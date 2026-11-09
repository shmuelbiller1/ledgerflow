import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { getDateInTimezoneISO } from '../../lib/calendarDate';
import { depositAppliedCents } from '../../lib/documentMath';
import { brandColor, LOGO_DATA_URL, MAX_LOGO_BYTES } from '../../lib/branding';
import type { BrandedDocument, WorkspaceBranding } from '../../lib/branding';
import { drawLine, wrapText } from './pdfText';
import { DOCUMENT_WORDS, type DocumentLanguage, type DocumentWords } from '../../lib/documentLanguage';

/**
 * Document PDFs (invoices, estimates, credit notes, payment receipts, statements) with pdfkit:
 * every line on as many pages as needed with "Page x of y" (Y-17), the workspace's logo, colour,
 * address, footer and default terms (Y-12…Y-14, Y-33, Y-34), a QR code to the invoice's payment
 * page (Y-15), and text in any script, Hebrew included (DejaVu Sans, embedded). The old PDF was
 * written by hand: one page, only the first 15 lines, Latin letters only.
 * The printed words are in the customer's or the workspace's language (P-11, src/lib/documentLanguage.ts).
 * layoutDocumentPdf decides what is printed (pure, tested); generateDocumentPdf draws it.
 */
/** Branded documents (sent to customers and vendors) plus bills and vendor credits, printed as records (BA-08). */
export type PdfDocumentType = BrandedDocument | 'bill' | 'vendorCredit';

/** One printed row: invoice items, estimate lines or statement entries. */
export interface PdfLine { description?: string; name?: string; quantity?: number; amountCents?: number | string; /** AUD-01: a statement row's balance after it */ balanceCents?: number }

/** What a document PDF prints. Any saved invoice, estimate, credit note, payment or statement fits. */
export interface PdfDocument {
  id?: string;
  number?: string;
  date?: string;
  /** draft / void / paid … decides the watermark (Y-16) */
  status?: string;
  dueDate?: string;
  paymentTerms?: string;
  customerName?: string;
  vendorName?: string;
  contactName?: string;
  amountCents?: number;
  currency?: string;
  items?: PdfLine[];
  lines?: PdfLine[];
  transactions?: PdfLine[];
  taxAmountCents?: number;
  discountCents?: number;
  lineSumCents?: number;
  taxRate?: number;
  taxBreakdown?: Array<{ name?: string; rate?: number; taxCents?: number }>;
  pricesIncludeTax?: boolean;
  depositCents?: number;
  /** AUD-01: the period a statement covers, printed with it */
  period?: { startDate: string; endDate: string };
  /** `saleReceipt` (K-03): an invoice paid on the spot, titled as a receipt */
  metadata?: { saleReceipt?: boolean; /** IL-6 */ ilAllocationNumber?: string };
  /** K-04: an estimate the customer accepted prints as a sales order, with their reference */
  orderedAt?: string;
  customerReference?: string;
  /** Y-20: the customer signed the estimate online */
  signature?: { name?: string; signedAt?: string };
}

export interface PdfWorkspace { name?: string; companyName?: string; currency?: string; timezone?: string; branding?: WorkspaceBranding }

export interface PdfOptions {
  /** The invoice's public payment page; printed as a QR code on invoices. */
  paymentUrl?: string;
  /** P-11: the language of the printed words; the workspace's (branding.language) when left out */
  language?: DocumentLanguage;
  /** P-12: the customer's own terms, printed in place of the workspace's */
  terms?: string;
  /** IL-2: an Israeli tax document's first print is the original, later ones are copies */
  copyMark?: 'original' | 'copy';
}

export interface PdfLayout {
  title: string;
  company: { name: string; addressLines: string[] };
  meta: Array<[string, string]>;
  recipientLabel: string;
  recipient: string;
  rows: Array<{ description: string; quantity: string; amount: string; balance?: string }>;
  summary: Array<{ label: string; value: string; strong?: boolean }>;
  terms?: string;
  footer?: string;
  qrUrl?: string;
  /** #RRGGBB */
  color: string;
  /** Y-16: DRAFT, PAID or VOID across every page, so a draft or a cancelled document isn't mistaken for a live one. */
  watermark?: string;
  logo?: Buffer;
  /** P-11: the printed words (headers, page numbers, the watermark) */
  words: DocumentWords;
  /** Y-11: the page's look (Settings → Branding) */
  style: 'classic' | 'bold' | 'minimal';
  /** Y-11: whether the quantity column is printed */
  quantityColumn: boolean;
  /** AUD-01: a statement prints each row's running balance, as the screen and the JSON give it */
  balanceColumn: boolean;
}

