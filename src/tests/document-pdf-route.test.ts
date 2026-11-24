/**
 * Document PDFs through the real router (GET /api/v1/documents/:type/:id/pdf) and database.
 * Express passes `next` as the handler's third argument; the handler took it for the database,
 * so every download failed with a 500 (only direct calls with a mock database were tested).
 * Runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';
import { pdfText } from './helpers/pdfText';

const url = process.env.LF_TEST_DATABASE_URL;

describe('Document PDF downloads', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const ws = `ws_pdf_${suffix}`;
  const other = `ws_pdf_other_${suffix}`;
  const id = (name: string) => `${ws}_${name}`;
  let server: Server;
  let base = '';
  let db: Firestore;

  const download = (uid: string, type: string, docId: string, workspaceId = ws) =>
    fetch(`${base}/api/v1/documents/${type}/${docId}/pdf?workspaceId=${workspaceId}`, { headers: { 'x-test-uid': uid } });

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { documentRouter } = await import('../server/routes/documentRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'PDF Books', currency: 'USD', members: ['owner-1', 'view-1'], roles: { 'view-1': 'viewer' } });
    await db.collection('workspaces').doc(other).set({ uid: 'owner-2', name: 'Other', currency: 'USD', members: ['owner-2'] });
    await db.collection('customers').doc(id('c1')).set({ workspaceId: ws, name: 'Acme Ltd' });
    await db.collection('invoices').doc(id('inv')).set({
      workspaceId: ws, customerId: id('c1'), customerName: 'Acme Ltd', number: 'INV-0007', date: '2026-06-01', status: 'sent',
      amountCents: 12500, items: [{ description: 'Consulting', quantity: 1, amountCents: 12500 }],
    });
    await db.collection('invoices').doc(id('inv2')).set({
      workspaceId: ws, customerId: id('c1'), customerName: 'Acme Ltd', number: 'INV-0009', date: '2026-08-10', status: 'sent', amountCents: 3000, items: [],
    });
    await db.collection('estimates').doc(id('est')).set({
      workspaceId: ws, customerId: id('c1'), number: 'EST-0003', date: '2026-06-02', status: 'sent', amountCents: 4000,
      lines: [{ description: 'Site survey', quantity: 2, unitPriceCents: 2000, amountCents: 4000 }],
    });
    await db.collection('purchaseOrders').doc(id('po')).set({
      workspaceId: ws, vendorId: 'v1', vendorName: 'Paper Supply Co', poNumber: 'PO-0042', issueDate: '2026-06-03', expectedDeliveryDate: '2026-06-20',
      status: 'approved', totalAmountCents: 7500, items: [{ id: 'l1', description: 'A4 paper boxes', quantity: 3, unitPriceCents: 2500, totalCents: 7500 }],
    });
    await db.collection('bills').doc(id('bill')).set({ workspaceId: ws, vendorId: 'v1', vendorName: 'Paper Supply Co', number: 'B-77', date: '2026-06-21', dueDate: '2026-07-21', amountCents: 7500, status: 'open' });
    await db.collection('invoices').doc(`${other}_inv`).set({ workspaceId: other, customerId: 'x', number: 'X-1', date: '2026-06-01', status: 'sent', amountCents: 100 });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/documents', documentRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['invoices', 'estimates', 'purchaseOrders', 'bills', 'customers', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = any($1) or id = any($1)`, [[ws, other]]);
    }
    await db.terminate();
  });

  test('an invoice downloads as a PDF', async () => {
    const res = await download('owner-1', 'invoice', id('inv'));
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.ok(bytes.toString('latin1').startsWith('%PDF-'));
    const pdf = pdfText(bytes);
    assert.match(pdf, /INV-0007/);
    assert.match(pdf, /Consulting/);
  });

  test('the POST PDF alias accepts the workspace in its body and refuses an outsider', async () => {
    const post = (uid: string) => fetch(`${base}/api/v1/documents/invoice/${id('inv')}/pdf`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify({ workspaceId: ws }),
    });
    const res = await post('owner-1');
    assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(pdfText(Buffer.from(await res.arrayBuffer())), /INV-0007/);
    assert.equal((await post('stranger-1')).status, 403);
  });

  test("an estimate's PDF lists its lines (estimates keep `lines`, not `items`)", async () => {
    const res = await download('view-1', 'estimate', id('est'));
    assert.equal(res.status, 200);
    const pdf = pdfText(Buffer.from(await res.arrayBuffer()));
    assert.match(pdf, /Site survey/);
    assert.doesNotMatch(pdf, /Standard Ledger Transaction/);
  });

  test('a customer statement downloads with its invoices', async () => {
    const res = await download('owner-1', 'statement', id('c1'));
    assert.equal(res.status, 200);
    const pdf = pdfText(Buffer.from(await res.arrayBuffer()));
    assert.match(pdf, /2026-06-01 Invoice INV-0007/);
  });

  test('a statement PDF follows the period on screen: opening balance, then only that period (ISS-141)', async () => {
    const res = await fetch(`${base}/api/v1/documents/statement/${id('c1')}/pdf?workspaceId=${ws}&startDate=2026-08-01&endDate=2026-08-31`, { headers: { 'x-test-uid': 'owner-1' } });
    assert.equal(res.status, 200);
    const pdf = pdfText(Buffer.from(await res.arrayBuffer()));
    assert.match(pdf, /2026-08-01 Opening balance/);
    assert.match(pdf, /125\.00/);
    assert.match(pdf, /2026-08-10 Invoice INV-0009/);
    assert.doesNotMatch(pdf, /INV-0007/);
  });

  test('a purchase order prints for the vendor: number, delivery date, lines (BA-08)', async () => {
    const res = await download('owner-1', 'purchaseOrder', id('po'));
    assert.equal(res.status, 200, await res.clone().text());
    const pdf = pdfText(Buffer.from(await res.arrayBuffer()));
    for (const text of [/PURCHASE ORDER/, /PO-0042/, /ORDERED FROM/, /Paper Supply Co/, /Deliver by/, /2026-06-20/, /A4 paper boxes/, /USD 75\.00/]) assert.match(pdf, text);
  });

  test('a bill prints as a record', async () => {
    const res = await download('view-1', 'bill', id('bill'));
    assert.equal(res.status, 200);
    const pdf = pdfText(Buffer.from(await res.arrayBuffer()));
    for (const text of [/BILL/, /B-77/, /Due/, /2026-07-21/]) assert.match(pdf, text);
  });

  test('several invoices in one zip (Y-18): only this workspace\'s, each a PDF', async () => {
    await db.collection('invoices').doc(id('inv2')).set({ workspaceId: ws, customerId: id('c1'), customerName: 'Acme Ltd', number: 'INV-0008', date: '2026-06-05', status: 'paid', amountCents: 900 });
    const zip = (uid: string, body: unknown) => fetch(`${base}/api/v1/documents/zip`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify(body) });
    const res = await zip('view-1', { workspaceId: ws, type: 'invoice', ids: [id('inv'), id('inv2'), `${other}_inv`, id('missing'), id('inv')] });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(res.headers.get('content-type'), 'application/zip');
    const bytes = Buffer.from(await res.arrayBuffer());
    const end = bytes.length - 22;
    assert.equal(bytes.readUInt32LE(end), 0x06054b50);
    assert.equal(bytes.readUInt16LE(end + 10), 2, 'two invoices: the other workspace\'s and the missing one are left out, a repeat counted once');
    let at = bytes.readUInt32LE(end + 16);
    const names: string[] = [];
    for (let i = 0; i < 2; i++) {
      const len = bytes.readUInt16LE(at + 28);
      names.push(bytes.subarray(at + 46, at + 46 + len).toString('utf8'));
      at += 46 + len + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    }
    assert.deepEqual(names, ['invoice_INV-0007.pdf', 'invoice_INV-0008.pdf']);
    assert.ok(bytes.indexOf('%PDF-') > 0);
    assert.equal((await zip('stranger', { workspaceId: ws, type: 'invoice', ids: [id('inv')] })).status, 403);
    assert.equal((await zip('owner-1', { workspaceId: ws, type: 'invoice', ids: [] })).status, 400);
    assert.equal((await zip('owner-1', { workspaceId: ws, type: 'statement', ids: [id('c1')] })).status, 400);
    assert.equal((await zip('owner-1', { workspaceId: ws, type: 'invoice', ids: [`${other}_inv`] })).status, 404);
  });

  test("another workspace's document answers like a missing one; strangers are refused", async () => {
    assert.equal((await download('owner-1', 'invoice', `${other}_inv`)).status, 404);
    assert.equal((await download('owner-1', 'invoice', id('nope'))).status, 404);
    assert.equal((await download('stranger', 'invoice', id('inv'))).status, 403);
    assert.equal((await download('owner-1', 'bogus', id('inv'))).status, 400);
  });
});
