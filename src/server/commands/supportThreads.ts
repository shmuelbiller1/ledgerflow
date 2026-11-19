import { z } from 'zod';
import type { SupportMessage, SupportTicket } from '../../types';
import type { RequestUser } from '../auth/requestUser';
import { isWorkspaceMemberData, type Transaction } from '../db/firestore';
import { writeServerAuditLog } from '../services/auditLogService';
import { sendSupportNotification } from '../services/emailService';
import { deferEffects } from '../services/sandboxEffects';
import { CommandRefusal } from '../utils/commandExecutor';
import { COMMAND_ROLES, type CommandContext, type CommandDefinition } from './types';

const ticketId = z.string().min(1);
export const threadReplyFields = z.object({
  body: z.string().min(1, 'Message body is required').max(5000, 'Message body must be under 5000 characters'),
  authorRole: z.enum(['user', 'admin']),
});
export const platformStatusFields = z.object({ status: z.enum(['open', 'pending_user', 'pending_support', 'resolved', 'closed']) });
const replyInput = threadReplyFields.extend({ ticketId }).strict();
const statusInput = platformStatusFields.extend({ ticketId }).strict();
type ReadContext = Pick<CommandContext, 'db' | 'user'>;

const isAdmin = (user: RequestUser) => Boolean(user.admin || user.role === 'admin');

async function readTicket(ctx: ReadContext, id: string, tx?: Transaction) {
  const ref = ctx.db.collection('supportTickets').doc(id);
  const snap = await (tx ? tx.get(ref) : ref.get());
  if (!snap.exists) throw new CommandRefusal('Ticket not found', 404, 'NOT_FOUND');
  return { ref, ticket: snap.data() as SupportTicket };
}

/** A thread can outlive its opener's membership. This is not a workspace support.message. */
async function replyTarget(ctx: ReadContext, { ticketId, authorRole }: z.output<typeof replyInput>, tx?: Transaction) {
  const target = await readTicket(ctx, ticketId, tx);
  if (authorRole === 'admin') {
    if (!isAdmin(ctx.user)) throw new CommandRefusal('Forbidden: Admin role required', 403, 'ADMIN_REQUIRED');
  } else if (!isAdmin(ctx.user) && target.ticket.uid !== ctx.user.uid) {
    const ws = ctx.db.collection('workspaces').doc(target.ticket.workspaceId);
    const snapshot = await (tx ? tx.get(ws) : ws.get());
    if (!snapshot.exists || !isWorkspaceMemberData(snapshot.data(), ctx.user, target.ticket.workspaceId)) {
      throw new CommandRefusal('Forbidden: Access denied to this workspace', 403, 'NOT_A_MEMBER');
    }
  }
  return target;
}

async function moveTarget(ctx: ReadContext, id: string, tx?: Transaction) {
  if (!isAdmin(ctx.user)) throw new CommandRefusal('Forbidden', 403, 'ADMIN_REQUIRED');
  return readTicket(ctx, id, tx);
}

async function notifyOpener(db: CommandContext['db'], ticket: SupportTicket, body: string) {
  try {
    const opener = (await db.collection('users').doc(ticket.uid).get()).data();
    if (opener?.email) await sendSupportNotification({
      toEmail: String(opener.email), subject: `Support Update: ${ticket.subject}`, ticketSubject: ticket.subject, messageBody: body,
    });
  } catch {
    // The message is already committed. Do not log the address, body, or a provider response.
    console.error('Support reply notification failed');
  }
}

