/**
 * FX-GOLD: foreign currency end to end on a real database, every figure worked by hand. A USD workspace invoices and
 * is billed in EUR; the month-end revaluation moves the open balances to the 31 March rate and reverses the next day;
 * the documents are then paid at their own day's rates, and the difference is realized gain. Through the app's own
 * code: invoice and bill posting, `POST /transactions/revaluation/run`, `POST /payments` with the day's rate, the
 * report routes. The test runs when LF_TEST_DATABASE_URL is set.
 *
 * Worked figures (cents; EUR amounts in euro cents), USD books:
 *   2025-03-10  INV-E1  €1,000.00 at 1.10 → A/R 110,000 / Sales 110,000
 *   2025-03-20  B-E1    €500.00 at 1.10   → Supplies 55,000 / A/P 55,000
 *   2025-03-31  revaluation at 1.15 (the rate given for that day):
 *               A/R  €1,000 × 1.15 = 115,000 − 110,000 = +5,000
 *               A/P  €500 × 1.15  =  57,500 −  55,000 = +2,500 owed
 *               → A/R DR 5,000 / A/P CR 2,500 / Unrealized currency revaluation CR 2,500 (net gain 2,500)
 *   2025-04-01  its reversal: the same lines turned round → A/R 110,000, A/P 55,000 again
 *   2025-04-15  INV-E1 paid €1,000 at 1.12 → Checking +112,000, A/R −110,000, realized gain 2,000
 *   2025-04-20  B-E1 paid €500 at 1.08   → Checking −54,000, A/P +55,000, realized gain 1,000
 *
 *   Balance sheet 03-31: A/R 115,000 = A/P 57,500 + profit 57,500 (110,000 − 55,000 + 2,500)
 *   Balance sheet 04-01: A/R 110,000 = A/P 55,000 + profit 55,000 (the revaluation reversed)
 *   Balance sheet 04-30: Checking 58,000 = profit 58,000; A/R 0, A/P 0
 *   P&L March 57,500; April −2,500 + 2,000 + 1,000 = 500; together 58,000 = the cash that came in and went out
 *   The same date cannot be revalued twice.
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

describe('FX with worked figures', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_fx_${crypto.randomBytes(4).toString('hex')}`;
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
    for (const table of ['paymentAllocations', 'allocationOperations', 'transactions', 'invoices', 'bills', 'payments', 'customers', 'vendors', 'chartAccounts', 'auditLogs', 'idempotencyKeys', 'documentSeries', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

  test('a €1,000.00 invoice and a €500.00 bill at 1.10 are booked at 110,000 and 55,000', async () => {
    const inv = {
      id: invoiceId(), workspaceId: ws, uid: OWNER, number: 'INV-E1', customerId, customerName: 'Lyon Café', date: '2025-03-10', dueDate: '2025-04-30', status: 'sent' as const,
      amountCents: 100_000, amountPaidCents: 0, currency: 'EUR', exchangeRate: 1.1, taxVersion: 2, taxAmountCents: 0,
      items: [{ id: 'l1', description: 'Espresso machines', quantity: 1, rateCents: 100_000, amountCents: 100_000, accountId: acct['4000'].id }],
    };
    await postInvoiceLedger(inv.id, inv as never, ws, OWNER, { collection: 'invoices', docId: inv.id, action: 'create', data: inv }, await context());
    const bill = {
      id: billId(), workspaceId: ws, uid: OWNER, number: 'B-E1', billNumber: 'B-E1', vendorId, vendorName: 'Porto Paper', date: '2025-03-20', dueDate: '2025-04-30', status: 'approved' as const,
      amountCents: 50_000, amountPaidCents: 0, currency: 'EUR', exchangeRate: 1.1, splits: [{ accountId: acct['6000'].id, amountCents: 50_000, description: 'Paper' }],
    };
    await postBillLedger(bill.id, bill as never, ws, OWNER, { collection: 'bills', docId: bill.id, action: 'create', data: bill }, await context());
    const entries = await all<Transaction>('transactions');
    assert.deepEqual(linesOf(entries.find(t => t.metadata?.invoiceId === invoiceId())), [[acct['1100'].id, 110_000], [acct['4000'].id, -110_000]].sort());
    assert.deepEqual(linesOf(entries.find(t => t.metadata?.billId === billId())), [[acct['2000'].id, -55_000], [acct['6000'].id, 55_000]].sort());
  });

  test('31 March at 1.15: A/R +5,000, A/P +2,500, net unrealized gain 2,500; reversed on 1 April; not twice', async () => {
    const run = await send('POST', '/api/v1/transactions/revaluation/run', { workspaceId: ws, date: '2025-03-31', rates: { EUR: 1.15 } });
    assert.equal(run.status, 200, JSON.stringify(run.body));
    assert.deepEqual([run.body.posted, run.body.netGainCents, run.body.reversalDate, run.body.documentCount], [true, 2_500, '2025-04-01', 2]);
    const entries = await all<Transaction>('transactions');
    const entry = entries.find(t => t.id === run.body.transactionId);
    const reversal = entries.find(t => t.id === run.body.reversalTransactionId);
    assert.deepEqual([entry?.date, reversal?.date], ['2025-03-31', '2025-04-01']);
    assert.deepEqual(linesOf(entry), [[acct['1100'].id, 5_000], [acct['2000'].id, -2_500], [acct['4900'].id, -2_500]].sort());
    assert.deepEqual(linesOf(reversal), [[acct['1100'].id, -5_000], [acct['2000'].id, 2_500], [acct['4900'].id, 2_500]].sort());
    assert.deepEqual(await sheet('2025-03-31'), [0, 115_000, 57_500, 57_500, true], '115,000 = 57,500 + 110,000 − 55,000 + 2,500');
    assert.deepEqual(await sheet('2025-04-01'), [0, 110_000, 55_000, 55_000, true], 'the revaluation reversed');
    assert.ok((await send('POST', '/api/v1/transactions/revaluation/run', { workspaceId: ws, date: '2025-03-31', rates: { EUR: 1.15 } })).status >= 400, 'one run per date');
  });

  test('paid at the day\'s rates: €1,000 at 1.12 → 112,000, gain 2,000; €500 at 1.08 → 54,000, gain 1,000', async () => {
    const pay = (side: 'invoice' | 'bill', documentId: string, date: string, cents: number, rate: number) => send('POST', '/api/v1/payments', {
      workspaceId: ws, amountCents: cents, paymentDate: date, cashAccountId: acct['1000'].id, paymentMethod: 'bank_transfer', paymentExchangeRate: rate,
      ...(side === 'invoice' ? { customerId } : { vendorId }), allocations: [{ documentId, documentType: side, amountCents: cents }],
    });
    const received = await pay('invoice', invoiceId(), '2025-04-15', 100_000, 1.12);
    assert.equal(received.status, 200, JSON.stringify(received.body));
    const paid = await pay('bill', billId(), '2025-04-20', 50_000, 1.08);
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    const entries = await all<Transaction>('transactions');
    const byPayment = (p: { body: Record<string, any> }) => entries.find(t => t.id === p.body.data.transactionId); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(linesOf(byPayment(received)), [[acct['1000'].id, 112_000], [acct['1100'].id, -110_000], [acct['4910'].id, -2_000]].sort());
    assert.deepEqual(linesOf(byPayment(paid)), [[acct['1000'].id, -54_000], [acct['2000'].id, 55_000], [acct['4910'].id, -1_000]].sort());
  });

  test('April closes at Checking 58,000 = profit 58,000; March 57,500 + April 500', async () => {
    assert.deepEqual(await sheet('2025-04-30'), [58_000, 0, 0, 58_000, true]);
    const march = await report('/profit-and-loss?startDate=2025-03-01&endDate=2025-03-31');
    const april = await report('/profit-and-loss?startDate=2025-04-01&endDate=2025-04-30');
    assert.deepEqual([march.netIncome, april.netIncome], [57_500, 500], 'April: −2,500 reversal + 2,000 + 1,000');
    assert.deepEqual([april.income.accounts[acct['4900'].id]?.balance, april.income.accounts[acct['4910'].id]?.balance], [-2_500, 3_000]);
  });

  // #653: €100.00 at 1.0842 = 108.42 in A/R, paid €33.33 + €33.33 + €33.34 at the same rate. Each part clears its own
  // amount (36.14, 36.14) and the part that settles the invoice clears exactly what is left (108.42 − 72.28 = 36.14),
  // so A/R ends at 0.00 — also after a middle part is voided and paid again. The payment-ledger rows agree.
  test('#653: €100.00 at 1.0842 in three parts (one voided and paid again) leaves A/R at 0.00 and the rows agree', async () => {
    const inv = {
      id: `${ws}_INV-653`, workspaceId: ws, uid: OWNER, number: 'INV-653', customerId, customerName: 'Lyon Café', date: '2025-05-01', dueDate: '2025-06-30', status: 'sent' as const,
      amountCents: 10_000, amountPaidCents: 0, currency: 'EUR', exchangeRate: 1.0842, taxVersion: 2, taxAmountCents: 0,
      items: [{ id: 'l1', description: 'Beans', quantity: 1, rateCents: 10_000, amountCents: 10_000, accountId: acct['4000'].id }],
    };
    await postInvoiceLedger(inv.id, inv as never, ws, OWNER, { collection: 'invoices', docId: inv.id, action: 'create', data: inv }, await context());
    const pay = async (date: string, cents: number) => {
      const res = await send('POST', '/api/v1/payments', {
        workspaceId: ws, amountCents: cents, paymentDate: date, cashAccountId: acct['1000'].id, paymentMethod: 'bank_transfer',
        customerId, allocations: [{ documentId: inv.id, documentType: 'invoice', amountCents: cents }],
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.body.data as { paymentId: string; transactionId: string };
    };
    const arCleared = async (txId: string) => -((await all<Transaction>('transactions')).find(t => t.id === txId)?.lines?.find(l => l.accountId === acct['1100'].id)?.amountCents || 0);
    const first = await pay('2025-05-10', 3_333);
    const second = await pay('2025-05-20', 3_333);
    assert.deepEqual([await arCleared(first.transactionId), await arCleared(second.transactionId)], [3_614, 3_614]);
    const voided = await send('POST', `/api/v1/payments/${second.paymentId}/void`, { workspaceId: ws, date: '2025-05-21', reason: 'bounced' });
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
    const again = await pay('2025-05-22', 3_333);
    const last = await pay('2025-05-30', 3_334);
    assert.deepEqual([await arCleared(again.transactionId), await arCleared(last.transactionId)], [3_614, 3_614], 'the last part clears 108.42 − 72.28');
    assert.equal((await db.collection('invoices').doc(inv.id).get()).data()?.status, 'paid');
    const sheet0531 = await sheet('2025-05-31');
    assert.equal(sheet0531[1], 0, 'A/R 0.00 once the invoice is paid');
    const rows = (await all<Record<string, unknown>>('paymentAllocations')).filter(r => r.documentId === inv.id && r.kind !== 'reversal' && !r.reversedBy);
    assert.ok(rows.length >= 3, 'the payment ledger is in use here');
    assert.equal(rows.reduce((sum, r) => sum + Number(r.baseClearedCents || 0), 0), 10_842, 'the live rows clear the invoice exactly');
  });
});
