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
import OpeningBalancesSetup from '../components/onboarding/OpeningBalancesSetup';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { Workspace } from '../types';
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
    let done = false;
    render(<OpeningBalancesSetup onClose={() => { done = true; }} />);

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
    assert.ok(screen.getByText(/debits and credits are both \$1,000\.00/));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })); });
    assert.ok(done);
    assert.ok(useAuthStore.getState().workspaces[0].openingBalanceDate);
  });

  test('skip: marks the setup done on the server', async () => {
    const calls = stubFetchWithBodies(200, { status: 'success' });
    render(<SetupWizard onStarted={() => {}} onDone={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByText('Skip setup')); });
    assert.match(calls[0].url, /\/w1\/setup-complete$/);
    assert.ok(screen.getByText(/Your starter settings are ready/));
  });

  test('viewers are told to ask an owner or accountant', () => {
    useAuthStore.setState({ user: { uid: 'v1' } as never, workspaces: [{ id: 'w1', uid: 'u1', name: 'Acme', roles: { v1: 'viewer' } } as unknown as Workspace] });
    render(<SetupWizard onStarted={() => {}} onDone={() => {}} />);
    assert.ok(screen.getByText(/Ask an owner or accountant/));
  });
});
