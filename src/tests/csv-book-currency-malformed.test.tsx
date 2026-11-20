/**
 * Gitar finding on PR #946 (verified on main): four book-currency report screens called
 * `csvMoneyForCurrency(bookCurrency)` in the render body. That writer throws a RangeError for any
 * code that is not three letters, and `useBookCurrency` only trims/upper-cases the workspace value —
 * so a workspace currency like `US$` or `EURO` crashed the whole report screen during render,
 * instead of falling back to two decimals as the export rule requires.
 *
 * These tests pin the fix: the four screens now use `csvMoneyForBook`, which falls back to the
 * two-decimal writer for an unusable code, and the screens render + export with a malformed
 * workspace currency instead of throwing.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TopExpensesIncomeReportView from '../components/reporting/TopExpensesIncomeReportView';
import IncomeBySourceReportView from '../components/reporting/IncomeBySourceReportView';
import ExpenseByCategoryReportView from '../components/reporting/ExpenseByCategoryReportView';
import AverageMonthlyReportView from '../components/reporting/AverageMonthlyReportView';
import { setLoadedAccountReportWorkspace } from './helpers/componentFixtures';
import { makeChartAccount, makeTransaction } from './fixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { csvMoneyForBook, csvMoneyForCurrency } from '../lib/csvExport';

function setupCurrencyWorkspace(currency: string) {
  const ws = setLoadedAccountReportWorkspace();
  useAuthStore.setState({ workspaces: [{ ...ws, currency }] });
  window.__ledgerBaseCurrency = currency;
  const cash = makeChartAccount({ id: 'cash', name: 'Cash', type: 'asset', category: 'Cash' });
  const rent = makeChartAccount({ id: 'rent', name: 'Office Rent', type: 'expense', category: 'Operating' });
  const sales = makeChartAccount({ id: 'sales', name: 'Consulting', type: 'income', category: 'Services' });
  useLedgerStore.setState({
    baseCurrency: currency,
    truncatedCollections: {},
    accounts: [cash, rent, sales],
    transactions: [
      makeTransaction({
        id: 'tx-exp',
        date: '2026-01-15',
        description: 'January Rent',
        payee: 'Landlord',
        totalAmountCents: 12345,
        lines: [
          { accountId: 'rent', accountName: 'Office Rent', amountCents: 12345 },
          { accountId: 'cash', accountName: 'Cash', amountCents: -12345 },
        ],
      }),
      makeTransaction({
        id: 'tx-inc',
        date: '2026-01-20',
        description: 'Retainer',
        payee: 'Acme Corp',
        totalAmountCents: 23450,
        lines: [
          { accountId: 'cash', accountName: 'Cash', amountCents: 23450 },
          { accountId: 'sales', accountName: 'Consulting', amountCents: -23450 },
        ],
      }),
    ],
  } as never);
}

async function captureExportCsv(): Promise<string> {
  let capturedBlob: Blob | null = null;
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = ((obj: Blob | MediaSource) => {
    if (obj instanceof Blob) capturedBlob = obj;
    return 'blob:test-csv';
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    assert.ok(capturedBlob, 'expected Export CSV click to create a Blob');
    return await (capturedBlob as Blob).text();
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  }
}

afterEach(() => {
  cleanup();
  window.__ledgerBaseCurrency = 'USD';
  useLedgerStore.setState({ baseCurrency: 'USD', truncatedCollections: {}, accounts: [], transactions: [] } as never);
});

test('csvMoneyForBook: malformed codes fall back to two decimals instead of throwing', () => {
  for (const bad of ['US$', 'EURO', '', '€', 'US', 'USDD', '12A']) {
    assert.equal(csvMoneyForBook(bad)(12345), '123.45', `expected fallback for ${JSON.stringify(bad)}`);
  }
  assert.equal(csvMoneyForBook(null)(12345), '123.45');
  assert.equal(csvMoneyForBook(undefined)(12345), '123.45');
});

test('csvMoneyForBook: valid codes keep their own scale (JPY 0, KWD 3, USD 2)', () => {
  assert.equal(csvMoneyForBook('JPY')(12345), '12345');
  assert.equal(csvMoneyForBook('KWD')(12345), '12.345');
  assert.equal(csvMoneyForBook('USD')(12345), '123.45');
  assert.equal(csvMoneyForBook(' usd ')(12345), '123.45');
});

test('csvMoneyForCurrency still refuses a malformed code (the throw the screens must not hit)', () => {
  assert.throws(() => csvMoneyForCurrency('US$'), RangeError);
});

for (const bad of ['US$', 'EURO']) {
  test(`malformed workspace currency (${bad}): TopExpensesIncomeReportView renders and exports with fallback`, async () => {
    setupCurrencyWorkspace(bad);
    render(<TopExpensesIncomeReportView startDate="2026-01-01" endDate="2026-12-31" />);
    const csv = await captureExportCsv();
    assert.ok(csv.includes('"123.45"'), `expected two-decimal fallback in:\n${csv}`);
  });

  test(`malformed workspace currency (${bad}): IncomeBySourceReportView renders and exports with fallback`, async () => {
    setupCurrencyWorkspace(bad);
    render(<IncomeBySourceReportView startDate="2026-01-01" endDate="2026-12-31" />);
    const csv = await captureExportCsv();
    assert.ok(csv.includes('"234.50"'), `expected two-decimal fallback in:\n${csv}`);
  });

  test(`malformed workspace currency (${bad}): ExpenseByCategoryReportView renders and exports with fallback`, async () => {
    setupCurrencyWorkspace(bad);
    render(<ExpenseByCategoryReportView startDate="2026-01-01" endDate="2026-12-31" />);
    const csv = await captureExportCsv();
    assert.ok(csv.includes('"123.45"'), `expected two-decimal fallback in:\n${csv}`);
  });

  test(`malformed workspace currency (${bad}): AverageMonthlyReportView renders and exports with fallback`, async () => {
    setupCurrencyWorkspace(bad);
    render(<AverageMonthlyReportView selectedYear={2026} />);
    const csv = await captureExportCsv();
    assert.ok(csv.includes('"234.50"'), `expected two-decimal fallback in:\n${csv}`);
  });
}
