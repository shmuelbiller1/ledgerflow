/**
 * EG-3: the period-closing document (docs/design/EG-3-period-closing.md) on a real database, through the app's own
 * routes: close-year, the month reopen, the report routes and GET /period-closings. The test runs when
 * LF_TEST_DATABASE_URL is set.
 *
 * Worked figures (cents), calendar 2025:
 *   01-02  capital:  Checking 1,000,000 / Owner's Equity 1,000,000
 *   03-01  sales:    Checking   500,000 / Sales 500,000
 *   06-01  rent:     Rent       300,000 / Checking 300,000
 *   P&L: income 500,000 − expenses 300,000 = net profit 200,000
 *   Retained earnings: 0 before the year + 200,000 transfer (figures only, no entry posted) = 200,000
 *   Balance sheet 2025-12-31: assets (Checking) 1,000,000 + 500,000 − 300,000 = 1,200,000;
 *     liabilities 0; equity accounts 1,000,000; retained earnings 200,000 → 1,200,000, balanced.
 *   Close (locked) → version 1, current, lock 2025-12-31, the snapshot's checksum.
 *   December reopened → version 1 superseded (kept), lock 2025-11-30.
 *   12-15  rent:     Rent 50,000 / Checking 50,000 → expenses 350,000, net 150,000, assets 1,150,000
 *   Closed again → version 2, current: income 500,000, expenses 350,000, net 150,000, RE 150,000, claims 1,150,000;
 *     version 1 still says 200,000 and is superseded. No entry is posted by either close.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { ChartAccount } from '../types';
import type { PeriodClosing } from '../server/services/periodClosingService';

const url = process.env.LF_TEST_DATABASE_URL;

/** What the routes used here answer (only the fields the test reads). */
interface Body {
  closings?: Array<PeriodClosing & { id: string }>;
  netIncomeCents?: number; closingVersion?: number;
  income?: { total: number }; expense?: { total: number }; netIncome?: number;
  totalAssets?: number; totalLiabilities?: number; totalEquity?: number; totalClaims?: number;
}

