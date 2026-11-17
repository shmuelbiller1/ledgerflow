import express from 'express';
import { accountMergeCommand, accountMergePreviewCommand } from '../commands/workspaceHousekeeping';
import { executeCommand } from '../utils/commandExecutor';
import { legacyAnswer, workspaceInvocation } from '../utils/legacyCommandRoute';

/**
 * Merging two accounts (CA-33), mounted at /api/v1/workspaces/:workspaceId/chart-accounts
 * (workspaceRoutes.ts, owners and accountants). POST /merge/preview says what would change; POST /merge
 * does it. Both are registered commands now (`account.mergepreview`, `account.merge`), and the answers
 * are the ones the handlers gave.
 */
export const accountMergeRouter = express.Router({ mergeParams: true });

accountMergeRouter.post('/merge/preview', async (req, res) => {
  await executeCommand(req, res, {
    ...workspaceInvocation(req, accountMergePreviewCommand),
    formatResponse: legacyAnswer({ badBody: 'Choose the account to merge and the one to keep', failed: 'The accounts could not be merged' }),
  });
});

accountMergeRouter.post('/merge', async (req, res) => {
  await executeCommand(req, res, {
    ...workspaceInvocation(req, accountMergeCommand),
    formatResponse: legacyAnswer({ badBody: 'Choose the account to merge and the one to keep', failed: 'The accounts could not be merged' }),
  });
});
