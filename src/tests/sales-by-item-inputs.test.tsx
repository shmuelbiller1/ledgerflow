import { stubFetch } from './helpers/dom';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SalesByItem from '../components/reporting/SalesByItemReportView';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { computeSalesByItem } from '../server/reports/itemReports';
import { setComponentWorkspace } from './helpers/componentFixtures';

const needs = () => useDataNeedsStore.getState();
const keys = ['invoices', 'inventory', 'accounts', 'transactions'] as const;
const empty = 'No invoice lines found for the selected period.';

describe('Sales by Item: unknown is not zero', () => {
  beforeEach(() => {
    const ws = setComponentWorkspace();
    needs().resetLoaded(ws.id);
    for (const key of keys) needs().markLoaded(key);
    useLedgerStore.setState({ transactions: [], accounts: [], invoices: [], inventory: [], truncatedCollections: {}, isDataTruncated: false });
    stubFetch(503);
  });
  afterEach(cleanup);

  for (const key of keys) it(`waits for ${key}, explains its failure, retries the read, and only then shows a true empty period`, () => {
    useDataNeedsStore.setState({ loaded: { ...needs().loaded, [key]: false } });
    render(<SalesByItem selectedYear={2026} />);
    const notFinal = () => {
      assert.ok(!screen.queryByText(empty), 'unknown period presented as empty');
      assert.doesNotMatch(document.body.textContent || '', /\$0\.00/, 'unknown total presented as zero');
    };
    notFinal();
    assert.ok(screen.getByText('Loading report records…'));
    act(() => needs().markFailed(key, 'Read unavailable'));
    notFinal();
    assert.match(document.body.textContent || '', /Read unavailable/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    assert.equal(needs().loaded[key], false);
    assert.equal(needs().failed[key], undefined);
    notFinal();
    act(() => needs().markLoaded(key));
    assert.ok(screen.getByText(empty));
    assert.match(document.body.textContent || '', /\$0\.00/);
  });

  it('does not present the previous workspace’s loaded flags or failures', () => {
    render(<SalesByItem selectedYear={2026} />);
    assert.ok(screen.getByText(empty));
    act(() => { needs().markFailed(keys[0], 'Book A failure'); useAuthStore.setState({ currentWorkspaceId: 'book-b' }); });
    assert.ok(screen.getByText('Loading report records…'));
    assert.doesNotMatch(document.body.textContent || '', /Book A failure|\$0\.00/);
  });

  it('does not claim a capped, empty local fallback is an empty period', async () => {
    // chartAccounts is the cap key for the chart that identifies posted costs.
    useLedgerStore.setState({ truncatedCollections: { chartAccounts: true } });
    const requests = stubFetch(503);
    render(<SalesByItem selectedYear={2026} />);
    await waitFor(() => assert.ok(requests.some(url => url.includes('/balances/'))));
    assert.ok(!screen.queryByText(empty), 'partial period presented as empty');
    assert.match(document.body.textContent || '', /incomplete/i);
    assert.doesNotMatch(document.body.textContent || '', /\$0\.00/);
  });

  it('waits for a fresh full-period retry and accepts a real server zero even if the invoice subscription failed', async () => {
    useLedgerStore.setState({ truncatedCollections: { invoices: true } });
    needs().markFailed('invoices', 'Read unavailable');
    render(<SalesByItem selectedYear={2026} />);
    const retry = await screen.findByRole('button', { name: 'Retry full report' });
    assert.ok(!screen.queryByText(empty));
    let finish!: (response: Response) => void;
    const response = new Promise<Response>(resolve => { finish = resolve; });
    globalThis.fetch = async () => response;
    fireEvent.click(retry);
    assert.ok(screen.getByText('Loading report records…'));
    assert.ok(!screen.queryByText(empty));
    finish(Response.json(computeSalesByItem({ invoices: [], accounts: [], transactions: [], items: [] })));
    assert.ok(await screen.findByText(empty));
    assert.match(screen.getByTestId('sales-by-item-source').textContent || '', /read from the server/);
    assert.ok(!screen.queryByRole('button', { name: /retry|try again/i }));
  });

  it('discards a late full answer after switching books and does not reuse it on returning', async () => {
    useLedgerStore.setState({ truncatedCollections: { invoices: true } });
    const responses: ((res: Response) => void)[] = [];
    globalThis.fetch = () => new Promise<Response>(resolve => responses.push(resolve));
    render(<SalesByItem selectedYear={2026} />);
    await waitFor(() => assert.equal(responses.length, 1));
    act(() => useAuthStore.setState({ currentWorkspaceId: 'book-b' }));
    await act(async () => { responses[0](Response.json(computeSalesByItem({ invoices: [], accounts: [], transactions: [], items: [] }))); });
    assert.ok(!screen.queryByText(empty));
    act(() => useAuthStore.setState({ currentWorkspaceId: 'component-workspace' }));
    await waitFor(() => assert.equal(responses.length, 2));
    assert.ok(!screen.queryByTestId('sales-by-item-source'));
    assert.ok(!screen.queryByText(empty));
    await act(async () => { responses[1](new Response(null, { status: 503 })); });
    assert.ok(screen.getByRole('button', { name: 'Retry full report' }));
  });

  it('does not make guest sample books wait for database subscriptions', () => {
    useAuthStore.setState({ user: null, isGuest: true });
    needs().resetLoaded();
    const requests = stubFetch(500);
    render(<SalesByItem selectedYear={2026} />);
    assert.ok(screen.getByText(empty));
    assert.deepEqual(requests, []);
  });
});
