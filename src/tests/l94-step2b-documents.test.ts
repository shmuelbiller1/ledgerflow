/**
 * L94-STEP2B: credit notes, vendor credits and deletes are built on the server too, and /transactions/bulk takes no
 * document entries from the browser any more. On the local test database, through the HTTP routes. Figures by hand:
 *   INV-1  2 × 150.00 = 300.00 + 10% 30.00 = 330.00 (A/R +330.00)
 *   CN-1   for INV-1: 100.00 + 10% 10.00 = 110.00 → A/R −110.00, the other side +110.00 (100.00 revenue back, 10.00 VAT)
 *   VC-1   from Paper Co: 100.00 + 18% 18.00 = 118.00 → A/P +118.00, the other side −118.00
 *   INV-1 deleted → its live entries reversed: A/R nets to −110.00 (only CN-1 is left)
 *   INV-2  dated 15 Sep, the books closed to 30 Sep → deleting it is refused (409), nothing changes
 * Every entry is the one the browser's builder makes from the same books. /transactions/bulk refuses an invoice save
 * and entries that name a document (400), and still takes a journal.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { postCreditNoteLedger, postVendorCreditLedger } from '../services/ledgerPost/creditPosting';
import { deletePostings } from '../services/ledgerPost/deletePostings';
import type { EntityMutation, LedgerPostContext, PostableTransaction } from '../services/ledgerPost/postingCore';
import { postingFingerprint } from './helpers/postingShadowCheck';
import type { ChartAccount, CreditNote, Transaction, VendorCredit, Workspace } from '../types';

const url = process.env.LF_TEST_DATABASE_URL;

describe('L94-STEP2B: credit notes, vendor credits and deletes posted by the server', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_l94s2b_${crypto.randomBytes(4).toString('hex')}`;
  const OWNER = 'owner-l94s2b';
  let db: import('../server/db/pgFirestore').Firestore;
  let server: Server;
  let base = '';
  const accounts = [
    { id: `${ws}_ar`, name: 'Accounts Receivable', type: 'asset', category: 'Receivables', code: '1100' },
    { id: `${ws}_bank`, name: 'Bank', type: 'asset', category: 'Cash', code: '1000' },
    { id: `${ws}_vatin`, name: 'VAT Receivable', type: 'asset', category: 'Tax', code: '1300' },
    { id: `${ws}_ap`, name: 'Accounts Payable', type: 'liability', category: 'Payables', code: '2000' },
    { id: `${ws}_vat`, name: 'VAT Payable', type: 'liability', category: 'Tax', code: '2200' },
    { id: `${ws}_sales`, name: 'Sales', type: 'income', code: '4000' },
    { id: `${ws}_supplies`, name: 'Office Supplies', type: 'expense', code: '6000' },
  ].map(a => ({ ...a, workspaceId: ws })) as unknown as ChartAccount[];
  const workspace = { id: ws, uid: OWNER, name: 'L-94 step 2B', currency: 'USD', timezone: 'UTC', defaultAccountMappings: { ar: `${ws}_ar`, ap: `${ws}_ap`, revenue: `${ws}_sales`, tax: `${ws}_vat` } } as unknown as Workspace;
  const invoice = (id: string, date = '2026-10-21') => ({
    id, workspaceId: ws, number: `INV-${id.slice(-1)}`, customerName: 'Acme', customerId: 'c1', date, dueDate: '2026-11-20', status: 'sent', currency: 'USD',
    amountCents: 33_000, taxAmountCents: 3_000, taxRate: 10, taxVersion: 2,
    items: [{ id: 'l1', description: 'Hours', quantity: 2, rateCents: 15_000, amountCents: 30_000 }],
  });
  const entries = async (key: string, docId: string) => (await db.collection('transactions').where('workspaceId', '==', ws).where(`metadata.${key}`, '==', docId).get()).docs.map(d => ({ ...d.data(), id: d.id }) as Transaction);
  const everything = async () => (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }) as Transaction);
  const sum = (txs: Transaction[], account: string) => txs.flatMap(t => t.lines || []).filter(l => l.accountId === `${ws}_${account}`).reduce((s, l) => s + l.amountCents, 0);
  /** what the browser's builder makes from the books as they are now */
  const browserBuild = async (build: (context: LedgerPostContext) => Promise<unknown>): Promise<PostableTransaction[]> => {
    const context: LedgerPostContext = { accounts, workspaces: [workspace], transactions: await everything(), invoices: [], inventory: [], lockDate: null, uid: OWNER, today: '2026-10-21', capture: [] };
    await build(context);
    return context.capture!.flatMap(c => c.txs);
  };
  const call = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': OWNER, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const post = (type: string, id: string, action: string, data?: Record<string, unknown>) => call(`/api/v1/documents/${type}/${id}/post`, { workspaceId: ws, action, ...(data ? { data } : {}) });
  const command = async (name: string, input: Record<string, unknown>, preview = false) => {
    const res = await fetch(`${base}/api/v1/commands/${name}${preview ? '/preview' : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-uid': OWNER, 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ workspaceId: ws, input }),
    });
    return { status: res.status, body: await res.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../server/db/firestore')).getDb() as unknown as typeof db;
    await db.collection('workspaces').doc(ws).set({ ...workspace, members: [OWNER], roles: { [OWNER]: 'owner' } } as unknown as Record<string, unknown>);
    for (const a of accounts) await db.collection('chartAccounts').doc(a.id).set(a as unknown as Record<string, unknown>);
    const express = (await import('express')).default;
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/transactions', transactionRouter);
    app.use('/api/v1/documents', (await import('../server/routes/documentPostRoutes')).documentPostRouter);
    app.use('/api/v1/commands', (await import('../server/routes/commandRoutes')).commandRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'invoices', 'creditNotes', 'vendorCredits', 'chartAccounts', 'idempotencyKeys', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    await db.terminate();
  });

  const inv1 = `${ws}_inv1`;

  test('CN-1 for INV-1 (110.00): A/R −110.00, as the browser builder makes it', async () => {
    assert.equal((await post('invoices', inv1, 'create', invoice(inv1))).status, 200);
    const cn = { id: `${ws}_cn1`, workspaceId: ws, number: 'CN-1', customerId: 'c1', customerName: 'Acme', invoiceId: inv1, date: '2026-10-21', status: 'open', currency: 'USD', amountCents: 11_000, taxAmountCents: 1_000, taxVersion: 2, remainingCents: 11_000 };
    const mutation: EntityMutation = { collection: 'creditNotes', docId: cn.id, action: 'create', data: cn };
    const expected = postingFingerprint(await browserBuild(c => postCreditNoteLedger(cn.id, cn as unknown as Partial<CreditNote>, ws, OWNER, mutation, c)));
    const res = await post('creditNotes', cn.id, 'create', cn);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const written = await entries('creditNoteId', cn.id);
    assert.deepEqual(postingFingerprint(written), expected);
    assert.equal(sum(written, 'ar'), -11_000);
    assert.equal(written.flatMap(t => t.lines).reduce((s, l) => s + l.amountCents, 0), 0);
  });

  test('VC-1 from Paper Co (118.00): A/P +118.00, as the browser builder makes it', async () => {
    const vc = { id: `${ws}_vc1`, workspaceId: ws, number: 'VC-1', vendorId: 'v1', vendorName: 'Paper Co', date: '2026-10-21', status: 'open', currency: 'USD', amountCents: 11_800, taxAmountCents: 1_800, taxVersion: 2, remainingCents: 11_800 };
    const mutation: EntityMutation = { collection: 'vendorCredits', docId: vc.id, action: 'create', data: vc };
    const expected = postingFingerprint(await browserBuild(c => postVendorCreditLedger(vc.id, vc as unknown as Partial<VendorCredit>, ws, OWNER, mutation, c)));
    const res = await post('vendorCredits', vc.id, 'create', vc);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const written = await entries('vendorCreditId', vc.id);
    assert.deepEqual(postingFingerprint(written), expected);
    assert.equal(sum(written, 'ap'), 11_800);
  });

  test('credit-note and vendor-credit CRUD commands preview, post edits, and reverse on delete', async () => {
    const cnId = `${ws}_cmd_cn`;
    const creditNote = { id: cnId, workspaceId: ws, number: 'CN-CMD', customerId: 'c1', customerName: 'Acme', date: '2026-10-21', status: 'partially_applied', currency: 'EUR', exchangeRate: 1, amountCents: 5_500, remainingCents: 5_500, taxAmountCents: 500, taxVersion: 2 };
    const cnMutation: EntityMutation = { collection: 'creditNotes', docId: cnId, action: 'create', data: creditNote };
    const cnExpected = postingFingerprint(await browserBuild(c => postCreditNoteLedger(cnId, creditNote as unknown as Partial<CreditNote>, ws, OWNER, cnMutation, c)));
    const cnPreview = await command('creditnote.create', { creditNote }, true);
    assert.equal(cnPreview.status, 200, JSON.stringify(cnPreview.body));
    assert.equal((await db.collection('creditNotes').doc(cnId).get()).exists, false, 'preview does not save the credit');
    const cnCreate = await command('creditnote.create', { creditNote });
    assert.equal(cnCreate.status, 200, JSON.stringify(cnCreate.body));
    assert.deepEqual(postingFingerprint(cnCreate.body.data.transactions), cnExpected);

    const changedCreditNote = { ...creditNote, amountCents: 6_600, remainingCents: 6_600, taxAmountCents: 600 };
    const cnUpdateMutation: EntityMutation = { collection: 'creditNotes', docId: cnId, action: 'update', data: changedCreditNote };
    const cnUpdateExpected = postingFingerprint(await browserBuild(c => postCreditNoteLedger(cnId, changedCreditNote as unknown as Partial<CreditNote>, ws, OWNER, cnUpdateMutation, c)));
    const cnUpdate = await command('creditnote.update', { id: cnId, data: { amountCents: 6_600, remainingCents: 6_600, taxAmountCents: 600 } });
    assert.equal(cnUpdate.status, 200, JSON.stringify(cnUpdate.body));
    assert.deepEqual(postingFingerprint(cnUpdate.body.data.transactions), cnUpdateExpected);
    const savedCreditNote = (await db.collection('creditNotes').doc(cnId).get()).data();
    assert.equal(savedCreditNote?.amountCents, 6_600);
    assert.equal(savedCreditNote?.status, 'partially_applied', 'a partial update preserves the non-default credit status');
    assert.equal(savedCreditNote?.currency, 'EUR', 'a partial update preserves the non-default currency');
    const cnDeleteExpected = postingFingerprint(await browserBuild(c => deletePostings(cnId, 'creditNoteId', ws, { collection: 'creditNotes', docId: cnId, action: 'delete' }, c)));
    const cnDelete = await command('creditnote.delete', { id: cnId });
    assert.equal(cnDelete.status, 200, JSON.stringify(cnDelete.body));
    assert.deepEqual(postingFingerprint(cnDelete.body.data.transactions), cnDeleteExpected);
    assert.equal((await db.collection('creditNotes').doc(cnId).get()).exists, false);

    const vcId = `${ws}_cmd_vc`;
    const vendorCredit = { id: vcId, workspaceId: ws, number: 'VC-CMD', vendorId: 'v1', vendorName: 'Paper Co', date: '2026-10-21', status: 'partially_applied', currency: 'ILS', exchangeRate: 1, amountCents: 7_700, remainingCents: 7_700, taxAmountCents: 700, taxVersion: 2 };
    const vcMutation: EntityMutation = { collection: 'vendorCredits', docId: vcId, action: 'create', data: vendorCredit };
    const vcExpected = postingFingerprint(await browserBuild(c => postVendorCreditLedger(vcId, vendorCredit as unknown as Partial<VendorCredit>, ws, OWNER, vcMutation, c)));
    const vcCreate = await command('vendorcredit.create', { vendorCredit });
    assert.equal(vcCreate.status, 200, JSON.stringify(vcCreate.body));
    assert.deepEqual(postingFingerprint(vcCreate.body.data.transactions), vcExpected);

    const changedVendorCredit = { ...vendorCredit, amountCents: 8_800, remainingCents: 8_800, taxAmountCents: 800 };
    const vcUpdateMutation: EntityMutation = { collection: 'vendorCredits', docId: vcId, action: 'update', data: changedVendorCredit };
    const vcUpdateExpected = postingFingerprint(await browserBuild(c => postVendorCreditLedger(vcId, changedVendorCredit as unknown as Partial<VendorCredit>, ws, OWNER, vcUpdateMutation, c)));
    const vcUpdate = await command('vendorcredit.update', { id: vcId, data: { amountCents: 8_800, remainingCents: 8_800, taxAmountCents: 800 } });
    assert.equal(vcUpdate.status, 200, JSON.stringify(vcUpdate.body));
    assert.deepEqual(postingFingerprint(vcUpdate.body.data.transactions), vcUpdateExpected);
    const savedVendorCredit = (await db.collection('vendorCredits').doc(vcId).get()).data();
    assert.equal(savedVendorCredit?.status, 'partially_applied', 'a partial update preserves the non-default credit status');
    assert.equal(savedVendorCredit?.currency, 'ILS', 'a partial update preserves the non-default currency');
    const vcDeleteExpected = postingFingerprint(await browserBuild(c => deletePostings(vcId, 'vendorCreditId', ws, { collection: 'vendorCredits', docId: vcId, action: 'delete' }, c)));
    const vcDelete = await command('vendorcredit.delete', { id: vcId });
    assert.equal(vcDelete.status, 200, JSON.stringify(vcDelete.body));
    assert.deepEqual(postingFingerprint(vcDelete.body.data.transactions), vcDeleteExpected);
    assert.equal((await db.collection('vendorCredits').doc(vcId).get()).exists, false);
  });

  // #775: an applied credit (remaining below the total) keeps its applied part
  test('an applied credit cannot be deleted or shrunk below what was applied', async () => {
    const cnId = `${ws}_applied_cn`;
    await db.collection('creditNotes').doc(cnId).set({ id: cnId, workspaceId: ws, number: 'CN-AP', customerId: 'c1', customerName: 'Acme', date: '2026-10-21', status: 'partially_applied', currency: 'USD', exchangeRate: 1, amountCents: 11_000, remainingCents: 5_000, taxAmountCents: 0, taxVersion: 2 });
    const del = await command('creditnote.delete', { id: cnId });
    assert.equal(del.status, 409, JSON.stringify(del.body));
    const shrink = await command('creditnote.update', { id: cnId, data: { amountCents: 5_000 } });
    assert.equal(shrink.status, 409, JSON.stringify(shrink.body));
    // Gitar on #929: 8,000 is above the 6,000 applied, but with 5,000 still remaining only 3,000 would look applied
    const quiet = await command('creditnote.update', { id: cnId, data: { amountCents: 8_000 } });
    assert.equal(quiet.status, 409, JSON.stringify(quiet.body));
    assert.equal((await db.collection('creditNotes').doc(cnId).get()).data()?.amountCents, 11_000);
    const vcId = `${ws}_applied_vc`;
    await db.collection('vendorCredits').doc(vcId).set({ id: vcId, workspaceId: ws, number: 'VC-AP', vendorId: 'v1', vendorName: 'Paper Co', date: '2026-10-21', status: 'applied', currency: 'USD', exchangeRate: 1, amountCents: 11_800, remainingCents: 0, taxAmountCents: 0, taxVersion: 2 });
    assert.equal((await command('vendorcredit.delete', { id: vcId })).status, 409);
    assert.ok((await db.collection('vendorCredits').doc(vcId).get()).exists);
  });

  // Gitar on #929: a total-only edit of an unapplied credit moves its remaining balance with it
  test('an unapplied credit edited by total alone keeps nothing applied', async () => {
    const cnId = `${ws}_free_cn`;
    await db.collection('creditNotes').doc(cnId).set({ id: cnId, workspaceId: ws, number: 'CN-FREE', customerId: 'c1', customerName: 'Acme', date: '2026-10-21', status: 'open', currency: 'USD', exchangeRate: 1, amountCents: 10_000, remainingCents: 10_000, taxAmountCents: 0, taxVersion: 2 });
    const up = await command('creditnote.update', { id: cnId, data: { amountCents: 12_000 } });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    let stored = (await db.collection('creditNotes').doc(cnId).get()).data();
    assert.equal(stored?.amountCents, 12_000);
    assert.equal(stored?.remainingCents, 12_000);
    const down = await command('creditnote.update', { id: cnId, data: { amountCents: 8_000 } });
    assert.equal(down.status, 200, JSON.stringify(down.body));
    stored = (await db.collection('creditNotes').doc(cnId).get()).data();
    assert.equal(stored?.remainingCents, 8_000);
    const mismatch = await command('creditnote.update', { id: cnId, data: { amountCents: 9_000, remainingCents: 5_000 } });
    assert.equal(mismatch.status, 409, JSON.stringify(mismatch.body));
    assert.ok((await command('creditnote.delete', { id: cnId })).status < 300);
  });

  test('INV-1 deleted: its entry reversed on the server, A/R nets to −110.00 (CN-1 alone), the deletion in the audit trail', async () => {
    const expected = postingFingerprint(await browserBuild(c => deletePostings(inv1, 'invoiceId', ws, { collection: 'invoices', docId: inv1, action: 'delete' }, c)));
    const res = await post('invoices', inv1, 'delete');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(postingFingerprint(res.body.transactions), expected);
    assert.equal((await db.collection('invoices').doc(inv1).get()).exists, false);
    assert.equal(sum(await entries('invoiceId', inv1), 'ar'), 0, 'INV-1 nets to zero');
    assert.equal(sum(await everything(), 'ar'), -11_000);
    const audit = (await db.collection('auditLogs').where('workspaceId', '==', ws).get()).docs.map(d => d.data());
    assert.ok(audit.some(a => a.action === 'DOCUMENT_DELETED' && a.entityId === inv1));
  });

  test('deleting an invoice whose entry is in a closed month is refused', async () => {
    const inv2 = `${ws}_inv2`;
    assert.equal((await post('invoices', inv2, 'create', invoice(inv2, '2026-09-15'))).status, 200);
    await db.collection('workspaces').doc(ws).update({ lockDate: '2026-09-30' });
    const res = await post('invoices', inv2, 'delete');
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal((await db.collection('invoices').doc(inv2).get()).exists, true);
    assert.equal(sum(await entries('invoiceId', inv2), 'ar'), 33_000);
    await db.collection('workspaces').doc(ws).update({ lockDate: null });
  });

  test('/transactions/bulk refuses an invoice save and entries that name a document; a journal still goes through', async () => {
    const journal = (metadata?: Record<string, unknown>) => ({
      id: crypto.randomUUID(), workspaceId: ws, date: '2026-10-21', description: 'Bank fee', totalAmountCents: 500, status: 'completed', type: 'actual',
      lines: [{ accountId: `${ws}_supplies`, amountCents: 500 }, { accountId: `${ws}_bank`, amountCents: -500 }], ...(metadata ? { metadata } : {}),
    });
    const refused = await call('/api/v1/transactions/bulk', { workspaceId: ws, transactions: [], entityMutation: { collection: 'invoices', docId: `${ws}_inv9`, action: 'create', data: invoice(`${ws}_inv9`) } });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /Invoices are saved and posted by the server/);
    const tagged = await call('/api/v1/transactions/bulk', { workspaceId: ws, transactions: [journal({ billId: 'b1' })] });
    assert.equal(tagged.status, 400);
    assert.match(tagged.body.error, /Bills are saved and posted by the server/);
    const ok = await call('/api/v1/transactions/bulk', { workspaceId: ws, transactions: [journal()] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });
});
