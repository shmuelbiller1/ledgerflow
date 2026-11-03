/**
 * L-123 step 4f: "Monthly Averages" (AverageMonthlyReportView) reads the year's months from the server
 * (GET /api/v1/balances/monthly-averages, src/hooks/useServerMonthlyAverages.ts) when the loaded list is capped and the
 * year reaches the oldest loaded day. Transfer lines are left out, so the per-account activity cannot be used.
 *
 * Hand-worked case (cents) on the step 4 ledger (src/tests/helpers/l123RangeLedger.ts), year Y:
 *   expense by month  Jan 900 (E1) · Feb 300 + 700 = 1,000 (E3, E4) · Mar 200 (E6) · Apr −300 (E7 reverses E3)
 *     → 4 active months, 1,800 / 4 = 450; Jan and Feb are above 1.5 × 450 = 675, so they are marked
 *   income by month   Jan 1,500 (E2) · Mar 800 (E5) → 2 active months, 2,300 / 2 = 1,150; none above 1,725
 * The loaded four (E4…E7) alone: expense Feb 700 · Mar 200 · Apr −300 → 600 / 3 = 200; income Mar 800 → 800.
 */
import { stubFetch } from './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Y, chart, entries, loadedOf, balanceRouteHarness } from './helpers/l123RangeLedger';
import { setComponentWorkspace } from './helpers/componentFixtures';
import AverageMonthlyReportView from '../components/reporting/AverageMonthlyReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { formatCurrency } from '../lib/utils';
import { computeMonthlyAverages, type MonthlyAverageSummary } from '../lib/reportGenerators';

const months = (s: MonthlyAverageSummary) => s.monthlyData.filter(m => m.expenseCents || m.incomeCents)
  .map(m => `${m.monthName} ${m.incomeCents}/${m.expenseCents}${m.isExpenseAnomaly ? '!' : ''}`);
const EVERY = { avg: [1150, 450], months: ['Jan 1500/900!', 'Feb 0/1000!', 'Mar 800/200', 'Apr 0/-300'] };

describe('L-123 step 4f: monthly averages (no database)', () => {
  const ws = 'component-workspace';
  const all = entries(ws), accounts = chart(ws);
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('every entry gives the hand-worked months; the loaded four do not', () => {
    const full = computeMonthlyAverages(accounts, all, Y);
    assert.deepEqual([full.monthlyAverageIncomeCents, full.monthlyAverageExpenseCents], EVERY.avg);
    assert.deepEqual(months(full), EVERY.months);
    const own = computeMonthlyAverages(accounts, loadedOf(all), Y);
    assert.deepEqual([own.monthlyAverageIncomeCents, own.monthlyAverageExpenseCents], [800, 200]);
  });

  test('screen: the loaded averages when not capped, the server\'s when capped, the loaded ones with a note when it fails', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ accounts, transactions: loadedOf(all), truncatedCollections: {} } as never);
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return Response.json({ status: 'success', summary: computeMonthlyAverages(accounts, all, Y) });
    }) as typeof fetch;
    const text = () => document.querySelector('#monthly-averages-report')?.textContent || '';
    const cases: Array<{ capped: boolean; fail?: boolean; avg: number; note: RegExp | null }> = [
      { capped: false, avg: 200, note: null },
      { capped: true, avg: 450, note: /read from every entry on the server/ },
      { capped: true, fail: true, avg: 200, note: /loaded entries only/ },
    ];
    for (const c of cases) {
      if (c.fail) stubFetch(500);
      useLedgerStore.setState({ truncatedCollections: c.capped ? { transactions: true } : {} });
      render(<AverageMonthlyReportView selectedYear={Y} />);
      await waitFor(() => assert.ok(text().includes(formatCurrency(c.avg)), text()), { timeout: 5000 });
      const note = screen.queryByTestId('monthly-averages-source');
      if (c.note) assert.match(note?.textContent || '', c.note); else assert.equal(note, null);
      cleanup();
    }
    assert.deepEqual(asked, [`/api/v1/balances/monthly-averages?workspaceId=${ws}&from=${Y}-01-01&to=${Y}-12-31`]);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 4f: GET /api/v1/balances/monthly-averages', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  // E8, timestamped on December 31 (Codex on #498): Fuel +100 / Cash −100 — Dec expense 100, still inside the year
  const withYearEnd = (w: string) => [...entries(w), { ...entries(w)[5], id: `${w}_e8`, date: `${Y}-12-31T18:00:00.000Z`, description: 'E8',
    lines: [{ accountId: `${w}_fuel`, amountCents: 100 }, { accountId: `${w}_cash`, amountCents: -100 }] }];
  const db = balanceRouteHarness(url, 'l123i', w => ({ accounts: chart(w), entries: withYearEnd(w) }));
  before(() => db.start());
  after(() => db.stop());

  test('every entry of the year: the hand-worked months; one calendar year only; members only', async () => {
    const get = (q: Record<string, string>, uid?: string) => db.get<{ summary: MonthlyAverageSummary; entriesRead: number }>('monthly-averages', { workspaceId: db.ws, ...q }, uid);
    const year = await get({ from: `${Y}-01-01`, to: `${Y}-12-31` });
    assert.equal(year.status, 200);
    // with E8: expense months Jan 900 · Feb 1,000 · Mar 200 · Apr −300 · Dec 100 → 1,900 / 5 = 380; Jan, Feb above 570
    assert.deepEqual([year.body.summary.monthlyAverageIncomeCents, year.body.summary.monthlyAverageExpenseCents], [1150, 380]);
    assert.deepEqual(months(year.body.summary), [...EVERY.months, 'Dec 0/100']);
    assert.equal(year.body.entriesRead, 8, 'a December 31 entry with a time of day is inside the year');
    const before = await get({ from: `${Y - 1}-01-01`, to: `${Y - 1}-12-31` });
    assert.equal(before.status, 200);
    assert.equal(before.body.entriesRead, 0, 'an earlier year reads only its own entries, not the later ones (CodeRabbit on #498)');
    const early = await get({ from: '0999-01-01', to: '0999-12-31' });
    assert.equal(early.status, 200, 'a year below 1000 keeps its four digits (CodeRabbit on #498)');
    assert.equal(early.body.entriesRead, 0);
    assert.equal((await get({ from: `${Y}-01-01`, to: `${Y}-06-30` })).status, 400, 'not a whole year');
    assert.equal((await get({ from: `${Y}-02-01`, to: `${Y}-12-31` })).status, 400, 'not from January 1');
    assert.equal((await get({ from: `${Y}-01-01`, to: `${Y}-12-31` }, 'stranger')).status, 403);
  });
});
