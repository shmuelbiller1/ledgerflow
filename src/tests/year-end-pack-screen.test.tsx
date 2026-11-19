/**
 * R-6 on the screen: the year-end pack shows the year's sections with their figures, says whether the
 * books balance, links each section to its full report, prints as one page, and — R-8 — says when the
 * lists it read were capped and when the year has nothing in it.
 *
 * The figures themselves are the sample year's, checked in `year-end-pack.test.ts`; here the check is
 * that the screen puts them where a reader looks, in one print root, with the honesty lines present.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import YearEndPackView from '../components/reporting/YearEndPackView';
import { buildSampleBusinessYear } from '../lib/sampleBusinessYear';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';

const fixture = buildSampleBusinessYear({ year: 2026 });

beforeEach(() => {
  markComponentCollectionsLoaded('transactions', 'accounts', 'invoices', 'bills', 'assets', 'customers', 'vendors', 'creditNotes', 'vendorCredits');
  setComponentWorkspace('owner');
  useLedgerStore.setState({
    accounts: fixture.accounts,
    transactions: fixture.transactions,
    customers: fixture.customers,
    vendors: fixture.vendors,
    invoices: fixture.invoices,
    bills: fixture.bills,
    creditNotes: fixture.creditNotes,
    vendorCredits: fixture.vendorCredits,
    assets: fixture.assets,
    truncatedCollections: {},
  });
});
afterEach(() => cleanup());

describe('the year-end pack screen', () => {
  test('shows the year, every section, the balancing line and one print root', async () => {
    const { container } = render(<YearEndPackView selectedYear={2026} />);
    await act(async () => {});

    assert.ok(container.querySelector('[data-print-root]'), 'the whole pack is one print root');
    const ids = Array.from(container.querySelectorAll('[data-year-end-section]')).map(node => node.getAttribute('data-year-end-section'));
    assert.deepEqual(ids, ['profit-and-loss', 'balance-sheet', 'trial-balance', 'receivables', 'payables', 'fixed-assets', 'closing']);

    // the sample year balances, so the reader is told so rather than left to check
    const checks = container.querySelector('[data-year-end-checks]');
    assert.ok(checks);
    assert.equal(checks.getAttribute('role'), null, 'a balanced year is not an alert');
    assert.match(checks.textContent || '', /trial balance balances and the books balance/i);

    // the figures reach the screen (net profit of the sample year), not just the model
    const netProfit = container.querySelector('[data-year-end-figure="pl-net-profit"] dd');
    assert.ok(netProfit && /\d/.test(netProfit.textContent || ''), 'the net profit figure is shown');

    // each section offers the report behind it
    // each section offers the report behind it; the closing checklist is its own screen, opened by a button
    assert.equal(screen.getAllByRole('link', { name: /open/i }).length, 6);
    const closing = container.querySelector('[data-year-end-section="closing"] button');
    assert.ok(closing, 'the closing section opens the month-end close');
    fireEvent.click(closing);
    assert.equal(useUIStore.getState().activeTab, 'month-end-close');
  });

  test('a year with nothing in it says so instead of printing an empty page of zeroes', async () => {
    const { container } = render(<YearEndPackView selectedYear={1999} />);
    await act(async () => {});
    const empty = container.querySelector('[data-report-empty-state]');
    assert.ok(empty, 'the empty state is shown');
    assert.match(empty.textContent || '', /Nothing posted in this year yet/);
    assert.equal(container.querySelectorAll('[data-year-end-figure="pl-net-profit"]').length, 1, 'the year still shows its structure');
  });

  test('says which lists were capped, so a short pack cannot read as a whole year', async () => {
    useLedgerStore.setState({ truncatedCollections: { transactions: true } as never });
    const { container } = render(<YearEndPackView selectedYear={2026} />);
    await act(async () => {});
    const note = container.querySelector('[data-testid="year-end-capped"]');
    assert.ok(note, 'the capped note appears');
    assert.match(note.textContent || '', /only the most recent entries are here/);
    assert.match(note.textContent || '', /this year-end pack may be incomplete/);
  });

  test('a year whose books do not balance is an alert, not a quiet line', async () => {
    // drop one side of an entry: the trial balance no longer balances
    const broken = fixture.transactions.map(transaction => transaction.id === fixture.transactions[0].id
      ? { ...transaction, lines: transaction.lines.slice(0, 1) }
      : transaction);
    useLedgerStore.setState({ transactions: broken });
    const { container } = render(<YearEndPackView selectedYear={2026} />);
    await act(async () => {});
    const checks = container.querySelector('[data-year-end-checks]');
    assert.ok(checks);
    assert.equal(checks.getAttribute('role'), 'alert');
    assert.match(checks.textContent || '', /do not balance at the year end/i);
    assert.match(checks.textContent || '', /does not balance/);
  });
});
