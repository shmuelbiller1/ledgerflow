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

function setupCurrencyWorkspace(currency: string) {
  const ws = setLoadedAccountReportWorkspace();
  useAuthStore.setState({ workspaces: [{ ...ws, currency }] });
  window.__ledgerBaseCurrency = currency;
  const cash = makeChartAccount({ id: 'cash', name: 'Cash', type: 'asset', category: 'Cash' });
  const rent = makeChartAccount({ id: 'rent', name: 'Office Rent', type: 'expense', category: 'Operating' });
  const rebate = makeChartAccount({ id: 'rebate', name: 'Supplier Rebate', type: 'expense', category: 'Rebate' });
  const sales = makeChartAccount({ id: 'sales', name: 'Consulting', type: 'income', category: 'Services' });
  useLedgerStore.setState({
    baseCurrency: currency,
    truncatedCollections: {},
    accounts: [cash, rent, rebate, sales],
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
      makeTransaction({
        id: 'tx-rebate',
        date: '2026-02-10',
        description: 'Overcharge Refund',
        payee: 'Cloud Co',
        totalAmountCents: 2345,
        lines: [
          { accountId: 'cash', accountName: 'Cash', amountCents: 2345 },
          { accountId: 'rebate', accountName: 'Supplier Rebate', amountCents: -2345 },
        ],
      }),
    ],
  } as never);
}

async function captureExportCsv(buttonLabel = 'Export CSV'): Promise<string> {
  let capturedBlob: Blob | null = null;
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = ((obj: Blob | MediaSource) => {
    if (obj instanceof Blob) capturedBlob = obj;
    return 'blob:test-csv';
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  try {
    fireEvent.click(screen.getByRole('button', { name: buttonLabel }));
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

for (const [currency, rentCsv, retainerCsv, febNetCsv, zeroCsv] of [
  ['JPY', '"12345"', '"23450"', '"-2345"', '"0"'],
  ['KWD', '"12.345"', '"23.450"', '"-2.345"', '"0.000"'],
  ['USD', '"123.45"', '"234.50"', '"-23.45"', '"0.00"'],
] as const) {
  test(`#910 CSV currency (${currency}): TopExpensesIncomeReportView exports book currency decimals`, async () => {
    setupCurrencyWorkspace(currency);
    render(<TopExpensesIncomeReportView startDate="2026-01-01" endDate="2026-12-31" />);
    const expCsv = await captureExportCsv();
    assert.ok(expCsv.includes(`"January Rent","Landlord","Office Rent",${rentCsv}`), `expected ${rentCsv} in:\n${expCsv}`);

    fireEvent.click(screen.getByRole('button', { name: /Top 25 Revenue/i }));
    const incCsv = await captureExportCsv();
    assert.ok(incCsv.includes(`"Retainer","Acme Corp","Consulting",${retainerCsv}`), `expected ${retainerCsv} in:\n${incCsv}`);
  });

  test(`#910 CSV currency (${currency}): IncomeBySourceReportView exports book currency decimals`, async () => {
    setupCurrencyWorkspace(currency);
    render(<IncomeBySourceReportView startDate="2026-01-01" endDate="2026-12-31" />);
    const csv = await captureExportCsv();
    assert.ok(csv.includes(`"Acme Corp",1,"100.0",${retainerCsv}`), `expected ${retainerCsv} in:\n${csv}`);
  });

  test(`#910 CSV currency (${currency}): ExpenseByCategoryReportView exports book currency decimals`, async () => {
    setupCurrencyWorkspace(currency);
    render(<ExpenseByCategoryReportView startDate="2026-01-01" endDate="2026-12-31" />);
    const csv = await captureExportCsv();
    assert.ok(csv.includes(`"Operating",1,`) && csv.includes(rentCsv), `expected ${rentCsv} in:\n${csv}`);
    assert.ok(csv.includes(`"Rebate",1,`) && csv.includes(febNetCsv), `expected negative ${febNetCsv} in:\n${csv}`);
  });

  test(`#910 CSV currency (${currency}): AverageMonthlyReportView exports book currency decimals including negative and zero`, async () => {
    setupCurrencyWorkspace(currency);
    render(<AverageMonthlyReportView selectedYear={2026} />);
    const csv = await captureExportCsv();
    // February has 0 income, -2345 expense rebate -> net cash flow +2345 minor units
    // March has 0 income, 0 expense, 0 net
    assert.ok(csv.includes(`"Jan 2026",${retainerCsv},${rentCsv}`), `expected Jan row in:\n${csv}`);
    assert.ok(csv.includes(`"Feb 2026",${zeroCsv},${febNetCsv}`), `expected Feb negative row (${febNetCsv}) in:\n${csv}`);
    assert.ok(csv.includes(`"Mar 2026",${zeroCsv},${zeroCsv},${zeroCsv}`), `expected Mar zero row (${zeroCsv}) in:\n${csv}`);
  });
}
