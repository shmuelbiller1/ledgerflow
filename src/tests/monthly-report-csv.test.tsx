import { stubFetch } from './helpers/dom';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Valuation from '../components/reporting/InventoryValuationReportView';
import { StatementColumns } from '../components/ledger/StatementColumns';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount, makeTransaction } from './fixtures';
import { stock } from './helpers/l123SalesLedger';
import { useAuthStore } from '../stores/useAuthStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { parseCsv } from '../lib/csv';
import { formatCurrency } from '../lib/moneyFormat';
import { computeProfitAndLoss, computeBalanceSheet } from '../server/reports/computeReports';

// Read what an accountant receives, rather than testing another call to the formatter.
async function csvFromButton(name: string) {
  const anchor = window.HTMLAnchorElement.prototype;
  const originalClick = anchor.click, originalUrl = URL.createObjectURL;
  let bytes: Blob | undefined;
  try {
    anchor.click = () => {};
    URL.createObjectURL = (file: Blob) => { bytes = file; return 'blob:monthly-csv'; };
    fireEvent.click(screen.getByRole('button', { name }));
    assert.ok(bytes, 'the action must produce a file');
    return parseCsv(await bytes.text());
  } finally { anchor.click = originalClick; URL.createObjectURL = originalUrl; }
}
afterEach(cleanup);

const examples = [
  { currency: 'JPY', jan: '12345', feb: '-5000', delta: '-17345', closing: '7345' },
  { currency: 'KWD', jan: '12.345', feb: '-5.000', delta: '-17.345', closing: '7.345' },
  { currency: 'USD', jan: '123.45', feb: '-50.00', delta: '-173.45', closing: '73.45' },
];
for (const { currency, jan, feb, delta, closing } of examples) {
  for (const kind of ['inventory', 'pl', 'bs'] as const) test(`${kind} CSV uses ${currency} units for every monetary cell`, async () => {
    const ws = setComponentWorkspace();
    useAuthStore.setState({ workspaces: [{ ...ws, currency }] });
    const needs = useDataNeedsStore.getState();
    needs.resetLoaded(ws.id);
    for (const k of ['transactions', 'accounts', 'inventory'] as const) needs.markLoaded(k);
    const accounts = [makeChartAccount({ id: 'cash', type: 'asset' }), makeChartAccount({ id: 'sales', type: 'income' })];
    const entry = (date: string, n: number) => makeTransaction({ id: date, currency, date, lines: [{ accountId: 'cash', amountCents: n }, { accountId: 'sales', amountCents: -n }] });
    const transactions = [entry('2026-01-16', 12345), entry('2026-02-16', -5000)];
    useLedgerStore.setState({ accounts, transactions, inventory: [{ ...stock(ws.id)[0], quantityAtHand: 1, unitCostCents: 12345 }], truncatedCollections: {}, isDataTruncated: false });
    stubFetch(503);
    if (kind === 'inventory') {
      await act(async () => { render(<Valuation />); });
      const row = (await csvFromButton('Export CSV')).find(r => r[0] === 'Widget');
      assert.deepEqual(row?.slice(3), ['1', jan, jan, '100']);
    } else {
      const data = (start: string, end: string) => kind === 'pl' ? computeProfitAndLoss(accounts, transactions, start, end) : computeBalanceSheet(accounts, transactions, end);
      const start = '2026-02-01', end = '2026-02-28', priorStart = '2026-01-01', priorEnd = '2026-01-31';
      render(<StatementColumns kind={kind} title="Comparison" accounts={accounts} transactions={transactions} startDate={start} endDate={end}
        compareStartDate={priorStart} compareEndDate={priorEnd} compare mode="total" onModeChange={() => {}} showPercent={false} onPercentChange={() => {}}
        totalData={data(start, end)} previousTotalData={data(priorStart, priorEnd)} totalAuthoritative formatMoney={n => formatCurrency(n, currency)} onSort={() => {}} onDrillDown={() => {}} />);
      const label = kind === 'pl' ? 'Net income' : 'Total Assets';
      const row = (await csvFromButton('Export columns CSV')).find(r => r[0] === label);
      assert.deepEqual(row?.slice(2), kind === 'pl' ? [feb, jan, delta, "'-140.5%"] : [closing, jan, feb, "'-40.5%"]);
    }
  });
}
