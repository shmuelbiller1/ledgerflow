import { takeCopyMark } from '../services/copyMarkService';
import type { TaxProfiles } from '../../lib/tax/profile';
import { errorMessage, requestUser } from '../auth/requestUser';
import express from 'express';
import { assertWorkspaceAccess, getDb } from '../db/firestore';
import type { Firestore } from '../db/firestore';
import { LEDGER_WRITER_ROLES, roleInWorkspace } from '../middleware/requireLedgerWriter';
import { generateDocumentPdf } from '../services/pdfService';
import type { PdfDocument, PdfDocumentType, PdfWorkspace } from '../services/pdfService';
import { loadStatement, statementDate, StatementScopeError } from '../services/statementService';
import { contactTerms, documentLanguage, type DocumentLanguage } from '../../lib/documentLanguage';
import { ChequeError, generateChequePdf, layoutCheque } from '../services/chequePdf';
import { getTrustedAppUrl } from '../utils/urlHelper';
import { zipStore } from '../utils/zip';
import { z } from 'zod';
import { documentPostRouter } from './documentPostRoutes';
import { trimEndChar } from '../../lib/textShape';

import { BRAND_NAME } from '../../config/brand';
export const documentRouter = express.Router();
// L-94 step 2: POST /:type/:id/post saves an invoice or bill and builds its entries on the server
documentRouter.use(documentPostRouter);

/** Stored documents a PDF can be made of: collection and the name used in "not found". */
const PDF_SOURCES = {
  invoice: { collection: 'invoices', label: 'Invoice' },
  estimate: { collection: 'estimates', label: 'Estimate' },
  creditNote: { collection: 'creditNotes', label: 'Credit Note' },
  payment: { collection: 'payments', label: 'Payment' },
  purchaseOrder: { collection: 'purchaseOrders', label: 'Purchase order' },
  bill: { collection: 'bills', label: 'Bill' },
  vendorCredit: { collection: 'vendorCredits', label: 'Vendor credit' },
} as const;
const PDF_TYPES: readonly PdfDocumentType[] = ['invoice', 'estimate', 'creditNote', 'payment', 'statement', 'purchaseOrder', 'bill', 'vendorCredit'];

/** A purchase order in the shape the PDF reads (its fields have their own names; BA-08). */
function purchaseOrderForPdf(po: Record<string, unknown>): PdfDocument {
  const items = Array.isArray(po.items) ? po.items as Array<Record<string, unknown>> : [];
  return {
    ...po,
    number: String(po.poNumber || po.number || ''),
    date: String(po.issueDate || po.date || ''),
    dueDate: typeof po.expectedDeliveryDate === 'string' ? po.expectedDeliveryDate : undefined,
    amountCents: Number(po.totalAmountCents) || 0,
    items: items.map(i => ({
      description: String(i.description || 'Item'),
      quantity: Number(i.quantity) || 1,
      amountCents: Number(i.totalCents ?? Math.round((Number(i.quantity) || 1) * (Number(i.unitPriceCents) || 0))),
    })),
  } as PdfDocument;
}
const isPdfType = (t: string): t is PdfDocumentType => (PDF_TYPES as readonly string[]).includes(t);

type DocType = keyof typeof PDF_SOURCES;

/** P-11, P-12: the printed words in the document's customer's (or vendor's) language, else the
 * workspace's, and their own terms when they have some. */
async function contactStyle(db: Firestore, workspace: PdfWorkspace, docData: PdfDocument, workspaceId: string): Promise<{ language: DocumentLanguage; terms?: string }> {
  const ref = docData as { customerId?: unknown; vendorId?: unknown; contactId?: unknown; direction?: unknown };
  const [collection, id] = typeof ref.customerId === 'string' && ref.customerId ? ['customers', ref.customerId]
    : typeof ref.vendorId === 'string' && ref.vendorId ? ['vendors', ref.vendorId]
      : typeof ref.contactId === 'string' && ref.contactId ? [ref.direction === 'made' ? 'vendors' : 'customers', ref.contactId] : ['', ''];
  const contact = collection ? (await db.collection(collection).doc(id).get()).data() : undefined;
  const own = contact && contact.workspaceId === workspaceId ? contact : null;
  return { language: documentLanguage(workspace.branding, own), terms: contactTerms(own) };
}

