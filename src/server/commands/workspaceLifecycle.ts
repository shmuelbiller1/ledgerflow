import { z } from 'zod';
import { FieldValue } from '../db/firestore';
import type { CommandDefinition } from './types';

export const workspaceCancelDeletionInput = z.object({}).strict();
export type WorkspaceCancelDeletionResult = { workspaceId: string; restoredAt: string };

export class WorkspaceLifecycleError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message);
    this.name = 'WorkspaceLifecycleError';
  }
}

function assertPendingDeletion(status: unknown): void {
  if (status !== 'pending_deletion') {
    throw new WorkspaceLifecycleError(400, 'Workspace is not pending deletion', 'WORKSPACE_NOT_PENDING_DELETION');
  }
}

export const workspaceCancelDeletionCommand: CommandDefinition<typeof workspaceCancelDeletionInput, WorkspaceCancelDeletionResult> = {
  name: 'workspace.canceldeletion',
  input: workspaceCancelDeletionInput,
  roles: ['owner'],
  async handler(ctx, tx) {
    const ref = ctx.db.collection('workspaces').doc(ctx.workspaceId);
    const workspace = (await tx.get(ref)).data();
    if (!workspace) throw new WorkspaceLifecycleError(404, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
    assertPendingDeletion(workspace.status);
    const restoredAt = new Date().toISOString();
    tx.update(ref, {
      status: 'active',
      deletedAt: FieldValue.delete(),
      scheduledPurgeAt: FieldValue.delete(),
      updatedAt: restoredAt,
    });
    return { workspaceId: ctx.workspaceId, restoredAt };
  },
  async preview(ctx) {
    assertPendingDeletion(ctx.workspace.status);
    return {
      title: 'Restore workspace',
      lines: ['Cancel the scheduled deletion and return the workspace to active status'],
    };
  },
  audit(_input, result) {
    return {
      action: 'WORKSPACE_RESTORED',
      entityType: 'workspace',
      entityId: result.workspaceId,
      description: 'Workspace restored from pending deletion',
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Cancel a pending workspace deletion and restore access; do not use this to undo individual record changes.',
    example: {},
    refusals: [
      { code: 'WORKSPACE_NOT_PENDING_DELETION', when: 'The workspace is not scheduled for deletion.', next: 'Choose a workspace currently marked pending deletion.' },
      { code: 'WORKSPACE_NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not the workspace owner.', next: 'Ask the workspace owner to restore the workspace.' },
    ],
  },
};
