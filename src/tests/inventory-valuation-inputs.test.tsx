import { stubFetch } from './helpers/dom';
import { afterEach, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Valuation from '../components/reporting/InventoryValuationReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { makeChartAccount } from './fixtures';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { stock } from './helpers/l123SalesLedger';

const needs = () => useDataNeedsStore.getState();
const noComparison = () => assert.doesNotMatch(document.body.textContent || '', /stock list and the Inventory account agree|stock list is \$[\d,.]+ (more|less)/i);
beforeEach(() => {
  const ws = setComponentWorkspace();
  needs().resetLoaded(ws.id);
  for (const key of ['accounts', 'transactions', 'inventory'] as const) needs().markLoaded(key);
  useLedgerStore.setState({ inventory: [{ ...stock(ws.id)[0], quantityAtHand: 10, unitCostCents: 1000 }],
    accounts: [makeChartAccount({ id: 'inv', name: 'Inventory', type: 'asset', category: 'Inventory', openingBalanceCents: 10000 })],
    transactions: [], truncatedCollections: {}, isDataTruncated: false });
  stubFetch(503);
});
afterEach(cleanup);

for (const key of ['accounts', 'transactions'] as const) it(`available $100 stock, unavailable ${key}: no claim that the books agree or disagree`, async () => {
  needs().markFailed(key, 'Read unavailable'); // A live read can fail after a good snapshot.
  await act(async () => { render(<Valuation />); });
  noComparison();
  assert.ok(screen.getByText('Widget'));
  assert.ok(!screen.queryByText('Inventory account in the books'));
  assert.ok(screen.getByText(/Read unavailable/));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  noComparison();
  act(() => needs().markLoaded(key));
  assert.ok(screen.getByText('The stock list and the Inventory account agree.'));
});

it('a chart-only cap cannot certify reconciliation, even when the visible amounts match', async () => {
  useLedgerStore.setState({ truncatedCollections: { chartAccounts: true } });
  await act(async () => { render(<Valuation />); });
  noComparison();
  assert.match(document.body.textContent || '', /account list is capped/i);
});

it('does not treat an unread, failed, other-workspace or capped empty inventory as a genuinely empty stock list', async () => {
  useLedgerStore.setState({ inventory: [] });
  const ws = useAuthStore.getState().currentWorkspaceId;
  useDataNeedsStore.setState({ loaded: { accounts: true, transactions: true } });
  await act(async () => { render(<Valuation />); });
  const absent = () => assert.ok(!screen.queryByText('No items yet. Add them in Inventory.'));
  absent();
  act(() => needs().markFailed('inventory', 'No item snapshot'));
  absent();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  absent();
  act(() => needs().markLoaded('inventory'));
  assert.ok(screen.getByText('No items yet. Add them in Inventory.'));
  act(() => useAuthStore.setState({ currentWorkspaceId: 'other' }));
  absent();
  act(() => { useAuthStore.setState({ currentWorkspaceId: ws }); useLedgerStore.setState({ truncatedCollections: { inventory: true } }); });
  absent();
  assert.match(document.body.textContent || '', /incomplete|capped/i);
});

it('does not export an unlabelled subset when items are capped', async () => {
  const { toast } = await import('sonner');
  const original = toast.error;
  const messages: unknown[] = [];
  const error = ((message: unknown) => { messages.push(message); return 'refusal'; }) as typeof toast.error;
  const file = URL.createObjectURL;
  let downloads = 0;
  try {
    toast.error = error;
    URL.createObjectURL = () => { downloads++; return 'blob:fixture'; };
    useLedgerStore.setState({ truncatedCollections: { inventory: true } });
    await act(async () => { render(<Valuation />); });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    assert.equal(downloads, 0);
    assert.deepEqual(messages, ['CSV is unavailable because the full item list is not loaded.']);
  } finally { toast.error = original; URL.createObjectURL = file; }
});

it('a malformed historical read is not an authoritative empty stock history', async () => {
  stubFetch(200, {});
  await act(async () => { render(<Valuation asOfDate="2020-01-31" />); });
  assert.match(screen.getByRole('alert').textContent || '', /not available/);
  noComparison();
});