/** A document of this workspace ready for the PDF (null when missing or another workspace's). */
async function loadDocumentForPdf(db: Firestore, type: DocType, id: string, workspaceId: string, req: express.Request): Promise<{ docData: PdfDocument; paymentUrl?: string } | null> {
  const snap = await db.collection(PDF_SOURCES[type].collection).doc(id).get();
  const data = snap.exists ? snap.data() : undefined;
  if (!data || data.workspaceId !== workspaceId) return null;
  let paymentUrl: string | undefined;
  // a sent invoice has a payment page: its QR code goes on the PDF (Y-15)
  if (type === 'invoice' && typeof data.paymentToken === 'string' && data.paymentToken) {
    try { paymentUrl = `${trimEndChar(getTrustedAppUrl(req), '/')}/i/${data.paymentToken}`; } catch { paymentUrl = undefined; }
  }
  return { docData: type === 'purchaseOrder' ? purchaseOrderForPdf(data) : data as PdfDocument, paymentUrl };
}

const ZipSchema = z.object({
  workspaceId: z.string().min(1).max(200),
  type: z.enum(Object.keys(PDF_SOURCES) as [DocType, ...DocType[]]),
  ids: z.array(z.string().min(1).max(200)).min(1).max(100),
}).strict();

/**
 * Several documents of one kind as PDFs in one zip file (Y-18), e.g. the invoices chosen in the
 * list. Members only; documents of other workspaces or missing ones are left out.
 */
export async function handleZipRequest(req: express.Request, res: express.Response, dbOverride?: Firestore) {
  try {
    const user = requestUser(req);
    const body = ZipSchema.parse(req.body);
    const db = dbOverride || getDb();
    await assertWorkspaceAccess(db, body.workspaceId, user);
    const wsSnap = await db.collection('workspaces').doc(body.workspaceId).get();
    const workspace: PdfWorkspace = wsSnap.exists ? (wsSnap.data() as PdfWorkspace) : { name: `${BRAND_NAME} Workspace` };
    const readOnlyCopy = !user.admin && !LEDGER_WRITER_ROLES.includes(roleInWorkspace(wsSnap.data() as never, user.uid));
    const files: Array<{ name: string; data: Buffer }> = [];
    const used = new Set<string>();
    for (const id of [...new Set(body.ids)]) {
      const loaded = await loadDocumentForPdf(db, body.type, id, body.workspaceId, req);
      if (!loaded) continue;
      const base = `${body.type}_${String(loaded.docData.number || id).replace(/[^\p{L}\p{N}._-]+/gu, '-')}`;
      let name = `${base}.pdf`;
      for (let n = 2; used.has(name); n++) name = `${base}_${n}.pdf`;
      used.add(name);
      const copyMark = await takeCopyMark(db, body.type, id, workspace as { taxProfiles?: TaxProfiles }, { readOnly: readOnlyCopy });
      files.push({ name, data: await generateDocumentPdf(body.type, loaded.docData, workspace, { paymentUrl: loaded.paymentUrl, ...(await contactStyle(db, workspace, loaded.docData, body.workspaceId)), ...(copyMark ? { copyMark } : {}) }) });
    }
    if (files.length === 0) return res.status(404).json({ status: 'error', message: 'None of these documents were found' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${body.type}s_${files.length}.zip"`);
    return res.send(zipStore(files));
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ status: 'error', message: err.issues[0]?.message || 'Invalid request' });
    if (errorMessage(err) === 'FORBIDDEN' || /not a member/i.test(errorMessage(err))) return res.status(403).json({ status: 'error', message: 'Forbidden' });
    return res.status(500).json({ status: 'error', message: errorMessage(err) || 'Failed to build the zip' });
  }
}

