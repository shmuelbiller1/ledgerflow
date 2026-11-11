/**
 * L-123 step 2: the server reports read their opening from balancesAsOf (src/server/reports/reportOpening.ts) instead
 * of every entry. On a real database (runs when LF_TEST_DATABASE_URL is set), each route gives byte-identical JSON:
 * - "before": the report functions over every entry the old query read (date ≤ the end), as the routes did;
 * - the route with no fresh snapshot (every entry before the date summed by balancesAsOf);
 * - the route with snapshots (at year ends and inside years, so a date inside a closed year reads one too).
 * Routes: balance sheet, trial balance, general ledger (opening line), balance sheet by label, cash flow (its new
 * opening and closing cash; the rest equals the old JSON). Gold ledgers: YEAR-END (year-end-gold.test.ts, closed
 * through close-year), W3W4 (w3w4-gold.test.ts, its bills, invoice, payment run, bank fee and cheque), W5-BS (the
 * A-210 label ledger of w5bs-balance-sheet-by-label.test.tsx) and FX (fx-gold.test.ts, with revaluation).
 *
 * Hand-worked case (cents). Cash (asset, code 1000, opening 5,000), Equity (opening 5,000 credit), Sales, Rent.
 *   2025-01-05  capital                     Cash +100,000 / Equity −100,000
 *   2025-06-10  sale, project A             Cash  +30,000 / Sales   −30,000
 *   2025-09-30  rent                        Rent  +12,000 / Cash    −12,000
 *   2025-12-31T18:00Z  rent (a clock time)  Rent   +1,000 / Cash     −1,000
 *   snapshot 2025-12-31: Cash 117,000 · Equity −100,000 · Sales −30,000 · Rent 13,000 (8 lines)
 *   2026-02-14  sale, project B             Cash   +8,000 / Sales    −8,000
 *   2026-03-31  rent                        Rent   +3,000 / Cash     −3,000
 * Balance sheet at 2026-03-31 = opening through 30 March (snapshot + the February sale) + the 31 March entry:
 *   Cash 5,000 + 117,000 + 8,000 − 3,000 = 127,000 = Equity 105,000 + profit (38,000 − 16,000 = 22,000)
 * Trial balance at 2026-03-31, Cash: debit 5,000 + 100,000 + 30,000 + 8,000 = 143,000; credit 12,000 + 1,000 + 3,000
 *   = 16,000; net 127,000
 * General ledger, Cash, 2026-01-01 → 2026-03-31: opening 5,000 + 117,000 = 122,000; +8,000 → 130,000; −3,000 → 127,000
 * By project A at 2026-03-31: Cash 30,000 = profit 30,000; not labelled: Cash 5,000 + 84,000 = 89,000, 8 lines, 2 openings
 * Cash flow 2026-01-01 → 2026-03-31: opening cash 122,000 + net change 5,000 = closing 127,000
 * The balance sheet at 2025-12-31 leaves the clock-time rent out (Cash 123,000), as the old date query did: the
 * opening is read through the day before, and the day itself by the report's own query.
 * An entry edited in the closed year marks the snapshot stale: every route still gives the "before" JSON of the
 * edited books, and the balance sheet's cache key changes, so no cached answer of the old books is served.
 */
import './helpers/dom';
import '../services/ledgerPost/postingKit';
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { postInvoiceLedger } from '../services/ledgerPost/invoicePosting';
import { postBillLedger } from '../services/ledgerPost/billPosting';
import type { LedgerPostContext } from '../services/ledgerPost/postingKit';
import { TransactionTemplates, type LineAccountWeight } from '../kernel/templates/TransactionTemplates';
import { isPostable, lineAmount, transactionDate } from '../lib/txFilters';
import { openingDebitCents } from '../lib/accountUtils';
import type { ChartAccount, Transaction, Workspace } from '../types';
import type { Firestore } from '../server/db/pgFirestore';
import type * as Reports from '../server/reports/computeReports';
import type * as ByLabel from '../server/reports/byLabel';
import type * as BalanceService from '../server/services/balanceService';
import type * as Opening from '../server/reports/reportOpening';

const url = process.env.LF_TEST_DATABASE_URL;
const OWNER = 'owner-1';

function monthEnds(from: string, to: string): string[] {
  const out: string[] = [];
  for (let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)); `${y}-${String(m).padStart(2, '0')}` <= to.slice(0, 7); m === 12 ? (y++, m = 1) : m++) {
    out.push(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
  }
  return out;
}

let db: Firestore;
let reports: typeof Reports;
let byLabel: typeof ByLabel;
let svc: typeof BalanceService;
let opening: typeof Opening;

