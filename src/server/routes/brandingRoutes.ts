import express from 'express';
import { getDb } from '../db/firestore';
import { generateDocumentPdf } from '../services/pdfService';
import { BrandingSchema } from '../../lib/branding';
import { formatTzDate } from '../../lib/calendarDate';
import { compactBranding } from '../services/brandingService';
import { brandingProfilesSaveCommand, brandingSaveCommand } from '../commands/workspaceHousekeeping';
import { executeCommand } from '../utils/commandExecutor';
import { legacyAnswer, workspaceInvocation } from '../utils/legacyCommandRoute';

/**
 * Document branding (Y-12…Y-14, Y-33, Y-34), mounted at /api/v1/workspaces/:workspaceId/branding
 * (workspaceRoutes.ts; owners and accountants). PUT saves logo, colour, address, footer, terms and
 * the payment QR switch on the workspace — the registered command `workspace.branding`; POST /preview
 * returns a sample invoice PDF with the branding given (saved or not), which writes nothing and stays
 * here. Empty texts are dropped before saving (the PDF then prints nothing there).
 */
export const brandingRouter = express.Router({ mergeParams: true });

const workspaceIdOf = (req: express.Request) => String((req.params as Record<string, string>).workspaceId);

brandingRouter.put('/', async (req, res) => {
  // the handler answered a malformed body with the first issue's own sentence and every issue as details
  const body = (req.body || {}) as { branding?: unknown };
  await executeCommand(req, res, {
    ...workspaceInvocation(req, brandingSaveCommand, { branding: body.branding }),
    formatResponse: (outcome) => {
      if (!outcome.ok && outcome.code === 'INVALID_INPUT') {
        const issues = ((outcome.error as { issues?: Array<{ message?: string }> }).issues) || [];
        return {
          status: 400,
          body: { status: 'error', message: issues[0]?.message || 'Check the branding fields', details: issues },
        };
      }
      return legacyAnswer({ badBody: 'Check the branding fields', failed: 'The branding could not be saved' })(outcome);
    },
  });
});

brandingRouter.post('/preview', async (req, res) => {
  const parsed = BrandingSchema.safeParse(req.body?.branding);
  if (!parsed.success) {
    return res.status(400).json({ status: 'error', message: parsed.error.issues[0]?.message || 'Check the branding fields', details: parsed.error.issues });
  }
  try {
    const snap = await getDb().collection('workspaces').doc(workspaceIdOf(req)).get();
    const workspace = snap.data() || {};
    const pdf = await generateDocumentPdf('invoice', {
      number: 'INV-SAMPLE', date: formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC'), paymentTerms: 'net_30', customerName: 'Sample Customer Ltd',
      currency: String(workspace.currency || 'USD'),
      items: [{ description: 'Consulting services', quantity: 10, amountCents: 100000 }, { description: 'Materials', quantity: 1, amountCents: 25000 }],
      amountCents: 125000,
    }, { name: String(workspace.name || ''), currency: String(workspace.currency || 'USD'), branding: compactBranding(parsed.data) }, { paymentUrl: 'https://example.com/i/sample' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="branding_preview.pdf"');
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'The preview could not be made', details: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * AUP-01: PUT /api/v1/workspaces/:workspaceId/branding-profiles saves the branding per label (the registered
 * command `workspace.brandingprofiles`); it answers { status: 'success', profiles } as the settings screen expects.
 */
export const brandingProfilesRouter = express.Router({ mergeParams: true });

brandingProfilesRouter.put('/', async (req, res) => {
  const body = (req.body || {}) as { profiles?: unknown; label?: unknown; branding?: unknown; expected?: unknown };
  const one = typeof body.label === 'string' ? { label: body.label, branding: body.branding ?? null, ...('expected' in body ? { expected: body.expected ?? null } : {}) } : { profiles: body.profiles };
  await executeCommand(req, res, {
    ...workspaceInvocation(req, brandingProfilesSaveCommand, one),
    formatResponse: (outcome) => {
      if (outcome.ok) return { status: 200, body: { status: 'success', ...(outcome.data as object) } };
      if (outcome.code === 'INVALID_INPUT') return { status: 400, body: { status: 'error', message: outcome.message } };
      if (outcome.status === 409) return { status: 409, body: { status: 'error', message: outcome.message } };
      return legacyAnswer({ badBody: 'Check the branding fields', failed: 'The branding profiles could not be saved' })(outcome);
    },
  });
});
