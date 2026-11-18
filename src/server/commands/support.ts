import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import type { CommandContext, CommandDefinition } from './types';

/**
 * A support ticket, and the messages on it.
 *
 * `SupportView` and the feedback dialog wrote these collections from the browser with `setDoc` and `updateDoc`: the
 * ticket's `uid`, `workspaceId` and every timestamp came from the tab, the ticket and its first message were two
 * separate writes that could half-succeed (a ticket with no message), and the reply path had to guess whether the
 * server had already taken the message. `sendFeedback`'s batch was the one honest attempt at atomicity, and it ran in
 * the tab, so the row could still name a workspace the person had left.
 *
 * Two commands, because there are two acts:
 *
 * - `support.ticket` opens a ticket **and** its first message in one transaction. The message cannot exist without
 *   its ticket, and a ticket cannot exist without what the person wrote.
 * - `support.message` adds a reply and moves the ticket's unread flags and its stage, in one transaction — the same
 *   fields the support route sets, so a reply sent through either path reads the same.
 *
 * Both are workspace-scoped: a support ticket belongs to the books it was raised from, and its `uid` is the person
 * who opened it. A reply may be written by any member of that workspace (the route allows exactly that); a
 * `support.status` change is owner/accountant, which is what the screen's own triage rule was.
 */
const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');
const text = (max: number) => z.string().trim().max(max);
const STAGES = ['open', 'pending_user', 'pending_support', 'resolved', 'closed'] as const;

export const supportTicketInput = z.object({
  /** the id the screen minted, so a retry answers the ticket it already opened instead of a second one */
  id: idSchema,
  subject: text(200).min(1),
  body: text(5000).min(1),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  /** the diagnostics a crash report carries, when the person asked to include them */
  errorDiagnostics: z.record(z.string(), z.unknown()).optional(),
  errorLogId: text(200).optional(),
}).strict();

export const supportMessageInput = z.object({
  ticketId: idSchema,
  body: text(5000).min(1),
  /** `admin` only where the ticket's workspace is being answered by someone with the platform role; the screen sends `user` */
  authorRole: z.enum(['user', 'admin']).optional(),
}).strict();

export const supportStatusInput = z.object({
  ticketId: idSchema,
  status: z.enum(STAGES),
}).strict();

type TicketInput = z.output<typeof supportTicketInput>;
type MessageInput = z.output<typeof supportMessageInput>;
type StatusInput = z.output<typeof supportStatusInput>;
type TicketRow = Record<string, unknown> & { id?: string; workspaceId?: string; subject?: string; uid?: string };

export type SupportTicketOpened = { id: string; messageId: string; created: boolean };
export type SupportMessageAdded = { ticketId: string; messageId: string; status: string };
export type SupportStatusChanged = { ticketId: string; status: string };

const MEMBER_ROLES = ['owner', 'accountant', 'bookkeeper', 'viewer'] as const;
const TRIAGE_ROLES = ['owner', 'accountant'] as const;

/** The message row both commands write; the author is always the signed-in person. */
function messageRow(ticketId: string, workspaceId: string, authorUid: string, body: string, authorRole: 'user' | 'admin', createdAt: string) {
  return { ticketId, workspaceId, authorUid, authorRole, body, createdAt };
}

export const supportTicketCommand: CommandDefinition<typeof supportTicketInput, SupportTicketOpened> = {
  name: 'support.ticket',
  input: supportTicketInput,
  roles: MEMBER_ROLES,
  async handler(ctx: CommandContext, tx, input: TicketInput) {
    const ticketRef = ctx.db.collection('supportTickets').doc(input.id);
    const existing = await tx.get(ticketRef);
    if (existing.exists) {
      // a retry after a dropped answer: the ticket and its message are already there, and writing them again would
      // show the person's description twice
      const row = existing.data() as TicketRow;
      if (row.workspaceId !== ctx.workspaceId) {
        throw Object.assign(new HttpError('That ticket id is already used.', 409), { code: 'CONFLICT' });
      }
      return { id: input.id, messageId: `${input.id}-message`, created: false };
    }
    const now = new Date().toISOString();
    const messageId = `${input.id}-message`;
    tx.set(ticketRef, {
      id: input.id,
      workspaceId: ctx.workspaceId,
      uid: ctx.actor,
      subject: input.subject,
      status: 'open',
      priority: input.priority || 'normal',
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      lastMessageBy: ctx.actor,
      unreadForUser: false,
      unreadForAdmin: true,
      ...(input.errorDiagnostics ? { errorDiagnostics: input.errorDiagnostics } : {}),
      ...(input.errorLogId ? { errorLogId: input.errorLogId } : {}),
    });
    tx.set(ctx.db.collection('supportMessages').doc(messageId), messageRow(input.id, ctx.workspaceId, ctx.actor, input.body, 'user', now));
    return { id: input.id, messageId, created: true };
  },
  async preview(ctx: CommandContext, input: TicketInput) {
    const existing = await ctx.db.collection('supportTickets').doc(input.id).get();
    return existing.exists
      ? { title: 'This ticket is already open', lines: ['Nothing will be written'] }
      : { title: `Open the ticket “${input.subject}”`, lines: [input.body.slice(0, 120), input.errorDiagnostics ? 'with the diagnostics' : 'without diagnostics'] };
  },
  audit(_input, result) {
    return result.created
      ? { action: 'SUPPORT_TICKET_OPENED', entityType: 'supportTickets', entityId: result.id, description: `Opened the support ticket ${result.id}` }
      : null;
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Open a support ticket with the message that describes the problem, in one step; do not use it to reply — support.message does that.',
    example: { id: 'feedback-1', subject: 'Feedback: Reports', body: 'The totals do not add up' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'There is no subject or no message, or the message is over 5000 characters.', next: 'Send a subject and a message of 1–5000 characters.' },
      { code: 'CONFLICT', when: 'That ticket id already belongs to another workspace.', next: 'Let the screen mint a fresh id and try again.' },
    ],
    next: [{ command: 'support.message', label: 'Add to the conversation' }],
  },
};

