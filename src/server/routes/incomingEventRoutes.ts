import express from 'express';
import { getDb } from '../db/firestore';
import { incomingEvents } from '../../lib/incomingEvents';
import { redactForLogs } from '../../lib/logRedaction';

/**
 * Incoming events (K-37): GET /api/v1/workspaces/:workspaceId/incoming-events, owners and
 * accountants (workspaceRoutes.ts). Stripe events and email delivery reports for this workspace,
 * newest first, in words (src/lib/incomingEvents.ts). Read only. Events that couldn't be tied to a
 * workspace (an unknown invoice, a forged request) are never shown to anyone's workspace.
 */
export const incomingEventRouter = express.Router({ mergeParams: true });

const LIMIT = 200;

incomingEventRouter.get('/', async (req, res) => {
  const { workspaceId } = req.params as Record<string, string>;
  try {
    const db = getDb();
    const [stripe, email] = await Promise.all([
      db.collection('stripeProcessedEvents').where('workspaceId', '==', workspaceId).limit(LIMIT).get(),
      db.collection('emailEvents').where('workspaceId', '==', workspaceId).where('event', 'in', ['delivered', 'bounced', 'complaint']).limit(LIMIT).get(),
    ]);
    const events = incomingEvents(stripe.docs.map(d => ({ id: d.id, ...d.data() })), email.docs.map(d => ({ id: d.id, ...d.data() })), LIMIT);
    res.json({ status: 'success', data: { events } });
  } catch (err) {
    console.error('[The incoming events could not be read]', redactForLogs(err instanceof Error ? err.message : String(err)));
    res.status(500).json({ status: 'error', message: 'The incoming events could not be read' });
  }
});
