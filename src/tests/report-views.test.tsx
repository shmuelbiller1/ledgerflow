/**
 * The small report screens (H-11 Expense by Category, H-12 Income by Source, H-13 Monthly Averages,
 * H-14 Top Line Items, H-15 Tag Breakdown): what the user reads, from the same books as
 * report-generators.test.ts (a reversed charge, a vendor refund, a credit back to a customer).
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ExpenseByCategoryReportView } from '../components/reporting/ExpenseByCategoryReportView';
import { IncomeBySourceReportView } from '../components/reporting/IncomeBySourceReportView';
import { AverageMonthlyReportView } from '../components/reporting/AverageMonthlyReportView';
import { TopExpensesIncomeReportView } from '../components/reporting/TopExpensesIncomeReportView';
import { TagBreakdownReportView } from '../components/reporting/TagBreakdownReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { setLoadedAccountReportWorkspace } from './helpers/componentFixtures';
import { accounts, ledger } from './helpers/reportLedger';

const rows = (caption: RegExp) => within(screen.getByRole('table', { name: caption })).getAllByRole('row').slice(1).map(r => r.textContent || '');

describe('report screens', () => {
  beforeEach(() => {
    setLoadedAccountReportWorkspace();
    stubFetch(404);
    useLedgerStore.setState({ accounts, transactions: ledger });
  });
  afterEach(() => cleanup());

  test('Expense by Category: totals per category, the reversed charge gone, the refund taken off', () => {
    render(<ExpenseByCategoryReportView selectedYear={2026} />);
    assert.match(screen.getByText('Total Expenses').parentElement!.textContent || '', /\$2,400\.00/);
    const [occupancy, software] = rows(/Expenses by category/);
    assert.match(occupancy, /Occupancy.*83\.3%.*\$2,000\.00/);
    assert.match(software, /Software.*16\.7%.*\$400\.00/);
  });

  test('Income by Source: per customer, net of credits', () => {
    render(<IncomeBySourceReportView selectedYear={2026} />);
    const [acme, bob] = rows(/Income by source/);
    assert.match(acme, /Acme.*\$4,500\.00/);
    assert.match(bob, /Bob.*\$1,000\.00/);
  });

  test('Monthly Averages: net per month', () => {
    render(<AverageMonthlyReportView selectedYear={2026} />);
    assert.match(screen.getByText('Monthly Average Revenue').closest('div')!.parentElement!.textContent || '', /\$2,750\.00/);
    assert.match(screen.getByText('Monthly Average Burn / Expense').closest('div')!.parentElement!.textContent || '', /\$1,200\.00/);
  });

  test('Top Line Items: the reversed charge and its reversal are not listed', () => {
    render(<TopExpensesIncomeReportView selectedYear={2026} />);
    const expenseRows = rows(/Top expenses and income/);
    assert.equal(expenseRows.length, 3);
    assert.ok(!expenseRows.some(r => r.includes('$400.00')));
    fireEvent.click(screen.getByRole('button', { name: /Top 25 Revenue/ }));
    assert.match(rows(/Top expenses and income/)[0], /\$3,000\.00/);
  });

  test('Tag Breakdown: net per tag', () => {
    render(<TagBreakdownReportView selectedYear={2026} />);
    const [office] = rows(/Totals by tag/);
    assert.match(office, /office/);
    assert.match(office, /\$2,000\.00/);
  });
});
