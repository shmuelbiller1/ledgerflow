import express from 'express';
import { z } from 'zod';
import { getDb } from '../db/firestore';
import { approvePayRun, PayRunError, postPayRun, rejectPayRun, setPayrollApproval, undoPayRun } from '../services/payRunService';
import { generatePayslipPdf, layoutPayslip } from '../services/payslipPdf';
import type { PayRunEmployeeLine } from '../../lib/payRunPosting';

/**
 * Pay runs (U-02), mounted at /api/v1/workspaces/:workspaceId/pay-runs (workspaceRoutes.ts, owners
 * and accountants). POST posts a run for the pay date (or, U-10, sends it for an owner's approval);
 * DELETE /:payRunId undoes it while the date is open, or withdraws it while it waits. Owners:
 * POST /:payRunId/approve or /reject, and PUT /approval turns approval on or off.
 */
export const payRunRouter = express.Router({ mergeParams: true });

type AuthedRequest = express.Request & { user: { uid: string; email?: string } };
const schema = z.object({
  date: z.string().max(10),
  bankAccountId: z.string().min(1).max(200),
  wagesAccountId: z.string().min(1).max(200),
  taxExpenseAccountId: z.string().min(1).max(200),
  liabilitiesAccountId: z.string().min(1).max(200),
  again: z.boolean().optional(),
  schedule: z.enum(['all', 'Weekly', 'Bi-Weekly', 'Monthly']).optional(),
}).strict();

const actor = (req: express.Request) => {
  const { user } = req as unknown as AuthedRequest;
  return { workspaceId: String((req.params as Record<string, string>).workspaceId), uid: user.uid, email: user.email };
};
const fail = (res: express.Response, err: unknown, what: string) => {
  if (err instanceof z.ZodError) return res.status(400).json({ status: 'error', message: 'Choose the pay date and the four accounts' });
  if (err instanceof PayRunError) return res.status(err.status).json({ status: 'error', message: err.message });
  res.status(500).json({ status: 'error', message: what, details: err instanceof Error ? err.message : String(err) });
};

payRunRouter.post('/', async (req, res) => {
  try {
    res.json({ status: 'success', ...(await postPayRun(getDb(), { ...actor(req), ...schema.parse(req.body) })) });
  } catch (err) { fail(res, err, 'The pay run could not be posted'); }
});

payRunRouter.delete('/:payRunId', async (req, res) => {
  try {
    res.json({ status: 'success', ...(await undoPayRun(getDb(), { ...actor(req), payRunId: String(req.params.payRunId) })) });
  } catch (err) { fail(res, err, 'The pay run could not be undone'); }
});

payRunRouter.put('/approval', async (req, res) => {
  try {
    const { required } = z.object({ required: z.boolean() }).strict().parse(req.body);
    res.json({ status: 'success', ...(await setPayrollApproval(getDb(), { ...actor(req), required })) });
  } catch (err) { fail(res, err, 'The setting could not be saved'); }
});

payRunRouter.post('/:payRunId/approve', async (req, res) => {
  try {
    const { again } = z.object({ again: z.boolean().optional() }).strict().parse(req.body || {});
    res.json({ status: 'success', ...(await approvePayRun(getDb(), { ...actor(req), payRunId: String(req.params.payRunId), again })) });
  } catch (err) { fail(res, err, 'The pay run could not be approved'); }
});

payRunRouter.post('/:payRunId/reject', async (req, res) => {
  try {
    const { note } = z.object({ note: z.string().max(500).optional() }).strict().parse(req.body || {});
    res.json({ status: 'success', ...(await rejectPayRun(getDb(), { ...actor(req), payRunId: String(req.params.payRunId), note })) });
  } catch (err) { fail(res, err, 'The pay run could not be sent back'); }
});

// U-01: one employee's payslip for a posted run (PDF)
payRunRouter.post('/:payRunId/payslips', async (req, res) => {
  try {
    const { employeeId } = z.object({ employeeId: z.string().min(1) }).strict().parse(req.body || {});
    const { workspaceId } = actor(req);
    const db = getDb();
    const run = (await db.collection('payRuns').doc(String(req.params.payRunId)).get()).data();
    if (!run || run.workspaceId !== workspaceId) return res.status(404).json({ status: 'error', message: 'That pay run is not in this workspace' });
    if (['awaiting_approval', 'rejected', 'withdrawn'].includes(String(run.status))) return res.status(409).json({ status: 'error', message: 'Payslips are for pay runs that were posted' });
    const line = ((run.employees || []) as PayRunEmployeeLine[]).find(e => e.employeeId === employeeId);
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
  } catch (err) { fail(res, err, 'The payslip could not be made'); }
});
