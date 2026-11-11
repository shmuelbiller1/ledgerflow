/**
 * The bank reconciliation screen with real bank lines and entries: suggested pairs, matching by
 * hand, ignoring a line, undoing a match, automatic matching, and the account and search filters.
 * Every action goes to the server's /transactions/reconcile in one request.
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Reconciliation from '../components/ledger/Reconciliation';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import type { BankStatementLine } from '../types';
import { makeChartAccount, makeTransaction } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';

const accounts = [
  makeChartAccount({ id: 'bank', name: 'Business Checking', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'card', name: 'Savings Bank', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'sales', name: 'Sales', type: 'revenue' }),
  makeChartAccount({ id: 'rent', name: 'Rent', type: 'expense' }),
];

const transactions = [
  makeTransaction({ id: 't1', date: '2026-10-01', description: 'Payment from Acme Corp', totalAmountCents: 50000, status: 'completed',
    lines: [{ id: 'l1', accountId: 'bank', amountCents: 50000 }, { id: 'l2', accountId: 'sales', amountCents: -50000 }] }),
  makeTransaction({ id: 't2', date: '2026-10-02', description: 'October office rent', totalAmountCents: 120000, status: 'completed',
    lines: [{ id: 'l3', accountId: 'rent', amountCents: 120000 }, { id: 'l4', accountId: 'bank', amountCents: -120000 }] }),
  makeTransaction({ id: 't0', date: '2026-09-01', description: 'September deposit', totalAmountCents: 10000, status: 'reconciled',
    lines: [{ id: 'l5', accountId: 'bank', amountCents: 10000 }, { id: 'l6', accountId: 'sales', amountCents: -10000 }] }),
  makeTransaction({ id: 'td', date: '2026-10-01', description: 'Draft entry never shown', totalAmountCents: 50000, status: 'draft',
    lines: [{ id: 'l7', accountId: 'bank', amountCents: 50000 }, { id: 'l8', accountId: 'sales', amountCents: -50000 }] }),
];

const line = (overrides: Partial<BankStatementLine>): BankStatementLine => ({
  id: 'b', workspaceId: 'component-workspace', date: '2026-10-01', description: '', amountCents: 0, status: 'pending', accountId: 'bank', ...overrides,
} as BankStatementLine);

const bankLines = [
  line({ id: 'b1', description: 'ACME CORP DEP 4411', amountCents: 50000 }),
  line({ id: 'b2', date: '2026-10-02', description: 'LANDLORD LTD OCT', amountCents: -120000 }),
  line({ id: 'b3', date: '2026-10-03', description: 'Coffee shop', amountCents: -450, accountId: 'card' }),
  line({ id: 'm1', date: '2026-09-01', description: 'DEPOSIT 0901', amountCents: 10000, status: 'matched', matchedTransactionId: 't0' }),
];

const operations = (body: unknown) => (body as { operations: unknown[] }).operations;
const click = (el: Element) => act(async () => { fireEvent.click(el); });

describe('Bank reconciliation screen', () => {
  beforeEach(() => {
    setComponentWorkspace('owner');
    markComponentCollectionsLoaded('bankLines', 'transactions', 'accounts');
    useLedgerStore.setState({ accounts, transactions, bankLines, autoRules: [] });
  });
  afterEach(() => cleanup());

  test('empty books say how to bring in work instead of implying that everything was matched', () => {
    stubFetchWithBodies(200, {});
    useLedgerStore.setState({ bankLines: [], transactions: [] });
    useUIStore.setState({ activeTab: 'reconciliation' });
    render(<Reconciliation />);
    assert.ok(screen.getByText(/Import a statement from Bank Connections/));
    assert.ok(screen.getByText(/add a new entry from Overview/));
    fireEvent.click(screen.getByRole('button', { name: 'Open Bank Connections' }));
    assert.equal(useUIStore.getState().activeTab, 'banking');
  });

  test('lists pending bank lines and uncleared posted entries (no drafts, no reconciled ones)', () => {
    stubFetchWithBodies(200, {});
    render(<Reconciliation />);
    assert.ok(screen.getByRole('button', { name: /To review \(3\)/ }));
    assert.ok(screen.getByRole('button', { name: /Matched \(1\)/ }));
    for (const text of ['ACME CORP DEP 4411', 'LANDLORD LTD OCT', 'Coffee shop', 'Payment from Acme Corp', 'October office rent']) assert.ok(screen.getByText(text), text);
    assert.equal(screen.queryByText('Draft entry never shown'), null);
    assert.equal(screen.queryByText('September deposit'), null);
    assert.ok(screen.getAllByText('Match found').length >= 1, 'a suggested pair is marked');
  });

  test('match a bank line to an entry by hand', async () => {
    const calls = stubFetchWithBodies(200, { status: 'ok' });
    render(<Reconciliation />);
    await click(screen.getByText('ACME CORP DEP 4411'));
    assert.ok(screen.getByText('Select a ledger entry to match, or create an entry from this bank line'));
    await click(screen.getByText('Payment from Acme Corp'));
    await click(screen.getByText('Confirm match'));
    await waitFor(() => assert.equal(calls.length, 1));
    assert.equal(calls[0].url, '/api/v1/transactions/reconcile');
    assert.deepEqual(calls[0].body, { workspaceId: 'component-workspace', operations: [
      { type: 'updateBankLine', id: 'b1', data: { status: 'matched', matchedTransactionId: 't1' } },
      { type: 'updateTransaction', id: 't1', data: { status: 'reconciled' } },
    ] });
  });

  test('ignoring a line sends only that line', async () => {
    const calls = stubFetchWithBodies(200, { status: 'ok' });
    render(<Reconciliation />);
    const coffee = screen.getByText('Coffee shop').closest('[role="presentation"]') as HTMLElement;
    await click(within(coffee).getByTitle('Ignore statement item'));
    await waitFor(() => assert.equal(calls.length, 1));
    assert.deepEqual(operations(calls[0].body), [{ type: 'updateBankLine', id: 'b3', data: { status: 'ignored' } }]);
  });

  test('suggested pairs: review and apply them', async () => {
    const calls = stubFetchWithBodies(200, { status: 'ok' });
    render(<Reconciliation />);
    const review = screen.getByText(/Review \d+ suggested matches/);
    const pairs = Number(/Review (\d+)/.exec(review.textContent || '')?.[1]);
    assert.ok(pairs >= 1);
    await click(review);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    const apply = screen.getByRole('button', { name: /Apply selected matches/ });
    await click(apply);
    await waitFor(() => assert.equal(calls.length, pairs));
    const matched = calls.map(c => operations(c.body)[0] as { id: string; data: { matchedTransactionId: string } });
    assert.ok(matched.some(op => op.id === 'b1' && op.data.matchedTransactionId === 't1'), 'the Acme deposit pairs with the Acme payment');
  });

  test('automatic matching sends every confident pair in one request', async () => {
    const calls = stubFetchWithBodies(200, { status: 'ok' });
    render(<Reconciliation />);
    await click(screen.getByRole('button', { name: 'Auto-match all' }));
    await waitFor(() => assert.equal(calls.length, 1));
    const ops = operations(calls[0].body) as Array<{ type: string; id: string }>;
    assert.ok(ops.some(op => op.type === 'updateBankLine' && op.id === 'b1'));
    assert.ok(ops.some(op => op.type === 'updateTransaction' && op.id === 't1'));
    assert.ok(!ops.some(op => op.id === 'b3'), 'the coffee has no entry to match');
  });

  test('automatic matching includes lines imported by someone else, and follows the account filter', async () => {
    useLedgerStore.setState({ bankLines: bankLines.map(l => ({ ...l, uid: 'server-import' } as BankStatementLine)) });
    const calls = stubFetchWithBodies(200, { status: 'ok' });
    render(<Reconciliation />);
    await click(screen.getByRole('button', { name: 'Auto-match all' }));
    await waitFor(() => assert.equal(calls.length, 1));
    assert.ok((operations(calls[0].body) as Array<{ id: string }>).some(op => op.id === 'b1'), 'not limited to the signed-in person\'s lines');
    cleanup();
    calls.length = 0;
    render(<Reconciliation />);
    fireEvent.change(screen.getByLabelText('Reconciliation account'), { target: { value: 'card' } });
    await click(screen.getByRole('button', { name: 'Auto-match all' }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(calls.length, 0, 'nothing on the card account matches, so nothing is sent');
  });

  test('history: undo a match puts the line back to pending and the entry back to completed', async () => {
    const calls = stubFetchWithBodies(200, { status: 'ok' });
    render(<Reconciliation />);
    await click(screen.getByRole('button', { name: /Matched \(1\)/ }));
    assert.ok(screen.getByText('DEPOSIT 0901'));
    assert.ok(screen.getByText('September deposit'));
    await click(screen.getByText('Undo match'));
    await waitFor(() => assert.equal(calls.length, 1));
    assert.deepEqual(operations(calls[0].body), [
      { type: 'updateBankLine', id: 'm1', data: { status: 'pending', matchedTransactionId: null } },
      { type: 'updateTransaction', id: 't0', data: { status: 'completed' } },
    ]);
  });

  test('the account filter and search narrow both lists', async () => {
    stubFetchWithBodies(200, {});
    render(<Reconciliation />);
    fireEvent.change(screen.getByLabelText('Reconciliation account'), { target: { value: 'card' } });
    assert.ok(screen.getByRole('button', { name: /To review \(1\)/ }));
    assert.ok(screen.getByText('Coffee shop'));
    assert.equal(screen.queryByText('Payment from Acme Corp'), null, 'entries that do not touch the account are hidden');
    fireEvent.change(screen.getByLabelText('Reconciliation account'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Search reconciliation amounts or descriptions'), { target: { value: 'landlord' } });
    assert.equal(screen.queryByText('ACME CORP DEP 4411'), null);
    assert.ok(screen.getByText('LANDLORD LTD OCT'));
  });

  test('a refused match tells the user and sends nothing more', async () => {
    const calls = stubFetchWithBodies(400, { error: 'This period is locked' });
    render(<Reconciliation />);
    await click(screen.getByText('ACME CORP DEP 4411'));
    await click(screen.getByText('Payment from Acme Corp'));
    await click(screen.getByText('Confirm match'));
    await waitFor(() => assert.equal(calls.length, 1));
  });

  test('reconciled percentage counts only matched lines inside the same scoped population', () => {
    stubFetchWithBodies(200, {});
    render(<Reconciliation />);
    assert.match(screen.getByText(/of bank lines matched/).textContent || '', /25% of bank lines matched/); // 1 matched of 4 active lines
    cleanup();

    // An ignored line is work set aside, not a reconciled line: 1 matched of 3 active lines = 33%.
    useLedgerStore.setState({ bankLines: bankLines.map(l => (l.id === 'b3' ? { ...l, status: 'ignored' } : l)) });
    render(<Reconciliation />);
    assert.match(screen.getByText(/of bank lines matched/).textContent || '', /33% of bank lines matched/);
    cleanup();

    // The card account holds only the pending coffee line: 0 matched of 1 in scope,
    // never the old global figure that mixed a scoped numerator with a global denominator.
    useLedgerStore.setState({ bankLines });
    render(<Reconciliation />);
    fireEvent.change(screen.getByLabelText('Reconciliation account'), { target: { value: 'card' } });
    assert.match(screen.getByText(/of bank lines matched/).textContent || '', /0% of bank lines matched/);
  });
});
