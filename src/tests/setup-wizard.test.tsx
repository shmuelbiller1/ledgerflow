/**
 * The first-run setup wizard (L-19, BO-03): basics, chart, opening balances (live check that
 * debits equal credits, the difference shown going to Opening Balance Equity), then done.
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import SetupWizard from '../components/onboarding/SetupWizard';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { Workspace } from '../types';
import { db } from '../firebase';
import { makeChartAccount } from './fixtures';

const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

describe('Setup wizard', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { uid: 'u1', getIdToken: async () => 'token' } as never, isGuest: false, currentWorkspaceId: 'w1',
      workspaces: [{ id: 'w1', uid: 'u1', name: 'Acme', currency: 'USD', timezone: deviceZone, fiscalYearStartMonth: 1 } as Workspace],
    });
    useLedgerStore.setState({ accounts: [
      makeChartAccount({ id: 'cash', name: 'Checking', type: 'asset', category: 'Cash' }),
      makeChartAccount({ id: 'loan', name: 'Bank Loan', type: 'liability', category: 'Long-term' }),
      makeChartAccount({ id: 'ar', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' }),
      makeChartAccount({ id: 'obe', name: 'Opening Balance Equity', type: 'equity', category: 'Equity' }),
    ] });
  });
  afterEach(() => cleanup());

  test('opening balances: live balance check, then one call with the amounts in cents', async () => {
    const calls = stubFetchWithBodies(200, { status: 'success', debitsCents: 100000, equityCents: 70000 });
    let started = false;
    let done = false;
    render(<SetupWizard onStarted={() => { started = true; }} onDone={() => { done = true; }} />);

    await act(async () => { fireEvent.click(screen.getByText('Next')); });
    assert.ok(screen.getByText('Keep my accounts'));
    await act(async () => { fireEvent.click(screen.getByText('Next')); });
    assert.equal(calls.length, 0, 'nothing changed in step 1, existing accounts kept: no calls');

    assert.equal(screen.queryByLabelText(/Accounts Receivable/), null, 'receivables come from invoices');
    fireEvent.change(screen.getByLabelText(/Checking/), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText(/Bank Loan/), { target: { value: '300' } });
    assert.ok(screen.getByText(/Debits \$1,000\.00 = credits \$1,000\.00/));
    assert.ok(screen.getByText(/\$700\.00 goes to Opening Balance Equity/));

    await act(async () => { fireEvent.click(screen.getByText('Record opening balances')); });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/v1\/workspaces\/w1\/opening-balances$/);
    const body = calls[0].body as { date: string; balances: Array<{ accountId: string; amountCents: number }> };
    assert.deepEqual(body.balances, [{ accountId: 'cash', amountCents: 100000 }, { accountId: 'loan', amountCents: 30000 }]);
    assert.match(body.date, /^\d{4}-\d{2}-01$/);
    assert.ok(started);
    assert.ok(screen.getByText(/debits and credits are both \$1,000\.00/));

    await act(async () => { fireEvent.click(screen.getByText('Go to the dashboard')); });
    assert.ok(done);
    assert.ok(useAuthStore.getState().workspaces[0].setupCompletedAt);
  });

  test('business details are sent to the workspace write boundary and restored when the wizard is reopened', async () => {
    const originalClient = db.client;
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    Object.assign(db, { client: () => ({ rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { error: null };
    } }) });
    try {
      const view = render(<SetupWizard onStarted={() => {}} onDone={() => {}} />);
      fireEvent.change(screen.getByLabelText('Business name'), { target: { value: '  Biller Books  ' } });
      fireEvent.change(screen.getByLabelText('Home currency'), { target: { value: 'ILS' } });
      fireEvent.change(screen.getByLabelText('Financial year starts in'), { target: { value: '4' } });
      fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'UTC' } });
      await act(async () => { fireEvent.click(screen.getByText('Next')); });
      assert.ok(screen.getByRole('heading', { name: 'Chart of accounts' }));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].fn, 'lf_update');
      assert.equal(calls[0].args.p_table, 'workspaces');
      assert.equal(calls[0].args.p_id, 'w1');
      assert.deepEqual({ ...(calls[0].args.p_set as object), updatedAt: undefined }, {
        name: 'Biller Books', currency: 'ILS', timezone: 'UTC', fiscalYearStartMonth: 4, fiscalYearStartDay: 1, updatedAt: undefined,
      });
      view.unmount();
      render(<SetupWizard onStarted={() => {}} onDone={() => {}} />);
      assert.equal((screen.getByLabelText('Business name') as HTMLInputElement).value, 'Biller Books');
      assert.equal((screen.getByLabelText('Home currency') as HTMLSelectElement).value, 'ILS');
      assert.equal((screen.getByLabelText('Financial year starts in') as HTMLSelectElement).value, '4');
      assert.equal((screen.getByLabelText('Time zone') as HTMLSelectElement).value, 'UTC');
    } finally { Object.assign(db, { client: originalClient }); }
  });

  test('a refused business save keeps the draft on the first step and allows retry', async () => {
    const originalClient = db.client;
    let attempts = 0;
    Object.assign(db, { client: () => ({ rpc: async () => ({ error: ++attempts === 1 ? { code: '42501', message: 'refused' } : null }) }) });
    try {
      render(<SetupWizard onStarted={() => {}} onDone={() => {}} />);
      fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Unsaved draft' } });
      await act(async () => { fireEvent.click(screen.getByText('Next')); });
      assert.ok(screen.getByRole('heading', { name: 'Your business' }));
      assert.equal((screen.getByLabelText('Business name') as HTMLInputElement).value, 'Unsaved draft');
      assert.equal(useAuthStore.getState().workspaces[0].name, 'Acme');
      await act(async () => { fireEvent.click(screen.getByText('Next')); });
      assert.equal(attempts, 2);
      assert.ok(screen.getByRole('heading', { name: 'Chart of accounts' }));
      assert.equal(useAuthStore.getState().workspaces[0].name, 'Unsaved draft');
    } finally { Object.assign(db, { client: originalClient }); }
  });

  test('chart and opening balance failures keep the user on the same step with their selections', async () => {
    const originalFetch = globalThis.fetch;
    const attempts: Record<string, number> = {};
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = String(input).split('/').pop()!;
      attempts[path] = (attempts[path] || 0) + 1;
      const ok = attempts[path] > 1;
      return new Response(JSON.stringify(ok ? { debitsCents: 100000, equityCents: 100000 } : { message: 'Not saved' }), {
        status: ok ? 200 : 500, headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      render(<SetupWizard onStarted={() => {}} onDone={() => {}} />);
      await act(async () => { fireEvent.click(screen.getByText('Next')); });
      fireEvent.click(screen.getByLabelText('Creative Project'));
      await act(async () => { fireEvent.click(screen.getByText('Next')); });
      assert.ok(screen.getByRole('heading', { name: 'Chart of accounts' }));
      assert.equal((screen.getByLabelText('Creative Project') as HTMLInputElement).checked, true);
      await act(async () => { fireEvent.click(screen.getByText('Next')); });
      assert.ok(screen.getByRole('heading', { name: 'Opening balances' }));
      fireEvent.change(screen.getByLabelText(/Checking/), { target: { value: '1000' } });
      await act(async () => { fireEvent.click(screen.getByText('Record opening balances')); });
      assert.ok(screen.getByRole('heading', { name: 'Opening balances' }));
      assert.equal((screen.getByLabelText(/Checking/) as HTMLInputElement).value, '1000');
      await act(async () => { fireEvent.click(screen.getByText('Record opening balances')); });
      assert.ok(screen.getByRole('heading', { name: 'Your books are set up' }));
      assert.deepEqual(attempts, { 'apply-template': 2, 'opening-balances': 2 });
    } finally { globalThis.fetch = originalFetch; }
  });

  test('skip: marks the setup done on the server', async () => {
    const calls = stubFetchWithBodies(200, { status: 'success' });
    render(<SetupWizard onStarted={() => {}} onDone={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByText('Skip setup')); });
    assert.match(calls[0].url, /\/w1\/setup-complete$/);
    assert.ok(screen.getByText('You start from zero; the trial balance balances.'));
  });

  test('viewers are told to ask an owner or accountant', () => {
    useAuthStore.setState({ user: { uid: 'v1' } as never, workspaces: [{ id: 'w1', uid: 'u1', name: 'Acme', roles: { v1: 'viewer' } } as unknown as Workspace] });
    render(<SetupWizard onStarted={() => {}} onDone={() => {}} />);
    assert.ok(screen.getByText(/Ask an owner or accountant/));
  });
});
