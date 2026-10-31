import express from 'express';
import { getDb } from '../db/firestore';
import { createPortalLink, PortalError, portalView, revokePortalLink } from '../services/customerPortalService';
import { formatTzDate } from '../../lib/calendarDate';

type AuthedRequest = express.Request & { user: { uid: string; email?: string } };

/**
 * Customer portal (K-27). `portalLinkRouter`: create or turn off a customer's link, mounted at
 * /api/v1/workspaces/:workspaceId/customers/:customerId/portal-link (writers; checked in the service).
 * `publicPortalRouter`: what the customer sees, at /api/v1/invoices/public/portal (publicInvoiceRoutes.ts:
 * no sign-in, the invoice pages' rate limit).
 */
export const portalLinkRouter = express.Router({ mergeParams: true });

const fail = (res: express.Response, err: unknown, what: string) => {
  if (err instanceof PortalError) return res.status(err.status).json({ status: 'error', message: err.message });
  res.status(500).json({ status: 'error', message: what, details: err instanceof Error ? err.message : String(err) });
};

portalLinkRouter.post('/', async (req, res) => {
  const { workspaceId, customerId } = req.params as Record<string, string>;
  const { user } = req as unknown as AuthedRequest;
  try {
    res.json({ status: 'success', ...(await createPortalLink(getDb(), { workspaceId, customerId, uid: user.uid, email: user.email })) });
  } catch (err) { fail(res, err, 'The portal link could not be made'); }
});

portalLinkRouter.delete('/', async (req, res) => {
  const { workspaceId, customerId } = req.params as Record<string, string>;
  const { user } = req as unknown as AuthedRequest;
  try {
    await revokePortalLink(getDb(), { workspaceId, customerId, uid: user.uid, email: user.email });
    res.json({ status: 'success' });
  } catch (err) { fail(res, err, 'The portal link could not be turned off'); }
});

export const publicPortalRouter = express.Router();

publicPortalRouter.get('/:token', async (req, res) => {
  try {
    const view = await portalView(getDb(), String(req.params.token || ''), formatTzDate(new Date(), 'UTC'));
    if (!view) return res.status(404).json({ status: 'error', message: 'This link is not valid any more. Ask for a new one.' });
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'success', ...view });
  } catch (err) { fail(res, err, 'The invoices could not be shown'); }
});
