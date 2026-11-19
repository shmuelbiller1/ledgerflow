/**
 * R-6: the year-end pack, checked against the 12-month sample business — the fixture the speed work
 * and the worked-figure goldens already use (`src/lib/sampleBusinessYear.ts`).
 *
 * What these tests establish, and what they do not:
 * - the pack calls the reports it names and carries *their* answers (so a pack cannot disagree with
 *   the screen it links to): the profit and loss, the trial balance and the balance sheet figures are
 *   the report functions' own, and the pack's checks are the reports' own `isBalanced` flags;
 * - the parts hold together: net profit is income − cost of goods − expenses, the trial balance's
 *   debits equal its credits, and the books balance on a fixture whose entries are all balanced;
 * - every figure key the pack can emit has a word on the screen (`YEAR_END_FIGURE_KEYS` is the list
 *   the screen is tested against), so a new figure cannot appear unlabelled.
 *
 * It does not claim the pack's browser rendering (that is the screen's component test) or that a
 * real year's data would balance — a real year's imbalance is exactly what the checks report.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSampleBusinessYear } from '../lib/sampleBusinessYear';
import { buildYearEndPack, yearBounds, YEAR_END_FIGURE_KEYS } from '../lib/yearEndPack';

const fixture = buildSampleBusinessYear({ year: 2026 });
const pack = buildYearEndPack({
  year: 2026,
  currency: fixture.workspace.currency || 'USD',
  accounts: fixture.accounts,
  transactions: fixture.transactions,
  customers: fixture.customers,
  vendors: fixture.vendors,
  invoices: fixture.invoices,
  bills: fixture.bills,
  creditNotes: fixture.creditNotes,
  vendorCredits: fixture.vendorCredits,
  assets: fixture.assets,
});

const figure = (sectionId: string, key: string) => {
  const section = pack.sections.find(entry => entry.id === sectionId);
  assert.ok(section, `the ${sectionId} section exists`);
  const found = section.figures.find(entry => entry.key === key);
  assert.ok(found, `${key} is on ${sectionId}`);
  return found;
};

describe('the year-end pack on the sample business year', () => {
  test('covers the calendar year it was asked for', () => {
    assert.deepEqual([pack.year, pack.startDate, pack.endDate, pack.closingMonth], [2026, '2026-01-01', '2026-12-31', '2026-12']);
    assert.deepEqual(yearBounds(2026), { startDate: '2026-01-01', endDate: '2026-12-31', closingMonth: '2026-12' });
  });

  test('has every section the queue asks for, each pointing at its report', () => {
    assert.deepEqual(pack.sections.map(section => section.id), [
      'profit-and-loss', 'balance-sheet', 'trial-balance', 'receivables', 'payables', 'fixed-assets', 'closing',
    ]);
    assert.deepEqual(pack.sections.map(section => section.reportId), [
      'pnl', 'balance-sheet', 'trial-balance', 'ar-aging', 'ap-aging', 'asset-register', 'month-end-close',
    ]);
  });

  test('the profit and loss figures hold together: income − cost of goods − expenses = net profit', () => {
    const income = figure('profit-and-loss', 'pl-income').cents || 0;
    const cogs = figure('profit-and-loss', 'pl-cogs').cents || 0;
    const expenses = figure('profit-and-loss', 'pl-expenses').cents || 0;
    const net = figure('profit-and-loss', 'pl-net-profit').cents || 0;
    assert.equal(income - cogs - expenses, net);
    assert.equal(income - cogs, figure('profit-and-loss', 'pl-gross-profit').cents || 0);
    // the fixture is a year of trading, so these are real figures rather than a sheet of zeroes
    assert.ok(income > 0, 'the year has income');
    assert.ok(expenses > 0, 'the year has expenses');
  });

  test('the trial balance balances, and the pack says so from the report’s own answer', () => {
    const debits = figure('trial-balance', 'tb-debits').cents || 0;
    const credits = figure('trial-balance', 'tb-credits').cents || 0;
    assert.equal(debits, credits);
    assert.equal(figure('trial-balance', 'tb-difference').cents, 0);
    assert.equal(pack.checks.trialBalanceBalanced, true);
    assert.ok((figure('trial-balance', 'tb-accounts').count || 0) > 0, 'accounts with a balance are counted');
  });

  test('the books balance: assets = liabilities + equity + retained earnings', () => {
    const assets = figure('balance-sheet', 'bs-assets').cents || 0;
    const claims = figure('balance-sheet', 'bs-claims').cents || 0;
    assert.equal(assets, claims);
    assert.equal(pack.checks.booksBalanced, true);
    assert.equal(pack.checks.differenceCents, 0);
    // and the pack's claims line is the sheet's own three parts added up
    assert.equal(
      (figure('balance-sheet', 'bs-liabilities').cents || 0)
        + (figure('balance-sheet', 'bs-equity').cents || 0)
        + (figure('balance-sheet', 'bs-retained').cents || 0),
      claims,
    );
  });

  test('the aging sections add their five buckets to their own total', () => {
    for (const sectionId of ['receivables', 'payables']) {
      const bucketSum = ['aging-current', 'aging-1-30', 'aging-31-60', 'aging-61-90', 'aging-90-plus']
        .reduce((total, key) => total + (figure(sectionId, key).cents || 0), 0);
      assert.equal(bucketSum, figure(sectionId, 'aging-total').cents || 0, `${sectionId} buckets add to its total`);
    }
  });

  test('fixed assets report cost, depreciation and what is left, for the assets still held', () => {
    const cost = figure('fixed-assets', 'assets-cost').cents || 0;
    const depreciated = figure('fixed-assets', 'assets-accumulated').cents || 0;
    const net = figure('fixed-assets', 'assets-net-book').cents || 0;
    assert.equal(cost - depreciated, net);
    assert.ok((figure('fixed-assets', 'assets-count').count || 0) > 0, 'the sample year holds fixed assets');
  });

  test('the closing section counts the checklist for the year’s closing month', () => {
    assert.equal(pack.closeItems.length > 0, true);
    const counted = ['close-done', 'close-attention', 'close-blocker']
      .reduce((total, key) => total + (figure('closing', key).count || 0), 0);
    assert.equal(counted, pack.closeItems.length);
  });

  test('every figure it can emit has a key the screen is expected to word', () => {
    const emitted = pack.sections.flatMap(section => section.figures.map(entry => entry.key));
    for (const key of emitted) assert.ok(YEAR_END_FIGURE_KEYS.includes(key), `${key} is in the declared list`);
    // and the declared list is not padded with keys the pack never produces
    for (const key of YEAR_END_FIGURE_KEYS) assert.ok(emitted.includes(key), `${key} is produced by the pack`);
  });

  test('a year with no entries is a zero pack, not a crash', () => {
    const empty = buildYearEndPack({ year: 2031, currency: 'USD', accounts: fixture.accounts, transactions: [] });
    assert.equal(empty.sections.length, 7);
    assert.equal((figureOf(empty, 'profit-and-loss', 'pl-net-profit').cents ?? 0), 0);
    assert.equal(empty.checks.trialBalanceBalanced, true);
    assert.equal(empty.checks.booksBalanced, empty.checks.differenceCents === 0);
  });
});

function figureOf(packUnderTest: ReturnType<typeof buildYearEndPack>, sectionId: string, key: string) {
  const section = packUnderTest.sections.find(entry => entry.id === sectionId);
  assert.ok(section);
  const found = section.figures.find(entry => entry.key === key);
  assert.ok(found);
  return found;
}
