/**
 * R-8: a report says plainly *why* it is empty, and says so when the lists it reads are capped —
 * a short figure must never look like the whole ledger.
 *
 * The Journal Sheet is the family's representative (a monthly report read from the browser's
 * entries); `CappedCollectionsNote` is the shared sentence the other reports now mount.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { JournalSheetReportView } from '../components/reporting/JournalSheetReportView';
import { CappedCollectionsNote } from '../components/common/LoadedEntriesOnlyNote';
import { makeChartAccount, makeTransaction } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';

const accounts = [
  makeChartAccount({ id: 'cash', code: '1000', name: 'Bank', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'income', category: 'Revenue' }),
];
const posted = [
  makeTransaction({ id: 'tx-1', workspaceId: 'component-workspace', date: '2026-03-04', description: 'March sale', status: 'posted', lines: [{ accountId: 'cash', amountCents: 50_000 }, { accountId: 'sales', amountCents: -50_000 }] }),
];

beforeEach(() => {
  markComponentCollectionsLoaded('transactions', 'accounts');
  setComponentWorkspace('owner');
  useLedgerStore.setState({ transactions: [], accounts, truncatedCollections: {} });
});
afterEach(() => cleanup());

const renderSheet = async () => {
  render(<JournalSheetReportView startDate="2026-03-01" endDate="2026-03-31" />);
  await act(async () => {});
};

describe('the journal sheet', () => {
  test('with nothing loaded says so, and does not pretend the period was empty', async () => {
    await renderSheet();
    const empty = document.querySelector('[data-report-empty-state]');
    assert.ok(empty, 'an empty state is shown');
    assert.match(empty!.textContent || '', /No entries loaded yet/);
  });

  test('with entries loaded but none in the period, names the period rather than the workspace', async () => {
    useLedgerStore.setState({ transactions: [makeTransaction({ id: 'other', workspaceId: 'component-workspace', date: '2025-12-31', lines: [] })] });
    await renderSheet();
    const empty = document.querySelector('[data-report-empty-state]');
    assert.ok(empty);
    assert.match(empty!.textContent || '', /No posted entries between these dates/);
  });

  test('shows the entries, and says nothing about completeness when the list is complete', async () => {
    useLedgerStore.setState({ transactions: posted });
    await renderSheet();
    assert.match(document.body.textContent || '', /March sale/);
    assert.equal(document.querySelector('[data-testid="journal-sheet-capped"]'), null);
  });

  test('says the sheet covers only the loaded entries when that list was capped', async () => {
    useLedgerStore.setState({ transactions: posted, truncatedCollections: { transactions: true } });
    await renderSheet();
    const note = document.querySelector('[data-testid="journal-sheet-capped"]');
    assert.ok(note, 'the capped note is shown');
    assert.match(note!.textContent || '', /only the most recent entries are here, so this journal sheet may be incomplete/);
  });
});

describe('the shared capped-lists sentence', () => {
  const Note = ({ keys }: { keys: Array<'invoices' | 'bills' | 'payments'> }) => (
    <CappedCollectionsNote testId="cap" keys={keys} what="this statement" />
  );

  test('names only the lists that were capped', async () => {
    useLedgerStore.setState({ truncatedCollections: { invoices: true, bills: true } });
    render(<Note keys={['invoices', 'bills', 'payments']} />);
    await act(async () => {});
    const text = screen.getByRole('note').textContent || '';
    assert.match(text, /only the most recent invoices and bills are here/i);
    assert.doesNotMatch(text, /payments/);
    assert.match(text, /may be incomplete/);
  });

  test('renders nothing when every list it names is complete', async () => {
    useLedgerStore.setState({ truncatedCollections: { invoices: false } });
    render(<Note keys={['invoices', 'bills']} />);
    await act(async () => {});
    assert.equal(screen.queryByRole('note'), null);
  });
});
