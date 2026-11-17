/**
 * Construction in progress (X-09), mounted at /api/v1/workspaces/:workspaceId/assets/:assetId/in-service
 * (workspaceRoutes.ts, writers): POST places an asset being built in service (one entry out of the
 * construction-in-progress account); DELETE undoes that while nothing happened to it since. Both are
 * registered commands (src/server/commands/assets.ts) keeping the handler's answers.
 */
import express from 'express';
import { assetPlaceInServiceCommand, assetUndoPlaceInServiceCommand } from '../commands/assets';
import { executeCommand } from '../utils/commandExecutor';
import { assetAnswer, assetInvocation } from '../utils/assetCommandRoute';

export const placeInServiceRouter = express.Router({ mergeParams: true });

placeInServiceRouter.post('/', async (req, res) => {
  await executeCommand(req, res, {
    ...assetInvocation(req, assetPlaceInServiceCommand),
    formatResponse: assetAnswer('Choose the day and the account it belongs in', 'The asset could not be placed in service'),
  });
});

placeInServiceRouter.delete('/', async (req, res) => {
  await executeCommand(req, res, {
    ...assetInvocation(req, assetUndoPlaceInServiceCommand),
    formatResponse: assetAnswer('Choose the day and the account it belongs in', 'That could not be undone'),
  });
});
