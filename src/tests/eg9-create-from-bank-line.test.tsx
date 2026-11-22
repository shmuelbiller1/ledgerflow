/**
 * EG-9 (review 4368675678): Reconciliation → Create entry starts from the bank rules' suggestion stored
 * on the line (account, contact, labels), and the person can change it before anything is posted.
 * Figures: line s1 "OFFICE DEPOT #12" −250.00, suggested account Office (6100), vendor v1 "Office Depot",
 * labels [supplies], dept=ops, rule R1 → the entry's first line is Office, −250.00 as the bank shows it,
 * tags [supplies], dept ops, metadata {contactId v1, contactKind vendor, suggestedByRules [R1]}.
 * Without a suggestion the first expense account (Rent) is pre-filled, as before.
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Reconciliation from '../components/ledger/Reconciliation';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useRecordDetailsStore } from '../stores/useRecordDetailsStore';
import type { BankStatementLine, Vendor } from '../types';
import { makeChartAccount } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';

const accounts = [
  makeChartAccount({ id: 'bank', name: 'Business Checking', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'rent', name: 'Rent', code: '6000', type: 'expense', category: 'Expenses' }),
  makeChartAccount({ id: 'office', name: 'Office', code: '6100', type: 'expense', category: 'Expenses' }),
];
const line = (overrides: Partial<BankStatementLine>): BankStatementLine => ({
  id: 'b', workspaceId: 'component-workspace', date: '2026-10-20', description: '', amountCents: 0, status: 'pending', accountId: 'bank', ...overrides,
} as BankStatementLine);
const bankLines = [
  line({ id: 's1', description: 'OFFICE DEPOT #12', amountCents: -25000, suggestion: { accountId: 'office', accountName: 'Office', contactId: 'v1', contactKind: 'vendor', tags: ['supplies'], dimensions: { dept: 'ops' }, ruleIds: ['R1'] } }),
  line({ id: 's2', description: 'UNKNOWN 99', amountCents: -1000 }),
];
type Op = { type: string; data: { lines: Array<{ accountId: string; amountCents: number; tags?: string[]; dimensions?: Record<string, string> }>; tags?: string[]; payee?: string; metadata?: Record<string, unknown> } };
const createOp = (body: unknown) => (body as { operations: Op[] }).operations.find(op => op.type === 'createTransaction')!;
const click = (el: Element) => act(async () => { fireEvent.click(el); });

describe('EG-9 create an entry from a bank line, pre-filled from the bank rules', () => {
  beforeEach(() => {
    setComponentWorkspace('owner');
    markComponentCollectionsLoaded('bankLines', 'transactions', 'accounts', 'customers', 'vendors');
    useLedgerStore.setState({ accounts, transactions: [], bankLines, autoRules: [], vendors: [{ id: 'v1', name: 'Office Depot' } as Vendor], customers: [] });
  });
  afterEach(() => cleanup());

  test('the suggestion is pre-filled and used', async () => {
    const calls = stubFetchWithBodies(200, { status: 'ok' });
    render(<Reconciliation />);
    await click(screen.getByText('OFFICE DEPOT #12'));
    assert.ok(screen.getByText(/Suggested by your bank rules/));
    assert.equal((screen.getByLabelText('Account') as HTMLSelectElement).value, 'office');
    assert.equal((screen.getByLabelText('Contact') as HTMLSelectElement).value, 'vendor:v1');
    assert.equal((screen.getByLabelText('Labels') as HTMLInputElement).value, 'supplies');
    await click(screen.getByRole('button', { name: 'Create entry' }));
    await waitFor(() => assert.equal(calls.length, 1));
    const op = createOp(calls[0].body);
    assert.equal(op.data.lines[0].accountId, 'office');
    assert.equal(op.data.lines[0].amountCents, 25000, 'a withdrawal debits the expense (#891)');
    assert.deepEqual(op.data.lines[0].tags, ['supplies']);
    assert.deepEqual(op.data.lines[0].dimensions, { dept: 'ops' });
    assert.equal(op.data.payee, 'Office Depot');
    assert.deepEqual(op.data.metadata, { contactId: 'v1', contactKind: 'vendor', suggestedByRules: ['R1'] });
  });

  test('the person can change the suggestion before creating', async () => {
    const calls = stubFetchWithBodies(200, { status: 'ok' });
    render(<Reconciliation />);
    await click(screen.getByText('OFFICE DEPOT #12'));
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'rent' } });
      fireEvent.change(screen.getByLabelText('Contact'), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText('Labels'), { target: { value: 'checked, q4' } });
    });
    await click(screen.getByRole('button', { name: 'Create entry' }));
    await waitFor(() => assert.equal(calls.length, 1));
    const op = createOp(calls[0].body);
    assert.equal(op.data.lines[0].accountId, 'rent');
    assert.deepEqual(op.data.lines[0].tags, ['checked', 'q4']);
    assert.equal(op.data.payee, undefined);
    assert.deepEqual(op.data.metadata, { suggestedByRules: ['R1'] });
  });

  // review 4368816639 / 4368816643: the contact's details open in the drawer; the form keeps its line and fields; 44px targets
  test('Edit details opens the suggested vendor and keeps the line and the edited fields', async () => {
    const calls = stubFetchWithBodies(200, { status: 'ok' });
    render(<Reconciliation />);
    await click(screen.getByText('OFFICE DEPOT #12'));
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'rent' } });
      fireEvent.change(screen.getByLabelText('Labels'), { target: { value: 'kept, here' } });
    });
    await click(screen.getByRole('button', { name: 'Edit details' }));
    const details = useRecordDetailsStore.getState() as unknown as { open: boolean; target?: unknown };
    assert.equal(details.open, true);
    assert.deepEqual(details.target, { kind: 'vendors', id: 'v1' });
    assert.equal((screen.getByLabelText('Account') as HTMLSelectElement).value, 'rent');
    assert.equal((screen.getByLabelText('Contact') as HTMLSelectElement).value, 'vendor:v1');
    assert.equal((screen.getByLabelText('Labels') as HTMLInputElement).value, 'kept, here');
    for (const el of [screen.getByLabelText('Account'), screen.getByLabelText('Contact'), screen.getByLabelText('Labels'), screen.getByRole('button', { name: 'Create entry' }), screen.getByRole('button', { name: 'Edit details' })]) {
      assert.match(el.className, /\bmin-h-11\b/, el.outerHTML.slice(0, 60));
    }
    await click(screen.getByRole('button', { name: 'Create entry' }));
    await waitFor(() => assert.equal(calls.length, 1));
    const op = createOp(calls[0].body);
    assert.equal(op.data.lines[0].accountId, 'rent');
    assert.deepEqual(op.data.lines[0].tags, ['kept', 'here']);
    assert.equal((op.data.metadata as { contactId?: string }).contactId, 'v1');
    act(() => { useRecordDetailsStore.getState().close(); });
  });

  test('without a suggestion the first expense account is pre-filled', async () => {
    const calls = stubFetchWithBodies(200, { status: 'ok' });
    render(<Reconciliation />);
    await click(screen.getByText('UNKNOWN 99'));
    assert.equal(screen.queryByRole('button', { name: 'Edit details' }), null, 'no contact, no details button');
    assert.equal(screen.queryByText(/Suggested by your bank rules/), null);
    assert.equal((screen.getByLabelText('Account') as HTMLSelectElement).value, 'rent');
    await click(screen.getByRole('button', { name: 'Create entry' }));
    await waitFor(() => assert.equal(calls.length, 1));
    assert.equal(createOp(calls[0].body).data.lines[0].accountId, 'rent');
  });
});
