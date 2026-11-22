/**
 * #910 (A7-CSV-03): four account reports wrote every monetary cell with the two-decimal writer, so a
 * yen book understated its own file by 100x and a dinar book overstated it by 10x, while the screen
 * above the button showed the right amount.
 *
 *   Top Line Items · Income by Source · Expense by Category · Monthly Averages · Tag Breakdown
 *
 * The book's currency decides the scale (JPY 0 decimals, KWD 3, USD 2). This reads the file an
 * accountant actually receives: it clicks the screen's own Export CSV, catches the Blob and parses it —
 * the same way `monthly-report-csv.test.tsx` reads the statement and inventory files.
 *
 * Hand-worked fixture (minor units of the book currency):
 *   rent  2026-01-05  rent +12,345 / bank −12,345     (category "Office")
 *   rebate 2026-02-05 bank +2,000 / rebate −2,000     (category "Rebate")
 *   acme  2026-01-15  bank +27,680 / sales −27,680    (payee "Acme")
 *   bob   2026-02-15  sales +2,345 / bank −2,345      (payee "Bob", a credit: negative share)
 *   burn  2026-01-10  rent +9,345 / bank −9,345       (January's only activity for the averages case)
 * So: Office 12,345 · Rebate −2,000 · Acme 27,680 · Bob −2,345 · January net −9,345.
 */
import { stubFetch } from './helpers/dom';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setLoadedAccountReportWorkspace } from './helpers/componentFixtures';
import { makeChartAccount, makeTransaction } from './fixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { parseCsv } from '../lib/csv';
import { csvMoneyForBook } from '../lib/csvExport';
import type { TransactionLine } from '../types';
import TopExpensesIncomeReportView from '../components/reporting/TopExpensesIncomeReportView';
import IncomeBySourceReportView from '../components/reporting/IncomeBySourceReportView';
import ExpenseByCategoryReportView from '../components/reporting/ExpenseByCategoryReportView';
import AverageMonthlyReportView from '../components/reporting/AverageMonthlyReportView';
import TagBreakdownReportView from '../components/reporting/TagBreakdownReportView';

const line = (accountId: string, amountCents: number): TransactionLine =>
  ({ accountId, accountName: accountId, amountCents }) as TransactionLine;
const tx = (id: string, date: string, lines: TransactionLine[], extra = {}) =>
  makeTransaction({ id, date, lines, totalAmountCents: Math.abs(lines[0].amountCents), ...extra });

const accounts = [
  makeChartAccount({ id: 'bank', name: 'Checking', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'rent', name: 'Rent', type: 'expense', category: 'Office' }),
  makeChartAccount({ id: 'rebate', name: 'Rebate', type: 'expense', category: 'Rebate' }),
  makeChartAccount({ id: 'sales', name: 'Sales', type: 'income', category: 'Revenue' }),
];
const ledger = [
  tx('rent', '2026-01-05', [line('rent', 12345), line('bank', -12345)], { tags: ['Q1'] }),
  tx('rebate', '2026-02-05', [line('bank', 2000), line('rebate', -2000)]),
  tx('acme', '2026-01-15', [line('bank', 27680), line('sales', -27680)], { payee: 'Acme', tags: ['Q1'] }),
  tx('bob', '2026-02-15', [line('sales', 2345), line('bank', -2345)], { payee: 'Bob' }),
];
const burnOnly = [tx('burn', '2026-01-10', [line('rent', 9345), line('bank', -9345)])];

/** Read the file the screen's own button produces, exactly as the browser would hand it over. */
async function csvFromButton(name: string) {
  const anchor = window.HTMLAnchorElement.prototype;
  const originalClick = anchor.click;
  const originalUrl = URL.createObjectURL;
  let bytes: Blob | undefined;
  try {
    anchor.click = () => {};
    URL.createObjectURL = (file: Blob) => { bytes = file; return 'blob:account-report-csv'; };
    fireEvent.click(screen.getByRole('button', { name }));
    assert.ok(bytes, 'the action must produce a file');
    return parseCsv(await bytes.text());
  } finally {
    anchor.click = originalClick;
    URL.createObjectURL = originalUrl;
  }
}

function book(currency: string, transactions = ledger) {
  const workspace = setLoadedAccountReportWorkspace();
  useAuthStore.setState({ workspaces: [{ ...workspace, currency }] });
  useLedgerStore.setState({ accounts, transactions, truncatedCollections: {} } as never);
  stubFetch(404);
}

