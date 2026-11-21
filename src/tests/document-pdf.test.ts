/**
 * Document PDFs (pdfService.ts on pdfkit) and branding (Y-12…Y-17, Y-33, Y-34): every line is printed
 * over as many pages as needed (the old PDF kept the first 15), page numbers, the workspace's
 * logo/colour/address/footer/terms, the payment QR on invoices, Hebrew and mixed text in reading
 * order, and the branding routes (owners and accountants; logo checked). Route part needs
 * LF_TEST_DATABASE_URL.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { generateDocumentPdf, layoutDocumentPdf, watermarkFor } from '../server/services/pdfService';
import { displayWords } from '../server/services/pdfText';
import { BrandingSchema, brandColor } from '../lib/branding';
import { pdfPageCount, pdfText } from './helpers/pdfText';
import type { Firestore } from '../server/db/pgFirestore';

/** A small valid PNG (solid colour). */
function png(w = 4, h = 2): string {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x40);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
}

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ description: `Line ${i + 1}`, quantity: 1, amountCents: 100 * (i + 1) }));

describe('What the PDF prints (layoutDocumentPdf)', () => {
  test('every line, the due date and terms, totals with the deposit, the workspace branding', () => {
    const layout = layoutDocumentPdf('invoice', {
      number: 'INV-9', date: '2026-07-01', dueDate: '2026-07-31', paymentTerms: 'net_30', customerName: 'Acme', currency: 'eur',
      items: items(40), amountCents: 82000, depositCents: 2000,
    }, { name: 'Shop', branding: { color: '#1f6feb', address: '1 Main St\nSpringfield', footer: 'Thank you', terms: { invoice: 'Pay within 30 days', estimate: 'Valid 14 days' } } },
    { paymentUrl: 'https://app.example/i/pay_1' });
    assert.equal(layout.rows.length, 40); // the old PDF printed 15
    assert.deepEqual(layout.meta, [['Number', 'INV-9'], ['Date', '2026-07-01'], ['Due', '2026-07-31'], ['Terms', 'Net 30']]);
    assert.deepEqual(layout.summary.map(s => [s.label, s.value]), [
      ['TOTAL', 'EUR 820.00'], ['Deposit received', '-EUR 20.00'], ['AMOUNT DUE', 'EUR 800.00'],
    ]);
    assert.deepEqual(layout.company, { name: 'Shop', addressLines: ['1 Main St', 'Springfield'] });
    assert.equal(layout.terms, 'Pay within 30 days');
    assert.equal(layout.footer, 'Thank you');
    assert.equal(layout.color, '#1F6FEB');
    assert.equal(layout.qrUrl, 'https://app.example/i/pay_1');
  });

  test('the payment QR only on invoices with something to pay, a real link, and the switch on', () => {
    const doc = { number: 'X', amountCents: 500 };
    const qr = (type: 'invoice' | 'estimate', d: object, branding = {}, paymentUrl = 'https://a.example/i/t') => layoutDocumentPdf(type, d, { branding }, { paymentUrl }).qrUrl;
    assert.ok(qr('invoice', doc));
    assert.equal(qr('estimate', doc), undefined);
    assert.equal(qr('invoice', doc, { showPaymentQr: false }), undefined);
    assert.equal(qr('invoice', { ...doc, depositCents: 500 }), undefined);
    assert.equal(qr('invoice', doc, {}, 'javascript:alert(1)'), undefined);
  });

  test('defaults: colour, recipient, a single line for documents without lines; a bad logo is ignored', () => {
    const layout = layoutDocumentPdf('payment', { number: 'PMT-1', amountCents: 1234 }, { branding: { logoDataUrl: 'data:image/gif;base64,AAAA', color: 'red' } });
    assert.equal(layout.color, brandColor());
    assert.equal(layout.logo, undefined);
    assert.equal(layout.recipientLabel, 'RECEIVED FROM');
    assert.deepEqual(layout.rows, [{ description: 'Payment receipt PMT-1', quantity: '1', amount: 'USD 12.34' }]);
    assert.equal(layout.terms, undefined);
    assert.equal(layoutDocumentPdf('statement', { amountCents: -500 }, {}).summary.at(-1)?.value, '-USD 5.00');
  });
});

