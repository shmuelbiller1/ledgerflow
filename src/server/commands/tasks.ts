import { z } from 'zod';
import { TASK_KIND, taskProblem, type Task, type TaskInput } from '../../lib/tasks';
import { workspaceRole } from '../../lib/periodLock';
import { notify } from '../services/notificationService';
import { notifyMentions } from '../services/mentionService';
import {
  createTaskInTransaction,
  removeTaskInTransaction,
  setTaskStatusInTransaction,
  TaskError,
} from '../services/taskService';
import type { CommandDefinition } from './types';

const taskInputSchema = z.object({
  title: z.unknown().optional(),
  note: z.unknown().optional(),
  assignee: z.unknown().optional(),
  due: z.unknown().optional(),
  record: z.unknown().optional(),
}).passthrough();

export const taskCreateInput = z.object({ task: taskInputSchema }).strict();
export const taskStatusInput = z.object({ taskId: z.string().min(1).max(200), status: z.unknown().optional() }).strict();
export const taskRemoveInput = z.object({ taskId: z.string().min(1).max(200) }).strict();

type TaskCreateInput = z.output<typeof taskCreateInput>;
type TaskStatusInput = z.output<typeof taskStatusInput>;
type TaskRemoveInput = z.output<typeof taskRemoveInput>;

type TaskStatusResult = Awaited<ReturnType<typeof setTaskStatusInTransaction>>;
type TaskRecordResult = { task: Task };

export const taskCreateCommand: CommandDefinition<typeof taskCreateInput, TaskRecordResult> = {
  name: 'tasks.create',
  input: taskCreateInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, tx, input: TaskCreateInput) {
    const task = await createTaskInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, task: input.task as TaskInput,
    });
    ctx.afterCommit(async () => {
      if (task.assignee !== ctx.actor) {
        await notify(ctx.db, {
          workspaceId: ctx.workspaceId,
          kind: 'task.assigned',
          title: `A task for you: ${task.title}`,
          message: `${ctx.email || 'A teammate'} asked you${task.record ? ` about ${task.record.label}` : ''}${task.due ? `, by ${task.due}` : ''}.`,
          eventKey: `task-assigned:${task.id}`,
          recordId: task.id,
          actorUid: ctx.actor,
          onlyUids: [task.assignee],
        });
      }
      await notifyMentions(ctx.db, {
        workspaceId: ctx.workspaceId,
        text: `${task.title}${task.note ? `\n${task.note}` : ''}`,
        actorUid: ctx.actor,
        actorEmail: ctx.email,
        where: `Task "${task.title}"`,
        recordId: task.id,
        eventKey: `task:${task.id}`,
        kind: 'mention.task',
      });
    });
    return { task };
  },
  async preview(ctx, input) {
    const task = input.task as TaskInput;
    const problem = taskProblem(task);
    if (problem) throw new TaskError(400, problem);
    const assignee = String(task.assignee);
    const people = [...new Set([
      ...(Array.isArray(ctx.workspace.members) ? ctx.workspace.members.map(String) : []),
      ...(ctx.workspace.uid ? [String(ctx.workspace.uid)] : []),
    ])];
    if (!people.includes(assignee)) throw new TaskError(400, 'That person is not in this workspace');
    const person = await ctx.db.collection('users').doc(assignee).get();
    return {
      title: `Create task ${String(task.title).trim()}`,
      lines: [
        `Assigned to ${String(person.data()?.email || assignee)}`,
        ...(typeof task.due === 'string' && task.due ? [`Due ${task.due}`] : []),
        ...(task.record && typeof task.record === 'object' && 'label' in task.record ? [`About ${String((task.record as { label: unknown }).label)}`] : []),
      ],
    };
  },
  audit(_input, result) {
    const task = result.task;
    return {
      action: 'TASK_CREATED',
      entityType: 'documents',
      entityId: task.id,
      description: `Task "${task.title}"${task.record ? ` about ${task.record.label}` : ''}${task.assignee === task.createdBy ? '' : ' given to a teammate'}`,
    };
  },
  inverse(_input, result) { return { command: 'tasks.remove', input: { taskId: result.task.id } }; },
  risk: 'normal',
  describe: {
    sentence: 'Create a task for a workspace teammate, optionally linked to a record and due date; do not use it to change a ledger record.',
    example: { task: { title: 'Review the Acme invoice', assignee: 'user_123', due: '2026-12-01', record: { type: 'invoice', id: 'invoice_123', label: 'Invoice INV-12' } } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The task details are incomplete or malformed.', next: 'Provide a clear title, a workspace assignee, and an optional valid due date or record.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not allowed to assign tasks.', next: 'Ask an owner, accountant, or bookkeeper to create the task.' },
      { code: 'NOT_FOUND', when: 'The workspace or assignee does not exist in this workspace.', next: 'Reload the workspace members and select an existing teammate.' },
      { code: 'CONFLICT', when: 'The workspace already has the maximum number of open tasks.', next: 'Complete or remove an open task before creating another.' },
    ],
  },
};

