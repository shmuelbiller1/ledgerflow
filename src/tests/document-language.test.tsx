/**
 * Documents in the customer's language (P-11): the customer's own language, else the workspace's,
 * else English (P-11), and their own terms in place of the workspace's (P-12); a Hebrew document prints its title, labels, totals and page numbers in Hebrew; the
 * PDF download picks the customer's language; Branding and the customer form keep the choice.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { contactTerms, documentLanguage } from '../lib/documentLanguage';
import { BrandingSchema } from '../lib/branding';
import { generateDocumentPdf, layoutDocumentPdf } from '../server/services/pdfService';
import PartyModal, { type PartyFields } from '../components/common/PartyModal';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { pdfText } from './helpers/pdfText';

const invoice = { number: 'INV-1', date: '2026-10-10', dueDate: '2026-11-09', paymentTerms: 'net_30', status: 'draft', customerName: 'Acme', amountCents: 11700, lineSumCents: 10000, taxAmountCents: 1700, taxRate: 17, items: [{ description: 'Consulting', quantity: 1, amountCents: 10000 }] };

describe('The language', () => {
  test('the customer\'s own, else the workspace\'s, else English; unknown values are ignored', () => {
    assert.equal(documentLanguage({ language: 'he' }, { metadata: { documentLanguage: 'en' } }), 'en');
    assert.equal(documentLanguage({ language: 'he' }, { metadata: {} }), 'he');
    assert.equal(documentLanguage({ language: 'fr' }, { metadata: { documentLanguage: 'xx' } }), 'en');
    assert.equal(documentLanguage(undefined, null), 'en');
    assert.equal(BrandingSchema.safeParse({ language: 'he' }).success, true);
    assert.equal(BrandingSchema.safeParse({ language: 'fr' }).success, false);
  });

  test('a Hebrew invoice: title, details, totals and the watermark in Hebrew; what was typed and the amounts as they are', () => {
    const he = layoutDocumentPdf('invoice', invoice, { name: 'Shop' }, { language: 'he' });
    assert.equal(he.title, 'חשבונית');
    assert.deepEqual(he.meta, [['מספר', 'INV-1'], ['תאריך', '2026-10-10'], ['לתשלום עד', '2026-11-09'], ['תנאי תשלום', 'תוך 30 ימים']]);
    assert.equal(he.recipientLabel, 'לכבוד');
    assert.deepEqual(he.summary.map(s => s.label), ['סכום ביניים', 'מס 17%', 'סה״כ']);
    assert.equal(he.summary.at(-1)?.value, 'USD 117.00');
    assert.equal(he.rows[0].description, 'Consulting');
    assert.equal(he.words.watermark[he.watermark as 'DRAFT'], 'טיוטה');
    assert.equal(he.words.page(1, 2), 'עמוד 1 מתוך 2');
    // the workspace's language when the call doesn't say
    assert.equal(layoutDocumentPdf('statement', { amountCents: 5 }, { branding: { language: 'he' } }).summary.at(-1)?.label, 'יתרה');
    assert.equal(layoutDocumentPdf('invoice', invoice, { name: 'Shop' }).meta[3][1], 'Net 30');
  });

  test('a customer\'s own terms print in place of the workspace\'s; none: the workspace\'s', () => {
    assert.equal(contactTerms({ metadata: { documentTerms: '  Net 60, by wire  ' } }), 'Net 60, by wire');
    assert.equal(contactTerms({ metadata: { documentTerms: '   ' } }), undefined);
    const branding = { terms: { invoice: 'Pay in 30 days' } };
    assert.equal(layoutDocumentPdf('invoice', invoice, { branding }, { terms: 'Net 60, by wire' }).terms, 'Net 60, by wire');
    assert.equal(layoutDocumentPdf('invoice', invoice, { branding }).terms, 'Pay in 30 days');
  });

  test('the Hebrew PDF is drawn (no English page numbers on it)', async () => {
    const text = pdfText(await generateDocumentPdf('invoice', invoice, { name: 'Shop' }, { language: 'he' }));
    assert.match(text, /INV-1/);
    assert.doesNotMatch(text, /Page 1 of 1/);
    assert.match(pdfText(await generateDocumentPdf('invoice', invoice, { name: 'Shop' })), /Page 1 of 1/);
  });
});

describe('Downloading (database)', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_lang_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const download = async (docId: string) => pdfText(Buffer.from(await (await fetch(`${base}/api/v1/documents/invoice/${docId}/pdf?workspaceId=${ws}`, { headers: { 'x-test-uid': 'owner-1' } })).arrayBuffer()));
  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const express = (await import('express')).default;
    const { documentRouter } = await import('../server/routes/documentRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Lang', currency: 'USD', members: ['owner-1'] });
    await db.collection('customers').doc(`${ws}_he`).set({ workspaceId: ws, name: 'Hebrew Co', metadata: { documentLanguage: 'he', documentTerms: 'Special terms 42' } });
    await db.collection('customers').doc(`${ws}_en`).set({ workspaceId: ws, name: 'English Co' });
    for (const who of ['he', 'en']) await db.collection('invoices').doc(`${ws}_inv_${who}`).set({ ...invoice, workspaceId: ws, customerId: `${ws}_${who}`, number: `INV-${who.toUpperCase()}` });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/documents', documentRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    server?.close();
    for (const table of ['invoices', 'customers', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('each customer\'s invoice prints in their language, with their own terms', async () => {
    const he = await download(`${ws}_inv_he`);
    assert.match(he, /INV-HE/);
    assert.match(he, /Special terms 42/);
    assert.doesNotMatch(he, /Page 1 of 1/);
    const en = await download(`${ws}_inv_en`);
    assert.match(en, /Page 1 of 1/);
    assert.doesNotMatch(en, /Special terms 42/);
  });
});

describe('On screen', () => {
  afterEach(() => cleanup());

  test('the customer form keeps the language and their terms in the customer\'s details, with what was there; cleared, they go', () => {
    setComponentWorkspace('owner');
    const saved: PartyFields[] = [];
    render(<PartyModal side="customer" isOpen initial={{ id: 'c1', name: 'Acme', metadata: { memo: 'keep' } }} onClose={() => {}} onSave={p => { saved.push(p); }} />);
    const chooser = screen.getByLabelText('Language of their documents') as HTMLSelectElement;
    assert.equal(chooser.value, '');
    fireEvent.change(chooser, { target: { value: 'he' } });
    fireEvent.change(screen.getByLabelText(/Their own terms/), { target: { value: 'Net 60' } });
    fireEvent.submit(screen.getByLabelText('Customer Name').closest('form')!);
    assert.deepEqual(saved[0].metadata, { memo: 'keep', documentLanguage: 'he', documentTerms: 'Net 60' });
    cleanup();
    render(<PartyModal side="customer" isOpen initial={{ id: 'c1', name: 'Acme', metadata: saved[0].metadata }} onClose={() => {}} onSave={p => { saved.push(p); }} />);
    assert.equal((screen.getByLabelText(/Their own terms/) as HTMLTextAreaElement).value, 'Net 60');
    fireEvent.change(screen.getByLabelText('Language of their documents'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/Their own terms/), { target: { value: '' } });
    fireEvent.submit(screen.getByLabelText('Customer Name').closest('form')!);
    assert.deepEqual(saved[1].metadata, { memo: 'keep', documentLanguage: null, documentTerms: null }, 'null marks the saved customer preferences for deletion on the server');
  });
});
