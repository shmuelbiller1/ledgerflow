/**
 * Moving a fixed asset (X-05), mounted at /api/v1/workspaces/:workspaceId/assets/:assetId/transfer
 * (workspaceRoutes.ts, writers). POST moves it (a new location and/or accounts; a move between
 * accounts is posted); DELETE undoes the latest move while its date is open. Both are registered
 * commands (src/server/commands/assets.ts) keeping the handler's answers.
 */
import express from 'express';
import { assetTransferCommand, assetUndoTransferCommand } from '../commands/assets';
import { executeCommand } from '../utils/commandExecutor';
import { assetAnswer, assetInvocation } from '../utils/assetCommandRoute';

export const assetTransferRouter = express.Router({ mergeParams: true });

assetTransferRouter.post('/', async (req, res) => {
  await executeCommand(req, res, {
    ...assetInvocation(req, assetTransferCommand),
    formatResponse: assetAnswer('Choose the day and where it moves', 'The asset could not be moved'),
  });
});

assetTransferRouter.delete('/', async (req, res) => {
  await executeCommand(req, res, {
    ...assetInvocation(req, assetUndoTransferCommand),
    formatResponse: assetAnswer('Choose the day and where it moves', 'The move could not be undone'),
  });
});
