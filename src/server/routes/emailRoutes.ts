import express from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { getDb } from '../db/firestore';
import { getTrustedAppUrl } from '../utils/urlHelper';
import { notify } from '../services/notificationService';
import { EmailSendError, emailInvoice, emailLog, emailStatements, logEmailEvent } from '../services/documentEmailService';
import { redactForLogs } from '../../lib/logRedaction';

/**
 * Emails to customers, mounted at /api/v1/workspaces/:workspaceId/emails (workspaceRoutes.ts,
 * members; sending checks the writer role in documentEmailService.ts).
 */
export const emailRouter = express.Router({ mergeParams: true });

type AuthedRequest = express.Request & { user: { uid: string } };

const sendSchema = z.object({
  template: z.enum(['invoice', 'reminder']).default('invoice'),
  to: z.string().email().max(200).optional(),
  subject: z.string().max(200).optional(),
  body: z.string().max(5000).optional(),
}).strict();

emailRouter.post('/invoices/:invoiceId', async (req, res) => {
  const { workspaceId, invoiceId } = req.params as Record<string, string>;
  try {
    const body = sendSchema.parse(req.body);
    const result = await emailInvoice(getDb(), { workspaceId, invoiceId, uid: (req as unknown as AuthedRequest).user.uid, baseUrl: getTrustedAppUrl(req), ...body });
    res.json({ status: 'success', ...result });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ status: 'error', message: 'Invalid request', details: err.issues });
    if (err instanceof EmailSendError) return res.status(err.status).json({ status: 'error', message: err.message });
    console.error('[The email could not be sent]', redactForLogs(err instanceof Error ? err.message : String(err)));
    res.status(500).json({ status: 'error', message: 'The email could not be sent' });
  }
});

// BE-07: statements to many customers at once (all active ones when no ids are given)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// ISS-141: an optional period, like the statement screen's (opening balance, then that period)
const statementsSchema = z.object({ customerIds: z.array(z.string().min(1).max(200)).max(1000).optional(), startDate: isoDate.optional(), endDate: isoDate.optional() }).strict();

emailRouter.post('/statements', async (req, res) => {
  const { workspaceId } = req.params as Record<string, string>;
  try {
    const body = statementsSchema.parse(req.body);
    const result = await emailStatements(getDb(), { workspaceId, uid: (req as unknown as AuthedRequest).user.uid, ...body });
    res.json({ status: 'success', ...result });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ status: 'error', message: 'Invalid request', details: err.issues });
    if (err instanceof EmailSendError) return res.status(err.status).json({ status: 'error', message: err.message });
    console.error('[The statements could not be sent]', redactForLogs(err instanceof Error ? err.message : String(err)));
    res.status(500).json({ status: 'error', message: 'The statements could not be sent' });
  }
});

emailRouter.get('/log/:documentId', async (req, res) => {
  const { workspaceId, documentId } = req.params as Record<string, string>;
  try {
    res.json({ status: 'success', events: await emailLog(getDb(), workspaceId, documentId) });
  } catch (err) {
    console.error('[The send log could not be loaded]', redactForLogs(err instanceof Error ? err.message : String(err)));
    res.status(500).json({ status: 'error', message: 'The send log could not be loaded' });
  }
});

/**
 * Delivery reports from the email provider (BL-01): bounces and spam complaints are logged, and
 * that address is then skipped (suppression list). Public URL, protected by a secret token:
 *   Preferred: X-Email-Webhook-Secret request header (EMAIL_WEBHOOK_SECRET).
 *   Legacy query tokens remain supported for existing provider configurations; never log their values.
 * Understands Resend, Postmark and SendGrid report formats.
 */
export const emailWebhookRouter = express.Router();

type Report = { event: 'bounced' | 'complaint' | 'delivered'; recipient: string; messageId?: string };

export function parseProviderReports(payload: unknown): Report[] {
  const out: Report[] = [];
  const add = (event: Report['event'] | null, recipient: unknown, messageId?: unknown) => {
    if (event && typeof recipient === 'string' && recipient.includes('@')) out.push({ event, recipient: recipient.toLowerCase(), messageId: messageId ? String(messageId) : undefined });
  };
  if (Array.isArray(payload)) {
    // SendGrid: [{ event: 'bounce' | 'dropped' | 'spamreport' | 'delivered', email, sg_message_id }]
    for (const e of payload as Array<Record<string, unknown>>) {
      const kind = e.event === 'bounce' || e.event === 'dropped' ? 'bounced' : e.event === 'spamreport' ? 'complaint' : e.event === 'delivered' ? 'delivered' : null;
      add(kind, e.email, String(e.sg_message_id || '').split('.')[0] || undefined);
    }
    return out;
  }
  const p = (payload || {}) as Record<string, unknown>;
  if (typeof p.type === 'string' && p.data && typeof p.data === 'object') {
    // Resend: { type: 'email.bounced' | 'email.complained' | 'email.delivered', data: { to: [..], email_id } }
    const data = p.data as Record<string, unknown>;
    const kind = p.type === 'email.bounced' ? 'bounced' : p.type === 'email.complained' ? 'complaint' : p.type === 'email.delivered' ? 'delivered' : null;
    for (const to of Array.isArray(data.to) ? data.to : [data.to]) add(kind, to, data.email_id);
    return out;
  }
  if (typeof p.RecordType === 'string') {
    // Postmark: { RecordType: 'Bounce' | 'SpamComplaint' | 'Delivery', Email / Recipient, MessageID }
    const kind = p.RecordType === 'Bounce' ? 'bounced' : p.RecordType === 'SpamComplaint' ? 'complaint' : p.RecordType === 'Delivery' ? 'delivered' : null;
    add(kind, p.Email || p.Recipient, p.MessageID);
  }
  return out;
}

function tokenOk(provided: unknown): boolean {
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  if (!secret || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

emailWebhookRouter.post('/', async (req, res) => {
  // Prefer a header: URLs with tokens may also be recorded by upstream HTTP proxies.
  if (!tokenOk(req.get('x-email-webhook-secret') || req.query.token)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const db = getDb();
  const reports = parseProviderReports(req.body);
  for (const r of reports) {
    // Tie the report to the workspace and document of the email it is about (our send log)
    const sent = r.messageId
      ? (await db.collection('emailEvents').where('messageId', '==', r.messageId).where('event', '==', 'sent').limit(1).get()).docs[0]?.data()
      : undefined;
    await logEmailEvent(db, {
      event: r.event, recipient: r.recipient, messageId: r.messageId || null,
      workspaceId: sent?.workspaceId || null, documentType: sent?.documentType || null, documentId: sent?.documentId || null,
    });
    if (sent?.workspaceId && (r.event === 'bounced' || r.event === 'complaint')) {
      await notify(db, {
        workspaceId: String(sent.workspaceId), kind: 'email.bounced',
        title: r.event === 'bounced' ? `Email to ${r.recipient} bounced` : `${r.recipient} marked an email as spam`,
        message: `${String(sent.subject || 'An email')}. That address won't be emailed again until the customer's email is changed.`,
        eventKey: `email.${r.event}:${r.messageId || r.recipient}`, recordId: sent.documentId ? String(sent.documentId) : undefined,
      });
    }
  }
  res.json({ status: 'success', recorded: reports.length });
});
