import express from 'express';
import { contactDeleteCommand, contactMergeCommand } from '../commands/workspaceHousekeeping';
import { executeCommand } from '../utils/commandExecutor';
import { legacyAnswer, workspaceInvocation } from '../utils/legacyCommandRoute';

/**
 * Merge duplicate customers or vendors (Y-23 BA-01; owner/accountant) and delete one that nothing
 * refers to (I-22; writers), mounted at /api/v1/workspaces/:workspaceId/contacts
 * (workspaceRoutes.ts). Both are registered commands (`contact.merge`, `contact.delete`), and the
 * answers are the ones the handlers gave — including the issues a malformed body answered.
 */
export const contactMergeRouter = express.Router({ mergeParams: true });

contactMergeRouter.post('/merge', async (req, res) => {
  await executeCommand(req, res, {
    ...workspaceInvocation(req, contactMergeCommand),
    formatResponse: legacyAnswer({ badBody: 'Invalid request', failed: 'The contacts could not be merged', issues: true }),
  });
});

contactMergeRouter.delete('/:side/:id', async (req, res) => {
  const params = req.params as Record<string, string>;
  await executeCommand(req, res, {
    ...workspaceInvocation(req, contactDeleteCommand, { side: params.side, id: params.id }),
    // ?check=1: may it be deleted? (nothing is deleted; the screen then offers Undo before deleting)
    formatResponse: (outcome) => {
      if (outcome.ok) return { status: 200, body: { status: 'success', ...(outcome.data as Record<string, unknown>) } };
      return legacyAnswer({ badBody: 'Invalid request', failed: 'The contact could not be deleted', issues: true })(outcome);
    },
  });
});
