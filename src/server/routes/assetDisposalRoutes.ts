/**
 * Fixed-asset writes after the asset exists: selling or scrapping it, wholly or in part (X-03, X-04),
 * moving it to another location or account (X-05), and placing an asset that was built in service
 * (X-09) — with the undo of each. Every one is a registered command (src/server/commands/assets.ts):
 * the runner checks the workspace, the caller's role and the plan, and the service checks the rest and
 * writes inside its own transaction with its audit line. The answers are the ones the handlers gave:
 * `{ status: 'success', ...result }`, a 400 with the handler's own sentence for a malformed body, the
 * service's status and words for a refusal, and the handler's sentence with the cause for a 500.
 */
import express from 'express';
import { assetDisposeCommand, assetUndoDisposalCommand } from '../commands/assets';
import { executeCommand } from '../utils/commandExecutor';
import { assetAnswer, assetInvocation } from '../utils/assetCommandRoute';

export const assetDisposalRouter = express.Router({ mergeParams: true });

assetDisposalRouter.post('/', async (req, res) => {
  await executeCommand(req, res, {
    ...assetInvocation(req, assetDisposeCommand),
    formatResponse: assetAnswer('Enter the date and the amount received (zero if scrapped)', 'The asset could not be disposed of'),
  });
});

assetDisposalRouter.delete('/', async (req, res) => {
  await executeCommand(req, res, {
    ...assetInvocation(req, assetUndoDisposalCommand),
    formatResponse: assetAnswer('Enter the date and the amount received (zero if scrapped)', 'The disposal could not be undone'),
  });
});
