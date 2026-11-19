/**
 * #909 (A7-UI-04): negative income/expense shares must not render as full positive bars.
 *
 * The decorative bar in IncomeBySourceReportView and ExpenseByCategoryReportView only
 * upper-bounded its width (Math.min(100, pct)). A negative percentage produced an invalid
 * negative CSS width, which the browser rejects — the block falls back to `auto` and fills
 * the track, so a refund looks like a 100% contribution. The fix clamps the decorative
 * track to [0, 100]; the signed text, share and CSV are unchanged.
 *
 * Hand-worked books (cents, 2026):
 *   Expenses: Rent 12,445 · Rebate −2,000 · net 10,445 → Rent 119.1%, Rebate −19.1%.
 *   Income:   Acme 27,680 · Bob −2,345 (credit only) · net 25,335 → Acme 109.3%, Bob −9.3%.
 * Expected bars: negative → 0% (empty track), >100% → 100% (exactly one track), text keeps
 * the true signed percentage.
 */
import { stubFetch } from './helpers/dom';
import { setLoadedAccountReportWorkspace } from './helpers/componentFixtures';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ExpenseByCategoryReportView } from '../components/reporting/ExpenseByCategoryReportView';
import { IncomeBySourceReportView } from '../components/reporting/IncomeBySourceReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeChartAccount, makeTransaction } from './fixtures';
import type { TransactionLine } from '../types';

const line = (accountId: string, amountCents: number): TransactionLine =>
  ({ accountId, accountName: accountId, amountCents }) as TransactionLine;
const tx = (id: string, date: string, lines: TransactionLine[], extra = {}) =>
  makeTransaction({ id, date, lines, totalAmountCents: Math.abs(lines[0].amountCents), ...extra });

const expenseAccounts = [
  makeChartAccount({ id: 'bank', name: 'Checking', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'rent', name: 'Rent', type: 'expense', category: 'Occupancy' }),
  makeChartAccount({ id: 'rebate', name: 'Rebate', type: 'expense', category: 'Rebate' }),
];
const expenseLedger = [
  tx('rent', '2026-01-05', [line('rent', 12445), line('bank', -12445)]),
  tx('rebate', '2026-02-05', [line('bank', 2000), line('rebate', -2000)]),
];

const incomeAccounts = [
  makeChartAccount({ id: 'bank', name: 'Checking', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'sales', name: 'Sales', type: 'income', category: 'Revenue' }),
];
const incomeLedger = [
  tx('sale-acme', '2026-01-15', [line('bank', 27680), line('sales', -27680)], { payee: 'Acme' }),
  tx('credit-bob', '2026-02-15', [line('sales', 2345), line('bank', -2345)], { payee: 'Bob' }),
];

function barWidths(caption: RegExp): string[] {
  const table = screen.getByRole('table', { name: caption });
  return within(table).getAllByRole('row').slice(1).map(row => {
    const bar = row.querySelector('span.block');
    assert.ok(bar, `bar exists in row: ${row.textContent}`);
    return (bar as HTMLElement).style.width;
  });
}

describe('share bars clamp to [0,100] (#909)', () => {
  beforeEach(() => { stubFetch(404); });
  afterEach(() => cleanup());

  test('Expense by Category: refund bar is empty, >100% bar fills exactly one track', () => {
    setLoadedAccountReportWorkspace();
    useLedgerStore.setState({ accounts: expenseAccounts, transactions: expenseLedger });
    render(<ExpenseByCategoryReportView selectedYear={2026} />);
    const [rent, rebate] = barWidths(/Expenses by category/);
    // rows sort by amount desc: Rent 12,445 first, Rebate −2,000 second
    assert.equal(rent, '100%', 'Rent 119.1% fills exactly one track');
    assert.equal(rebate, '0%', 'Rebate −19.1% leaves the positive track empty');
    const table = screen.getByRole('table', { name: /Expenses by category/ });
    assert.match(table.textContent || '', /-19\.1%/);
    assert.match(table.textContent || '', /119\.1%/);
  });

  test('Income by Source: credit bar is empty, >100% bar fills exactly one track', () => {
    setLoadedAccountReportWorkspace();
    useLedgerStore.setState({ accounts: incomeAccounts, transactions: incomeLedger });
    render(<IncomeBySourceReportView selectedYear={2026} />);
    const [acme, bob] = barWidths(/Income by source/);
    // rows sort by amount desc: Acme 27,680 first, Bob −2,345 second
    assert.equal(acme, '100%', 'Acme 109.3% fills exactly one track');
    assert.equal(bob, '0%', 'Bob −9.3% leaves the positive track empty');
    const table = screen.getByRole('table', { name: /Income by source/ });
    assert.match(table.textContent || '', /-9\.3%/);
    assert.match(table.textContent || '', /109\.3%/);
  });
});
