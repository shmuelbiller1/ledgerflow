import type { Firestore, Transaction as FirestoreTransaction } from '../db/firestore';
import { workspaceRole } from '../../lib/periodLock';
import { MAX_OPEN_TASKS, TASK_KIND, taskProblem, type Task, type TaskInput } from '../../lib/tasks';
import { writeServerAuditLog } from './auditLogService';
import { notify } from './notificationService';
import { notifyMentions } from './mentionService';

/**
 * Tasks (BG-02, BG-03, src/lib/tasks.ts). Owners, accountants and bookkeepers give tasks to anyone in
 * the workspace (viewers too: an owner who only reads can still be asked to look at something). The
 * person given a task, whoever made it and owners mark it done or open again; whoever made it and
 * owners remove it. The person is told when given one, and whoever made it when it is done.
 */
export class TaskError extends Error {
  readonly code: string;
  constructor(readonly status: number, message: string, code?: string) {
    super(message);
    this.code = code || (status === 400 ? 'INVALID_INPUT' : status === 403 ? 'ROLE_REQUIRED' : status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'TASK_ERROR');
  }
}

const GIVERS = ['owner', 'accountant', 'bookkeeper'];
interface Actor { workspaceId: string; uid: string; email?: string }

async function workspaceOf(db: Firestore, workspaceId: string) {
  const ws = (await db.collection('workspaces').doc(workspaceId).get()).data();
  if (!ws) throw new TaskError(404, 'Workspace not found');
  return ws;
}
const peopleOf = (ws: Record<string, unknown>) => [...new Set([...(Array.isArray(ws.members) ? ws.members.map(String) : []), ...(ws.uid ? [String(ws.uid)] : [])])];

/** The workspace's tasks and the people who can be given one (with their email when known). */
export async function listTasks(db: Firestore, input: Actor) {
  const ws = await workspaceOf(db, input.workspaceId);
  const snap = await db.collection('documents').where('workspaceId', '==', input.workspaceId).where('kind', '==', TASK_KIND).get();
  const tasks = snap.docs.map(d => ({ ...(d.data() as Task), id: d.id }));
  const people = await Promise.all(peopleOf(ws).map(async uid => {
    const email = (await db.collection('users').doc(uid).get()).data()?.email;
    return { uid, role: workspaceRole(ws as never, uid), ...(typeof email === 'string' && email ? { email } : {}) };
  }));
  return { tasks, people };
}

export async function createTask(db: Firestore, input: Actor & { task: TaskInput }) {
  const problem = taskProblem(input.task);
  if (problem) throw new TaskError(400, problem);
  const ws = await workspaceOf(db, input.workspaceId);
  if (!GIVERS.includes(workspaceRole(ws as never, input.uid))) throw new TaskError(403, 'Only owners, accountants and bookkeepers give tasks');
  const assignee = String(input.task.assignee);
  if (!peopleOf(ws).includes(assignee)) throw new TaskError(400, 'That person is not in this workspace');
  const open = await db.pool.query<{ n: number }>(`select count(*)::int as n from public.documents where workspace_id = $1 and data->>'kind' = $2 and data->>'status' = 'open'`, [input.workspaceId, TASK_KIND]);
  if ((open.rows[0]?.n || 0) >= MAX_OPEN_TASKS) throw new TaskError(409, `${MAX_OPEN_TASKS} open tasks at most: finish or remove some first`);
  const ref = db.collection('documents').doc();
  const record = input.task.record as Task['record'] | null | undefined;
  const task: Omit<Task, 'id'> = {
    kind: TASK_KIND, workspaceId: input.workspaceId, title: String(input.task.title).trim(),
    ...(typeof input.task.note === 'string' && input.task.note.trim() ? { note: input.task.note.trim() } : {}),
    assignee, createdBy: input.uid, ...(input.email ? { createdByEmail: input.email } : {}), createdAt: new Date().toISOString(),
    ...(typeof input.task.due === 'string' && input.task.due ? { due: input.task.due } : {}),
    ...(record ? { record: { type: record.type, id: record.id, label: record.label.trim() } } : {}),
    status: 'open',
  };
  await db.runTransaction(async t => {
    t.set(ref, task);
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'TASK_CREATED', entityType: 'documents', entityId: ref.id,
      details: { description: `Task "${task.title}"${task.record ? ` about ${task.record.label}` : ''}${assignee === input.uid ? '' : ' given to a teammate'}` },
    }, { db, tx: t });
  });
  if (assignee !== input.uid) {
    await notify(db, {
      workspaceId: input.workspaceId, kind: 'task.assigned', title: `A task for you: ${task.title}`,
      message: `${input.email || 'A teammate'} asked you${task.record ? ` about ${task.record.label}` : ''}${task.due ? `, by ${task.due}` : ''}.`,
      eventKey: `task-assigned:${ref.id}`, recordId: ref.id, actorUid: input.uid, onlyUids: [assignee],
    });
  }
  await notifyMentions(db, { workspaceId: input.workspaceId, text: `${task.title}${task.note ? `\n${task.note}` : ''}`, actorUid: input.uid, actorEmail: input.email, where: `Task "${task.title}"`, recordId: ref.id, eventKey: `task:${ref.id}`, kind: 'mention.task' });
  return { task: { ...task, id: ref.id } };
}

