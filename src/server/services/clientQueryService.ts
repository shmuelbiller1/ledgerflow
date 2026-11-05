import crypto from 'crypto';
import { notifyMentions } from './mentionService';
import type { Firestore } from '../db/firestore';
import { workspaceRole } from '../../lib/periodLock';
import { workspaceMemberIds } from '../../lib/notifications';
import {
  ASKER_ROLES, MAX_MESSAGES, MAX_OPEN_PER_ENTRY, questionProblem, replyProblem,
  type ClientQuery, type ClientQueryMessage,
} from '../../lib/clientQueries';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import { writeServerAuditLog } from './auditLogService';
import { notify } from './notificationService';

/**
 * Client queries (BD-07): owners, accountants and bookkeepers ask about an entry; any member answers
 * (the owner, usually); the asker follows up or closes it. Only the server writes `clientQueries`
 * (members read it), so who may do what is decided here. Each step notifies the other side and is
 * in the audit trail.
 */
export class QueryError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

interface Actor { workspaceId: string; uid: string; email?: string }
type Tx = Parameters<Parameters<Firestore['runTransaction']>[0]>[0];

async function memberRole(db: Firestore, t: Tx, input: Actor) {
  const ws = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
  if (!ws) throw new QueryError(404, 'Workspace not found');
  if (!workspaceMemberIds(ws as never).includes(input.uid)) throw new QueryError(403, 'Only members of this workspace see its questions');
  return { ws, role: workspaceRole(ws as never, input.uid) };
}

const short = (text: string, n = 80) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** A new question on an entry of this workspace. */
export async function askQuery(db: Firestore, input: Actor & { transactionId: string; question: string }): Promise<ClientQuery> {
  const problem = questionProblem(input.question);
  if (problem) throw new QueryError(400, problem);
  const question = input.question.trim();
  const query = await db.runTransaction(async t => {
    const { role } = await memberRole(db, t, input);
    if (!ASKER_ROLES.includes(role)) throw new QueryError(403, 'Viewers answer questions but do not ask them');
    const entry = (await t.get(db.collection('transactions').doc(input.transactionId))).data();
    if (!entry || entry.workspaceId !== input.workspaceId) throw new QueryError(404, 'That entry is not in this workspace');
    const open = await t.get(db.collection('clientQueries').where('workspaceId', '==', input.workspaceId).where('transactionId', '==', input.transactionId));
    if (open.docs.filter(d => d.data().status !== 'closed').length >= MAX_OPEN_PER_ENTRY) {
      throw new QueryError(409, `This entry already has ${MAX_OPEN_PER_ENTRY} open questions; close one first`);
    }
    const now = new Date().toISOString();
    const id = `cq_${crypto.randomBytes(10).toString('hex')}`;
    const data: Omit<ClientQuery, 'id'> = {
      workspaceId: input.workspaceId,
      transactionId: input.transactionId,
      entry: {
        date: String(entry.date || '').slice(0, 10),
        description: String(entry.description || entry.payee || '').slice(0, 200),
        amountCents: Math.abs(Number(entry.totalAmountCents) || 0),
        currency: String(entry.currency || 'USD'),
      },
      askedBy: input.uid,
      ...(input.email ? { askedByEmail: input.email } : {}),
      askedAt: now,
      status: 'open',
      messages: [{ uid: input.uid, ...(input.email ? { email: input.email } : {}), text: question, at: now }],
      updatedAt: now,
    };
    const record: ClientQuery = { id, ...data };
    t.set(db.collection('clientQueries').doc(id), data);
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'CLIENT_QUERY_ASKED', entityType: 'transactions', entityId: input.transactionId,
      details: { description: `Asked about "${short(record.entry.description || input.transactionId)}": ${short(question, 120)}`, queryId: id },
    }, { db, tx: t });
    return record;
  });
  const what = `${query.entry.date} · ${query.entry.description || 'an entry'} · ${formatCurrency(query.entry.amountCents, query.entry.currency)}`;
  await notify(db, {
    workspaceId: input.workspaceId, kind: 'query.asked', title: 'A question about an entry',
    message: `${what}: ${short(question, 200)}`, eventKey: `query:${query.id}:0`, recordId: query.id, actorUid: input.uid,
  });
  await notifyMentions(db, { workspaceId: input.workspaceId, text: question, actorUid: input.uid, actorEmail: input.email, where: `A question about ${what}`, recordId: query.id, eventKey: `query:${query.id}:0`, kind: 'mention.query' });
  return query;
}

