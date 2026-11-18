/**
 * A checklist per client on Month-End Close (BD-10): the steps due that month are in the checklist
 * and signed off through the server; an accountant adds a step, copies another client's steps and
 * saves the list; a bookkeeper sees the steps but has nothing to edit them with.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MonthEndCloseView from '../components/ledger/MonthEndCloseView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';
import type { CloseStep } from '../lib/closeSteps';

type Call = { url: string; method: string; body: Record<string, unknown>; headers?: Record<string, string> };
const steps: CloseStep[] = [
  { id: 'cs_payroll01', title: 'Get the payroll report', frequency: 'monthly' },
  { id: 'cs_vatfile01', title: 'File the VAT return', frequency: 'yearly' },
];

describe('Month-End Close: this client\'s own steps', () => {
  let calls: Call[] = [];
  let refusePeriods: boolean;
  beforeEach(() => {
    calls = [];
    refusePeriods = false;
    useLedgerStore.setState({ truncatedCollections: {}, isDataTruncated: false });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      calls.push({
        url, method: init?.method || 'GET', body,
        ...(init?.headers ? { headers: init.headers as Record<string, string> } : {}),
      });
      if (refusePeriods && url.includes('/rest/v1/periods')) return new Response('{}', { status: 403 });
      let answer: unknown = url.includes('/rest/v1/') ? [] : null;
      if (url.endsWith('/api/v1/commands/period.yearclose')) {
        answer = { status: 'success', command: 'period.yearclose', data: { yearStart: '2025-01-01', closingDate: '2025-12-31', lockPeriod: false, year: { netIncome: 25_000 }, closingVersion: null } };
      }
      if (url.includes('/sign-off')) answer = { status: 'success', signOffs: { [body.itemId]: { by: 'test@example.test', at: '2026-10-06T10:00:00Z' } } };
      if (url.endsWith('/periods/close-steps')) answer = { status: 'success', closeSteps: (body.steps as CloseStep[]).map((s, i) => ({ id: s.id || `cs_saved0${i}`, title: s.title, frequency: s.frequency })) };
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  const open = (role: 'owner' | 'accountant' | 'bookkeeper', extra: Array<Record<string, unknown>> = []) => {
    const ws = setComponentWorkspace(role);
    useAuthStore.setState({ workspaces: [{ ...ws, closeSteps: steps } as never, ...extra as never[]] });
    markComponentCollectionsLoaded('accounts', 'assets', 'bankLines', 'bills', 'creditNotes', 'invoices', 'journalEntries', 'transactions', 'vendorCredits');
    useDataNeedsStore.setState({ loadedWorkspaceId: ws.id });
    render(<MonthEndCloseView />);
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-05' } });
  };

  test('year-end close uses the named command with its idempotency key', async () => {
    open('owner');
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2025-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record the year as closed' }));
    await waitFor(() => assert.ok(calls.some(call => call.url.endsWith('/api/v1/commands/period.yearclose'))));
    const close = calls.find(call => call.url.endsWith('/api/v1/commands/period.yearclose'))!;
    assert.deepEqual(close.body, { workspaceId: 'component-workspace', input: { closingDate: '2025-12-31', lockPeriod: false } });
    assert.ok(close.headers?.['Idempotency-Key']);
  });

  test('the steps due that month are in the checklist and signed off through the server', async () => {
    open('bookkeeper');
    assert.ok(screen.getByText('Get the payroll report'));
    assert.equal(screen.queryByText('File the VAT return'), null, 'a year-end step is not due in May');
    assert.equal(screen.queryByRole('button', { name: /this client's steps/ }), null, 'a bookkeeper does not edit the steps');
    const signOff = await screen.findByRole('button', { name: 'Sign off: Get the payroll report' });
    fireEvent.click(signOff);
    await waitFor(() => assert.ok(calls.some(c => c.url.endsWith('/periods/2026-05/sign-off'))));
    assert.deepEqual(calls.find(c => c.url.endsWith('/sign-off'))!.body, { itemId: 'step:cs_payroll01', remove: false });
    assert.ok(await screen.findByRole('button', { name: 'Remove sign-off: Get the payroll report' }));

    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-12' } });
    assert.ok(screen.getByText('File the VAT return'), 'due at the year end');
    assert.equal(Boolean(screen.queryByRole('button', { name: 'Remove sign-off: Get the payroll report' })), false,
      'the May sign-off must not appear in December while December is loading');
  });

  test('a failed period read does not mean there are no sign-offs; retry reads the chosen month', async () => {
    refusePeriods = true;
    open('owner');
    const retry = await screen.findByRole('button', { name: 'Retry sign-offs' });
    assert.equal((screen.getByRole('button', { name: 'Close 2026-05' }) as HTMLButtonElement).disabled, true);
    assert.equal(Boolean(screen.queryByRole('button', { name: 'Sign off: Get the payroll report' })), false);
    refusePeriods = false;
    fireEvent.click(retry);
    assert.ok(await screen.findByRole('button', { name: 'Sign off: Get the payroll report' }));
  });

  test('switching books does not show the previous book’s sign-off or figures while the new data loads', async () => {
    open('owner');
    const signOff = await screen.findByRole('button', { name: 'Sign off: Get the payroll report' });
    fireEvent.click(signOff);
    await screen.findByRole('button', { name: 'Remove sign-off: Get the payroll report' });
    const book = useAuthStore.getState().getCurrentWorkspace()!;
    act(() => useAuthStore.setState({ currentWorkspaceId: 'other-book', workspaces: [{ ...book, id: 'other-book' }] }));
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-05' } });
    assert.ok(screen.getByText(/Loading the entries and documents/));
    assert.equal(Boolean(screen.queryByRole('heading', { name: 'Close journey' })), false);
    assert.equal(Boolean(screen.queryByRole('button', { name: 'Remove sign-off: Get the payroll report' })), false);
    act(() => useDataNeedsStore.setState({ loadedWorkspaceId: 'other-book' }));
    assert.ok(await screen.findByRole('button', { name: 'Sign off: Get the payroll report' }));
  });

  test('failed core collections do not read as clean; capped entries block a misleading workbook', async () => {
    open('owner');
    const packageButton = screen.getByRole('button', { name: 'Close package (.xlsx)' }) as HTMLButtonElement;
    await waitFor(() => assert.equal(packageButton.disabled, false));
    act(() => useDataNeedsStore.getState().markFailed('transactions', 'Server refused the read'));
    assert.ok(screen.getByText(/Couldn't load entries for the close checklist/));
    assert.equal(Boolean(screen.queryByText('Debits equal credits through the end of the month.')), false);
    assert.equal((screen.getByRole('button', { name: /Soft close/ }) as HTMLButtonElement).disabled, true);
    assert.equal(packageButton.disabled, true);
    act(() => {
      useDataNeedsStore.getState().markLoaded('transactions');
      useLedgerStore.setState({ truncatedCollections: { transactions: true }, isDataTruncated: true });
    });
    assert.ok(screen.getByText(/loaded records omit some history/));
    assert.equal(packageButton.disabled, true);
  });

  test('an accountant adds a step, copies another client\'s and saves the list', async () => {
    const other = { id: 'other-client', uid: 'test-user', name: 'Bakery Ltd', businessType: 'custom', createdAt: '2026-01-01', currency: 'USD',
      closeSteps: [{ id: 'cs_bakery001', title: 'Count the stock', frequency: 'monthly' }, { id: 'cs_bakery002', title: 'Get the payroll report', frequency: 'monthly' }] };
    open('accountant', [other]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this client\'s steps' }));
    fireEvent.change(screen.getByLabelText('New step'), { target: { value: 'Ask for the loan statement' } });
    fireEvent.change(screen.getByLabelText('How often'), { target: { value: 'quarterly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    fireEvent.change(screen.getByLabelText('Copy the steps of another client'), { target: { value: 'other-client' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove File the VAT return' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save steps' })); });
    await waitFor(() => assert.ok(calls.some(c => c.url.endsWith('/periods/close-steps') && c.method === 'PUT')));
    const sent = calls.find(c => c.url.endsWith('/periods/close-steps'))!.body.steps as Array<Record<string, unknown>>;
    assert.deepEqual(sent.map(s => [s.id, s.title, s.frequency]), [
      ['cs_payroll01', 'Get the payroll report', 'monthly'],
      [undefined, 'Ask for the loan statement', 'quarterly'],
      [undefined, 'Count the stock', 'monthly'],
    ], 'the payroll step the client already has is not copied twice');
    await waitFor(() => assert.ok(screen.getByText('Count the stock')));
    assert.equal((useAuthStore.getState().workspaces[0] as { closeSteps?: CloseStep[] }).closeSteps?.length, 3);
  });
});