describe('Page styles (Y-11)', () => {
  test('classic by default; bold and minimal when chosen; the quantity column can be left out', () => {
    const doc = { number: 'INV-1', items: items(2), amountCents: 300 };
    assert.equal(layoutDocumentPdf('invoice', doc, {}).style, 'classic');
    assert.equal(layoutDocumentPdf('invoice', doc, { branding: { style: 'bold' } }).style, 'bold');
    assert.equal(layoutDocumentPdf('invoice', doc, { branding: { style: 'minimal' } }).style, 'minimal');
    const plain = layoutDocumentPdf('invoice', doc, { branding: { hideQuantity: true } });
    assert.equal(plain.quantityColumn, false);
    assert.deepEqual(plain.rows.map(r => r.quantity), ['', '']);
    assert.equal(layoutDocumentPdf('invoice', doc, {}).quantityColumn, true);
    assert.equal(layoutDocumentPdf('statement', doc, {}).quantityColumn, false);
  });

  test('each style draws a whole invoice with its texts', async () => {
    for (const style of ['classic', 'bold', 'minimal'] as const) {
      const text = pdfText(await generateDocumentPdf('invoice', { number: 'INV-5', customerName: 'Acme', items: items(3), amountCents: 600 }, { name: 'Style Co', branding: { style, hideQuantity: style === 'minimal', logoDataUrl: png() } }));
      for (const shown of ['Style Co', 'INV-5', 'Acme', 'Line 3', 'Page 1 of 1']) assert.ok(text.includes(shown), `${style}: ${shown}`);
      assert.equal(text.includes('QTY'), style !== 'minimal', `${style}: the quantity column`);
    }
  });
});

describe('The PDF file', () => {
  test('long invoices run over several pages, each numbered, with the footer on every page', async () => {
    const pdf = await generateDocumentPdf('invoice', { number: 'INV-77', items: items(60), amountCents: 183000 }, { name: 'Shop', branding: { footer: 'Bank 12-345', logoDataUrl: png() } });
    const pages = pdfPageCount(pdf);
    assert.ok(pages >= 2, `${pages} pages`);
    const text = pdfText(pdf);
    for (let i = 1; i <= 60; i++) assert.ok(text.includes(`Line ${i} `), `line ${i} printed`);
    assert.ok(text.includes(`Page ${pages} of ${pages}`));
    assert.equal(text.split('Bank 12-345').length - 1, pages);
    assert.ok(text.includes('TOTAL USD 1,830.00'));
  });

  test('Hebrew and mixed Hebrew/English text keep their letters', async () => {
    const pdf = await generateDocumentPdf('invoice', { number: 'INV-1', customerName: 'שלום בע״מ', items: [{ description: 'ייעוץ Consulting', quantity: 2, amountCents: 5000 }], amountCents: 5000 }, { name: 'סטודיו אור' });
    const text = pdfText(pdf);
    const reversed = (s: string) => [...s].reverse().join('');
    // right-to-left words are stored in display order
    for (const word of ['שלום', 'סטודיו', 'ייעוץ']) assert.ok(text.includes(reversed(word)), word);
    assert.ok(text.includes('Consulting'));
  });

  test('words are put in display order: a Hebrew line reads right to left, numbers and English stay left to right', () => {
    // the font engine reverses a Hebrew word itself, so Hebrew words are passed in reading order
    assert.deepEqual(displayWords('Invoice 12'), ['Invoice', '12']);
    assert.deepEqual(displayWords('שלום עולם'), ['עולם', 'שלום']);
    assert.deepEqual(displayWords('Paid שלום 12 today'), ['Paid', '12', 'שלום', 'today']);
  });
});