export async function handlePdfRequest(req: express.Request, res: express.Response, dbOverride?: Firestore) {
  try {
    const user = requestUser(req);
    const { type, id } = req.params as Record<string, string>;
    const workspaceId = (req.query.workspaceId || req.body?.workspaceId || '') as string;

    if (!workspaceId) {
      return res.status(400).json({ status: 'error', message: 'workspaceId is required' });
    }

    // a payment made to a vendor, printed as a cheque (BE-13): owners, accountants and bookkeepers
    if (type === 'cheque') return await handleChequeRequest(req, res, id, workspaceId, dbOverride);

    if (!isPdfType(type)) {
      return res.status(400).json({ status: 'error', message: `Invalid document type. Must be one of: ${PDF_TYPES.join(', ')}` });
    }

    const db = dbOverride || getDb();
    await assertWorkspaceAccess(db, workspaceId, user);

    // Fetch workspace
    const wsSnap = await db.collection('workspaces').doc(workspaceId).get();
    const workspace: PdfWorkspace = wsSnap.exists ? (wsSnap.data() as PdfWorkspace) : { name: `${BRAND_NAME} Workspace` };
    const readOnlyCopy = !user.admin && !LEDGER_WRITER_ROLES.includes(roleInWorkspace(wsSnap.data() as never, user.uid));

    let docData: PdfDocument | null = null;
    let paymentUrl: string | undefined;
    let style: { language: DocumentLanguage; terms?: string } | undefined;

    if (type !== 'statement') {
      const loaded = await loadDocumentForPdf(db, type, id, workspaceId, req);
      // another workspace's document answers like a missing one
      if (!loaded) return res.status(404).json({ status: 'error', message: `${PDF_SOURCES[type].label} not found` });
      ({ docData, paymentUrl } = loaded);
    } else {
      // id is a customer or vendor
      let statement: Awaited<ReturnType<typeof loadStatement>>;
      try {
        statement = await loadStatement(db, workspaceId, id, { startDate: statementDate(req.query.startDate), endDate: statementDate(req.query.endDate) });
      } catch (err) {
        // AUD-01: a period that is not real dates is refused, as the screen and the JSON refuse it
        if (err instanceof StatementScopeError) return res.status(400).json({ status: 'error', message: err.message });
        throw err;
      }
      if (!statement) return res.status(404).json({ status: 'error', message: 'Contact not found' });
      docData = statement.pdf;
      style = { language: documentLanguage(workspace.branding, statement.contact), terms: contactTerms(statement.contact) };
    }

    const copyMark = type === 'statement' ? undefined : await takeCopyMark(db, type, id, workspace as { taxProfiles?: TaxProfiles }, { readOnly: readOnlyCopy });
    const pdfBuffer = await generateDocumentPdf(type, docData, workspace, { paymentUrl, ...(style || await contactStyle(db, workspace, docData, workspaceId)), ...(copyMark ? { copyMark } : {}) });

    if (req.query.format === 'json' || req.headers.accept?.includes('application/json')) {
      return res.json({
        status: 'success',
        data: {
          filename: `${type}_${id}.pdf`,
          pdfBase64: pdfBuffer.toString('base64')
        }
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${type}_${id}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    if (errorMessage(err) === 'FORBIDDEN' || /not a member/i.test(errorMessage(err))) return res.status(403).json({ status: 'error', message: 'Forbidden' });
    console.error('PDF Generation Error:', err);
    return res.status(500).json({ status: 'error', message: errorMessage(err) || 'Failed to generate PDF' });
  }
}

const CHEQUE_ROLES = new Set(['owner', 'accountant', 'bookkeeper']);

async function handleChequeRequest(req: express.Request, res: express.Response, paymentId: string, workspaceId: string, dbOverride?: Firestore) {
  const user = requestUser(req);
  const db = dbOverride || getDb();
  await assertWorkspaceAccess(db, workspaceId, user);
  const wsSnap = await db.collection('workspaces').doc(workspaceId).get();
  const ws = (wsSnap.data() || {}) as { uid?: string; roles?: Record<string, string>; name?: string; companyName?: string };
  const role = ws.uid === user.uid ? 'owner' : ws.roles?.[user.uid] || 'viewer';
  if (!CHEQUE_ROLES.has(role)) return res.status(403).json({ status: 'error', message: 'Only owners, accountants and bookkeepers print cheques' });
  const snap = await db.collection('payments').doc(paymentId).get();
  const payment = snap.exists ? snap.data() : undefined;
  if (!payment || payment.workspaceId !== workspaceId) return res.status(404).json({ status: 'error', message: 'Payment not found' });
  const billIds = ((payment.allocations || []) as Array<{ documentId: string }>).map(a => a.documentId).filter(Boolean);
  const bills = billIds.length ? await db.getAll(...billIds.slice(0, 50).map(bid => db.collection('bills').doc(bid))) : [];
  const numbers = Object.fromEntries(bills.filter(b => b.exists && b.data()?.workspaceId === workspaceId).map(b => [b.id, String(b.data()?.number || b.id)]));
  try {
    const layout = layoutCheque(payment, ws, numbers);
    const pdf = await generateChequePdf(layout);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="cheque_${(layout.chequeNumber || paymentId).replace(/[^\w.-]+/g, '_')}.pdf"`);
    return res.send(pdf);
  } catch (err) {
    if (err instanceof ChequeError) return res.status(err.status).json({ status: 'error', message: err.message });
    throw err;
  }
}

// Express passes `next` third: never let it stand in for the database (every download failed so)
documentRouter.post('/zip', (req, res) => handleZipRequest(req, res));
documentRouter.post('/:type/:id/pdf', (req, res) => handlePdfRequest(req, res));
documentRouter.get('/:type/:id/pdf', (req, res) => handlePdfRequest(req, res));