/**
 * An answer, or the asker's follow-up. An answer from anyone but the asker marks the question
 * answered; a follow-up from the asker puts it back to waiting.
 */
export async function replyToQuery(db: Firestore, input: Actor & { queryId: string; text: string }): Promise<ClientQuery> {
  const problem = replyProblem(input.text);
  if (problem) throw new QueryError(400, problem);
  const text = input.text.trim();
  const { query, byAsker } = await db.runTransaction(async t => {
    await memberRole(db, t, input);
    const ref = db.collection('clientQueries').doc(input.queryId);
    const current = (await t.get(ref)).data() as Omit<ClientQuery, 'id'> | undefined;
    if (!current || current.workspaceId !== input.workspaceId) throw new QueryError(404, 'That question is not in this workspace');
    if (current.status === 'closed') throw new QueryError(409, 'This question is closed; ask a new one');
    const messages = Array.isArray(current.messages) ? current.messages : [];
    if (messages.length >= MAX_MESSAGES) throw new QueryError(409, 'This conversation is long enough; close it and ask a new question');
    const now = new Date().toISOString();
    const message: ClientQueryMessage = { uid: input.uid, ...(input.email ? { email: input.email } : {}), text, at: now };
    const fromAsker = current.askedBy === input.uid;
    const next = { messages: [...messages, message], status: fromAsker ? 'open' as const : 'answered' as const, updatedAt: now };
    t.update(ref, next);
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: fromAsker ? 'CLIENT_QUERY_FOLLOW_UP' : 'CLIENT_QUERY_ANSWERED', entityType: 'transactions', entityId: current.transactionId,
      details: { description: `${fromAsker ? 'Followed up on' : 'Answered'} the question about "${short(current.entry?.description || current.transactionId)}": ${short(text, 120)}`, queryId: input.queryId },
    }, { db, tx: t });
    return { query: { ...current, ...next, id: input.queryId }, byAsker: fromAsker };
  });
  await notify(db, {
    workspaceId: input.workspaceId,
    kind: byAsker ? 'query.asked' : 'query.answered',
    title: byAsker ? 'A follow-up question about an entry' : 'Your question was answered',
    message: `${query.entry?.description || 'An entry'}: ${short(text, 200)}`,
    eventKey: `query:${input.queryId}:${query.messages.length - 1}`, recordId: input.queryId, actorUid: input.uid,
  });
  await notifyMentions(db, { workspaceId: input.workspaceId, text, actorUid: input.uid, actorEmail: input.email, where: `About ${query.entry?.description || 'an entry'}`, recordId: input.queryId, eventKey: `query:${input.queryId}:${query.messages.length - 1}`, kind: 'mention.query' });
  return query;
}

/** Done with it: the asker, an owner or an accountant closes a question. */
export async function closeQuery(db: Firestore, input: Actor & { queryId: string }): Promise<void> {
  await db.runTransaction(async t => {
    const { role } = await memberRole(db, t, input);
    const ref = db.collection('clientQueries').doc(input.queryId);
    const current = (await t.get(ref)).data() as Omit<ClientQuery, 'id'> | undefined;
    if (!current || current.workspaceId !== input.workspaceId) throw new QueryError(404, 'That question is not in this workspace');
    if (current.askedBy !== input.uid && role !== 'owner' && role !== 'accountant') {
      throw new QueryError(403, 'Only the person who asked, an owner or an accountant closes a question');
    }
    if (current.status === 'closed') return;
    const now = new Date().toISOString();
    t.update(ref, { status: 'closed', closedBy: input.uid, closedAt: now, updatedAt: now });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'CLIENT_QUERY_CLOSED', entityType: 'transactions', entityId: current.transactionId,
      details: { description: `Closed the question about "${short(current.entry?.description || current.transactionId)}"`, queryId: input.queryId },
    }, { db, tx: t });
  });
}