describe('L-123 step 2: the server reports read balancesAsOf', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  let server: Server;
  let base = '';
  const realFetch = globalThis.fetch;
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await realFetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-uid': OWNER }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
  };
  const report = async (path: string, q: Record<string, string>) => {
    const res = await realFetch(`${base}/api/v1/reports/${path}?${new URLSearchParams(q)}`, { headers: { 'x-test-uid': OWNER } });
    const text = await res.text();
    assert.equal(res.status, 200, `${path} ${JSON.stringify(q)}: ${text}`);
    if (path === 'balance-sheet-by-label') return text;
    // AUD-10: the statement routes attach `provenance` (with `cachedAt` on a cache hit); check it and compare the figures.
    const { provenance, ...rest } = JSON.parse(text) as { provenance?: { source?: string; completeness?: string } } & Record<string, unknown>;
    assert.equal(provenance?.source, 'server', `${path}: missing server provenance`);
    assert.equal(provenance?.completeness, 'complete', `${path}: expected complete provenance`);
    return JSON.stringify(rest);
  };
  const workspaces: string[] = [];
  const newWorkspace = async (prefix: string) => {
    const ws = `ws_${prefix}_${crypto.randomBytes(4).toString('hex')}`;
    workspaces.push(ws);
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: prefix, currency: 'USD', timezone: 'UTC', members: [OWNER] });
    return ws;
  };
  const accountsOf = async (ws: string) => (await db.collection('chartAccounts').where('workspaceId', '==', ws).get()).docs.map(d => ({ id: d.id, ...d.data() }) as ChartAccount);
  const entriesOf = async (ws: string) => (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }) as Transaction);
  /** the old getReportContext query: every entry dated (as stored) between the dates */
  const oldQuery = async (ws: string, start: string | undefined, end: string) => {
    let q = db.collection('transactions').where('workspaceId', '==', ws).where('date', '<=', end);
    if (start) q = q.where('date', '>=', start);
    return (await q.get()).docs.map(d => ({ ...d.data(), id: d.id }) as Transaction);
  };
  const importAccounts = async (ws: string, rows: Array<{ name: string; code: string; type: string }>) => {
    const r = await send('POST', `/api/v1/workspaces/${ws}/import-records`, { kind: 'accounts', rows });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return Object.fromEntries((await accountsOf(ws)).map(a => [String(a.code), a]));
  };
  const context = async (ws: string, acct: Record<string, ChartAccount>): Promise<LedgerPostContext> => ({
    accounts: Object.values(acct), lockDate: null, uid: OWNER, inventory: [], transactions: await entriesOf(ws),
    workspaces: [{ id: ws, uid: OWNER, name: 'L-123', currency: 'USD' } as Workspace],
  });
  const party = async (ws: string, kind: 'customers' | 'vendors', name: string, currency?: string) => {
    assert.equal((await send('POST', `/api/v1/workspaces/${ws}/import-records`, { kind, rows: [{ name, ...(currency ? { currency } : {}) }] })).status, 200);
    return (await db.collection(kind).where('workspaceId', '==', ws).where('name', '==', name).get()).docs[0].id;
  };
  const invoice = async (ws: string, acct: Record<string, ChartAccount>, customerId: string, n: string, date: string, cents: number, extra: Record<string, unknown> = {}) => {
    const data = { id: `${ws}_${n}`, workspaceId: ws, uid: OWNER, number: n, customerId, customerName: 'Customer', date, dueDate: date, status: 'sent' as const,
      amountCents: cents, amountPaidCents: 0, currency: 'USD', taxVersion: 2, taxAmountCents: 0,
      items: [{ id: 'l1', description: 'Goods', quantity: 1, rateCents: cents, amountCents: cents, accountId: acct['4000'].id }], ...extra };
    await postInvoiceLedger(data.id, data as never, ws, OWNER, { collection: 'invoices', docId: data.id, action: 'create', data }, await context(ws, acct));
    return data.id;
  };
  const bill = async (ws: string, acct: Record<string, ChartAccount>, vendorId: string, n: string, date: string, cents: number, extra: Record<string, unknown> = {}) => {
    const data = { id: `${ws}_${n}`, workspaceId: ws, uid: OWNER, number: n, billNumber: n, vendorId, vendorName: 'Vendor', date, dueDate: date, status: 'approved' as const,
      amountCents: cents, amountPaidCents: 0, currency: 'USD', splits: [{ accountId: acct['6000'].id, amountCents: cents, description: 'Supplies' }], ...extra };
    await postBillLedger(data.id, data as never, ws, OWNER, { collection: 'bills', docId: data.id, action: 'create', data }, await context(ws, acct));
    return data.id;
  };
  const pay = (ws: string, cashAccountId: string, side: 'invoice' | 'bill', partyId: string, docs: Array<[string, number]>, date: string, rate?: number) => send('POST', '/api/v1/payments', {
    workspaceId: ws, amountCents: docs.reduce((a, [, c]) => a + c, 0), paymentDate: date, cashAccountId, paymentMethod: 'bank_transfer', ...(rate ? { paymentExchangeRate: rate } : {}),
    ...(side === 'invoice' ? { customerId: partyId } : { vendorId: partyId }), allocations: docs.map(([documentId, amountCents]) => ({ documentId, documentType: side, amountCents })),
  });
  const journal = async (ws: string, key: string, date: string, lines: Array<[string, number]>) => {
    const r = await send('POST', '/api/v1/transactions/bulk', { workspaceId: ws, transactions: [{
      id: `${ws}_${key}`, uid: OWNER, workspaceId: ws, date, description: key, totalAmountCents: Math.abs(lines[0][1]), currency: 'USD', status: 'completed', type: 'journal',
      lines: lines.map(([accountId, amountCents]) => ({ accountId, amountCents })),
    }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };

  /** What the routes answered before step 2, from the report functions over the old query's entries. */
  async function beforeJson(ws: string, path: string, q: Record<string, string>): Promise<string> {
    const accounts = await accountsOf(ws);
    if (path === 'balance-sheet') return JSON.stringify(reports.computeBalanceSheet(accounts, await oldQuery(ws, undefined, q.endDate), q.endDate));
    if (path === 'trial-balance') return JSON.stringify(reports.computeTrialBalance(accounts, await oldQuery(ws, undefined, q.asOfDate), q.asOfDate));
    if (path === 'general-ledger') return JSON.stringify(reports.computeGeneralLedger(accounts, await oldQuery(ws, undefined, q.endDate), q.startDate, q.endDate, q.accountId));
    if (path === 'balance-sheet-by-label') return JSON.stringify(byLabel.balanceSheetByLabel(accounts, await oldQuery(ws, undefined, q.endDate), q.dimensionId, q.value, q.endDate));
    // the cash flow: the old JSON, plus the cash at the start from every entry before it
    const cf = reports.computeCashFlow(accounts, await oldQuery(ws, q.startDate, q.endDate), q.startDate, q.endDate);
    const cash = new Set(accounts.filter(reports.isCashFlowCashAccount).map(a => a.id));
    let openingCashCents = accounts.filter(a => cash.has(a.id)).reduce((s, a) => s + openingDebitCents(a), 0);
    for (const tx of await entriesOf(ws)) {
      if (!isPostable(tx) || transactionDate(tx) === '' || transactionDate(tx) >= q.startDate) continue;
      for (const line of tx.lines || []) if (cash.has(line.accountId)) openingCashCents += lineAmount(line, tx);
    }
    return JSON.stringify({ ...cf, openingCashCents, closingCashCents: openingCashCents + cf.netChange });
  }

  const queries = (ws: string, date: string, labels: Array<[string, string]>, accountId?: string): Array<[string, Record<string, string>]> => {
    const month = `${date.slice(0, 8)}01`;
    const year = `${date.slice(0, 4)}-01-01`;
    return [
      ['balance-sheet', { workspaceId: ws, endDate: date }],
      ['trial-balance', { workspaceId: ws, asOfDate: date }],
      ['general-ledger', { workspaceId: ws, startDate: month, endDate: date }],
      ['general-ledger', { workspaceId: ws, startDate: year, endDate: date, ...(accountId ? { accountId } : {}) }],
      ['cash-flow', { workspaceId: ws, startDate: month, endDate: date }],
      ['cash-flow', { workspaceId: ws, startDate: year, endDate: date }],
      ...labels.map(([dimensionId, value]): [string, Record<string, string>] => ['balance-sheet-by-label', { workspaceId: ws, dimensionId, value, endDate: date }]),
    ];
  };

  const markAllStale = (ws: string) => db.pool.query(`update public."periodBalances" set data = data || '{"stale":true}' where workspace_id = $1`, [ws]);

  /**
   * At each date: the "before" JSON, the route with no fresh snapshot, and the route with the snapshots given (built
   * here), byte for byte. Returns which snapshot each date's opening read, for the record.
   */
  async function identical(ws: string, dates: string[], snapshotDates: string[], labels: Array<[string, string]> = [], accountId?: string) {
    const want = new Map<string, string>();
    for (const date of dates) for (const [path, q] of queries(ws, date, labels, accountId)) want.set(`${path}?${new URLSearchParams(q)}`, await beforeJson(ws, path, q));
    await markAllStale(ws);
    for (const date of dates) for (const [path, q] of queries(ws, date, labels, accountId)) {
      assert.equal(await report(path, q), want.get(`${path}?${new URLSearchParams(q)}`), `no snapshot: ${path} ${JSON.stringify(q)}`);
    }
    for (const asOf of snapshotDates) await svc.buildSnapshot(db, ws, asOf, 'test');
    const read: Array<string | null> = [];
    for (const date of dates) {
      for (const [path, q] of queries(ws, date, labels, accountId)) {
        assert.equal(await report(path, q), want.get(`${path}?${new URLSearchParams(q)}`), `with snapshots: ${path} ${JSON.stringify(q)}`);
      }
      read.push((await svc.freshSnapshot(db, ws, opening.dayBefore(date)))?.asOf ?? null);
    }
    assert.ok(read.some(Boolean), 'a snapshot was read');
    return read;
  }

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { getDb } = await import('../server/db/firestore');
    reports = await import('../server/reports/computeReports');
    byLabel = await import('../server/reports/byLabel');
    svc = await import('../server/services/balanceService');
    opening = await import('../server/reports/reportOpening');
    db = getDb();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: 'owner@l123.test' }; next(); });
    app.use('/api/v1/workspaces', (await import('../server/routes/workspaceRoutes')).workspaceRouter);
    app.use('/api/v1/transactions', (await import('../server/routes/transactionRoutes')).transactionRouter);
    app.use('/api/v1/documents', (await import('../server/routes/documentPostRoutes')).documentPostRouter);
    app.use('/api/v1/payments', (await import('../server/routes/paymentRoutes')).paymentRouter);
    app.use('/api/v1/reports', (await import('../server/routes/reportRoutes')).reportRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (!target.startsWith('/')) return realFetch(input, init);
      return realFetch(`${base}${target}`, { ...init, headers: { ...(init?.headers as Record<string, string> || {}), 'x-test-uid': OWNER } });
    }) as typeof fetch;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    server?.close();
    for (const ws of workspaces) {
      for (const table of ['transactions', 'invoices', 'bills', 'payments', 'assets', 'periods', 'customers', 'vendors', 'chartAccounts', 'auditLogs', 'idempotencyKeys', 'documentSeries', 'periodBalances', 'workspaces']) {
        await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
      }
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

  describe('the hand-worked case', () => {
    let ws = '';
    const id = (s: string) => `${ws}_${s}`;
    const entry = (key: string, date: string, lines: Array<[string, number, string?]>) => db.collection('transactions').doc(id(key)).set({
      id: id(key), workspaceId: ws, uid: OWNER, date, description: key, status: 'completed', type: 'journal', currency: 'USD',
      totalAmountCents: Math.abs(lines[0][1]), lines: lines.map(([acc, cents, project]) => ({ accountId: id(acc), amountCents: cents, ...(project ? { dimensions: { project } } : {}) })),
    });
    const json = async (path: string, q: Record<string, string>) => JSON.parse(await report(path, { workspaceId: ws, ...q }));

    before(async () => {
      ws = await newWorkspace('l123s2h');
      for (const [key, type, code, openingBalanceCents] of [['cash', 'asset', '1000', 5_000], ['equity', 'equity', '3000', 5_000], ['sales', 'income', '4000', 0], ['rent', 'expense', '6000', 0]] as const) {
        await db.collection('chartAccounts').doc(id(key)).set({ id: id(key), workspaceId: ws, name: key, code, type, openingBalanceCents });
      }
      await entry('capital', '2025-01-05', [['cash', 100_000], ['equity', -100_000]]);
      await entry('saleA', '2025-06-10', [['cash', 30_000, 'A'], ['sales', -30_000, 'A']]);
      await entry('rent25', '2025-09-30', [['rent', 12_000], ['cash', -12_000]]);
      await entry('rentClock', '2025-12-31T18:00:00.000Z', [['rent', 1_000], ['cash', -1_000]]);
      await entry('saleB', '2026-02-14', [['cash', 8_000, 'B'], ['sales', -8_000, 'B']]);
      await entry('rent26', '2026-03-31', [['rent', 3_000], ['cash', -3_000]]);
      const s = await svc.buildSnapshot(db, ws, '2025-12-31', 'test');
      assert.deepEqual([s.accounts[id('cash')], s.lines?.[id('cash')], s.debits?.[id('cash')], s.credits?.[id('cash')]], [117_000, 4, 130_000, 13_000]);
    });

    test('the worked figures, read from the snapshot', async () => {
      const bs = await json('balance-sheet', { endDate: '2026-03-31' });
      assert.deepEqual([bs.assets[id('cash')], bs.equity[id('equity')], bs.netIncome, bs.totalClaims, bs.isBalanced], [127_000, 105_000, 22_000, 127_000, true]);
      const tb = (await json('trial-balance', { asOfDate: '2026-03-31' })).accounts.find((a: { id: string }) => a.id === id('cash'));
      assert.deepEqual([tb.debit, tb.credit, tb.netSigned], [143_000, 16_000, 127_000]);
      const gl = (await json('general-ledger', { startDate: '2026-01-01', endDate: '2026-03-31', accountId: id('cash') })).accounts[0];
      assert.deepEqual([gl.openingBalanceCents, ...gl.entries.map((e: { runningBalanceCents: number }) => e.runningBalanceCents)], [122_000, 130_000, 127_000]);
      const a = await json('balance-sheet-by-label', { dimensionId: 'project', value: 'A', endDate: '2026-03-31' });
      assert.deepEqual([a.sheet.assets[id('cash')], a.sheet.netIncome, a.notLabelled.sheet.assets[id('cash')], a.notLabelled.lines, a.notLabelled.openings], [30_000, 30_000, 89_000, 8, 2]);
      const cf = await json('cash-flow', { startDate: '2026-01-01', endDate: '2026-03-31' });
      assert.deepEqual([cf.openingCashCents, cf.netChange, cf.closingCashCents], [122_000, 5_000, 127_000]);
      assert.equal((await json('balance-sheet', { endDate: '2025-12-31' })).assets[id('cash')], 123_000, 'the clock-time entry of 31 December is left out, as before');
    });

    test('byte-identical with and without the snapshot, by project too', async () => {
      const labels: Array<[string, string]> = [['project', 'A'], ['project', 'B'], ['Project', 'Unassigned'], ['location', 'X']];
      await identical(ws, [...monthEnds('2025-01-01', '2026-04-30'), '2026-01-01', '2026-02-14'], ['2025-06-30', '2025-12-31'], labels, id('cash'));
    });

    test('an entry edited in the closed year: the snapshot is stale, every route still answers the edited books, and the cache key changes', async () => {
      await svc.buildSnapshot(db, ws, '2025-12-31', 'test');
      const keyBefore = await opening.openingKey(db, ws, '2026-03-31');
      const old = await report('balance-sheet', { workspaceId: ws, endDate: '2026-03-31' });
      await db.collection('transactions').doc(id('rent25')).update({ lines: [{ accountId: id('rent'), amountCents: 12_500 }, { accountId: id('cash'), amountCents: -12_500 }] });
      assert.equal((await db.collection('periodBalances').doc(`${ws}_2025-12-31`).get()).data()?.stale, true);
      const keyAfter = await opening.openingKey(db, ws, '2026-03-31');
      assert.notEqual(keyAfter, keyBefore);
      for (const [path, q] of queries(ws, '2026-03-31', [['project', 'A']], id('cash'))) assert.equal(await report(path, q), await beforeJson(ws, path, q), `stale: ${path}`);
      const now = await report('balance-sheet', { workspaceId: ws, endDate: '2026-03-31' });
      assert.notEqual(now, old, 'not the cached answer of the old books');
      assert.equal(JSON.parse(now).assets[id('cash')], 126_500);
      await svc.rebuildSnapshots(db, ws, 'test');
      const keyRebuilt = await opening.openingKey(db, ws, '2026-03-31');
      assert.ok(![keyBefore, keyAfter].includes(keyRebuilt), 'a rebuilt snapshot has its own key');
      assert.equal(await report('balance-sheet', { workspaceId: ws, endDate: '2026-03-31' }), await beforeJson(ws, 'balance-sheet', { endDate: '2026-03-31' }));
    });

    test('a snapshot built before step 2 (no gross figures) or with lines on an account outside the chart: every entry is read, same JSON', async () => {
      await svc.buildSnapshot(db, ws, '2025-12-31', 'test');
      await db.pool.query(`update public."periodBalances" set data = data - 'debits' - 'credits' - 'lines' - 'labelLines' where id = $1`, [`${ws}_2025-12-31`]);
      const accounts = await accountsOf(ws);
      assert.equal(await opening.openingBefore(db, ws, accounts, '2026-03-31', { gross: true }), null);
      assert.ok(await opening.openingBefore(db, ws, accounts, '2026-03-31'), 'a net opening is still read');
      for (const [path, q] of queries(ws, '2026-03-31', [['project', 'A']])) assert.equal(await report(path, q), await beforeJson(ws, path, q), `old snapshot: ${path}`);
      {
        const { withCorruptFixtureAllowed } = await import('./helpers/balanceRouteHarness');
        await withCorruptFixtureAllowed(db.pool, client => client.query(
          `INSERT INTO public.transactions (id, data) VALUES ($1, $2::jsonb)`,
          [id('orphan'), JSON.stringify({
            workspaceId: ws, uid: 'owner-1', date: '2025-03-01', description: 'orphan', status: 'completed',
            totalAmountCents: 700, currency: 'USD',
            lines: [{ accountId: id('gone'), amountCents: 700 }, { accountId: id('cash'), amountCents: -700 }],
          })],
        ));
      }
      await svc.buildSnapshot(db, ws, '2025-12-31', 'test');
      assert.equal(await opening.openingBefore(db, ws, accounts, '2026-03-31', { gross: true }), null);
      const bs = await report('balance-sheet', { workspaceId: ws, endDate: '2026-02-28' });
      assert.equal(bs, await beforeJson(ws, 'balance-sheet', { endDate: '2026-02-28' }));
      assert.equal(JSON.parse(bs).orphanedLines.length, 1, 'the orphaned line is still listed');
      assert.equal(await opening.openingKey(db, ws, 'not a date'), 'none');
    });
  });

  describe('YEAR-END gold ledger, closed through close-year', () => {
    test('byte-identical at every month end, inside the closed year and after it, and after a reopened range', async () => {
      const ws = await newWorkspace('l123s2ye');
      const acct = await importAccounts(ws, [
        { name: 'Checking', code: '1000', type: 'Bank' }, { name: 'Accounts Receivable', code: '1100', type: 'Accounts receivable' },
        { name: 'Equipment', code: '1500', type: 'Fixed asset' }, { name: 'Accumulated Depreciation', code: '1510', type: 'Fixed asset' },
        { name: 'Accounts Payable', code: '2000', type: 'Accounts payable' }, { name: 'Opening Balance Equity', code: '3000', type: 'Equity' },
        { name: 'Retained Earnings', code: '3100', type: 'Equity' }, { name: 'Sales', code: '4000', type: 'Income' },
        { name: 'Supplies', code: '6000', type: 'Expense' }, { name: 'Depreciation', code: '6500', type: 'Expense' },
      ]);
      const customerId = await party(ws, 'customers', 'Delta Builders');
      const vendorId = await party(ws, 'vendors', 'Iron Supply');
      assert.equal((await send('POST', `/api/v1/workspaces/${ws}/opening-balances`, { date: '2025-01-01', balances: [{ accountId: acct['1000'].id, amountCents: 1_000_000 }] })).status, 200);
      await journal(ws, 'equipment', '2025-01-15', [[acct['1500'].id, 120_000], [acct['1000'].id, -120_000]]);
      await db.collection('assets').doc(`${ws}_saw`).set({
        workspaceId: ws, name: 'Table saw', purchaseDate: '2025-01-15', purchasePriceCents: 120_000, salvageValueCents: 0, usefulLifeYears: 5, depreciationMethod: 'straight-line',
        accumulatedDepreciationCents: 0, status: 'active', expenseAccountId: acct['6500'].id, accumulatedAccountId: acct['1510'].id, assetAccountId: acct['1500'].id,
      });
      const inv1 = await invoice(ws, acct, customerId, 'INV-1', '2025-03-10', 300_000);
      const b1 = await bill(ws, acct, vendorId, 'B-1', '2025-04-05', 80_000);
      assert.equal((await pay(ws, acct['1000'].id, 'invoice', customerId, [[inv1, 300_000]], '2025-04-20')).status, 200);
      assert.equal((await pay(ws, acct['1000'].id, 'bill', vendorId, [[b1, 80_000]], '2025-05-01')).status, 200);
      await invoice(ws, acct, customerId, 'INV-2', '2025-11-20', 200_000);
      await bill(ws, acct, vendorId, 'B-2', '2025-12-10', 50_000);
      assert.equal((await send('POST', `/api/v1/workspaces/${ws}/periods/2025-12/depreciation`, {})).body.totalCents, 22_000);
      const close = await send('POST', '/api/v1/transactions/close-year', { workspaceId: ws, closingDate: '2025-12-31', lockPeriod: true });
      assert.equal(close.body.netIncomeCents, 348_000, JSON.stringify(close.body));
      await journal(ws, 'jan26', '2026-01-20', [[acct['1000'].id, 40_000], [acct['4000'].id, -40_000]]);

      const dates = [...monthEnds('2025-01-01', '2026-03-31'), '2026-01-01', '2026-01-20'];
      const read = await identical(ws, dates, ['2025-03-31', '2025-08-31', '2025-12-31'], [], acct['1000'].id);
      assert.deepEqual([read[dates.indexOf('2025-06-30')], read[dates.indexOf('2025-12-31')], read[dates.indexOf('2026-02-28')]], ['2025-03-31', '2025-08-31', '2025-12-31'], 'inside the closed year, at its end (the day before) and after it');
      const bs = JSON.parse(await report('balance-sheet', { workspaceId: ws, endDate: '2025-12-31' }));
      assert.deepEqual([bs.netIncome, bs.isBalanced], [348_000, true], 'the gold profit');

      // a reopened range: a late entry marks the year-end snapshot stale; the reports still give the "before" JSON
      assert.equal((await send('POST', `/api/v1/workspaces/${ws}/periods/unlock`, { fromDate: '2025-12-01', toDate: '2025-12-31', reason: 'Late supplier invoice' })).status, 200);
      const key = await opening.openingKey(db, ws, '2026-02-28');
      await journal(ws, 'late', '2025-12-20', [[acct['6000'].id, 1_000], [acct['1000'].id, -1_000]]);
      assert.notEqual(await opening.openingKey(db, ws, '2026-02-28'), key);
      for (const [path, q] of queries(ws, '2026-02-28', [], acct['1000'].id)) assert.equal(await report(path, q), await beforeJson(ws, path, q), `stale: ${path}`);
      assert.equal(JSON.parse(await report('balance-sheet', { workspaceId: ws, endDate: '2026-02-28' })).netIncome, 347_000 + 40_000);
    });
  });

  describe('W3W4 gold ledger (Cedar Hardware)', () => {
    test('byte-identical with snapshots inside April and May', async () => {
      const ws = await newWorkspace('l123s2w3');
      const acct = await importAccounts(ws, [
        { name: 'Checking', code: '1000', type: 'Bank' }, { name: 'Accounts Receivable', code: '1100', type: 'Accounts receivable' },
        { name: 'Accounts Payable', code: '2000', type: 'Accounts payable' }, { name: 'Opening Balance Equity', code: '3000', type: 'Equity' },
        { name: 'Sales', code: '4000', type: 'Income' }, { name: 'Supplies', code: '6000', type: 'Expense' },
        { name: 'Rent', code: '6100', type: 'Expense' }, { name: 'Bank fees', code: '6200', type: 'Expense' },
      ]);
      const acme = await party(ws, 'vendors', 'Acme Supplies');
      const beta = await party(ws, 'vendors', 'Beta Parts');
      const dune = await party(ws, 'customers', 'Dune LLC');
      assert.equal((await send('POST', `/api/v1/workspaces/${ws}/opening-balances`, { date: '2026-04-01', balances: [{ accountId: acct['1000'].id, amountCents: 500_000 }] })).status, 200);
      const a101 = await bill(ws, acct, acme, 'A-101', '2026-04-01', 120_000, { dueDate: '2026-05-01' });
      const a102 = await bill(ws, acct, acme, 'A-102', '2026-04-20', 80_000, { dueDate: '2026-05-20' });
      await bill(ws, acct, beta, 'B-201', '2026-05-10', 45_000, { dueDate: '2026-06-09' });
      const inv = await invoice(ws, acct, dune, 'INV-501', '2026-05-12', 250_000);
      assert.equal((await pay(ws, acct['1000'].id, 'bill', acme, [[a101, 120_000], [a102, 80_000]], '2026-05-21')).status, 200);
      assert.equal((await pay(ws, acct['1000'].id, 'invoice', dune, [[inv, 250_000]], '2026-05-25')).status, 200);
      await journal(ws, 'cheque1042', '2026-05-30', [[acct['6100'].id, 30_000], [acct['1000'].id, -30_000]]);
      await journal(ws, 'fee', '2026-05-31', [[acct['6200'].id, 3_500], [acct['1000'].id, -3_500]]);

      const dates = [...monthEnds('2026-04-01', '2026-06-30'), '2026-05-20', '2026-05-21', '2026-05-25'];
      await identical(ws, dates, ['2026-04-30', '2026-05-20'], [], acct['1000'].id);
      const bs = JSON.parse(await report('balance-sheet', { workspaceId: ws, endDate: '2026-05-31' }));
      assert.deepEqual([bs.assets[acct['1000'].id], bs.liabilities[acct['2000'].id]], [516_500, 45_000], 'the gold books: 516,500 in checking, B-201 owed');
    });
  });

  describe('W5-BS gold ledger (two properties)', () => {
    test('byte-identical by label, with snapshots at January and February ends', async () => {
      const ws = await newWorkspace('l123s2w5');
      const id = (s: string) => `${ws}_${s}`;
      const dimension = 'property';
      const accounts = [
        ['cash', '1000', 'Cash', 'asset', 500], ['ar', '1100', 'Accounts receivable', 'asset', 0], ['ap', '2100', 'Accounts payable', 'liability', 0],
        ['tax', '2200', 'Net tax payable', 'liability', 0], ['owner', '3000', "Owner's equity", 'equity', 500], ['revenue', '4000', 'Rental income', 'income', 0],
        ['repairs', '6100', 'Repairs', 'expense', 0],
      ] as const;
      for (const [key, code, name, type, openingBalanceCents] of accounts) {
        await db.collection('chartAccounts').doc(id(key)).set({ id: id(key), workspaceId: ws, uid: OWNER, code, name, type, openingBalanceCents });
      }
      const a = (s: string) => ({ id: id(s), name: s });
      const shares: LineAccountWeight[] = [{ account: a('revenue'), weightCents: 10_000, dimensions: { [dimension]: 'A' } }, { account: a('revenue'), weightCents: 17_000, dimensions: { [dimension]: 'B' } }];
      const billShares: LineAccountWeight[] = [{ account: a('repairs'), weightCents: 5_000, dimensions: { [dimension]: 'A' } }, { account: a('repairs'), weightCents: 8_500, dimensions: { [dimension]: 'B' } }];
      const put = (key: string, date: string, lines: Transaction['lines'], status = 'completed') => db.collection('transactions').doc(id(key)).set({
        id: id(key), workspaceId: ws, uid: OWNER, date, description: key, status, type: 'journal', currency: 'USD', totalAmountCents: 0, lines,
      });
      // the A-210 month, again in March (a second round of the same books)
      for (const [n, month] of [['1', '01'], ['2', '03']]) {
        await put(`invoice-${n}`, `2026-${month}-05`, TransactionTemplates.buildInvoiceLines({ invoiceNumber: `INV-${n}`, customerName: 'Tenant', totalCents: 30_000, taxCents: 3_000, arAccount: a('ar'), revenueAccount: a('revenue'), taxAccount: a('tax'), lineAccounts: shares }));
        await put(`receipt-${n}`, `2026-${month}-12`, TransactionTemplates.buildPaymentLines({ documentNumber: `INV-${n}`, entityName: 'Tenant', amountCents: 20_000, cashAccount: a('cash'), offsetAccount: a('ar'), isReceipt: true, lineAccounts: shares }));
        await put(`bill-${n}`, `2026-${month}-15`, TransactionTemplates.buildBillLines({ billNumber: `BILL-${n}`, vendorName: 'Repair vendor', totalCents: 15_000, taxCents: 1_500, apAccount: a('ap'), expenseAccount: a('repairs'), taxAccount: a('tax'), lineAccounts: billShares }));
        await put(`vendor-payment-${n}`, `2026-${month}-22`, TransactionTemplates.buildPaymentLines({ documentNumber: `BILL-${n}`, entityName: 'Repair vendor', amountCents: 6_000, cashAccount: a('cash'), offsetAccount: a('ap'), isReceipt: false, lineAccounts: billShares }));
      }
      await put('owner-in', '2026-01-02', [{ accountId: id('cash'), amountCents: 1_000 }, { accountId: id('owner'), amountCents: -1_000 }]);
      await put('deposit', '2026-01-25', [{ accountId: id('cash'), amountCents: 2_000, dimensions: { [dimension]: 'A' } }, { accountId: id('ap'), amountCents: -2_000 }]);
      await put('other-c', '2026-01-26', [{ accountId: id('cash'), amountCents: 700, dimensions: { [dimension]: 'C' } }, { accountId: id('owner'), amountCents: -700, dimensions: { [dimension]: 'C' } }]);
      await put('draft-a', '2026-01-27', [{ accountId: id('cash'), amountCents: 900, dimensions: { [dimension]: 'A' } }, { accountId: id('owner'), amountCents: -900, dimensions: { [dimension]: 'A' } }], 'draft');
      await put('february-a', '2026-02-03', [{ accountId: id('cash'), amountCents: 400, dimensions: { [dimension]: 'A' } }, { accountId: id('owner'), amountCents: -400, dimensions: { [dimension]: 'A' } }]);

      const labels: Array<[string, string]> = [[dimension, 'A'], [dimension, 'B'], [dimension, 'C'], ['Property', 'Unassigned'], ['project', 'P1']];
      await identical(ws, [...monthEnds('2026-01-01', '2026-04-30'), '2026-03-12'], ['2026-01-31', '2026-02-28'], labels, id('cash'));
      const jan = JSON.parse(await report('balance-sheet-by-label', { workspaceId: ws, dimensionId: dimension, value: 'A', endDate: '2026-02-28' }));
      assert.deepEqual([jan.sheet.totalAssets, jan.sheet.totalClaims, jan.notLabelled.lines], [8_889 + 2_000 + 400, 8_889 + 400, 3], 'A: the gold 8,889, the one-sided deposit and February');
    });
  });

  describe('FX gold ledger (Atlas Imports)', () => {
    test('byte-identical with revaluation and payments at other rates', async () => {
      const ws = await newWorkspace('l123s2fx');
      const acct = await importAccounts(ws, [
        { name: 'Checking', code: '1000', type: 'Bank' }, { name: 'Accounts Receivable', code: '1100', type: 'Accounts receivable' },
        { name: 'Accounts Payable', code: '2000', type: 'Accounts payable' }, { name: 'Sales', code: '4000', type: 'Income' },
        { name: 'Unrealized currency revaluation', code: '4900', type: 'Income' }, { name: 'Realized exchange differences', code: '4910', type: 'Income' },
        { name: 'Supplies', code: '6000', type: 'Expense' },
      ]);
      const customerId = await party(ws, 'customers', 'Lyon Café', 'EUR');
      const vendorId = await party(ws, 'vendors', 'Porto Paper', 'EUR');
      const inv = await invoice(ws, acct, customerId, 'INV-E1', '2025-03-10', 100_000, { currency: 'EUR', exchangeRate: 1.1, dueDate: '2025-04-30' });
      const b = await bill(ws, acct, vendorId, 'B-E1', '2025-03-20', 50_000, { currency: 'EUR', exchangeRate: 1.1, dueDate: '2025-04-30' });
      assert.equal((await send('POST', '/api/v1/transactions/revaluation/run', { workspaceId: ws, date: '2025-03-31', rates: { EUR: 1.15 } })).status, 200);
      assert.equal((await pay(ws, acct['1000'].id, 'invoice', customerId, [[inv, 100_000]], '2025-04-15', 1.12)).status, 200);
      assert.equal((await pay(ws, acct['1000'].id, 'bill', vendorId, [[b, 50_000]], '2025-04-20', 1.08)).status, 200);

      await identical(ws, [...monthEnds('2025-02-01', '2025-06-30'), '2025-04-01', '2025-04-16'], ['2025-03-31', '2025-04-15'], [], acct['1000'].id);
      const bs = JSON.parse(await report('balance-sheet', { workspaceId: ws, endDate: '2025-04-30' }));
      assert.deepEqual([bs.assets[acct['1000'].id], bs.netIncome], [58_000, 58_000], 'the gold figures: Checking 58,000 = profit 58,000');
    });
  });
});
