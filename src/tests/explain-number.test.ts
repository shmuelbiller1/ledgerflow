/**
 * Explain this number (N-12): what the explanation lists adds up to the figure the report shows,
 * for every account of the profit and loss, the balance sheet and the trial balance; drafts, voided
 * and out-of-period entries are left out like the reports leave them out; a balance "as of" starts
 * from the opening balance; a label narrows it; the route reads the full history, says each line's
 * document and counts its files, and refuses outsiders. The route part runs with LF_TEST_DATABASE_URL.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { explainFigure } from '../server/reports/explain';
import { computeBalanceSheet, computeProfitAndLoss, computeTrialBalance } from '../server/reports/computeReports';
import { makeChartAccount, makeTransaction } from './fixtures';
import { computeBudgetActual, type SavedBudget } from '../lib/budgetActual';
import { splitReportPeriods } from '../lib/reportColumns';
import { isDebitNatureType } from '../lib/accountUtils';
import type { ChartAccount, Transaction } from '../types';

const accounts: ChartAccount[] = [
  makeChartAccount({ id: 'cash', name: 'Cash', type: 'asset', category: 'Cash', openingBalanceCents: 50000 }),
  makeChartAccount({ id: 'ar', name: 'Receivables', type: 'asset', category: 'Receivables' }),
  makeChartAccount({ id: 'loan', name: 'Loan', type: 'liability' }),
  makeChartAccount({ id: 'capital', name: 'Capital', type: 'equity', openingBalanceCents: 50000 }),
  makeChartAccount({ id: 'sales', name: 'Sales', type: 'income' }),
  makeChartAccount({ id: 'rent', name: 'Rent', type: 'expense' }),
];
const entry = (id: string, date: string, lines: Array<[string, number]>, over: Partial<Transaction> = {}) => makeTransaction({
  id, date, status: 'completed', description: id, lines: lines.map(([accountId, amountCents], i) => ({ id: `${id}-${i}`, accountId, amountCents })), ...over,
} as Partial<Transaction>);
const ledger: Transaction[] = [
  entry('sale1', '2026-03-01', [['ar', 12000], ['sales', -10000], ['sales', -2000]], { metadata: { invoiceId: 'inv1' } } as Partial<Transaction>),
  entry('paid', '2026-03-05', [['cash', 12000], ['ar', -12000]], { isCleared: true } as Partial<Transaction>),
  entry('rent1', '2026-03-10', [['rent', 3000], ['cash', -3000]], { metadata: { billId: 'bill1' } } as Partial<Transaction>),
  entry('loan1', '2026-02-01', [['cash', 20000], ['loan', -20000]]),
  entry('draft', '2026-03-12', [['rent', 999], ['cash', -999]], { status: 'draft' }),
  entry('voided', '2026-03-13', [['rent', 777], ['cash', -777]], { status: 'void' }),
  entry('later', '2026-05-01', [['cash', 4000], ['sales', -4000]]),
  entry('fx', '2026-03-20', [['cash', 1000], ['sales', -1000]], { exchangeRate: 1.5, currency: 'EUR' } as Partial<Transaction>),
];
const sum = (ids: string[], startDate?: string, endDate?: string) => explainFigure(accounts, ledger, { accountIds: ids, ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) }).totalCents;

describe('It adds up to the report', () => {
  test('every profit and loss account and section, for the period', () => {
    const pl = computeProfitAndLoss(accounts, ledger, '2026-03-01', '2026-03-31');
    for (const [id, a] of Object.entries(pl.income.accounts)) assert.equal(-sum([id], '2026-03-01', '2026-03-31'), a.balance, id);
    for (const [id, a] of Object.entries(pl.expense.accounts)) assert.equal(sum([id], '2026-03-01', '2026-03-31'), a.balance, id);
    assert.equal(-sum(Object.keys(pl.income.accounts), '2026-03-01', '2026-03-31'), pl.income.total);
    assert.equal(sum(Object.keys(pl.expense.accounts), '2026-03-01', '2026-03-31'), pl.expense.total);
  });

  test('every balance sheet account, as of a date, from its opening balance', () => {
    const bs = computeBalanceSheet(accounts, ledger, '2026-03-31');
    for (const [id, cents] of Object.entries(bs.assets)) assert.equal(sum([id], undefined, '2026-03-31'), cents, id);
    for (const [id, cents] of Object.entries(bs.liabilities)) assert.equal(-sum([id], undefined, '2026-03-31'), cents, id);
    for (const [id, cents] of Object.entries(bs.equity)) assert.equal(-sum([id], undefined, '2026-03-31'), cents, id);
    assert.equal(sum(Object.keys(bs.assets), undefined, '2026-03-31'), bs.totalAssets);
  });

  test('every trial balance account', () => {
    const tb = computeTrialBalance(accounts, ledger, '2026-12-31');
    for (const a of tb.accounts) {
      const debitNature = ['asset', 'expense', 'cost_of_goods'].includes(a.type);
      assert.equal((debitNature ? 1 : -1) * sum([a.id], undefined, '2026-12-31'), a.netSigned, a.id);
    }
  });
});

describe('Opening balances in the account\'s own direction (N-13)', () => {
  test('a loan typed as 10,000 is a credit everywhere; an old closing snapshot is compared as it was stored', async () => {
    const { openingDebitCents } = await import('../lib/accountUtils');
    const { balancesAsOf } = await import('../lib/closingSnapshot');
    const loan = makeChartAccount({ id: 'loan', name: 'Loan', type: 'liability', openingBalanceCents: 1000000 });
    assert.equal(openingDebitCents(loan), -1000000);
    assert.equal(openingDebitCents(makeChartAccount({ id: 'b', type: 'asset', openingBalanceCents: -500 })), -500, 'an overdrawn bank stays negative');
    assert.equal(computeBalanceSheet([loan], [], '2026-12-31').totalLiabilities, 1000000);
    const tb = computeTrialBalance([loan], [], '2026-12-31');
    assert.deepEqual([tb.accounts[0].debit, tb.accounts[0].credit, tb.accounts[0].netSigned], [0, 1000000, 1000000]);
    assert.equal(balancesAsOf([loan], [], '2026-12-31').balances.loan, -1000000);
    assert.equal(balancesAsOf([loan], [], '2026-12-31', { openingAsStored: true }).balances.loan, 1000000);
  });
});

describe('Budget vs actual (N-12 step 2)', () => {
  test('each month\'s actual is what the explanation of that month adds up to, for a cost and for income', () => {
    for (const id of ['rent', 'sales']) {
      const budget: SavedBudget = { id: 'b', uid: 'u', targetType: 'account', targetId: id, amountCents: 5000, period: 'monthly', startDate: '2026-01-01', createdAt: '2026-01-01' } as SavedBudget;
      const report = computeBudgetActual(budget, accounts, ledger, splitReportPeriods('2026-02-01', '2026-03-31', 'months'))!;
      const sign = isDebitNatureType(report.account.type) ? 1 : -1;
      for (const column of report.columns) {
        assert.equal((sign * sum([id], column.period.startDate, column.period.endDate)) || 0, column.actualCents, `${id} ${column.period.label}`);
      }
    }
  });
});

describe('What it lists', () => {
  test('each line once, in the base currency, with its document and bank match; drafts, voided and other periods left out', () => {
    const e = explainFigure(accounts, ledger, { accountIds: ['sales', 'cash'], startDate: '2026-03-01', endDate: '2026-03-31' });
    assert.deepEqual(e.lines.map(l => [l.transactionId, l.accountId, l.amountCents]), [
      ['sale1', 'sales', -10000], ['sale1', 'sales', -2000], ['paid', 'cash', 12000], ['rent1', 'cash', -3000], ['fx', 'cash', 1500], ['fx', 'sales', -1500],
    ]);
    assert.equal(e.entries, 4);
    assert.deepEqual(e.lines[0].document, { type: 'invoice', id: 'inv1' });
    assert.deepEqual(e.lines.find(l => l.transactionId === 'rent1')!.document, { type: 'bill', id: 'bill1' });
    assert.deepEqual(e.lines.find(l => l.transactionId === 'paid')!.document, { type: 'transaction', id: 'paid' });
    assert.equal(e.lines.find(l => l.transactionId === 'paid')!.bankMatched, true);
    const asOf = explainFigure(accounts, ledger, { accountIds: ['cash'], endDate: '2026-03-31' });
    assert.deepEqual(asOf.lines[0], { key: 'opening:cash', transactionId: null, date: '', description: 'Opening balance', accountId: 'cash', accountName: 'Cash', amountCents: 50000, document: null, bankMatched: false, attachments: 0, opening: true });
  });

  test('a label narrows it to the lines carrying it', () => {
    const tagged = [...ledger, entry('proj', '2026-03-15', [['rent', 500], ['cash', -500]], { lines: [{ id: 'p0', accountId: 'rent', amountCents: 500, dimensions: { project: 'P5' } }, { id: 'p1', accountId: 'cash', amountCents: -500 }] } as Partial<Transaction>)];
    const e = explainFigure(accounts, tagged, { accountIds: ['rent'], startDate: '2026-03-01', endDate: '2026-03-31', label: { dimensionId: 'project', value: 'P5' } });
    assert.deepEqual(e.lines.map(l => [l.transactionId, l.amountCents]), [['proj', 500]]);
  });
});

describe('The route', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_explain_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const get = async (query: string, uid = 'owner-1') => {
    const res = await fetch(`${base}/api/v1/reports/explain?${query}`, { headers: { 'x-test-uid': uid } });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const express = (await import('express')).default;
    const { reportRouter } = await import('../server/routes/reportRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Explain', members: ['owner-1'] });
    for (const acc of accounts) await db.collection('chartAccounts').doc(`${ws}_${acc.id}`).set({ ...acc, id: undefined, workspaceId: ws });
    // more entries than any browser list holds: the explanation reads them all
    for (let i = 0; i < 30; i++) {
      await db.collection('transactions').doc(`${ws}_s${i}`).set({ workspaceId: ws, date: '2026-03-02', description: `Sale ${i}`, status: 'completed', type: 'actual', currency: 'USD',
        metadata: i === 0 ? { invoiceId: `${ws}_inv` } : {}, lines: [{ accountId: `${ws}_cash`, amountCents: 100 }, { accountId: `${ws}_sales`, amountCents: -100 }] });
    }
    await db.collection('documents').doc(`${ws}_doc1`).set({ workspaceId: ws, linkedId: `${ws}_inv`, name: 'contract.pdf', uid: 'owner-1' });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/reports', reportRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'chartAccounts', 'documents', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('reads the full history, counts files, and refuses outsiders', async () => {
    const res = await get(`workspaceId=${ws}&accountIds=${ws}_sales&startDate=2026-03-01&endDate=2026-03-31`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.totalCents, -3000);
    assert.equal(res.body.entries, 30);
    const lines = res.body.lines as Array<{ attachments: number; document: { type: string } }>;
    assert.equal(lines.filter(l => l.document.type === 'invoice').length, 1);
    assert.equal(lines.find(l => l.document.type === 'invoice')!.attachments, 1);
    assert.equal((await get(`workspaceId=${ws}&accountIds=${ws}_sales`, 'stranger')).status, 403);
    assert.equal((await get(`workspaceId=${ws}`)).status, 400);
  });

  test('a total over a large chart of accounts is asked in the body, past what fits in a link', async () => {
    const post = async (body: unknown, uid = 'owner-1') => {
      const res = await fetch(`${base}/api/v1/reports/explain`, { method: 'POST', headers: { 'x-test-uid': uid, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    };
    // 300 account ids are far more than the 4,000 characters a link takes
    const accountIds = [`${ws}_sales`, ...Array.from({ length: 299 }, (_, i) => `${ws}_unused_account_${i}`)];
    assert.ok(accountIds.join(',').length > 4000);
    const res = await post({ workspaceId: ws, accountIds, startDate: '2026-03-01', endDate: '2026-03-31' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.totalCents, -3000, 'the same lines as the short request');
    assert.equal(res.body.entries, 30);
    assert.equal((await post({ workspaceId: ws, accountIds }, 'stranger')).status, 403);
    assert.equal((await post({ workspaceId: ws, accountIds: [] })).status, 400);
  });
});
