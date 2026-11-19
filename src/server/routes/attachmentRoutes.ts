import express from 'express';
import { documentRemoveCommand } from '../commands/attachments';
import { executeCommand } from '../utils/commandExecutor';
import { commandFailureResponse } from '../utils/commandResponses';

/** K-07: mounted under a workspace with its usual membership gate. */
export const attachmentRouter = express.Router({ mergeParams: true });

attachmentRouter.delete('/:attachmentId', async (req, res) => {
  const { workspaceId, attachmentId } = req.params as Record<string, string>;
  await executeCommand(req, res, {
    definition: documentRemoveCommand,
    workspaceId,
    input: { id: attachmentId },
    legacyRoute: true,
    legacyOperationId: 'ignore',
    formatResponse(outcome) {
      if (!outcome.ok) return commandFailureResponse(outcome, 'The file could not be removed');
      return { status: 200, body: { status: 'success' } };
    },
  });
});
