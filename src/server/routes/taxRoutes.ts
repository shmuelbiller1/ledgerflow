/**
 * Tax returns, mounted at /api/v1/workspaces/:workspaceId/tax-returns (workspaceRoutes.ts, members).
 * GET lists filed returns; GET /preview computes a period; POST files it — owners and accountants only,
 * through the registered command `tax.file`, so the role check and the period checks stay with the
 * schema and the service.
 *
 * The answers are the ones the handler gave: `{ status: 'success', return }`, a 400 with "Choose a
 * valid period" and the issues for a malformed body, the service's status and words for a refusal, and
 * "The tax return could not be prepared" with the cause for a 500.
 */
import express from 'express';
import { z } from 'zod';
import { getDb } from '../db/firestore';
import { computeWorkspaceTaxReturn, listTaxReturns, TaxReturnError } from '../services/taxReturnService';
import { taxFileCommand } from '../commands/tagAndTax';
import { executeCommand } from '../utils/commandExecutor';

export const taxRouter = express.Router({ mergeParams: true });

const periodSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reference: z.string().max(100).optional(),
  /** CON-4b: the registration the return is for ('vat:IL:514000001'); absent: the whole workspace */
  registration: z.string().max(120).regex(/^[a-z_]+:[^:]{2,60}:[^:]{1,40}$/).optional(),
}).strict();

function fail(res: express.Response, err: unknown) {
  if (err instanceof z.ZodError) return res.status(400).json({ status: 'error', message: 'Choose a valid period', details: err.issues });
  // the service's own refusal (a backwards period is a 400 "Choose a valid period"), never the 500
  if (err instanceof TaxReturnError) return res.status(err.status).json({ status: 'error', message: err.message });
  return res.status(500).json({ status: 'error', message: 'The tax return could not be prepared', details: err instanceof Error ? err.message : String(err) });
}

taxRouter.get('/', async (req, res) => {
  try {
    res.json({ status: 'success', returns: await listTaxReturns(getDb(), String((req.params as Record<string, string>).workspaceId)) });
  } catch (err) {
    fail(res, err);
  }
});

taxRouter.get('/preview', async (req, res) => {
  try {
    const { startDate, endDate } = periodSchema.omit({ reference: true, registration: true }).parse({ startDate: req.query.startDate, endDate: req.query.endDate });
    res.json({ status: 'success', return: await computeWorkspaceTaxReturn(getDb(), String((req.params as Record<string, string>).workspaceId), startDate, endDate) });
  } catch (err) {
    fail(res, err);
  }
});

taxRouter.post('/', async (req, res) => {
  await executeCommand(req, res, {
    definition: taxFileCommand,
    workspaceId: String((req.params as Record<string, string>).workspaceId || ''),
    input: req.body,
    formatResponse: (outcome) => {
      if (outcome.ok) return { status: 200, body: { status: 'success', return: outcome.data } };
      if (outcome.code === 'INVALID_INPUT') {
        return { status: 400, body: { status: 'error', message: 'Choose a valid period', details: (outcome.error as { issues?: unknown })?.issues } };
      }
      if (outcome.status < 500) return { status: outcome.status, body: { status: 'error', message: outcome.message } };
      const cause = outcome.error instanceof Error ? outcome.error.message : String(outcome.error ?? outcome.message);
      return { status: 500, body: { status: 'error', message: 'The tax return could not be prepared', details: cause } };
    },
  });
});
