import { z } from 'zod';
import { verifyInviteTokenSignature } from '../../lib/inviteManager';
import { planFor } from '../../lib/plans';
import { isWorkspaceMemberData, type Transaction } from '../db/firestore';
import { writeServerAuditLog } from '../services/auditLogService';
import { notify } from '../services/notificationService';
import { CommandRefusal } from '../utils/commandExecutor';
import { COMMAND_ROLES, type CommandContext, type CommandDefinition } from './types';

export const inviteTokenParamsSchema = z.object({ token: z.string().min(10, 'Token too short').max(256, 'Token too long') });
const input = inviteTokenParamsSchema.strict();
type Invite = Parameters<typeof verifyInviteTokenSignature>[0] & { status?: string };
type Context = Pick<CommandContext, 'db' | 'user'>;

function requireVerifiedEmail(user: Context['user']): void {
  // Membership is the result of the command, not the authority for running it (#842).
  if (user.email_verified !== true) {
    throw new CommandRefusal('Verify your email address first, then open the invitation again.', 403, 'VERIFIED_EMAIL_REQUIRED');
  }
}

async function target({ db, user }: Context, { token }: z.output<typeof input>, tx?: Transaction) {
  requireVerifiedEmail(user);
  const search = db.collection('invites').where('token', '==', token).limit(1);
  const inviteDoc = (await (tx ? tx.get(search) : search.get())).docs[0];
  if (!inviteDoc) throw new CommandRefusal('Invite not found or invalid token', 404, 'NOT_FOUND');
  const invite = inviteDoc.data() as Invite;
  if (invite.status !== 'pending') {
    throw new CommandRefusal(`Invite is no longer pending (currently ${invite.status})`, 400, 'INVITE_ALREADY_USED');
  }
  if (new Date() > new Date(invite.expiresAt)) throw new CommandRefusal('Invite has expired', 400, 'INVITE_EXPIRED');
  if (!verifyInviteTokenSignature(invite)) throw new CommandRefusal('Invalid invite token signature', 400, 'INVALID_INVITE');
  if ((user.email || '').toLowerCase().trim() !== invite.email.toLowerCase().trim()) {
    throw new CommandRefusal(`This invitation was issued to ${invite.email}, but you are currently signed in as ${user.email}. Please sign in with ${invite.email} to accept this invite.`, 403, 'INVITE_EMAIL_MISMATCH');
  }
  const wsRef = db.collection('workspaces').doc(invite.workspaceId);
  const ws = await (tx ? tx.get(wsRef) : wsRef.get());
  if (!ws.exists) throw new CommandRefusal('Workspace not found', 404, 'WORKSPACE_NOT_FOUND');
  const data = ws.data() || {};
  const members: string[] = Array.isArray(data.members) ? [...data.members] : [];
  // The signed invitation authorizes joining. Only an existing roster entry exempts a caller from
  // the legacy seat check; ownership, role-only/admin access and platform admin do not.
  const alreadyListed = isWorkspaceMemberData({ members }, { uid: user.uid });
  const maxSeats = data.maxSeats || Math.max(5, planFor(String(data.plan || 'free')).limits.seats);
  if (data.bypassBilling !== true && !alreadyListed && new Set([...members, data.uid || 'owner']).size >= maxSeats) {
    throw new CommandRefusal('Payment Required: Workspace seat limit reached. The workspace owner must upgrade the plan.', 402, 'SEAT_LIMIT_EXCEEDED');
  }
  return { inviteRef: inviteDoc.ref, invite, wsRef, data, members, alreadyListed };
}

export const inviteAcceptCommand: CommandDefinition<typeof input, { workspaceId: string; role?: string }> = {
  name: 'invite.accept', input, scope: 'person', roles: COMMAND_ROLES, peopleOnly: true, risk: 'high',
  async authorizeInput({ user }) { requireVerifiedEmail(user); },
  async handler(ctx, tx, fields) {
    const { inviteRef, invite, wsRef, data, members, alreadyListed } = await target(ctx, fields, tx);
    if (!alreadyListed) members.push(ctx.actor);
    const now = new Date().toISOString();
    tx.update(wsRef, { members, roles: { ...(data.roles || {}), [ctx.actor]: invite.role }, updatedAt: now });
    tx.update(inviteRef, { status: 'accepted', acceptedAt: now, acceptedByUid: ctx.actor, updatedAt: now });
    // The audit goes in the book the person joined, not in their personal operation-key scope.
    await writeServerAuditLog({
      workspaceId: invite.workspaceId, uid: ctx.actor, email: ctx.email || '', action: 'INVITE_ACCEPTED',
      entityType: 'workspace', entityId: invite.workspaceId,
      details: { email: invite.email, role: invite.role, inviteId: inviteRef.id,
        description: `User ${ctx.email} accepted workspace invitation as ${invite.role}` },
    }, { db: ctx.db, tx });
    ctx.afterCommit(async () => {
      await notify(ctx.db, { workspaceId: invite.workspaceId, kind: 'member.joined',
        title: `${ctx.email || invite.email} joined the workspace`, message: `They accepted the invitation as ${invite.role}.`,
        eventKey: `member.joined:${inviteRef.id}`, actorUid: ctx.actor });
    });
    return { workspaceId: invite.workspaceId, role: invite.role };
  },
  async preview(ctx, fields) {
    const { invite, data } = await target(ctx, fields);
    return { title: `Join ${String(data.name || 'the workspace')}`, lines: [`Role: ${invite.role}`, 'Uses this invitation once.'] };
  },
  audit: () => null,
  describe: {
    sentence: 'Join a workspace using an invitation addressed to your verified email; do not use this to invite another person or assign a role.',
    example: { token: 'example-invitation-token' },
    refusals: [
      { code: 'VERIFIED_EMAIL_REQUIRED', when: 'The signed-in person has not verified their email.', next: 'Verify the address on the invite.' },
      { code: 'INVITE_EMAIL_MISMATCH', when: 'The sign-in does not use the invited address.', next: 'Sign in with the address on your invite.' },
      { code: 'NOT_FOUND', when: 'The token is unknown.', next: 'Ask the owner for an invitation.' },
      { code: 'INVALID_INVITE', when: 'The token does not match the terms of the invitation.', next: 'Ask for a new invitation.' },
      { code: 'INVITE_EXPIRED', when: 'The invitation is no longer valid.', next: 'Ask for a fresh invitation.' },
      { code: 'INVITE_ALREADY_USED', when: 'The invitation is no longer pending.', next: 'Open the workspace if you already joined, or ask for a fresh invitation.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Ask the owner which workspace to join.' },
      { code: 'SEAT_LIMIT_EXCEEDED', when: 'The workspace has no seat left for another person.', next: 'Ask the owner to free a seat or upgrade.' },
    ],
  },
};
