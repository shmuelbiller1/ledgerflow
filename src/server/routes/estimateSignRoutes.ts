import express from 'express';
import { getDb } from '../db/firestore';
import { createSignLink, SignError, signEstimate, signView } from '../services/estimateSignService';
import { formatTzDate } from '../../lib/calendarDate';

type AuthedRequest = express.Request & { user: { uid: string; email?: string } };

/**
 * Signing an estimate online (Y-20). `signLinkRouter`: make the private link, mounted at
 * /api/v1/workspaces/:workspaceId/estimates/:estimateId/sign-link (writers; checked in the service).
 * `publicEstimateRouter`: what the customer sees and signs, at /api/v1/invoices/public/estimate
 * (publicInvoiceRoutes.ts: no sign-in, the invoice pages' rate limit).
 */
export const signLinkRouter = express.Router({ mergeParams: true });

const today = () => formatTzDate(new Date(), 'UTC');
const fail = (res: express.Response, err: unknown, what: string) => {
  if (err instanceof SignError) return res.status(err.status).json({ status: 'error', message: err.message });
  res.status(500).json({ status: 'error', message: what, details: err instanceof Error ? err.message : String(err) });
};

signLinkRouter.post('/', async (req, res) => {
  const { workspaceId, estimateId } = req.params as Record<string, string>;
  const { user } = req as unknown as AuthedRequest;
  try {
    res.json({ status: 'success', ...(await createSignLink(getDb(), { workspaceId, estimateId, uid: user.uid, email: user.email }, today())) });
  } catch (err) { fail(res, err, 'The signing link could not be made'); }
});

export const publicEstimateRouter = express.Router();

publicEstimateRouter.get('/:token', async (req, res) => {
  try {
    const view = await signView(getDb(), String(req.params.token || ''), today());
    if (!view) return res.status(404).json({ status: 'error', message: 'This link is not valid any more. Ask for a new one.' });
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'success', estimate: view });
  } catch (err) { fail(res, err, 'The estimate could not be shown'); }
});

publicEstimateRouter.post('/:token/sign', async (req, res) => {
  try {
    const signed = await signEstimate(getDb(), String(req.params.token || ''), { name: req.body?.name, agree: req.body?.agree }, { ip: req.ip, userAgent: req.get('user-agent') || undefined }, today());
    res.json({ status: 'success', ...signed });
  } catch (err) { fail(res, err, 'The signature could not be saved'); }
});
