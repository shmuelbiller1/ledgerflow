/**
 * Moving money between two of your own bank accounts (L-181): the transfer is saved through the
 * server as one balanced entry (it used to change only the list on screen and was gone after a
 * reload), and linking two existing entries as a transfer moves their other side to Transfer
 * Clearing so the expense and income they were booked to disappear.
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TransferModal } from '../components/banking/TransferModal';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeChartAccount, makeTransaction } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';
import type { TransactionLine } from '../types';

const accounts = [
  makeChartAccount({ id: 'checking', name: 'Business Checking', type: 'asset', category: 'Cash', code: '1000' }),
  makeChartAccount({ id: 'savings', name: 'Savings', type: 'asset', category: 'Cash', code: '1010' }),
  makeChartAccount({ id: 'misc', name: 'Miscellaneous Expense', type: 'expense', category: 'Operating Expenses', code: '6900' }),
  makeChartAccount({ id: 'other', name: 'Other Income', type: 'revenue', category: 'Other Income', code: '4900' }),
];

const outflow = makeTransaction({ id: 'out', date: '2026-10-01', description: 'Online transfer to savings', totalAmountCents: 25000, status: 'completed',
  lines: [{ id: 'o1', accountId: 'misc', accountName: 'Miscellaneous Expense', amountCents: 25000 }, { id: 'o2', accountId: 'checking', accountName: 'Business Checking', amountCents: -25000 }] });
const inflow = makeTransaction({ id: 'in', date: '2026-10-02', description: 'Transfer from checking', totalAmountCents: 25000, status: 'completed',
  lines: [{ id: 'i1', accountId: 'savings', accountName: 'Savings', amountCents: 25000 }, { id: 'i2', accountId: 'other', accountName: 'Other Income', amountCents: -25000 }] });

describe('Transfer between your own accounts', () => {
  beforeEach(() => {
    setComponentWorkspace('owner');
    markComponentCollectionsLoaded('transactions', 'accounts');
    useLedgerStore.setState({ accounts, transactions: [outflow, inflow] });
  });
  afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });

  test('a new transfer is saved through the server as one balanced entry between the two accounts', async () => {
    const calls = stubFetchWithBodies(200, { status: 'ok' });
    render(<TransferModal isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('From Account (Source)'), { target: { value: 'checking' } });
    fireEvent.change(screen.getByLabelText('To Account (Destination)'), { target: { value: 'savings' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '125.50' } });
    fireEvent.change(screen.getByLabelText('Transfer Date'), { target: { value: '2026-10-03' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Post Transfer/ })); });
    await waitFor(() => assert.ok(calls.some(c => c.url === '/api/v1/transactions' && c.method === 'POST')));
    const saved = (calls.find(c => c.url === '/api/v1/transactions')!.body as { transaction: { date: string; currency: string; isTransfer: boolean; lines: TransactionLine[] } }).transaction;
    assert.equal(saved.date, '2026-10-03');
    assert.equal(saved.currency, 'USD');
    assert.equal(saved.isTransfer, true);
    assert.deepEqual(saved.lines.map(l => [l.accountId, l.amountCents]), [['checking', -12550], ['savings', 12550]]);
    assert.ok(await screen.findByText(/Transferred \$125\.50 from Business Checking to Savings/));
  });

  test('without an amount nothing can be posted', async () => {
    const calls = stubFetchWithBodies(200, {});
    render(<TransferModal isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('From Account (Source)'), { target: { value: 'checking' } });
    fireEvent.change(screen.getByLabelText('To Account (Destination)'), { target: { value: 'savings' } });
    assert.equal((screen.getByRole('button', { name: /Post Transfer/ }) as HTMLButtonElement).disabled, true, 'no amount');
    assert.equal(calls.filter(c => c.url.startsWith('/api/v1/transactions')).length, 0);
  });

  test('linking two entries as a transfer: Transfer Clearing is added and both entries move their other side to it', async () => {
    const calls = stubFetchWithBodies(200, { status: 'ok' });
    render(<TransferModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Transfer Suggestions \(1\)/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Link as Transfer' })); });
    await waitFor(() => assert.equal(calls.filter(c => c.url === '/api/v1/transactions/batch').length, 1));
    const account = calls.find(c => c.url.includes('/rpc/lf_set') && (c.body as { p_table: string }).p_table === 'chartAccounts')!.body as { p_table: string; p_data: { id: string; name: string; type: string; code: string } };
    assert.equal(account.p_table, 'chartAccounts');
    assert.deepEqual([account.p_data.name, account.p_data.type, account.p_data.code], ['Transfer Clearing', 'asset', '1095']);
    // #106: both halves go in ONE batch request, which the server saves together or not at all
    const batches = calls.filter(c => c.url === '/api/v1/transactions/batch');
    assert.equal(batches.length, 1, 'one request for the pair');
    assert.equal(calls.filter(c => c.method === 'PUT').length, 0, 'no separate per-entry saves');
    const updates = (batches[0].body as { updates: Array<{ id: string; data: { isTransfer: boolean; lines: TransactionLine[] } }> }).updates.map(u => ({ url: `/api/v1/transactions/${u.id}`, tx: u.data }));
    assert.deepEqual(updates.map(u => u.url), ['/api/v1/transactions/out', '/api/v1/transactions/in']);
    assert.deepEqual(updates[0].tx.lines.map(l => [l.accountId, l.amountCents]), [[account.p_data.id, 25000], ['checking', -25000]]);
    assert.deepEqual(updates[1].tx.lines.map(l => [l.accountId, l.amountCents]), [['savings', 25000], [account.p_data.id, -25000]]);
    assert.ok(updates.every(u => u.tx.isTransfer), 'both marked as a transfer');
    assert.ok(updates.every(u => u.tx.lines.every(l => l.accountId !== 'misc' && l.accountId !== 'other')), 'the expense and the income are gone');
  });

  test('an existing Transfer Clearing account is reused, not added twice', async () => {
    useLedgerStore.setState({ accounts: [...accounts, makeChartAccount({ id: 'tc', name: 'Transfer Clearing', type: 'asset', category: 'Current Assets', code: '1095' })] });
    const calls = stubFetchWithBodies(200, { status: 'ok' });
    render(<TransferModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Transfer Suggestions \(1\)/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Link as Transfer' })); });
    await waitFor(() => assert.equal(calls.filter(c => c.url === '/api/v1/transactions/batch').length, 1));
    assert.equal(calls.filter(c => c.url.includes('/rpc/lf_set') && (c.body as { p_table: string }).p_table === 'chartAccounts').length, 0);
    const first = (calls.find(c => c.url === '/api/v1/transactions/batch')!.body as { updates: Array<{ data: { lines: TransactionLine[] } }> }).updates[0].data;
    assert.equal(first.lines[0].accountId, 'tc');
  });
});