/** Text without control characters (tabs and new lines kept), trimmed and cut to `max`. */
const clean = (value: unknown, max = 200) => [...String(value ?? '')].map(ch => {
  const code = ch.charCodeAt(0);
  return (code < 32 && ch !== '\n' && ch !== '\t') || code === 127 ? ' ' : ch;
}).join('').trim().slice(0, max);

/** The image bytes of a valid logo, else undefined. */
function logoBytes(dataUrl?: string): Buffer | undefined {
  if (!dataUrl || !LOGO_DATA_URL.test(dataUrl)) return undefined;
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  return bytes.length > 0 && bytes.length <= MAX_LOGO_BYTES ? bytes : undefined;
}

const STAMPED: ReadonlySet<PdfDocumentType> = new Set(['invoice', 'estimate', 'creditNote', 'purchaseOrder', 'bill', 'vendorCredit']);

/** The word stamped across a document by its status (statements and receipts are never stamped). */
export function watermarkFor(type: PdfDocumentType, status: unknown): string | undefined {
  if (!STAMPED.has(type)) return undefined;
  const s = String(status || '').toLowerCase();
  if (s === 'draft') return 'DRAFT';
  if (s === 'void' || s === 'cancelled') return 'VOID';
  if (s === 'paid' && (type === 'invoice' || type === 'bill')) return 'PAID';
  return undefined;
}

