/**
 * EU-E4: the General Ledger takes the same label filter as the P&L. By hand: Tel Aviv sells 300.00 and pays 100.00
 * rent; Haifa sells 200.00. Location = Tel Aviv leaves Sales with one 300.00 line and Rent with 100.00; Haifa's
 * 200.00 is gone. When entries are left out of this browser (capped), the filter is not offered at all.
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import GeneralLedgerView from '../components/ledger/GeneralLedgerView';
import { scopeTransactionsToLabel } from '../lib/reportLabelScope';
import { getSupabase } from '../lib/db/client';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeChartAccount, makeTransaction } from './fixtures';

const chart = [
  makeChartAccount({ id: 'cash', code: '1000', name: 'Cash', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'income', category: 'Revenue' }),
  makeChartAccount({ id: 'rent', code: '6100', name: 'Rent', type: 'expense', category: 'Operating' }),
];
const ledger = [
  makeTransaction({ id: 't1', date: '2026-03-02', status: 'completed', posted: true, description: 'TA sale',
    lines: [{ accountId: 'cash', amountCents: 30000, dimensions: { location: 'Tel Aviv' } }, { accountId: 'sales', amountCents: -30000, dimensions: { location: 'Tel Aviv' } }] }),
  makeTransaction({ id: 't2', date: '2026-03-03', status: 'completed', posted: true, description: 'Haifa sale',
    lines: [{ accountId: 'cash', amountCents: 20000, dimensions: { location: 'Haifa' } }, { accountId: 'sales', amountCents: -20000, dimensions: { location: 'Haifa' } }] }),
  makeTransaction({ id: 't3', date: '2026-03-04', status: 'completed', posted: true, description: 'TA rent',
    lines: [{ accountId: 'rent', amountCents: 10000, dimensions: { location: 'Tel Aviv' } }, { accountId: 'cash', amountCents: -10000, dimensions: { location: 'Tel Aviv' } }] }),
];

beforeEach(() => {
  stubFetch(404);
  useAuthStore.setState({ user: null, currentWorkspaceId: null, workspaces: [] });
  useLedgerStore.setState({ transactions: ledger, accounts: chart, journalEntries: [], isDataTruncated: false, truncatedCollections: {} });
});
afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });

test('EU-E4: scoping keeps only the lines carrying the value (any case); entries without one drop out', () => {
  const scoped = scopeTransactionsToLabel(ledger, { dimensionId: 'location', value: 'tel aviv' });
  assert.deepEqual(scoped.map(t => t.id), ['t1', 't3']);
  assert.deepEqual(scopeTransactionsToLabel(ledger, null).map(t => t.id), ['t1', 't2', 't3']);
});

test('EU-E4: General Ledger narrowed to Location = Tel Aviv', async () => {
  const view = render(<GeneralLedgerView startDate="2026-03-01" endDate="2026-03-31" />);
  await waitFor(() => assert.ok(view.queryAllByText('Haifa sale').length > 0));
  fireEvent.change(view.getByLabelText('Label kind'), { target: { value: 'location' } });
  fireEvent.change(view.getByLabelText('Label value'), { target: { value: 'Tel Aviv' } });
  await waitFor(() => assert.equal(view.queryAllByText('Haifa sale').length, 0));
  assert.ok(view.queryAllByText('TA sale').length > 0 && view.queryAllByText('TA rent').length > 0);
});

test('EU-E4: not offered when entries are left out of this browser', () => {
  useLedgerStore.setState({ truncatedCollections: { transactions: true } });
  const view = render(<GeneralLedgerView startDate="2026-03-01" endDate="2026-03-31" />);
  assert.equal(view.queryByLabelText('Label kind'), null);
});