async function taskFor(db: Firestore, input: Actor & { taskId: string }) {
  const ws = await workspaceOf(db, input.workspaceId);
  const ref = db.collection('documents').doc(input.taskId);
  const task = (await ref.get()).data() as Task | undefined;
  if (!task || task.kind !== TASK_KIND || task.workspaceId !== input.workspaceId) throw new TaskError(404, 'That task is not in this workspace');
  return { ws, ref, task, owner: workspaceRole(ws as never, input.uid) === 'owner' };
}

export async function setTaskStatus(db: Firestore, input: Actor & { taskId: string; status: unknown }) {
  if (input.status !== 'open' && input.status !== 'done') throw new TaskError(400, 'A task is open or done');
  const { ref, task, owner } = await taskFor(db, input);
  if (!owner && input.uid !== task.assignee && input.uid !== task.createdBy) throw new TaskError(403, 'Only the person given the task, whoever made it, or an owner changes it');
  if (task.status === input.status) return { task: { ...task, id: ref.id } };
  const now = new Date().toISOString();
  const next: Partial<Task> = input.status === 'done' ? { status: 'done', doneAt: now, doneBy: input.uid } : { status: 'open', doneAt: undefined, doneBy: undefined };
  await db.runTransaction(async t => {
    t.update(ref, input.status === 'done' ? next : { status: 'open', doneAt: null, doneBy: null });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: input.status === 'done' ? 'TASK_DONE' : 'TASK_REOPENED', entityType: 'documents', entityId: ref.id,
      details: { description: `Task "${task.title}" ${input.status === 'done' ? 'done' : 'opened again'}` },
    }, { db, tx: t });
  });
  if (input.status === 'done' && task.createdBy !== input.uid) {
    await notify(db, {
      workspaceId: input.workspaceId, kind: 'task.done', title: `Done: ${task.title}`,
      message: `${input.email || 'A teammate'} marked it done${task.record ? ` (${task.record.label})` : ''}.`,
      eventKey: `task-done:${ref.id}:${now}`, recordId: ref.id, actorUid: input.uid, onlyUids: [task.createdBy],
    });
  }
  const { doneAt: _a, doneBy: _b, ...rest } = task;
  return { task: { ...(input.status === 'done' ? task : rest), ...next, id: ref.id } };
}

export async function removeTask(db: Firestore, input: Actor & { taskId: string }) {
  const { ref, task, owner } = await taskFor(db, input);
  if (!owner && input.uid !== task.createdBy) throw new TaskError(403, 'Only whoever made the task, or an owner, removes it');
  await db.runTransaction(async t => {
    t.delete(ref);
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'TASK_REMOVED', entityType: 'documents', entityId: ref.id,
      details: { description: `Removed the task "${task.title}"` },
    }, { db, tx: t });
  });
}

