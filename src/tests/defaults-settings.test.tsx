/**
 * Settings → Defaults (BB-03): each kind of posting shows the account it uses now (chosen, or the
 * automatic one by the posting's own rule); choosing saves at once and keeps the other mappings;
 * only owners and accountants change them. The keys are the ones the postings read.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DefaultsSettings from '../components/platform/settings/DefaultsSettings';
import { DEFAULT_ACCOUNT_SLOTS, accountInUse, withDefault } from '../lib/accountDefaults';
import { advanceAccount } from '../lib/advancePayments';
import { prepaidAccount } from '../lib/prepaidSchedule';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount } from './fixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';

const accounts = [
  makeChartAccount({ id: 'bank', code: '1000', name: 'Checking', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'ar', code: '1100', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' }),
  makeChartAccount({ id: 'ar2', code: '1110', name: 'Receivables – export', type: 'asset', category: 'Receivables' }),
  makeChartAccount({ id: 'pre', code: '1300', name: 'Prepaid Expenses', type: 'asset', category: 'Current Assets' }),
  makeChartAccount({ id: 'ap', code: '2000', name: 'Accounts Payable', type: 'liability', category: 'Payables' }),
  makeChartAccount({ id: 'dep', code: '2300', name: 'Customer Deposits', type: 'liability', category: 'Current Liabilities' }),
  makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'income', category: 'Revenue' }),
  makeChartAccount({ id: 'rent', code: '6000', name: 'Rent', type: 'expense', category: 'Operating Expenses' }),
  makeChartAccount({ id: 'ahead', code: '1310', name: 'Insurance paid ahead', type: 'asset', category: 'Current Assets' }),
];
const slot = (key: string) => DEFAULT_ACCOUNT_SLOTS.find(s => s.key === key)!;

describe('Which account each posting uses', () => {
  test('automatic follows the posting rules; a chosen one wins while it exists', () => {
    assert.deepEqual(DEFAULT_ACCOUNT_SLOTS.map(s => [s.key, s.automatic(accounts)?.id]), [
      ['ar', 'ar'], ['ap', 'ap'], ['revenue', 'sales'], ['expense', 'rent'], ['cash', 'bank'],
      ['tax payable', undefined], ['tax paid', undefined], ['customer deposits', 'dep'], ['vendor prepayments', 'pre'], ['prepaid expenses', 'pre'], ['deferred revenue', undefined],
      // CA-28: one per payment method, automatically the bank
      ['payment cash', 'bank'], ['payment check', 'bank'], ['payment bank_transfer', 'bank'], ['payment card', 'bank'], ['payment other', 'bank'],
    ]);
    assert.deepEqual(accountInUse(slot('ar'), accounts, { ar: 'ar2' }), { account: accounts[2], chosen: true });
    assert.deepEqual(accountInUse(slot('ar'), accounts, { ar: 'deleted' }), { account: accounts[1], chosen: false }, 'a chosen account that is gone falls back');
  });

  test('the keys are the ones the postings read', () => {
    assert.equal(advanceAccount(accounts, 'received', { 'customer deposits': 'ap' })?.id, 'ap');
    assert.equal(advanceAccount(accounts, 'made', { 'vendor prepayments': 'ar2' })?.id, 'ar2');
    assert.equal(prepaidAccount(accounts, { 'prepaid expenses': 'ahead' })?.id, 'ahead');
    assert.equal(prepaidAccount(accounts, { 'prepaid expenses': 'ar2' })?.id, 'pre', 'a receivables account is not taken as Prepaid');
  });

  test('setting one keeps the other mappings; clearing it goes back to automatic', () => {
    assert.deepEqual(withDefault({ Travel: 'rent', ar: 'ar' }, 'ar', 'ar2'), { Travel: 'rent', ar: 'ar2' });
    assert.deepEqual(withDefault({ Travel: 'rent', ar: 'ar' }, 'ar', ''), { Travel: 'rent' });
    assert.deepEqual(withDefault(undefined, 'cash', 'bank'), { cash: 'bank' });
  });
});

describe('The Defaults page', () => {
  let writes: { fn: string; body: Record<string, unknown> }[] = [];
  beforeEach(() => {
    writes = [];
    markComponentCollectionsLoaded('accounts');
    useLedgerStore.setState({ accounts });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const rpc = String(input).match(/\/rpc\/(lf_\w+)/);
      if (rpc) writes.push({ fn: rpc[1], body: JSON.parse(String(init?.body || '{}')) });
      return new Response(rpc ? 'null' : '[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  const withMappings = (mappings: Record<string, string>) => useAuthStore.setState(s => ({ workspaces: s.workspaces.map(w => ({ ...w, defaultAccountMappings: mappings })) }));

  test('shows what is used now, and choosing saves at once with the other mappings kept', async () => {
    setComponentWorkspace('accountant');
    withMappings({ Travel: 'rent' });
    render(<DefaultsSettings />);
    const ar = screen.getByLabelText('Accounts receivable') as HTMLSelectElement;
    assert.equal(ar.value, '');
    assert.equal(ar.options[0].textContent, 'Automatic (1100 – Accounts Receivable)');
    assert.equal((screen.getByLabelText('Sales tax payable') as HTMLSelectElement).options[0].textContent, 'Automatic (none found)');
    assert.equal(screen.getAllByText(/None in your chart yet/).length, 3, 'both tax rows and deferred revenue warn');
    await act(async () => { fireEvent.change(ar, { target: { value: 'ar2' } }); });
    await waitFor(() => assert.equal(writes.length, 1));
    const saved = JSON.stringify(writes[0].body);
    assert.match(saved, /"defaultAccountMappings":\{"Travel":"rent","ar":"ar2"\}/);
    assert.deepEqual(useAuthStore.getState().getCurrentWorkspace()?.defaultAccountMappings, { Travel: 'rent', ar: 'ar2' });
    assert.equal((screen.getByLabelText('Accounts receivable') as HTMLSelectElement).value, 'ar2');
  });

  test('a bookkeeper reads them without changing', () => {
    setComponentWorkspace('bookkeeper');
    withMappings({ cash: 'bank' });
    render(<DefaultsSettings />);
    assert.equal(screen.queryAllByRole('combobox').length, 0);
    assert.match(document.body.textContent || '', /Bank.*1000 – Checking/);
    assert.match(document.body.textContent || '', /1100 – Accounts Receivable \(automatic\)/);
  });
});