/** Row named `label`, with the monetary cells only — the text columns are the other tests' business. */
function moneyCells(rows: string[][], label: string) {
  const row = rows.find(r => r[0] === label);
  assert.ok(row, `row "${label}" is in the file: ${JSON.stringify(rows)}`);
  return row;
}

describe('#910: account-report CSV money follows the book currency', () => {
  beforeEach(() => { stubFetch(404); });
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('the writer: 12,345 minor units in each currency, and a safe fallback for an unusable code', () => {
    assert.equal(csvMoneyForBook('JPY')(12345), '12345');
    assert.equal(csvMoneyForBook('KWD')(12345), '12.345');
    assert.equal(csvMoneyForBook('USD')(12345), '123.45');
    assert.equal(csvMoneyForBook('JPY')(-2000), '-2000');
    assert.equal(csvMoneyForBook('KWD')(-2000), '-2.000');
    // A report reads the currency from the workspace: an unfinished setting must not break the download.
    for (const bad of ['', '   ', null, undefined, 'US', 'US DOLLARS']) {
      assert.equal(csvMoneyForBook(bad)(12345), '123.45', `fallback for ${JSON.stringify(bad)}`);
    }
  });

  const cases = [
    { currency: 'JPY', rent: '12345', rebate: '-2000', acme: '27680', bob: '-2345', janIncome: '0', janExpense: '9345', janNet: '-9345', tagIncome: '27680', tagExpense: '12345', tagNet: '15335' },
    { currency: 'KWD', rent: '12.345', rebate: '-2.000', acme: '27.680', bob: '-2.345', janIncome: '0.000', janExpense: '9.345', janNet: '-9.345', tagIncome: '27.680', tagExpense: '12.345', tagNet: '15.335' },
    { currency: 'USD', rent: '123.45', rebate: '-20.00', acme: '276.80', bob: '-23.45', janIncome: '0.00', janExpense: '93.45', janNet: '-93.45', tagIncome: '276.80', tagExpense: '123.45', tagNet: '153.35' },
  ] as const;

  for (const expected of cases) {
    test(`Expense by Category writes ${expected.currency} amounts`, async () => {
      book(expected.currency);
      render(<ExpenseByCategoryReportView selectedYear={2026} />);
      await screen.findByRole('button', { name: 'Export CSV' });
      const rows = await csvFromButton('Export CSV');
      assert.equal(moneyCells(rows, 'Office').at(-1), expected.rent);
      assert.equal(moneyCells(rows, 'Rebate').at(-1), expected.rebate);
    });

    test(`Income by Source writes ${expected.currency} amounts, credits included`, async () => {
      book(expected.currency);
      render(<IncomeBySourceReportView selectedYear={2026} />);
      await screen.findByRole('button', { name: 'Export CSV' });
      const rows = await csvFromButton('Export CSV');
      assert.equal(moneyCells(rows, 'Acme').at(-1), expected.acme);
      assert.equal(moneyCells(rows, 'Bob').at(-1), expected.bob);
    });

    test(`Top Line Items writes ${expected.currency} amounts on the expenses tab`, async () => {
      book(expected.currency);
      render(<TopExpensesIncomeReportView selectedYear={2026} />);
      await screen.findByRole('button', { name: 'Export CSV' });
      const rows = await csvFromButton('Export CSV');
      // Date, Description, Payee, Account / Category, Amount — the rent line is the period's only expense
      const rentRow = moneyCells(rows, '2026-01-05');
      assert.equal(rentRow.at(-1), expected.rent);
      assert.equal(rentRow[3], 'rent', 'the account column still names where the line went');
    });

    test(`Tag Breakdown writes ${expected.currency} amounts on all three money columns`, async () => {
      book(expected.currency);
      render(<TagBreakdownReportView selectedYear={2026} />);
      await screen.findByRole('button', { name: 'Export CSV' });
      const rows = await csvFromButton('Export CSV');
      // Tag, Tagged Items, Revenue Inflow, Expense Outflow, Net Financial Impact
      assert.deepEqual(moneyCells(rows, 'Q1').slice(2), [expected.tagIncome, expected.tagExpense, expected.tagNet]);
    });

    test(`Monthly Averages writes ${expected.currency} amounts for the month's net`, async () => {
      book(expected.currency, burnOnly);
      render(<AverageMonthlyReportView selectedYear={2026} />);
      await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Export CSV' }), 'export is available'));
      const rows = await csvFromButton('Export CSV');
      // Month, Revenue, Expense / Burn, Net Cash Flow, Status / Anomaly
      const january = moneyCells(rows, 'Jan 2026');
      assert.deepEqual(january.slice(1, 4), [expected.janIncome, expected.janExpense, expected.janNet]);
    });
  }
});
