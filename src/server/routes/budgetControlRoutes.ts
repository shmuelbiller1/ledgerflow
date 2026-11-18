import express from 'express';
import { budgetControlInput, workspaceBudgetControlCommand } from '../commands/budgetControl';
import { errorMessage } from '../auth/requestUser';
import { executeCommand, withLegacyInputIdempotencyHash } from '../utils/commandExecutor';

/** PUT /workspaces/:workspaceId/budget-control. The parent router requires an owner. */
export const budgetControlRouter = express.Router({ mergeParams: true });

budgetControlRouter.put('/', async (req, res) => {
  const workspaceId = String((req.params as Record<string, string>).workspaceId);
  const parsed = budgetControlInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "budgetControl is 'off', 'warn' or 'block'" });
  await executeCommand(req, res, {
    definition: withLegacyInputIdempotencyHash(workspaceBudgetControlCommand), workspaceId, input: parsed.data,
    formatResponse(outcome) {
      if (outcome.ok) return { status: 200, body: { status: 'success', budgetControl: (outcome.data as { budgetControl: string }).budgetControl } };
      if (outcome.status < 500) return { status: outcome.status, body: { error: outcome.message } };
      return { status: 500, body: { error: 'Failed to save the budget control', details: outcome.error ? errorMessage(outcome.error) : outcome.message } };
    },
  });
});
