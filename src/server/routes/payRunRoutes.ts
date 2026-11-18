/**
 * Pay runs (U-02, U-10, U-11), mounted at /api/v1/workspaces/:workspaceId/pay-runs
 * (workspaceRoutes.ts, owners and accountants). Every write is a registered command
 * (src/server/commands/payroll.ts): POST posts a run for the pay date (or sends it for an owner's
 * approval); DELETE /:payRunId undoes it while the date is open, or withdraws it while it waits;
 * owners approve or send it back and turn approval on or off. The handlers keep their answers —
 * `{ status: 'success', ...result }`, the handler's own 400 sentence for a malformed body, the
 * service's status and words for a refusal, and the handler's sentence with the cause for a 500.
 *
 * The payslip PDF (U-01) is a read and stays here.
 */
import express from 'express';
import { getDb } from '../db/firestore';
import {
  payRunApprovalCommand, payRunApproveCommand, payRunPostCommand, payRunRejectCommand, payRunUndoCommand,
} from '../commands/payroll';
import type { AnyCommandDefinition, CommandExecutionOutcome } from '../commands/types';
import { executeCommand } from '../utils/commandExecutor';
import { layoutPayslip, generatePayslipPdf } from '../services/payslipPdf';
import type { PayRunEmployeeLine } from '../../lib/payRunPosting';
import { payrollImportRouter } from './payrollImportRoutes';

export const payRunRouter = express.Router({ mergeParams: true });
// PAY-1: an outside payroll provider's results, one entry per pay date (payrollImportRoutes.ts)
payRunRouter.use('/imports', payrollImportRouter);

/** The address names the workspace and the run; the body carries the rest. */
function invocation(req: express.Request, definition: AnyCommandDefinition, extra: Record<string, unknown> = {}) {
  const params = req.params as Record<string, string>;
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const workspaceId = String(params.workspaceId || '');
  const runId = params.payRunId ? { payRunId: String(params.payRunId) } : {};
  return { definition, workspaceId, input: { ...body, ...runId, ...extra, workspaceId } };
}

/** The legacy answers: the handler's own sentence for a bad body, `details` kept on a 500. */
function answer(badBody: string, what: string) {
  return (outcome: CommandExecutionOutcome): { status: number; body: unknown } => {
    if (outcome.ok) return { status: 200, body: { status: 'success', ...(outcome.data as Record<string, unknown>) } };
    if (outcome.code === 'INVALID_INPUT') return { status: 400, body: { status: 'error', message: badBody } };
    if (outcome.status < 500) return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    const cause = outcome.error instanceof Error ? outcome.error.message : String(outcome.error ?? outcome.message);
    return { status: 500, body: { status: 'error', message: what, details: cause } };
  };
}

payRunRouter.post('/', async (req, res) => {
  await executeCommand(req, res, {
    ...invocation(req, payRunPostCommand),
    formatResponse: answer('Choose the pay date and the four accounts', 'The pay run could not be posted'),
  });
});

payRunRouter.delete('/:payRunId', async (req, res) => {
  await executeCommand(req, res, {
    ...invocation(req, payRunUndoCommand),
    formatResponse: answer('Choose the pay date and the four accounts', 'The pay run could not be undone'),
  });
});

payRunRouter.put('/approval', async (req, res) => {
  await executeCommand(req, res, {
    ...invocation(req, payRunApprovalCommand),
    formatResponse: answer('Choose the pay date and the four accounts', 'The setting could not be saved'),
  });
});

payRunRouter.post('/:payRunId/approve', async (req, res) => {
  await executeCommand(req, res, {
    ...invocation(req, payRunApproveCommand),
    formatResponse: answer('Choose the pay date and the four accounts', 'The pay run could not be approved'),
  });
});

payRunRouter.post('/:payRunId/reject', async (req, res) => {
  await executeCommand(req, res, {
    ...invocation(req, payRunRejectCommand),
    formatResponse: answer('Choose the pay date and the four accounts', 'The pay run could not be sent back'),
  });
});

// U-01: one employee's payslip for a posted run (PDF)
payRunRouter.get('/:payRunId/payslips/:employeeId', async (req, res) => {
  try {
    const workspaceId = String((req.params as Record<string, string>).workspaceId);
    const db = getDb();
    const run = (await db.collection('payRuns').doc(String(req.params.payRunId)).get()).data();
    if (!run || run.workspaceId !== workspaceId) return res.status(404).json({ status: 'error', message: 'That pay run is not in this workspace' });
    if (['awaiting_approval', 'rejected', 'withdrawn'].includes(String(run.status))) return res.status(409).json({ status: 'error', message: 'Payslips are for pay runs that were posted' });
    const line = ((run.employees || []) as PayRunEmployeeLine[]).find(e => e.employeeId === req.params.employeeId);
    if (!line) return res.status(404).json({ status: 'error', message: 'That employee was not paid in this run' });
    const year = String(run.date).slice(0, 4);
    const runs = (await db.collection('payRuns').where('workspaceId', '==', workspaceId).get()).docs.map(d => d.data())
      .filter(r => String(r.date).startsWith(`${year}-`)) as Array<{ date: string; status: string; employees?: PayRunEmployeeLine[] }>;
    const ws = (await db.collection('workspaces').doc(workspaceId).get()).data() || {};
    const layout = layoutPayslip({ date: String(run.date) }, line, runs, { name: ws.name, currency: ws.currency });
    const pdf = await generatePayslipPdf(layout);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `inline; filename="payslip_${layout.payDate}_${layout.employee.replace(/[^\w.-]+/g, '_')}.pdf"`);
    res.send(pdf);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    res.status(500).json({ status: 'error', message: 'The payslip could not be made', details: cause });
  }
});
