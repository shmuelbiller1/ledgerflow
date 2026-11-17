import express from 'express';
import { getDb } from '../db/firestore';
import { PortalError, portalView } from '../services/customerPortalService';
import { portalLinkCreateCommand, portalLinkRevokeCommand } from '../commands/workspaceHousekeeping';
import { executeCommand } from '../utils/commandExecutor';
import { legacyAnswer, workspaceInvocation } from '../utils/legacyCommandRoute';
import { formatTzDate } from '../../lib/calendarDate';

/**
 * Customer portal (K-27). `portalLinkRouter`: create or turn off a customer's link, mounted at
 * /api/v1/workspaces/:workspaceId/customers/:customerId/portal-link (writers; checked in the service).
 * `publicPortalRouter`: what the customer sees, at /api/v1/invoices/public/portal (publicInvoiceRoutes.ts:
 * no sign-in, the invoice pages' rate limit).
 */
export const portalLinkRouter = express.Router({ mergeParams: true });

portalLinkRouter.post('/', async (req, res) => {
  const params = req.params as Record<string, string>;
  await executeCommand(req, res, {
    ...workspaceInvocation(req, portalLinkCreateCommand, { customerId: params.customerId }),
    formatResponse: legacyAnswer({ badBody: 'Check the customer', failed: 'The portal link could not be made' }),
  });
});

portalLinkRouter.delete('/', async (req, res) => {
  const params = req.params as Record<string, string>;
  await executeCommand(req, res, {
    ...workspaceInvocation(req, portalLinkRevokeCommand, { customerId: params.customerId }),
    formatResponse: legacyAnswer({ badBody: 'Check the customer', failed: 'The portal link could not be turned off' }),
  });
});

export const publicPortalRouter = express.Router();

publicPortalRouter.get('/:token', async (req, res) => {
  try {
    const view = await portalView(getDb(), String(req.params.token || ''), formatTzDate(new Date(), 'UTC'));
    if (!view) return res.status(404).json({ status: 'error', message: 'This link is not valid any more. Ask for a new one.' });
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'success', ...view });
  } catch (err) {
    const status = err instanceof PortalError ? err.status : 500;
    if (status < 500) return res.status(status).json({ status: 'error', message: (err as Error).message });
    res.status(500).json({ status: 'error', message: 'The invoices could not be shown', details: err instanceof Error ? err.message : String(err) });
  }
});
