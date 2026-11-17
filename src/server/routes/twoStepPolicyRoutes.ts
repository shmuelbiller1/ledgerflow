import express from 'express';
import { twoPersonCommand, twoStepCommand } from '../commands/workspaceHousekeeping';
import { executeCommand } from '../utils/commandExecutor';
import { legacyAnswer, workspaceInvocation } from '../utils/legacyCommandRoute';

/**
 * Two-step login for everyone in a workspace (Y-30), mounted at
 * /api/v1/workspaces/:workspaceId/security (workspaceRoutes.ts, owners): PUT /two-step {required};
 * and the two-person rule (P-05): PUT /two-person {on}. Both are registered commands
 * (`security.twostep`, `security.twoperson`) and each keeps its own sentence for a malformed body.
 */
export const twoStepPolicyRouter = express.Router({ mergeParams: true });

twoStepPolicyRouter.put('/two-step', async (req, res) => {
  await executeCommand(req, res, {
    ...workspaceInvocation(req, twoStepCommand),
    formatResponse: legacyAnswer({ badBody: 'Say whether two-step login is required', failed: 'The setting could not be saved' }),
  });
});

twoStepPolicyRouter.put('/two-person', async (req, res) => {
  await executeCommand(req, res, {
    ...workspaceInvocation(req, twoPersonCommand),
    formatResponse: legacyAnswer({ badBody: 'Say whether the two-person rule is on', failed: 'The setting could not be saved' }),
  });
});
