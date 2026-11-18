import express from 'express';
import { payrollImportCommand } from '../commands/payroll';
import { type PayrollImportResult, PayrollImportError } from '../services/payrollImportService';
import { CommandRefusal, executeCommand } from '../utils/commandExecutor';
import { commandFailureResponse } from '../utils/commandResponses';

/** PAY-1 legacy address; the workspace mount still checks owner/accountant before the body. */
export const payrollImportRouter = express.Router({ mergeParams: true });

payrollImportRouter.post('/', async (req, res) => {
  await executeCommand(req, res, {
    definition: payrollImportCommand,
    workspaceId: String((req.params as Record<string, string>).workspaceId),
    input: req.body,
    legacyRoute: true,
    // This address always refused an already imported pay date, even if a header was sent.
    legacyOperationId: 'ignore',
    formatResponse(outcome) {
      if (outcome.ok) {
        const { entries } = outcome.data as PayrollImportResult;
        return { status: 200, body: { status: 'success', entries } };
      }
      if (outcome.code === 'INVALID_INPUT') {
        return { status: 400, body: { status: 'error', message: 'Choose the provider, the file and the accounts', problems: [] } };
      }
      if (outcome.error instanceof PayrollImportError) {
        return { status: outcome.status, body: { status: 'error', message: outcome.message, problems: outcome.error.details } };
      }
      // Unexpected import/ledger errors used to be a 500 with details; keep the runner's own gates.
      const failure = outcome.error && !(outcome.error instanceof CommandRefusal) ? { ...outcome, status: 500 } : outcome;
      return commandFailureResponse(failure, 'The payroll could not be imported');
    },
  });
});
