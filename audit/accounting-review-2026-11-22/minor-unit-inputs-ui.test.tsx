// Real OpeningBalancesSetup and LoansView components in JPY (0-digit) and KWD (3-digit) workspaces.
import '../../src/tests/helpers/dom';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OpeningBalancesSetup from '../../src/components/onboarding/OpeningBalancesSetup';
import LoansView from '../../src/components/finance/LoansView';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { useLedgerStore } from '../../src/stores/useLedgerStore';
import { makeChartAccount } from '../../src/tests/fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from '../../src/tests/helpers/componentFixtures';
import { stubFetchWithBodies } from '../../src/tests/helpers/dom';
import { getSupabase } from '../../src/lib/db/client';

const accounts = [
  makeChartAccount({ id: 'bank', code: '1010', name: 'Checking', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'loan', code: '2500', name: 'Bank Loan', type: 'liability', category: 'Long-term Liabilities' }),
  makeChartAccount({ id: 'interest', code: '6100', name: 'Interest Expense', type: 'expense', category: 'Expenses' }),
  makeChartAccount({ id: 'obe', code: '3900', name: 'Opening Balance Equity', type: 'equity', subtype: 'opening_balance_equity' } as never),
];

function setWorkspaceCurrency(currency: string) {
  setComponentWorkspace('owner');
  const auth = useAuthStore.getState();
  auth.setWorkspaces(auth.workspaces.map(w => ({ ...w, currency })));
}

test('OpeningBalancesSetup scales JPY by 100x and KWD by 0.1x instead of currency minor units', async () => {
  try {
    setWorkspaceCurrency('JPY');
    useLedgerStore.setState({ accounts });
    const jpyCalls = stubFetchWithBodies(200, { debitsCents: 100_000_000 });
    render(<OpeningBalancesSetup onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Checking/), { target: { value: '1000000' } });
    assert.ok(screen.getByText(/100,000,000/));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record opening balances' })); });
    await waitFor(() => assert.ok(jpyCalls.some(c => c.url.endsWith('/opening-balances') && c.method === 'POST')));
    const jpyBody = jpyCalls.find(c => c.url.endsWith('/opening-balances'))!.body as { balances: Array<{ accountId: string; amountCents: number }> };
    assert.deepEqual(jpyBody.balances, [{ accountId: 'bank', amountCents: 100_000_000 }]);
    cleanup();

    setWorkspaceCurrency('KWD');
    useLedgerStore.setState({ accounts });
    const kwdCalls = stubFetchWithBodies(200, { debitsCents: 100_013 });
    render(<OpeningBalancesSetup onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Checking/), { target: { value: '1000.125' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record opening balances' })); });
    await waitFor(() => assert.ok(kwdCalls.some(c => c.url.endsWith('/opening-balances') && c.method === 'POST')));
    const kwdBody = kwdCalls.find(c => c.url.endsWith('/opening-balances'))!.body as { balances: Array<{ accountId: string; amountCents: number }> };
    // Expected KWD minor units (fils, 3 decimals): 1,000,125; actual sent: 100,013 (KWD 100.013).
    assert.deepEqual(kwdBody.balances, [{ accountId: 'bank', amountCents: 100_013 }]);
    console.log(JSON.stringify({ jpyTyped: '1000000', jpySentMinorUnits: jpyBody.balances[0].amountCents, kwdTyped: '1000.125', kwdSentMinorUnits: kwdBody.balances[0].amountCents }));
  } finally {
    cleanup();
    await getSupabase().auth.dispose();
  }
});

test('LoansView scales a typed JPY principal 100x before formatting and posting', async () => {
  try {
    setWorkspaceCurrency('JPY');
    markComponentCollectionsLoaded('loans');
    useLedgerStore.setState({ accounts, loans: [], transactions: [] });
    const calls = stubFetchWithBodies(200, { ok: true, data: { id: 'loan-jpy' } });
    render(<LoansView />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add a loan' })[0]);
    fireEvent.change(screen.getByLabelText('Lender'), { target: { value: 'Tokyo Bank' } });
    fireEvent.change(screen.getByLabelText('Principal'), { target: { value: '1000000' } });
    fireEvent.change(screen.getByLabelText('Rate (% a year)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Loan (liability) account'), { target: { value: 'loan' } });
    fireEvent.change(screen.getByLabelText('Interest expense account'), { target: { value: 'interest' } });
    fireEvent.change(screen.getByLabelText('Bank the money comes to'), { target: { value: 'bank' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save the loan' })); });
    await waitFor(() => assert.ok(calls.some(c => c.method === 'POST')));
    const post = calls.find(c => c.method === 'POST')!.body as { input?: { data?: { principalCents?: number; currency?: string } } };
    assert.equal(post.input?.data?.currency, 'JPY');
    assert.equal(post.input?.data?.principalCents, 100_000_000);
    console.log(JSON.stringify({ jpyLoanTyped: '1000000', savedCurrency: post.input?.data?.currency, savedPrincipalMinorUnits: post.input?.data?.principalCents }));
  } finally {
    cleanup();
    await getSupabase().auth.dispose();
  }
});