export const supportMessageCommand: CommandDefinition<typeof supportMessageInput, SupportMessageAdded> = {
  name: 'support.message',
  input: supportMessageInput,
  roles: MEMBER_ROLES,
  async handler(ctx: CommandContext, tx, input: MessageInput) {
    const ticketRef = ctx.db.collection('supportTickets').doc(input.ticketId);
    const snapshot = await tx.get(ticketRef);
    const ticket = snapshot.data() as TicketRow | undefined;
    if (!snapshot.exists || ticket?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This ticket is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    const authorRole = input.authorRole || 'user';
    if (authorRole === 'admin' && ctx.user.role !== 'admin' && !ctx.user.admin) {
      throw Object.assign(new HttpError('Only a platform admin can reply as support.', 403), { code: 'ROLE_REQUIRED' });
    }
    const now = new Date().toISOString();
    const messageId = `${input.ticketId}-${now}-${Math.random().toString(36).slice(2, 8)}`;
    tx.set(ctx.db.collection('supportMessages').doc(messageId), messageRow(input.ticketId, ctx.workspaceId, ctx.actor, input.body, authorRole, now));
    const status = authorRole === 'admin' ? 'pending_user' : 'pending_support';
    tx.update(ticketRef, {
      lastMessageAt: now,
      lastMessageBy: ctx.actor,
      updatedAt: now,
      unreadForUser: authorRole === 'admin',
      unreadForAdmin: authorRole === 'user',
      status,
    });
    return { ticketId: input.ticketId, messageId, status };
  },
  async preview(ctx: CommandContext, input: MessageInput) {
    const snapshot = await ctx.db.collection('supportTickets').doc(input.ticketId).get();
    if (!snapshot.exists || (snapshot.data() as TicketRow)?.workspaceId !== ctx.workspaceId) {
      throw new HttpError('This ticket is not in the selected workspace.', 404);
    }
    return { title: 'Add a message to the ticket', lines: [input.body.slice(0, 160)] };
  },
  audit(_input, result) {
    return {
      action: 'SUPPORT_MESSAGE_ADDED',
      entityType: 'supportTickets',
      entityId: result.ticketId,
      description: `Added a message to the support ticket ${result.ticketId}`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Add a message to a support ticket and move its unread flags and stage; do not use it to open a ticket, which support.ticket does.',
    example: { ticketId: 'feedback-1', body: 'Here is the screenshot you asked for' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The message is empty or over 5000 characters.', next: 'Send a message of 1–5000 characters.' },
      { code: 'NOT_FOUND', when: 'The ticket is not in the selected workspace.', next: 'Reload support and choose a ticket in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller sends `authorRole: admin` without the platform role.', next: 'Reply as a user, or ask an administrator to answer.' },
    ],
  },
};

export const supportStatusCommand: CommandDefinition<typeof supportStatusInput, SupportStatusChanged> = {
  name: 'support.status',
  input: supportStatusInput,
  roles: TRIAGE_ROLES,
  async handler(ctx: CommandContext, tx, input: StatusInput) {
    const ticketRef = ctx.db.collection('supportTickets').doc(input.ticketId);
    const snapshot = await tx.get(ticketRef);
    const ticket = snapshot.data() as TicketRow | undefined;
    if (!snapshot.exists || ticket?.workspaceId !== ctx.workspaceId) {
      throw Object.assign(new HttpError('This ticket is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
    }
    tx.update(ticketRef, { status: input.status, updatedAt: new Date().toISOString(), unreadForUser: false });
    return { ticketId: input.ticketId, status: input.status };
  },
  async preview(ctx: CommandContext, input: StatusInput) {
    const snapshot = await ctx.db.collection('supportTickets').doc(input.ticketId).get();
    if (!snapshot.exists) throw new HttpError('This ticket is not in the selected workspace.', 404);
    return { title: `Mark the ticket ${input.status}`, lines: [String((snapshot.data() as TicketRow)?.subject || '')] };
  },
  audit(_input, result) {
    return {
      action: 'SUPPORT_TICKET_STATUS_CHANGED',
      entityType: 'supportTickets',
      entityId: result.ticketId,
      description: `Moved the support ticket ${result.ticketId} to ${result.status}`,
      details: { status: result.status },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Move a support ticket’s stage (open, waiting on either side, resolved, closed); do not use it to write to the ticket’s conversation.',
    example: { ticketId: 'feedback-1', status: 'resolved' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The ticket is not in the selected workspace.', next: 'Reload support and choose a ticket in this workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant.', next: 'Ask a workspace owner or accountant to triage the ticket.' },
    ],
  },
};