export function layoutDocumentPdf(
  type: PdfDocumentType,
  docData: PdfDocument | null | undefined,
  workspace: PdfWorkspace | null | undefined,
  options: PdfOptions = {}
): PdfLayout {
  const doc = docData || {};
  const branding = workspace?.branding || {};
  const words = DOCUMENT_WORDS[options.language || (branding.language === 'he' ? 'he' : 'en')];
  // amounts in the document's own currency, as a code (unambiguous on paper)
  const currency = String(doc.currency || workspace?.currency || 'USD').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'USD';
  const money = (cents: number) => {
    const text = `${currency} ${(Math.abs(Math.round(cents)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return cents < 0 ? `-${text}` : text;
  };
  const totalCents = Number(doc.amountCents) || 0;

  const meta: Array<[string, string]> = [[words.number, clean(doc.number || doc.id || 'N/A', 60)], [words.date, clean(doc.date || getDateInTimezoneISO(new Date(), workspace?.timezone), 10)]];
  if ((type === 'invoice' || type === 'estimate' || type === 'bill' || type === 'purchaseOrder') && doc.dueDate) {
    meta.push([type === 'estimate' ? words.validUntil : type === 'purchaseOrder' ? words.deliverBy : words.due, clean(doc.dueDate, 10)]);
  }
  if (type === 'statement' && doc.period) meta.push([words.period, `${clean(doc.period.startDate, 10)} – ${clean(doc.period.endDate, 10)}`]);
  if (type === 'invoice' && doc.paymentTerms) meta.push([words.terms, words.paymentTerms(doc.paymentTerms) || clean(doc.paymentTerms, 40)]);
  if (type === 'invoice' && doc.metadata?.ilAllocationNumber) meta.push([words.allocationNumber, clean(doc.metadata.ilAllocationNumber, 12)]);
  const salesOrder = type === 'estimate' && Boolean(doc.orderedAt);
  if (salesOrder && doc.customerReference) meta.push([words.yourReference, clean(doc.customerReference, 60)]);
  if (type === 'estimate' && doc.signature?.name) meta.push([words.signedBy, `${clean(doc.signature.name, 120)}, ${clean(doc.signature.signedAt, 10)}`]);

  // invoices keep `items`, estimates `lines`, statements `transactions`; every one is printed
  const items = doc.items || doc.lines || doc.transactions || [];
  const quantityColumn = type !== 'statement' && branding.hideQuantity !== true;
  const rows = (Array.isArray(items) && items.length > 0 ? items : [{ description: `${words.titles[type][0]}${words.titles[type].slice(1).toLowerCase()} ${clean(doc.number || '', 60)}`.trim(), quantity: 1, amountCents: totalCents }])
    .map(item => ({
      description: clean(item.description || item.name || words.item, 500),
      quantity: quantityColumn ? String(item.quantity ?? 1) : '',
      amount: money(Number(item.amountCents) || 0),
      ...(typeof item.balanceCents === 'number' ? { balance: money(item.balanceCents) } : {}),
    }));
  const balanceColumn = type === 'statement' && rows.some(r => r.balance !== undefined);

  // subtotal, discount and each tax part above the total (documents saved with the tax-code forms)
  const summary: PdfLayout['summary'] = [];
  const taxCents = Number(doc.taxAmountCents) || 0;
  const discountCents = Number(doc.discountCents) || 0;
  if (taxCents > 0 || discountCents > 0) {
    if (typeof doc.lineSumCents === 'number') summary.push({ label: words.subtotal, value: money(doc.lineSumCents) });
    if (discountCents > 0) summary.push({ label: words.discount, value: money(-discountCents) });
    const parts = Array.isArray(doc.taxBreakdown) && doc.taxBreakdown.length ? doc.taxBreakdown : [{ name: words.tax, rate: doc.taxRate, taxCents }];
    for (const p of parts) {
      summary.push({ label: `${clean(p.name || words.tax, 30)}${p.rate ? ` ${p.rate}%` : ''}${doc.pricesIncludeTax ? ` ${words.included}` : ''}`, value: money(Number(p.taxCents) || 0) });
    }
  }
  summary.push({ label: type === 'statement' ? words.balance : words.total, value: money(totalCents), strong: true });
  // a deposit is a payment in advance: the total keeps its tax, the deposit lowers what is due (AF-03)
  const depositCents = type === 'invoice' ? depositAppliedCents(doc) : 0;
  if (depositCents > 0) {
    summary.push({ label: words.deposit, value: money(-depositCents) });
    summary.push({ label: words.amountDue, value: money(totalCents - depositCents), strong: true });
  }

  // a sale receipt (K-03) is an invoice paid on the spot: titled as a receipt, nothing to pay
  const saleReceipt = type === 'invoice' && Boolean(doc.metadata?.saleReceipt);
  const qrWanted = type === 'invoice' && !saleReceipt && branding.showPaymentQr !== false && /^https?:\/\//.test(options.paymentUrl || '') && totalCents - depositCents > 0;
  return {
    title: `${saleReceipt ? words.titles.saleReceipt : salesOrder ? words.titles.salesOrder : words.titles[type]}${options.copyMark ? ` · ${words.copyMark[options.copyMark]}` : ''}`,
    company: {
      name: clean(workspace?.name || workspace?.companyName || 'LedgerFlow Workspace', 120),
      addressLines: clean(branding.address, 300).split(/\s*\n\s*/).filter(Boolean).slice(0, 5),
    },
    meta,
    recipientLabel: words.recipient[type],
    recipient: clean(doc.customerName || doc.vendorName || doc.contactName || words.client, 120),
    rows,
    summary,
    terms: clean(options.terms || (branding.terms as Partial<Record<PdfDocumentType, string>> | undefined)?.[type], 2000) || undefined,
    footer: clean(branding.footer, 300) || undefined,
    qrUrl: qrWanted ? options.paymentUrl : undefined,
    watermark: watermarkFor(type, doc.status),
    color: brandColor(branding.color),
    logo: logoBytes(branding.logoDataUrl),
    words,
    style: branding.style === 'bold' || branding.style === 'minimal' ? branding.style : 'classic',
    quantityColumn,
    balanceColumn,
  };
}

const FONT_DIR = path.join(process.cwd(), 'src/server/assets/fonts');
const PAGE = { width: 595.28, height: 841.89, margin: 50 };
const RIGHT = PAGE.width - PAGE.margin;
const FOOTER_SPACE = 36;

export function fonts(): { body: string; bold: string } | null {
  const body = path.join(FONT_DIR, 'DejaVuSans.ttf');
  const bold = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');
  return fs.existsSync(body) && fs.existsSync(bold) ? { body, bold } : null;
}

export async function generateDocumentPdf(
  type: PdfDocumentType,
  docData: PdfDocument | null | undefined,
  workspace: PdfWorkspace | null | undefined,
  options: PdfOptions = {}
): Promise<Buffer> {
  const layout = layoutDocumentPdf(type, docData, workspace, options);
  const files = fonts();
  // without the embedded fonts (should not happen) the built-in one prints Latin letters only
  const pdf = new PDFDocument({ size: 'A4', margin: PAGE.margin, bufferPages: true, font: files?.body || 'Helvetica', info: { Title: `${layout.title} ${layout.meta[0][1]}`, Author: layout.company.name } });
  if (files) { pdf.registerFont('body', files.body); pdf.registerFont('bold', files.bold); }
  const body = files ? 'body' : 'Helvetica';
  const bold = files ? 'bold' : 'Helvetica-Bold';
  const latin = (s: string) => (files ? s : s.replace(/[^\x20-\xFF]/g, '?'));
  const text = (s: string, x: number, y: number, width: number, align: 'left' | 'right' | 'center' = 'left') => drawLine(pdf, latin(s), x, y, width, align);
  const muted = () => pdf.fillColor('#6B7280');
  const ink = () => pdf.fillColor('#111827');
  const brand = () => pdf.fillColor(layout.color);
  const done = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  // --- header: logo, company and address on the left; title and document details on the right
  // (Y-11: "bold" puts it on a band of the brand colour across the top, in white)
  const banded = layout.style === 'bold';
  pdf.font(bold).fontSize(16);
  const nameLines = wrapText(pdf, latin(layout.company.name), 260);
  const headerBottom = Math.max(40 + (layout.logo ? 68 : 0) + nameLines.length * 20 + layout.company.addressLines.length * 12, 40 + 28 + layout.meta.length * 13);
  if (banded) pdf.rect(0, 0, PAGE.width, headerBottom + 10).fill(layout.color);
  const onBand = (fallback: () => unknown) => (banded ? pdf.fillColor('#FFFFFF') : fallback());
  let left = 40;
  if (layout.logo) {
    try { pdf.image(layout.logo, PAGE.margin, left, { fit: [150, 60] }); left += 68; } catch { /* unreadable image: no logo */ }
  }
  pdf.font(bold).fontSize(16); onBand(ink);
  for (const line of nameLines) { text(line, PAGE.margin, left, 260); left += 20; }
  pdf.font(body).fontSize(9); onBand(muted);
  for (const line of layout.company.addressLines) { text(line, PAGE.margin, left, 260); left += 12; }

  let right = 40;
  pdf.font(bold).fontSize(20); onBand(layout.style === 'minimal' ? ink : brand);
  text(layout.title, 320, right, RIGHT - 320, 'right'); right += 28;
  pdf.font(body).fontSize(9); onBand(ink);
  for (const [label, value] of layout.meta) { text(`${label}: ${value}`, 320, right, RIGHT - 320, 'right'); right += 13; }

  let y = Math.max(left, right) + 12;
  if (banded) y += 8;
  else pdf.moveTo(PAGE.margin, y).lineTo(RIGHT, y).lineWidth(1).strokeColor(layout.style === 'minimal' ? '#D1D5DB' : layout.color).stroke();
  y += 12;
  pdf.font(body).fontSize(8); muted(); text(layout.recipientLabel, PAGE.margin, y, 300); y += 12;
  pdf.font(bold).fontSize(12); ink(); text(layout.recipient, PAGE.margin, y, 400); y += 26;

  // --- the lines, over as many pages as needed
  const bottom = PAGE.height - PAGE.margin - FOOTER_SPACE;
  const descWidth = layout.balanceColumn ? 230 : 300;
  // a statement's amount moves left to make room for the balance after each row
  const amountX = layout.balanceColumn ? 290 : 420;
  const amountWidth = layout.balanceColumn ? 120 : RIGHT - 428;
  const tableHeader = () => {
    // Y-11: "minimal" has no coloured fill, only a thin line under the headings
    if (layout.style === 'minimal') {
      pdf.moveTo(PAGE.margin, y + 20).lineTo(RIGHT, y + 20).lineWidth(0.8).strokeColor('#111827').stroke();
      pdf.font(bold).fontSize(9); ink();
    } else {
      pdf.rect(PAGE.margin, y, RIGHT - PAGE.margin, 20).fill(layout.color);
      pdf.font(bold).fontSize(9).fillColor('#FFFFFF');
    }
    text(layout.words.description, PAGE.margin + 8, y + 6, descWidth);
    if (layout.quantityColumn) text(layout.words.quantity, 360, y + 6, 50, 'right');
    text(layout.words.amount, amountX, y + 6, amountWidth, 'right');
    if (layout.balanceColumn) text(layout.words.balance, 420, y + 6, RIGHT - 428, 'right');
    y += 26;
  };
  const newPage = () => { pdf.addPage(); y = PAGE.margin; };
  tableHeader();
  pdf.font(body).fontSize(10);
  for (const row of layout.rows) {
    pdf.font(body).fontSize(10);
    const lines = wrapText(pdf, latin(row.description), descWidth);
    const height = lines.length * 13 + 6;
    if (y + height > bottom) { newPage(); tableHeader(); pdf.font(body).fontSize(10); }
    ink();
    lines.forEach((line, i) => text(line, PAGE.margin + 8, y + i * 13, descWidth));
    if (row.quantity) text(row.quantity, 360, y, 50, 'right');
    text(row.amount, amountX, y, amountWidth, 'right');
    if (row.balance) text(row.balance, 420, y, RIGHT - 428, 'right');
    y += height;
    pdf.moveTo(PAGE.margin, y - 3).lineTo(RIGHT, y - 3).lineWidth(0.5).strokeColor('#E5E7EB').stroke();
  }

  // --- totals on the right, the payment QR code beside them
  const summaryHeight = layout.summary.length * 18 + 10;
  const qrSize = 84;
  const blockHeight = Math.max(summaryHeight, layout.qrUrl ? qrSize + 18 : 0);
  if (y + blockHeight > bottom) newPage();
  const blockTop = y + 8;
  y = blockTop;
  for (const line of layout.summary) {
    pdf.font(line.strong ? bold : body).fontSize(line.strong ? 11 : 10);
    if (line.strong) brand(); else ink();
    text(line.label, 330, y, 110);
    text(line.value, 440, y, RIGHT - 440, 'right');
    y += 18;
  }
  if (layout.qrUrl) {
    const qr = QRCode.create(layout.qrUrl, { errorCorrectionLevel: 'M' });
    const cells = qr.modules.size;
    const cell = qrSize / cells;
    pdf.fillColor('#000000');
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        if (qr.modules.get(r, c)) pdf.rect(PAGE.margin + c * cell, blockTop + r * cell, cell, cell).fill();
      }
    }
    pdf.font(body).fontSize(8); muted();
    text(layout.words.scanToPay, PAGE.margin, blockTop + qrSize + 4, 160);
  }
  y = blockTop + blockHeight + 10;

  // --- terms
  if (layout.terms) {
    pdf.font(body).fontSize(9);
    const lines = wrapText(pdf, latin(layout.terms), RIGHT - PAGE.margin);
    if (y + 26 > bottom) newPage();
    pdf.font(bold).fontSize(9); ink(); text(layout.words.termsHeading, PAGE.margin, y, 200); y += 14;
    pdf.font(body).fontSize(9); muted();
    for (const line of lines) {
      if (y + 12 > bottom) { newPage(); pdf.font(body).fontSize(9); muted(); }
      text(line, PAGE.margin, y, RIGHT - PAGE.margin); y += 12;
    }
  }

  // --- footer and page numbers on every page
  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    pdf.page.margins.bottom = 0;
    const fy = PAGE.height - PAGE.margin + 10;
    pdf.font(body).fontSize(8); muted();
    if (layout.footer) text(layout.footer, PAGE.margin, fy, 380);
    text(layout.words.page(i - range.start + 1, range.count), RIGHT - 100, fy, 100, 'right');
    if (layout.watermark) {
      pdf.save();
      pdf.rotate(-30, { origin: [PAGE.width / 2, PAGE.height / 2] });
      pdf.font(bold).fontSize(110).fillColor(layout.watermark === 'PAID' ? '#047857' : '#B91C1C').fillOpacity(0.1);
      pdf.text(latin(layout.words.watermark[layout.watermark as 'DRAFT' | 'VOID' | 'PAID'] || layout.watermark), 0, PAGE.height / 2 - 60, { width: PAGE.width, align: 'center', lineBreak: false });
      pdf.restore();
    }
  }
  pdf.end();
  return done;
}