describe('EG-3 period-closing document', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_eg3_${crypto.randomBytes(4).toString('hex')}`;
  const OWNER = 'owner-eg3';
  const VIEWER = 'viewer-eg3';
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const acct: Record<string, ChartAccount> = {};
  let bust = 0;
  const send = async (method: string, path: string, body?: unknown, uid = OWNER) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-uid': uid }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json().catch(() => ({})) as Body };
  };
  const report = async (path: string) => (await send('GET', `/api/v1/reports${path}&workspaceId=${ws}&_read=${++bust}`)).body as Required<Body>;
  const closings = async () => (await send('GET', `/api/v1/transactions/period-closings?workspaceId=${ws}`)).body.closings || [];
  const entryCount = async () => (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.length;
  const journal = (id: string, date: string, debit: string, credit: string, cents: number) => send('POST', '/api/v1/transactions/bulk', { workspaceId: ws, transactions: [{
    id: `${ws}_${id}`, uid: OWNER, workspaceId: ws, date, description: id, totalAmountCents: cents, currency: 'USD', status: 'completed', type: 'journal',
    lines: [{ accountId: acct[debit].id, amountCents: cents }, { accountId: acct[credit].id, amountCents: -cents }],
  }] });
  const close = () => send('POST', '/api/v1/transactions/close-year', { workspaceId: ws, closingDate: '2025-12-31', lockPeriod: true });

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const { reportRouter } = await import('../server/routes/reportRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'Closing Co', currency: 'USD', timezone: 'UTC', members: [OWNER, VIEWER], roles: { [VIEWER]: 'viewer' } });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: `${req.header('x-test-uid')}@closing.test` }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    app.use('/api/v1/transactions', transactionRouter);
    app.use('/api/v1/reports', reportRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const imported = await send('POST', `/api/v1/workspaces/${ws}/import-records`, { kind: 'accounts', rows: [
      { name: 'Checking', code: '1000', type: 'Bank' },
      { name: "Owner's Equity", code: '3000', type: 'Equity' },
      { name: 'Retained Earnings', code: '3100', type: 'Equity' },
      { name: 'Sales', code: '4000', type: 'Income' },
      { name: 'Rent', code: '6000', type: 'Expense' },
    ] });
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    for (const d of (await db.collection('chartAccounts').where('workspaceId', '==', ws).get()).docs) {
      const a = { ...d.data(), id: d.id } as ChartAccount;
      acct[String(a.code)] = a;
    }
    for (const [id, date, dr, cr, cents] of [['capital', '2025-01-02', '1000', '3000', 1_000_000], ['sales', '2025-03-01', '1000', '4000', 500_000], ['rent', '2025-06-01', '6000', '1000', 300_000]] as const) {
      const r = await journal(id, date, dr, cr, cents);
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'periods', 'chartAccounts', 'auditLogs', 'periodBalances', 'periodClosings', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

  test('A7S-01: a draft dated inside the year blocks locking it (409), so it is never left unpostable', async () => {
    const draftId = `${ws}_draft_in_year`;
    const saved = await send('POST', '/api/v1/transactions/bulk', { workspaceId: ws, transactions: [{
      id: draftId, uid: OWNER, workspaceId: ws, date: '2025-09-01', description: 'draft', totalAmountCents: 1_000, currency: 'USD', status: 'draft', type: 'journal',
      lines: [{ accountId: acct['6000'].id, amountCents: 1_000 }, { accountId: acct['1000'].id, amountCents: -1_000 }],
    }] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const refused = await close();
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.match(JSON.stringify(refused.body), /draft/);
    assert.equal((await closings()).length, 0, 'nothing was closed');
    await db.pool.query('delete from public."transactions" where id = $1', [draftId]);
  });

  test('close: one current document whose figures equal the P&L and the balance sheet at the year end; no entry posted', async () => {
    const before = await entryCount();
    const r = await close();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.netIncomeCents, r.body.closingVersion], [200_000, 1]);
    assert.equal(await entryCount(), before, 'no closing entry (CA-07)');
    const docs = await closings();
    assert.equal(docs.length, 1);
    const [d] = docs;
    assert.deepEqual([d.id, d.version, d.status, d.yearStart, d.yearEnd, d.lockDate, d.closedByUid], [`${ws}_2025-12-31_v1`, 1, 'current', '2025-01-01', '2025-12-31', '2025-12-31', OWNER]);
    assert.deepEqual([d.profitAndLoss.income.total, d.profitAndLoss.expense.total, d.profitAndLoss.netIncome], [500_000, 300_000, 200_000]);
    assert.deepEqual(d.profitAndLoss.income.accounts.map(a => [a.code, a.cents]), [['4000', 500_000]]);
    assert.deepEqual(d.profitAndLoss.expense.accounts.map(a => [a.code, a.cents]), [['6000', 300_000]]);
    assert.deepEqual(d.retainedEarnings, { before: 0, transfer: 200_000, after: 200_000, entryPosted: false });
    assert.deepEqual(d.balanceSheet, { totalAssets: 1_200_000, totalLiabilities: 0, totalEquity: 1_000_000, retainedEarnings: 200_000, totalClaims: 1_200_000, isBalanced: true });
    const pl = await report('/profit-and-loss?startDate=2025-01-01&endDate=2025-12-31');
    assert.deepEqual([pl.income.total, pl.expense.total, pl.netIncome], [d.profitAndLoss.income.total, d.profitAndLoss.expense.total, d.profitAndLoss.netIncome]);
    const bs = await report('/balance-sheet?endDate=2025-12-31');
    assert.deepEqual([bs.totalAssets, bs.totalLiabilities, bs.totalEquity, bs.netIncome, bs.totalClaims], [1_200_000, 0, 1_000_000, 200_000, 1_200_000]);
    const snap = (await db.collection('periodBalances').doc(`${ws}_2025-12-31`).get()).data();
    assert.deepEqual([d.snapshot.id, d.snapshot.checksum, d.snapshot.entryCount], [`${ws}_2025-12-31`, snap?.checksum, 3]);
    assert.deepEqual([d.links.closeChecklist.month, d.links.closePackage.file], ['2025-12', 'Close_Package_2025-12.xlsx']);
  });

  test('any member reads the documents (a viewer too); an outsider is refused', async () => {
    assert.equal((await send('GET', `/api/v1/transactions/period-closings?workspaceId=${ws}`, undefined, VIEWER)).status, 200);
    assert.equal((await send('GET', `/api/v1/transactions/period-closings?workspaceId=${ws}`, undefined, 'outsider')).status, 403);
    assert.equal((await send('GET', '/api/v1/transactions/period-closings')).status, 400);
  });

  test('reopen December: version 1 superseded and kept', async () => {
    const reopen = await send('POST', `/api/v1/workspaces/${ws}/periods/2025-12/reopen`, { reason: 'A December rent bill was missed' });
    assert.equal(reopen.status, 200, JSON.stringify(reopen.body));
    const [d] = await closings();
    assert.deepEqual([d.version, d.status, d.supersededBy, d.supersededReason], [1, 'superseded', `${OWNER}@closing.test`, 'Reopened 2025-12: A December rent bill was missed']);
    assert.equal(d.profitAndLoss.netIncome, 200_000, 'the figures of version 1 are unchanged');
  });

  test('edit and close again: version 2 with the new figures, version 1 kept as it was', async () => {
    assert.equal((await journal('rent-dec', '2025-12-15', '6000', '1000', 50_000)).status, 200);
    const r = await close();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.netIncomeCents, r.body.closingVersion], [150_000, 2]);
    const docs = await closings();
    assert.deepEqual(docs.map(d => [d.version, d.status, d.profitAndLoss.netIncome]), [[2, 'current', 150_000], [1, 'superseded', 200_000]]);
    const [v2, v1] = docs;
    assert.deepEqual([v2.profitAndLoss.income.total, v2.profitAndLoss.expense.total], [500_000, 350_000]);
    assert.deepEqual(v2.retainedEarnings, { before: 0, transfer: 150_000, after: 150_000, entryPosted: false });
    assert.deepEqual([v2.balanceSheet.totalAssets, v2.balanceSheet.totalClaims, v2.balanceSheet.isBalanced], [1_150_000, 1_150_000, true]);
    const snap = (await db.collection('periodBalances').doc(`${ws}_2025-12-31`).get()).data();
    assert.deepEqual([v2.snapshot.checksum, v2.snapshot.entryCount], [snap?.checksum, 4]);
    assert.notEqual(v1.snapshot.checksum, v2.snapshot.checksum);
    assert.equal(v1.balanceSheet.totalAssets, 1_200_000);
    const bs = await report('/balance-sheet?endDate=2025-12-31');
    assert.deepEqual([bs.totalAssets, bs.netIncome], [v2.balanceSheet.totalAssets, v2.balanceSheet.retainedEarnings]);
  });
});
