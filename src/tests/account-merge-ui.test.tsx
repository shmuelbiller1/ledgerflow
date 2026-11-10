/**
 * "Merge into…" on the chart of accounts (CA-33): owners and accountants pick the account to keep
 * (only accounts of the same kind are offered), see what would move, and merge; bookkeepers do not
 * get the action, and nor does an account LedgerFlow uses itself.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ChartOfAccountsView from '../components/ledger/ChartOfAccountsView';
import { describeChanges } from '../lib/accountMerge';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount } from './fixtures';

import { BRAND_NAME } from '../config/brand';
type Call = { url: string; body: Record<string, unknown> };
const accounts = [
  makeChartAccount({ id: 'office', code: '6100', name: 'Office', type: 'expense' }),
  makeChartAccount({ id: 'office2', code: '6101', name: 'Office 2', type: 'expense' }),
  makeChartAccount({ id: 'bank', code: '1000', name: 'Bank', type: 'asset' }),
  makeChartAccount({ id: 'ar', code: '1100', name: 'Receivable', type: 'asset', isSystem: true }),
];
const view = () => render(<ChartOfAccountsView accounts={accounts} searchTerm="" formatCurrency={c => String(c)} onDrillDown={() => {}} onDeleteAccount={() => {}} />);

describe('Merge into… on the chart of accounts', () => {
  let calls: Call[] = [];
  beforeEach(() => {
    calls = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : {} });
      const body = { status: 'success', from: 'Office 2', into: 'Office', changes: { transactions: 12, bills: 1, autoRules: 2 }, total: 15 };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  });
  afterEach(() => cleanup());

  test('an accountant picks the account to keep, sees what moves, and merges', async () => {
    setComponentWorkspace('accountant');
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Account options for Office 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Merge into…' }));
    const dialog = screen.getByRole('dialog');
    const select = within(dialog).getByLabelText('Account to keep') as HTMLSelectElement;
    assert.deepEqual([...select.options].map(o => o.textContent), ['Choose an account…', '6100 · Office'], 'only another expense account is offered');
    fireEvent.change(select, { target: { value: 'office' } });
    const status = await within(dialog).findByRole('status');
    assert.match(status.textContent || '', /^12 entries, 1 bill, 2 rules will use "Office" instead\./);
    assert.deepEqual(calls[0], { url: '/api/v1/workspaces/component-workspace/chart-accounts/merge/preview', body: { fromId: 'office2', intoId: 'office' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Merge' })); });
    await waitFor(() => assert.ok(calls.some(c => c.url.endsWith('/chart-accounts/merge'))));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  });

  test(`a bookkeeper has no merge, and an account ${BRAND_NAME} uses itself cannot be merged away`, () => {
    setComponentWorkspace('bookkeeper');
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Account options for Office 2' }));
    assert.equal(screen.queryByRole('button', { name: 'Merge into…' }), null);
    cleanup();
    setComponentWorkspace('owner');
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Account options for Receivable' }));
    assert.equal(screen.queryByRole('button', { name: 'Merge into…' }), null);
  });

  test('what moves, in words', () => {
    assert.equal(describeChanges({ transactions: 1, settings: 1, chartAccounts: 2 }), '1 entry, 1 workspace setting, 2 sub-accounts');
    assert.equal(describeChanges({}), 'nothing else');
  });
});
