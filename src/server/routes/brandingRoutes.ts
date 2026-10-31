import express from 'express';
import { z } from 'zod';
import { getDb } from '../db/firestore';
import { requestUser } from '../auth/requestUser';
import { writeServerAuditLog } from '../services/auditLogService';
import { generateDocumentPdf } from '../services/pdfService';
import { BrandingSchema } from '../../lib/branding';
import { formatTzDate } from '../../lib/calendarDate';
import type { WorkspaceBranding } from '../../lib/branding';

/**
 * Document branding (Y-12…Y-14, Y-33, Y-34), mounted at /api/v1/workspaces/:workspaceId/branding
 * (workspaceRoutes.ts; owners and accountants). PUT saves logo, colour, address, footer, terms and
 * the payment QR switch on the workspace; POST /preview returns a sample invoice PDF with the
 * branding given (saved or not). Saved by the server so the logo's type and size are checked.
 */
export const brandingRouter = express.Router({ mergeParams: true });

const workspaceIdOf = (req: express.Request) => String((req.params as Record<string, string>).workspaceId);

/** Empty texts are not kept (the PDF then prints nothing there). */
function compact(branding: WorkspaceBranding): WorkspaceBranding {
  const terms = Object.fromEntries(Object.entries(branding.terms || {}).map(([k, v]) => [k, (v || '').trim()]).filter(([, v]) => v));
  const out: WorkspaceBranding = {};
  if (branding.logoDataUrl) out.logoDataUrl = branding.logoDataUrl;
  if (branding.color) out.color = branding.color.toUpperCase();
  if (branding.address?.trim()) out.address = branding.address.trim();
  if (branding.footer?.trim()) out.footer = branding.footer.trim();
  if (Object.keys(terms).length) out.terms = terms;
  if (branding.showPaymentQr === false) out.showPaymentQr = false;
  if (branding.language && branding.language !== 'en') out.language = branding.language;
  if (branding.style && branding.style !== 'classic') out.style = branding.style;
  if (branding.hideQuantity === true) out.hideQuantity = true;
  return out;
}

function invalid(res: express.Response, err: z.ZodError) {
  return res.status(400).json({ status: 'error', message: err.issues[0]?.message || 'Check the branding fields', details: err.issues });
}

brandingRouter.put('/', async (req, res) => {
  const parsed = BrandingSchema.safeParse(req.body?.branding);
  if (!parsed.success) return invalid(res, parsed.error);
  const workspaceId = workspaceIdOf(req);
  const branding = compact(parsed.data);
  try {
    const db = getDb();
    await db.collection('workspaces').doc(workspaceId).update({ branding, updatedAt: new Date().toISOString() });
    const user = requestUser(req);
    await writeServerAuditLog({
      workspaceId, uid: user.uid, email: user.email || '', action: 'BRANDING_UPDATED', entityType: 'workspace', entityId: workspaceId,
      details: { description: 'Document branding changed', logo: Boolean(branding.logoDataUrl), color: branding.color || null, termsFor: Object.keys(branding.terms || {}) },
    }, { db });
    res.json({ status: 'success', branding });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'The branding could not be saved', details: err instanceof Error ? err.message : String(err) });
  }
});

brandingRouter.post('/preview', async (req, res) => {
  const parsed = BrandingSchema.safeParse(req.body?.branding);
  if (!parsed.success) return invalid(res, parsed.error);
  try {
    const snap = await getDb().collection('workspaces').doc(workspaceIdOf(req)).get();
    const workspace = snap.data() || {};
    const pdf = await generateDocumentPdf('invoice', {
      number: 'INV-SAMPLE', date: formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC'), paymentTerms: 'net_30', customerName: 'Sample Customer Ltd',
      currency: String(workspace.currency || 'USD'),
      items: [{ description: 'Consulting services', quantity: 10, amountCents: 100000 }, { description: 'Materials', quantity: 1, amountCents: 25000 }],
      amountCents: 125000,
    }, { name: String(workspace.name || ''), currency: String(workspace.currency || 'USD'), branding: compact(parsed.data) }, { paymentUrl: 'https://example.com/i/sample' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="branding_preview.pdf"');
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'The preview could not be made', details: err instanceof Error ? err.message : String(err) });
  }
});
