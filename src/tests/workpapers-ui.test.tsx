import { inlineEditName } from './helpers/inlineEditName';
/**
 * BD-04 workpapers panel (AI #3, A-6): what the person closing the month sees — each account's
 * balance at month end with its note, files and review mark — and that the note and the mark are
 * saved on the account document, by owners and accountants only. Looking at the panel writes
 * nothing; the files are read through the attachments service.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WorkpapersPanel from '../components/ledger/WorkpapersPanel';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount, makeTransaction } from './fixtures';

const accounts = [
  makeChartAccount({ id: 'cash', code: '1000', name: 'Cash', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'ar', code: '1100', name: 'Accounts receivable', type: 'asset', category: 'Receivables', openingBalanceCents: 50_000, asOfDate: '2026-08-31' }),
  makeChartAccount({ id: 'reviewed', code: '2100', name: 'Reviewed loan', type: 'liability', category: 'Debt', workpapers: { '2026-09': { reviewedBy: 'Ada', reviewedAt: '2026-10-02T10:00:00.000Z' } } }),
  makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'revenue', category: 'Revenue' }),
  makeChartAccount({ id: 'rent', code: '5000', name: 'Rent', type: 'expense', category: 'Operations' }),
  makeChartAccount({ id: 'noted', code: '5200', name: 'Noted supplies', type: 'expense', category: 'Operations', workpapers: { '2026-09': { note: 'kept under a zero balance' } } }),
];

const line = (accountId: string, amountCents: number) => ({ id: `${accountId}-${amountCents}`, accountId, amountCents });
const tx = (id: string, date: string, lines: Array<{ id: string; accountId: string; amountCents: number }>, status: ReturnType<typeof makeTransaction>['status'] = 'completed') =>
  makeTransaction({ id, date, status, lines: lines as ReturnType<typeof makeTransaction>['lines'] });

const transactions = [
  tx('t1', '2026-09-10', [line('ar', 100_000), line('sales', -100_000)]),
  tx('t2', '2026-09-15', [line('rent', 20_000), line('cash', -20_000)]),
  tx('t3', '2026-09-20', [line('cash', 50_000), line('sales', -50_000)]),
  tx('t4', '2026-08-10', [line('ar', 40_000), line('sales', -40_000)]),
  tx('t5', '2026-10-05', [line('rent', 7_000), line('cash', -7_000)]), // after the month: not counted
  tx('t6', '2026-09-12', [line('rent', 3_000), line('cash', -3_000)], 'draft'), // a draft: not counted
];

interface SavedWorkpaper { note?: string; reviewedBy?: string; reviewedAt?: string }
interface UpdateCall { workspaceId: string; input: { id: string; workpapers?: Record<string, SavedWorkpaper> } }

const storedFile = (id: string, name: string, linkedId: string, linkedLabel = 'Workpaper 2026-09') => ({
  id,
  updated_at: '2026-10-01T00:00:00Z',
  data: {
    workspaceId: 'component-workspace', uid: 'someone', name, fileUrl: 'data:text/plain;base64,aGk=', sizeBytes: 2,
    createdAt: '2026-10-01T00:00:00Z', linkedCollection: 'chartAccounts', linkedId, linkedLabel,
  },
});

let calls: Array<{ url: string; method: string; body: unknown }> = [];
let fileRows: ReturnType<typeof storedFile>[] = [];

function setup(role: 'owner' | 'accountant' | 'bookkeeper' | 'viewer' = 'owner') {
  setComponentWorkspace(role);
  useLedgerStore.setState({ accounts, transactions, journalEntries: [], isDataTruncated: false });
}

function table(): HTMLElement {
  return screen.getByRole('table', { name: /Workpapers of September 2026/ });
}

function rowOf(label: string): HTMLElement {
  const row = within(table()).getAllByRole('row')
    .find(candidate => (candidate.querySelector('th[scope="row"]')?.textContent || '').startsWith(label));
  assert.ok(row, `a row starting with "${label}"`);
  return row;
}

const updates = () => calls.filter(c => c.url.includes('/commands/chartaccount.update')).map(c => c.body as UpdateCall);

describe('the workpapers panel on Month-End Close', () => {
  beforeEach(() => {
    calls = [];
    fileRows = [storedFile('f1', 'statement.pdf', 'ar'), storedFile('f2', 'receipt.pdf', 'cash'), storedFile('f3', 'august.pdf', 'ar', 'Workpaper 2026-08: Accounts receivable')];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method || 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      const body = url.includes('/rest/v1/documents') && (init?.method || 'GET') === 'GET' ? fileRows : null;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('lists each account\'s balance at month end with its note, files and review mark; looking writes nothing', async () => {
    setup('owner');
    render(<WorkpapersPanel month="2026-09" currency="USD" />);

    assert.ok(screen.getByRole('heading', { name: 'Workpapers' }));
    assert.ok(screen.getByText('1 of 6 reviewed'));
    const balances = within(table()).getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[0]?.textContent);
    assert.deepEqual(balances, ['$300.00', '$1,900.00', '$0.00', '$1,900.00', '$200.00', '$0.00']);
    assert.ok(within(rowOf('Rent')).getByRole('button', { name: inlineEditName('Edit Note on Rent for 2026-09') }));
    assert.ok(within(rowOf('Noted supplies')).getByText('kept under a zero balance'), 'a kept note is shown');
    assert.ok(within(rowOf('Reviewed loan')).getByText(/Reviewed by Ada on 2026-10-02/), 'a kept review mark is shown');

    // the files come through the attachments service, one list per account, the month in the label
    const arFiles = within(rowOf('Accounts receivable')).getByRole('region', { name: 'Files of Workpaper 2026-09: Accounts receivable' });
    await waitFor(() => assert.ok(within(arFiles).getByText('statement.pdf')));
    const cashFiles = within(rowOf('Cash')).getByRole('region', { name: 'Files of Workpaper 2026-09: Cash' });
    await waitFor(() => assert.ok(within(cashFiles).getByText('receipt.pdf')));
    assert.equal(within(arFiles).queryByText('receipt.pdf'), null, 'each account lists only its own files');
    assert.equal(within(arFiles).queryByText('august.pdf'), null, 'and only this month\'s files');
    assert.ok(calls.some(c => c.url.includes('/rest/v1/documents') && c.url.includes('linkedId=eq.ar')), 'the files are queried by account');

    assert.equal(updates().length, 0, 'looking at the workpapers writes nothing');
    assert.equal(calls.filter(c => c.method === 'POST').length, 0, 'and posts nothing');
  });

  test('a note is saved on the account document, and shown once it is', async () => {
    setup('owner');
    render(<WorkpapersPanel month="2026-09" currency="USD" />);
    fireEvent.click(within(rowOf('Rent')).getByRole('button', { name: inlineEditName('Edit Note on Rent for 2026-09') }));
    const box = screen.getByLabelText('Note on Rent for 2026-09');
    fireEvent.change(box, { target: { value: 'check the August invoice' } });
    await act(async () => { fireEvent.blur(box); });

    await waitFor(() => assert.equal(updates().length, 1));
    const saved = updates()[0];
    assert.equal(saved.input.id, 'rent', 'the note lands on the account the row names');
    assert.deepEqual(saved.input.workpapers, { '2026-09': { note: 'check the August invoice' } });
    await waitFor(() => assert.ok(within(rowOf('Rent')).getByText('check the August invoice')));
  });

  test('the review mark is saved on the account with who and when, shown, and taken off again', async () => {
    setup('accountant');
    render(<WorkpapersPanel month="2026-09" currency="USD" />);
    await act(async () => { fireEvent.click(within(rowOf('Cash')).getByRole('button', { name: 'Mark reviewed' })); });

    await waitFor(() => assert.equal(updates().length, 1));
    const saved = updates()[0];
    assert.equal(saved.input.id, 'cash', 'the review mark lands on the account the row names');
    assert.equal(saved.input.workpapers?.['2026-09']?.reviewedBy, 'Test', 'the signed-in user is the reviewer');
    assert.match(saved.input.workpapers?.['2026-09']?.reviewedAt || '', /^\d{4}-\d{2}-\d{2}T/, 'and when');

    const cashRow = rowOf('Cash');
    await waitFor(() => assert.ok(within(cashRow).getByText(/Reviewed by Test on \d{4}-\d{2}-\d{2}/)));
    assert.ok(screen.getByText('2 of 6 reviewed'), 'the count follows the mark');

    await act(async () => { fireEvent.click(within(rowOf('Cash')).getByRole('button', { name: 'Remove the review' })); });
    await waitFor(() => assert.equal(updates().length, 2));
    assert.deepEqual(updates()[1].input.workpapers, {}, 'a workpaper with nothing in it leaves no month behind');
    await waitFor(() => assert.ok(within(rowOf('Cash')).getByRole('button', { name: 'Mark reviewed' })));
    assert.ok(screen.getByText('1 of 6 reviewed'));
  });

  test('a refused save says why and keeps the typed note', async () => {
    setup('owner');
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method || 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (url.includes('/rest/v1/documents') && (init?.method || 'GET') === 'GET') {
        return new Response(JSON.stringify(fileRows), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const body = url.includes('/commands/chartaccount.update') ? { message: 'Field "workpapers" is not allowed on chartAccounts', code: 'INVALID_INPUT' } : null;
      return new Response(JSON.stringify(body), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    render(<WorkpapersPanel month="2026-09" currency="USD" />);
    fireEvent.click(within(rowOf('Rent')).getByRole('button', { name: inlineEditName('Edit Note on Rent for 2026-09') }));
    const box = screen.getByLabelText('Note on Rent for 2026-09');
    fireEvent.change(box, { target: { value: 'typed before the refusal' } });
    await act(async () => { fireEvent.blur(box); });

    const rentRow = rowOf('Rent');
    await waitFor(() => assert.ok(within(rentRow).getByRole('alert'), 'the refusal is shown'));
    assert.match(within(rentRow).getByRole('alert').textContent || '', /not been updated for workpapers yet/);
    assert.equal((screen.getByLabelText('Note on Rent for 2026-09') as HTMLTextAreaElement).value, 'typed before the refusal', 'what was typed is kept');
  });

  test('viewers and bookkeepers only read: no note box, no review button, the files still listed', async () => {
    setup('viewer');
    render(<WorkpapersPanel month="2026-09" currency="USD" />);
    assert.equal(screen.queryByRole('button', { name: 'Mark reviewed' }), null);
    assert.equal(screen.queryByRole('button', { name: /^Edit Note on / }), null);
    assert.ok(within(rowOf('Noted supplies')).getByText('kept under a zero balance'));
    assert.ok(within(rowOf('Reviewed loan')).getByText(/Reviewed by Ada on 2026-10-02/));
    const arFiles = within(rowOf('Accounts receivable')).getByRole('region', { name: 'Files of Workpaper 2026-09: Accounts receivable' });
    await waitFor(() => assert.ok(within(arFiles).getByText('statement.pdf')));
    assert.equal(updates().length, 0);

    cleanup();
    setup('bookkeeper');
    render(<WorkpapersPanel month="2026-09" currency="USD" />);
    assert.equal(screen.queryByRole('button', { name: 'Mark reviewed' }), null, 'the chart policy keeps bookkeepers out');
    assert.equal(screen.queryByRole('button', { name: /^Edit Note on / }), null);
    assert.equal(updates().length, 0);
  });
});