export const taskStatusCommand: CommandDefinition<typeof taskStatusInput, TaskStatusResult> = {
  name: 'tasks.status',
  input: taskStatusInput,
  roles: ['owner', 'accountant', 'bookkeeper', 'viewer'],
  async handler(ctx, tx, input: TaskStatusInput) {
    const result = await setTaskStatusInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, taskId: input.taskId, status: input.status,
    });
    if (result.changed && input.status === 'done' && result.task.createdBy !== ctx.actor) {
      ctx.afterCommit(async () => {
        await notify(ctx.db, {
          workspaceId: ctx.workspaceId,
          kind: 'task.done',
          title: `Done: ${result.task.title}`,
          message: `${ctx.email || 'A teammate'} marked it done${result.task.record ? ` (${result.task.record.label})` : ''}.`,
          eventKey: `task-done:${result.task.id}:${result.task.doneAt}`,
          recordId: result.task.id,
          actorUid: ctx.actor,
          onlyUids: [result.task.createdBy],
        });
      });
    }
    return result;
  },
  async preview(ctx, input) {
    if (input.status !== 'open' && input.status !== 'done') throw new TaskError(400, 'A task is open or done');
    const snapshot = await ctx.db.collection('documents').doc(input.taskId).get();
    const task = snapshot.data() as Task | undefined;
    if (!task || task.kind !== TASK_KIND || task.workspaceId !== ctx.workspaceId) throw new TaskError(404, 'That task is not in this workspace');
    const owner = workspaceRole(ctx.workspace as never, ctx.actor) === 'owner';
    if (!owner && ctx.actor !== task.assignee && ctx.actor !== task.createdBy) {
      throw new TaskError(403, 'Only the person given the task, whoever made it, or an owner changes it');
    }
    return { title: `${input.status === 'done' ? 'Complete' : 'Reopen'} task ${task.title}`, lines: [task.title] };
  },
  audit(_input, result) {
    if (!result.changed) return null;
    return {
      action: result.task.status === 'done' ? 'TASK_DONE' : 'TASK_REOPENED',
      entityType: 'documents',
      entityId: result.task.id,
      description: `Task "${result.task.title}" ${result.task.status === 'done' ? 'done' : 'opened again'}`,
    };
  },
  inverse(input, result) {
    return result.changed ? { command: 'tasks.status', input: { taskId: input.taskId, status: result.previousStatus } } : null;
  },
  risk: 'normal',
  describe: {
    sentence: 'Mark a task done or open again when you made it, were assigned it, or own the workspace; do not use it to edit the task details.',
    example: { taskId: 'task_123', status: 'done' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The requested status is not open or done.', next: 'Use status open or done.' },
      { code: 'NOT_FOUND', when: 'The task is not in the selected workspace.', next: 'Reload the task list and choose an existing task.' },
      { code: 'ROLE_REQUIRED', when: 'The caller did not create or receive this task and is not a workspace owner.', next: 'Ask the task creator, assignee, or workspace owner to change its status.' },
    ],
  },
};

export const taskRemoveCommand: CommandDefinition<typeof taskRemoveInput, Task> = {
  name: 'tasks.remove',
  input: taskRemoveInput,
  // Any member who created the task may remove it, even if their role changed after creation.
  roles: ['owner', 'accountant', 'bookkeeper', 'viewer'],
  async handler(ctx, tx, input: TaskRemoveInput) {
    return removeTaskInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, taskId: input.taskId,
    });
  },
  async preview(ctx, input) {
    const snapshot = await ctx.db.collection('documents').doc(input.taskId).get();
    const task = snapshot.data() as Task | undefined;
    if (!task || task.kind !== TASK_KIND || task.workspaceId !== ctx.workspaceId) throw new TaskError(404, 'That task is not in this workspace');
    if (workspaceRole(ctx.workspace as never, ctx.actor) !== 'owner' && ctx.actor !== task.createdBy) {
      throw new TaskError(403, 'Only whoever made the task, or an owner, removes it');
    }
    return { title: `Remove task ${task.title}`, lines: [task.title] };
  },
  audit(_input, task) {
    return { action: 'TASK_REMOVED', entityType: 'documents', entityId: task.id, description: `Removed the task "${task.title}"` };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Remove a task you created or any task as the workspace owner; do not use this for deleting an invoice, bill, or other financial record.',
    example: { taskId: 'task_123' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The task is not in the selected workspace.', next: 'Reload the task list and choose an existing task.' },
      { code: 'ROLE_REQUIRED', when: 'The caller did not create this task and is not the workspace owner.', next: 'Ask the task creator or workspace owner to remove it.' },
    ],
  },
};
