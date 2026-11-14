/**
 * #653: a foreign invoice paid in parts at its own rate leaves nothing in Accounts Receivable. Books in USD;
 * an invoice of €100.00 at 1.0842 = 108.42 into A/R, paid €33.33 + €33.33 + €33.34 at the same rate.
 * Each payment clears what the paid total is worth after it less before it, at the invoice's rate:
 *   round(33.33 × 1.0842) = 36.14;  round(66.66 × 1.0842) − 36.14 = 72.27 − 36.14 = 36.13;
 *   round(100 × 1.0842) − 72.27 = 108.42 − 72.27 = 36.15  → 108.42 in all, A/R 0.00.
 * (Each payment converted on its own gave 36.14 + 36.14 + 36.15 = 108.43 and left −0.01 in A/R.)
 * Runs when LF_TEST_DATABASE_URL is set.
 */
import './helpers/dom';
// registers the browser's posting host (L-94): the app's posting code sends its entries through it
import '../services/ledgerPost/postingKit';
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { postInvoiceLedger } from '../services/ledgerPost/invoicePosting';
import { postBillLedger } from '../services/ledgerPost/billPosting';
import type { LedgerPostContext } from '../services/ledgerPost/postingKit';
import type { ChartAccount, Transaction, Workspace } from '../types';

const url = process.env.LF_TEST_DATABASE_URL;

describe('#653 instalments at the invoice rate', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_fx653_${crypto.randomBytes(4).toString('hex')}`;
  const OWNER = 'owner-1';
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const realFetch = globalThis.fetch;
  const acct: Record<string, ChartAccount> = {};
  let customerId = '';
  let vendorId = '';
  let bust = 0;
  const invoiceId = () => `${ws}_INV-E1`;
  const billId = () => `${ws}_B-E1`;
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await realFetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-uid': OWNER }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const report = async (path: string) => (await send('GET', `/api/v1/reports${path}&workspaceId=${ws}&_read=${++bust}`)).body;
  const all = async <T>(collection: string) => (await db.collection(collection).where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }) as T);
  const context = async (): Promise<LedgerPostContext> => ({
    accounts: Object.values(acct), lockDate: null, uid: OWNER, inventory: [], transactions: await all<Transaction>('transactions'),
    workspaces: [{ id: ws, uid: OWNER, name: 'Atlas Imports', currency: 'USD' } as Workspace],
  });
  const linesOf = (t?: Transaction) => (t?.lines || []).map(l => [l.accountId, l.amountCents]).sort();
  const sheet = async (endDate: string) => {
    const bs = await report(`/balance-sheet?endDate=${endDate}`);
    return [bs.assets[acct['1000'].id] || 0, bs.assets[acct['1100'].id] || 0, bs.liabilities[acct['2000'].id] || 0, bs.netIncome, bs.isBalanced];
  };

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const { reportRouter } = await import('../server/routes/reportRoutes');
    const { paymentRouter } = await import('../server/routes/paymentRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'Atlas Imports', currency: 'USD', timezone: 'UTC', members: [OWNER] });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: 'owner@atlas.test' }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    app.use('/api/v1/transactions', transactionRouter);
    app.use('/api/v1/documents', (await import('../server/routes/documentPostRoutes')).documentPostRouter);
    app.use('/api/v1/reports', reportRouter);
    app.use('/api/v1/payments', paymentRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (!target.startsWith('/')) return realFetch(input, init);
      return realFetch(`${base}${target}`, { ...init, headers: { ...(init?.headers as Record<string, string> || {}), 'x-test-uid': OWNER } });
    }) as typeof fetch;
    const accounts = await send('POST', `/api/v1/workspaces/${ws}/import-records`, { kind: 'accounts', rows: [
      { name: 'Checking', code: '1000', type: 'Bank' },
      { name: 'Accounts Receivable', code: '1100', type: 'Accounts receivable' },
      { name: 'Accounts Payable', code: '2000', type: 'Accounts payable' },
      { name: 'Sales', code: '4000', type: 'Income' },
      // the month-end entry's account (found by "revaluation") and the payment-day one (found by "exchange")
      { name: 'Unrealized currency revaluation', code: '4900', type: 'Income' },
      { name: 'Realized exchange differences', code: '4910', type: 'Income' },
      { name: 'Supplies', code: '6000', type: 'Expense' },
    ] });
    assert.equal(accounts.status, 200, JSON.stringify(accounts.body));
    for (const a of await all<ChartAccount>('chartAccounts')) acct[String(a.code)] = a;
    assert.equal(Object.keys(acct).length, 7);
    assert.equal((await send('POST', `/api/v1/workspaces/${ws}/import-records`, { kind: 'customers', rows: [{ name: 'Lyon Café', currency: 'EUR' }] })).status, 200);
    assert.equal((await send('POST', `/api/v1/workspaces/${ws}/import-records`, { kind: 'vendors', rows: [{ name: 'Porto Paper', currency: 'EUR' }] })).status, 200);
    customerId = (await all<{ id: string }>('customers'))[0].id;
    vendorId = (await all<{ id: string }>('vendors'))[0].id;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    server?.close();
    for (const table of ['transactions', 'invoices', 'bills', 'payments', 'customers', 'vendors', 'chartAccounts', 'auditLogs', 'idempotencyKeys', 'documentSeries', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

  test('€100.00 at 1.0842 paid in three parts: the bank gets 108.42 and A/R ends at 0.00', async () => {
    const inv = {
      id: `${ws}_INV-653`, workspaceId: ws, uid: OWNER, number: 'INV-653', customerId, customerName: 'Lyon Café', date: '2025-05-01', dueDate: '2025-06-30', status: 'sent' as const,
      amountCents: 10_000, amountPaidCents: 0, currency: 'EUR', exchangeRate: 1.0842, taxVersion: 2, taxAmountCents: 0,
      items: [{ id: 'l1', description: 'Beans', quantity: 1, rateCents: 10_000, amountCents: 10_000, accountId: acct['4000'].id }],
    };
    await postInvoiceLedger(inv.id, inv as never, ws, OWNER, { collection: 'invoices', docId: inv.id, action: 'create', data: inv }, await context());
    const pay = (date: string, cents: number) => send('POST', '/api/v1/payments', {
      workspaceId: ws, amountCents: cents, paymentDate: date, cashAccountId: acct['1000'].id, paymentMethod: 'bank_transfer',
      customerId, allocations: [{ documentId: inv.id, documentType: 'invoice', amountCents: cents }],
    });
    const cleared: number[] = [];
    for (const [date, cents] of [['2025-05-10', 3_333], ['2025-05-20', 3_333], ['2025-05-30', 3_334]] as const) {
      const res = await pay(date, cents);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const entry = (await all<Transaction>('transactions')).find(t => t.id === res.body.data.transactionId);
      cleared.push(-(entry?.lines?.find(l => l.accountId === acct['1100'].id)?.amountCents || 0));
    }
    assert.deepEqual(cleared, [3_614, 3_613, 3_615]);
    assert.deepEqual(await sheet('2025-05-31'), [10_842, 0, 0, 10_842, true], 'Checking 108.42, A/R 0.00');
    const paid = (await db.collection('invoices').doc(inv.id).get()).data();
    assert.equal(paid?.status, 'paid');
  });
});