/** The command runner owns this transaction; notifications are scheduled by the command after commit. */
export async function createTaskInTransaction(db: Firestore, tx: FirestoreTransaction, input: Actor & { task: TaskInput }): Promise<Task> {
  const problem = taskProblem(input.task);
  if (problem) throw new TaskError(400, problem);
  const ws = (await tx.get(db.collection('workspaces').doc(input.workspaceId))).data();
  if (!ws) throw new TaskError(404, 'Workspace not found');
  if (!GIVERS.includes(workspaceRole(ws as never, input.uid))) throw new TaskError(403, 'Only owners, accountants and bookkeepers give tasks');
  const assignee = String(input.task.assignee);
  if (!peopleOf(ws).includes(assignee)) throw new TaskError(400, 'That person is not in this workspace');
  const open = await tx.get(db.collection('documents')
    .where('workspaceId', '==', input.workspaceId).where('kind', '==', TASK_KIND).where('status', '==', 'open'));
  if (open.size >= MAX_OPEN_TASKS) throw new TaskError(409, `${MAX_OPEN_TASKS} open tasks at most: finish or remove some first`);
  const ref = db.collection('documents').doc();
  const record = input.task.record as Task['record'] | null | undefined;
  const task: Omit<Task, 'id'> = {
    kind: TASK_KIND,
    workspaceId: input.workspaceId,
    title: String(input.task.title).trim(),
    ...(typeof input.task.note === 'string' && input.task.note.trim() ? { note: input.task.note.trim() } : {}),
    assignee,
    createdBy: input.uid,
    ...(input.email ? { createdByEmail: input.email } : {}),
    createdAt: new Date().toISOString(),
    ...(typeof input.task.due === 'string' && input.task.due ? { due: input.task.due } : {}),
    ...(record ? { record: { type: record.type, id: record.id, label: record.label.trim() } } : {}),
    status: 'open',
  };
  tx.create(ref, task);
  return { ...task, id: ref.id };
}

async function taskForInTransaction(db: Firestore, tx: FirestoreTransaction, input: Actor & { taskId: string }) {
  const workspace = (await tx.get(db.collection('workspaces').doc(input.workspaceId))).data();
  if (!workspace) throw new TaskError(404, 'Workspace not found');
  const ref = db.collection('documents').doc(input.taskId);
  const snapshot = await tx.get(ref);
  const task = snapshot.data() as Task | undefined;
  if (!task || task.kind !== TASK_KIND || task.workspaceId !== input.workspaceId) throw new TaskError(404, 'That task is not in this workspace');
  return { ref, task, owner: workspaceRole(workspace as never, input.uid) === 'owner' };
}

export async function setTaskStatusInTransaction(
  db: Firestore,
  tx: FirestoreTransaction,
  input: Actor & { taskId: string; status: unknown },
): Promise<{ task: Task; previousStatus: Task['status']; changed: boolean }> {
  if (input.status !== 'open' && input.status !== 'done') throw new TaskError(400, 'A task is open or done');
  const { ref, task, owner } = await taskForInTransaction(db, tx, input);
  if (!owner && input.uid !== task.assignee && input.uid !== task.createdBy) {
    throw new TaskError(403, 'Only the person given the task, whoever made it, or an owner changes it');
  }
  if (task.status === input.status) return { task: { ...task, id: ref.id }, previousStatus: task.status, changed: false };
  const now = new Date().toISOString();
  const next: Partial<Task> = input.status === 'done'
    ? { status: 'done', doneAt: now, doneBy: input.uid }
    : { status: 'open', doneAt: undefined, doneBy: undefined };
  tx.update(ref, input.status === 'done' ? next : { status: 'open', doneAt: null, doneBy: null });
  const { doneAt: _doneAt, doneBy: _doneBy, ...rest } = task;
  return {
    task: { ...(input.status === 'done' ? task : rest), ...next, id: ref.id },
    previousStatus: task.status,
    changed: true,
  };
}

export async function removeTaskInTransaction(
  db: Firestore,
  tx: FirestoreTransaction,
  input: Actor & { taskId: string },
): Promise<Task> {
  const { ref, task, owner } = await taskForInTransaction(db, tx, input);
  if (!owner && input.uid !== task.createdBy) throw new TaskError(403, 'Only whoever made the task, or an owner, removes it');
  tx.delete(ref);
  return task;
}
