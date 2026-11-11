/** R-5: the journal sheet draws its first 200 entries, more on request; totals and unbalanced entries cover the whole period. */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import JournalSheetReportView from '../components/reporting/JournalSheetReportView';
import { makeChartAccount, makeTransaction } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { formatCurrency } from '../lib/utils';

afterEach(() => cleanup());

test('R-5: 450 entries of 10.00 → 200 drawn, then 400, then all; totals 4,500.00 throughout; an unbalanced entry past the page is drawn', async () => {
  const accounts = [
    makeChartAccount({ id: 'cash', code: '1000', name: 'Bank', type: 'asset', category: 'Cash', balanceCents: 0 }),
    makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'income', category: 'Revenue', balanceCents: 0 }),
  ];
  const day = (i: number) => `2026-${String(1 + Math.floor(i / 40)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;
  const transactions = Array.from({ length: 450 }, (_, i) => makeTransaction({
    id: `t${String(i).padStart(3, '0')}`, workspaceId: 'component-workspace', date: day(i), description: `Sale ${i}`,
    lines: [{ accountId: 'cash', amountCents: 1000 }, { accountId: 'sales', amountCents: i === 430 ? -900 : -1000 }],
  }));
  markComponentCollectionsLoaded('transactions', 'accounts');
  setComponentWorkspace('owner');
  useLedgerStore.setState({ transactions, accounts });
  await act(async () => { render(<JournalSheetReportView startDate="2026-01-01" endDate="2026-12-31" />); });
  const drawn = () => document.querySelectorAll('#journal-sheet-report table').length;
  // 200 on the first page, plus the one unbalanced entry (Sale 430) that falls on a later page
  assert.equal(drawn(), 201);
  assert.ok(screen.getByText('Sale 430'), 'the unbalanced entry is on screen');
  assert.match(document.body.textContent || '', /1 unbalanced entry/);
  // debits 450 × 10.00 = 4,500.00 over every entry, not only the drawn ones
  assert.ok((document.body.textContent || '').includes(`Debits: ${formatCurrency(450_000)}`));
  fireEvent.click(screen.getByRole('button', { name: /Show more entries \(201 of 450\)/ }));
  assert.equal(drawn(), 401);
  fireEvent.click(screen.getByRole('button', { name: 'Show all 450' }));
  assert.equal(drawn(), 450);
  assert.equal(screen.queryByRole('button', { name: /Show more entries/ }), null);
});

test('#642: printing the journal sheet carries every entry, then the screen returns to its page', async () => {
  const accounts = [
    makeChartAccount({ id: 'cash', code: '1000', name: 'Bank', type: 'asset', category: 'Cash', balanceCents: 0 }),
    makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'income', category: 'Revenue', balanceCents: 0 }),
  ];
  const transactions = Array.from({ length: 250 }, (_, i) => makeTransaction({
    id: `p${String(i).padStart(3, '0')}`, workspaceId: 'component-workspace', date: `2026-03-${String(1 + (i % 28)).padStart(2, '0')}`,
    description: `Sale ${i}`, lines: [{ accountId: 'cash', amountCents: 1000 }, { accountId: 'sales', amountCents: -1000 }],
  }));
  markComponentCollectionsLoaded('transactions', 'accounts');
  setComponentWorkspace('owner');
  useLedgerStore.setState({ transactions, accounts });
  await act(async () => { render(<JournalSheetReportView startDate="2026-01-01" endDate="2026-12-31" />); });
  const drawn = () => document.querySelectorAll('#journal-sheet-report table').length;
  assert.equal(drawn(), 200);
  await act(async () => { window.dispatchEvent(new window.Event('beforeprint')); });
  assert.equal(drawn(), 250, 'the paper carries all 250 entries');
  assert.equal(screen.queryByRole('button', { name: /Show more entries/ }), null);
  await act(async () => { window.dispatchEvent(new window.Event('afterprint')); });
  assert.equal(drawn(), 200);
});
