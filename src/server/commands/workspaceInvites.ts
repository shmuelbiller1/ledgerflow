import { z } from 'zod';
import type { CommandDefinition } from './types';

export const workspaceInviteRevokeInput = z.object({
  inviteId: z.string().min(1).max(200),
}).strict();
type WorkspaceInviteRevokeInput = z.output<typeof workspaceInviteRevokeInput>;

export interface WorkspaceInviteRevokeResult {
  inviteId: string;
  previousStatus: string;
  changed: boolean;
}

export class WorkspaceInviteError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message);
    this.name = 'WorkspaceInviteError';
  }
}

async function readWorkspaceInvite(ctx: { db: import('../db/firestore').Firestore; workspaceId: string }, inviteId: string) {
  const invite = (await ctx.db.collection('invites').doc(inviteId).get()).data();
  if (!invite) throw new WorkspaceInviteError(404, 'Invite not found', 'INVITE_NOT_FOUND');
  if (invite.workspaceId !== ctx.workspaceId) throw new WorkspaceInviteError(403, 'Forbidden', 'WORKSPACE_MISMATCH');
  if (invite.status && invite.status !== 'pending' && invite.status !== 'revoked') {
    throw new WorkspaceInviteError(409, `Invite is no longer pending (currently ${invite.status})`, 'INVITE_NOT_PENDING');
  }
  return invite;
}

export const workspaceInviteRevokeCommand: CommandDefinition<typeof workspaceInviteRevokeInput, WorkspaceInviteRevokeResult> = {
  name: 'workspace.revokeinvite',
  peopleOnly: true,
  input: workspaceInviteRevokeInput,
  roles: ['owner'],
  async handler(ctx, tx, input: WorkspaceInviteRevokeInput) {
    const ref = ctx.db.collection('invites').doc(input.inviteId);
    const invite = (await tx.get(ref)).data();
    if (!invite) throw new WorkspaceInviteError(404, 'Invite not found', 'INVITE_NOT_FOUND');
    if (invite.workspaceId !== ctx.workspaceId) throw new WorkspaceInviteError(403, 'Forbidden', 'WORKSPACE_MISMATCH');
    const previousStatus = typeof invite.status === 'string' ? invite.status : 'pending';
    if (previousStatus === 'revoked') return { inviteId: input.inviteId, previousStatus, changed: false };
    if (previousStatus !== 'pending') {
      throw new WorkspaceInviteError(409, `Invite is no longer pending (currently ${previousStatus})`, 'INVITE_NOT_PENDING');
    }
    tx.update(ref, { status: 'revoked', updatedAt: new Date().toISOString() });
    return { inviteId: input.inviteId, previousStatus, changed: true };
  },
  async preview(ctx, input) {
    const invite = await readWorkspaceInvite(ctx, input.inviteId);
    const email = typeof invite.email === 'string' ? invite.email : 'this invite';
    return {
      title: invite.status === 'revoked' ? 'Workspace invite is already revoked' : 'Revoke workspace invite',
      lines: invite.status === 'revoked' ? ['No change will be made'] : [`Revoke the invite for ${email}`],
    };
  },
  audit(_input, result) {
    if (!result.changed) return null;
    return {
      action: 'INVITE_REVOKED',
      entityType: 'workspaceInvite',
      entityId: result.inviteId,
      description: 'Workspace invite revoked',
      details: { previousStatus: result.previousStatus },
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Revoke a pending workspace invite; do not use this to remove a person who has already joined the workspace.',
    example: { inviteId: 'invite_123' },
    refusals: [
      { code: 'INVITE_NOT_FOUND', when: 'The invite does not exist.', next: 'Reload the workspace invites and select a current invite.' },
      { code: 'WORKSPACE_MISMATCH', when: 'The invite belongs to another workspace.', next: 'Choose an invite from the selected workspace.' },
      { code: 'INVITE_NOT_PENDING', when: 'The invite has already been accepted or otherwise finalized.', next: 'Use workspace member management for an accepted invite; only pending invites can be revoked.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not the workspace owner.', next: 'Ask the workspace owner to revoke the invite.' },
    ],
  },
};