describe('Branding settings (BrandingSchema)', () => {
  test('accepts PNG/JPEG logos, #RRGGBB colours and texts within their limits; rejects the rest', () => {
    assert.ok(BrandingSchema.safeParse({ logoDataUrl: png(), color: '#A1B2C3', address: 'x', footer: 'y', terms: { invoice: 'z' }, showPaymentQr: false }).success);
    assert.ok(BrandingSchema.safeParse({ logoDataUrl: '', color: '' }).success);
    assert.equal(BrandingSchema.safeParse({ logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }).success, false);
    assert.equal(BrandingSchema.safeParse({ logoDataUrl: `data:image/png;base64,${'A'.repeat(300_000)}` }).success, false);
    assert.equal(BrandingSchema.safeParse({ color: 'blue' }).success, false);
    assert.equal(BrandingSchema.safeParse({ footer: 'x'.repeat(301) }).success, false);
    assert.equal(BrandingSchema.safeParse({ terms: { bill: 'x' } }).success, false);
    assert.equal(BrandingSchema.safeParse({ script: '<x>' }).success, false);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('Branding routes', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_brand_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  const call = (uid: string, path: string, method: string, branding: unknown) =>
    fetch(`${base}/api/v1/workspaces/${ws}/branding${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify({ branding }) });

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner', name: 'Brand Co', currency: 'GBP', members: ['owner', 'acct', 'book'], roles: { acct: 'accountant', book: 'bookkeeper' } });
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    await db.pool.query(`delete from public."auditLogs" where workspace_id = $1`, [ws]).catch(() => undefined);
    await db.pool.query(`delete from public."workspaces" where id = $1`, [ws]);
    await db.terminate();
  });

  test('an accountant saves the branding; empty texts are dropped; the change is audited', async () => {
    const res = await call('acct', '', 'PUT', { color: '#00aa55', footer: '  Thanks!  ', address: '', terms: { invoice: 'Net 30', estimate: '  ' }, logoDataUrl: png() });
    assert.equal(res.status, 200, await res.clone().text());
    const saved = (await db.collection('workspaces').doc(ws).get()).data()?.branding;
    assert.deepEqual({ ...saved, logoDataUrl: Boolean(saved.logoDataUrl) }, { color: '#00AA55', footer: 'Thanks!', terms: { invoice: 'Net 30' }, logoDataUrl: true });
    const audit = await db.collection('auditLogs').where('workspaceId', '==', ws).get();
    assert.ok(audit.docs.some(d => d.data().action === 'BRANDING_UPDATED'));
  });

  test('the page style, the quantity column and the documents\' language are kept (Y-11, P-11); the defaults are not written', async () => {
    assert.equal((await call('owner', '', 'PUT', { style: 'bold', hideQuantity: true, language: 'he', footer: 'F' })).status, 200);
    assert.deepEqual((await db.collection('workspaces').doc(ws).get()).data()?.branding, { footer: 'F', style: 'bold', hideQuantity: true, language: 'he' });
    assert.equal((await call('owner', '', 'PUT', { style: 'classic', hideQuantity: false, language: 'en', footer: 'F' })).status, 200);
    assert.deepEqual((await db.collection('workspaces').doc(ws).get()).data()?.branding, { footer: 'F' });
    assert.equal((await call('owner', '', 'PUT', { style: 'fancy' })).status, 400);
  });

  test('a bookkeeper cannot; a non-image logo is refused with the reason', async () => {
    assert.equal((await call('book', '', 'PUT', { color: '#000000' })).status, 403);
    const bad = await call('owner', '', 'PUT', { logoDataUrl: 'data:text/html;base64,PHNjcmlwdD4=' });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).message, /PNG or JPEG/);
  });

  test('the preview is a sample invoice PDF with the branding given, in the workspace currency', async () => {
    const res = await call('owner', '/preview', 'POST', { footer: 'Preview footer', terms: { invoice: 'Preview terms' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    const text = pdfText(Buffer.from(await res.arrayBuffer()));
    for (const shown of ['Brand Co', 'Sample Customer Ltd', 'Preview footer', 'Preview terms', 'GBP 1,250.00', 'Scan to view and pay']) assert.ok(text.includes(shown), shown);
  });
});

describe('Status watermark (Y-16)', () => {
  test('draft, void and paid documents are stamped; open ones, statements and receipts are not', () => {
    assert.equal(watermarkFor('invoice', 'draft'), 'DRAFT');
    assert.equal(watermarkFor('bill', 'void'), 'VOID');
    assert.equal(watermarkFor('purchaseOrder', 'cancelled'), 'VOID');
    assert.equal(watermarkFor('invoice', 'paid'), 'PAID');
    assert.equal(watermarkFor('estimate', 'paid'), undefined);
    assert.equal(watermarkFor('invoice', 'sent'), undefined);
    assert.equal(watermarkFor('statement', 'draft'), undefined);
    assert.equal(watermarkFor('payment', 'void'), undefined);
    assert.equal(layoutDocumentPdf('invoice', { number: 'INV-1', status: 'draft', amountCents: 100 }, { name: 'Co' }).watermark, 'DRAFT');
  });

  test('a draft invoice PDF carries DRAFT; a sent one does not', async () => {
    const draft = pdfText(await generateDocumentPdf('invoice', { number: 'INV-9', status: 'draft', amountCents: 1000, date: '2026-10-05' }, { name: 'Co' }));
    assert.match(draft, /DRAFT/);
    const sent = pdfText(await generateDocumentPdf('invoice', { number: 'INV-9', status: 'sent', amountCents: 1000, date: '2026-10-05' }, { name: 'Co' }));
    assert.doesNotMatch(sent, /DRAFT|PAID|VOID/);
  });
});

describe('#890 (J-6): seller VAT number and recipient address', () => {
  const workspace = {
    name: 'Seller Ltd',
    branding: { address: '17 Seller Street' },
    taxProfiles: { books: { name: 'Books', place: { country: 'IL' }, registrations: [
      { kind: 'vat', number: '515123456', place: { country: 'IL' }, validFrom: '2026-01-01' },
      { kind: 'vat', number: '999000111', place: { country: 'IL' }, validTo: '2025-12-31' },
      { kind: 'employer', number: '777', place: { country: 'IL' } },
    ] } },
  } as never;

  test('the VAT number in force on the document date goes under the seller address; the address under the buyer', () => {
    const layout = layoutDocumentPdf('invoice', { number: 'INV-1', date: '2026-09-30', customerName: 'Buyer', amountCents: 100 }, workspace, { recipientAddress: '29 Buyer Avenue\nTel Aviv' });
    assert.deepEqual(layout.company.addressLines, ['17 Seller Street', 'VAT No. 515123456']);
    assert.deepEqual(layout.recipientAddressLines, ['29 Buyer Avenue', 'Tel Aviv']);
    // a number that ended before the document is printed on documents of its time only
    const old = layoutDocumentPdf('invoice', { number: 'INV-0', date: '2025-06-01', amountCents: 100 }, workspace);
    assert.deepEqual(old.company.addressLines, ['17 Seller Street', 'VAT No. 999000111']);
  });

  test('a statement in Hebrew prints both, and the address saved on the document wins over the contact\'s', async () => {
    const layout = layoutDocumentPdf('statement', { date: '2026-09-30', customerName: 'קונה', recipientAddress: '1 Issued Road' } as never, workspace, { language: 'he', recipientAddress: '29 Buyer Avenue' });
    assert.deepEqual(layout.company.addressLines, ['17 Seller Street', 'עוסק מורשה 515123456']);
    assert.deepEqual(layout.recipientAddressLines, ['1 Issued Road']);
    const text = pdfText(await generateDocumentPdf('invoice', { number: 'INV-2', date: '2026-09-30', customerName: 'Buyer', amountCents: 100 }, workspace, { recipientAddress: '29 Buyer Avenue' }));
    assert.match(text, /515123456/);
    assert.match(text, /29 Buyer Avenue/);
  });

  test('no tax profile or address: nothing extra is printed', () => {
    const layout = layoutDocumentPdf('invoice', { number: 'INV-3', amountCents: 100 }, { name: 'Co' });
    assert.deepEqual(layout.company.addressLines, []);
    assert.deepEqual(layout.recipientAddressLines, []);
  });
});