export const supportThreadReplyCommand: CommandDefinition<typeof replyInput, SupportMessage> = {
  name: 'support.reply', input: replyInput, scope: 'person', roles: COMMAND_ROLES, peopleOnly: true,
  async authorizeInput(ctx, input) { await replyTarget(ctx, input); },
  async handler(ctx, tx, input) {
    const { ref, ticket } = await replyTarget(ctx, input, tx);
    const { ticketId, body, authorRole } = input;
    const messageRef = ctx.db.collection('supportMessages').doc();
    const createdAt = new Date().toISOString();
    const message: SupportMessage = {
      id: messageRef.id, ticketId, workspaceId: ticket.workspaceId, authorUid: ctx.actor, authorRole, body, createdAt,
    };
    tx.create(messageRef, { ...message });
    tx.update(ref, {
      lastMessageAt: createdAt, lastMessageBy: ctx.actor, updatedAt: createdAt,
      unreadForUser: authorRole === 'admin', unreadForAdmin: authorRole === 'user',
      status: authorRole === 'admin' ? 'pending_user' : 'pending_support',
    });
    if (authorRole === 'admin') {
      // Person-scoped authorization/retry, but the original platform audit belongs to the ticket's book.
      await writeServerAuditLog({
        workspaceId: ticket.workspaceId || 'system', uid: ctx.actor, email: ctx.email || '',
        action: 'SUPPORT_ADMIN_REPLY', entityType: 'supportTicket', entityId: ticketId,
        details: { description: `Admin replied to support ticket ${ticketId}`, body: body.slice(0, 100) },
      }, { db: ctx.db, tx });
      deferEffects(ctx.db, [{ kind: 'email', action: 'send', target: ticketId }], ctx.afterCommit, () => notifyOpener(ctx.db, ticket, body));
    }
    return message;
  },
  async preview(ctx, input) {
    const { ticket } = await replyTarget(ctx, input);
    return { title: 'Reply to the support thread', lines: [ticket.subject, input.authorRole === 'admin' ? 'Notifies the opener after the reply is saved.' : 'Marks the thread as waiting on support.'] };
  },
  audit: () => null,
  risk: 'normal',
  describe: {
    sentence: 'Reply to an existing support thread as its opener, a workspace member, or platform support; do not use this to open a new ticket.',
    example: { ticketId: 'ticket_1', body: 'Here is the missing detail.', authorRole: 'user' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The ticket no longer exists.', next: 'Open an existing support thread.' },
      { code: 'NOT_A_MEMBER', when: 'The caller neither opened the thread nor belongs to its workspace.', next: 'Choose a thread you can access.' },
      { code: 'ADMIN_REQUIRED', when: 'A caller without the platform role wants to reply as support.', next: 'Reply as yourself.' },
    ],
  },
};

export const supportPlatformStatusCommand: CommandDefinition<typeof statusInput, { ticketId: string; status: string }> = {
  name: 'support.platformstatus', input: statusInput, scope: 'person', roles: COMMAND_ROLES, peopleOnly: true,
  async authorizeInput(ctx, input) { await moveTarget(ctx, input.ticketId); },
  async handler(ctx, tx, { ticketId, status }) {
    const { ref, ticket } = await moveTarget(ctx, ticketId, tx);
    tx.update(ref, { status, updatedAt: new Date().toISOString() });
    await writeServerAuditLog({
      workspaceId: ticket.workspaceId || 'system', uid: ctx.actor, email: ctx.email || '',
      action: 'SUPPORT_TICKET_STATUS_CHANGE', entityType: 'supportTicket', entityId: ticketId,
      details: { description: `Support ticket ${ticketId} status changed to ${status}`, newStatus: status },
    }, { db: ctx.db, tx });
    return { ticketId, status };
  },
  async preview(ctx, { ticketId, status }) {
    const { ticket } = await moveTarget(ctx, ticketId);
    return { title: `Set the support status to ${status}`, lines: [ticket.subject, 'Does not change unread flags or send a reply.'] };
  },
  // The workspace audit is written above within the runner's transaction.
  audit: () => null,
  risk: 'normal',
  describe: {
    sentence: 'Change the stage of a support ticket as a platform administrator without sending a reply or marking it read.',
    example: { ticketId: 'ticket_1', status: 'resolved' },
    refusals: [
      { code: 'ADMIN_REQUIRED', when: 'Only platform support can use this command.', next: 'Ask the platform support team to triage the ticket.' },
      { code: 'NOT_FOUND', when: 'The ticket no longer exists.', next: 'Reload the support queue.' },
    ],
  },
};
