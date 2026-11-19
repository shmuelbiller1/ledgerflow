import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PURCHASE_ITEM_CSV_HEADERS, purchaseItemCsvRows, purchaseItemTrends, purchaseTrendStart } from '../lib/purchaseItemTrends';
import { toCsv } from '../lib/csvExport';
import PurchaseItemTrendsView from '../components/reporting/PurchaseItemTrendsView';
import { PurchaseTrendsView } from '../components/reporting/DocumentTrendsView';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { Bill, InventoryItem } from '../types';

const realFetch = globalThis.fetch;
const item = (id: string, name = 'כיסא') => ({ id, uid: 'test-user', workspaceId: 'component-workspace', name, sku: id, unitPriceCents: 0, unitCostCents: 0, quantityAtHand: 0, reorderPoint: 0, createdAt: '2026-01-01' }) as InventoryItem;
const bill = (id: string, date: string, extra: Partial<Bill> = {}) => ({
  id, uid: 'test-user', workspaceId: 'component-workspace', vendorId: 'v', vendorName: 'ספק', number: id, amountCents: 2000,
  date, dueDate: date, status: 'approved', splits: [{ accountId: 'inventory', itemId: 'chair', quantity: 2, amountCents: 2000 }], ...extra,
}) as Bill;
const items = [item('chair'), item('other')];
const bills = [
  bill('start', '2025-04-01'), bill('old', '2025-03-31'),
  bill('end', '2026-03-31', { splits: [
    { accountId: 'inventory', itemId: 'chair', quantity: 0.25, amountCents: 500 },
    { accountId: 'inventory', itemId: 'chair', quantity: 0.75, amountCents: 1500 },
    { accountId: 'freight', amountCents: 125, landedCost: true },
    { accountId: 'expense', amountCents: 50 },
  ] }),
  bill('eur', '2026-03-01', { currency: 'EUR', exchangeRate: 2, splits: [{ accountId: 'inventory', itemId: 'chair', quantity: 1, amountCents: 3000 }] }),
  bill('same-name', '2026-03-02', { splits: [{ accountId: 'inventory', itemId: 'other', quantity: 3, amountCents: 4000 }] }),
  bill('future', '2026-04-01'), bill('draft', '2026-03-01', { status: 'draft' }), bill('void', '2026-03-01', { status: 'void' }),
  bill('rejected', '2026-03-01', { status: 'rejected' }), bill('cancelled', '2026-03-01', { status: 'cancelled' }),
  bill('opening', '2026-03-01', { metadata: { type: 'opening-balance' } }), bill('undated', ''),
];
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function setup() {
  setComponentWorkspace();
  useLedgerStore.setState({ inventory: items, bills, vendors: [], customers: [], invoices: [], transactions: [], accounts: [], truncatedCollections: {} });
  markComponentCollectionsLoaded('inventory', 'bills', 'vendors', 'customers', 'invoices', 'transactions', 'accounts');
}
afterEach(async () => {
  cleanup(); globalThis.fetch = realFetch;
  getSupabase().realtime.disconnect(); await getSupabase().auth.dispose();
});

test('item trends use twelve calendar months, sum recorded lines, preserve Hebrew identity and keep currencies apart', () => {
  assert.equal(purchaseTrendStart('2026-03-31'), '2025-04-01');
  const rows = purchaseItemTrends(items, bills, '2026-03-31');
  assert.deepEqual(rows.map(row => [row.month, row.itemId, row.currency, row.quantity, row.cents, row.lines]), [
    ['2025-04', 'chair', 'USD', 2, 2000, 1],
    ['2026-03', 'chair', 'EUR', 1, 3000, 1],
    ['2026-03', 'chair', 'USD', 1, 2000, 2],
    ['2026-03', 'other', 'USD', 3, 4000, 1],
  ]);
  assert.deepEqual(rows.map(row => row.name), ['כיסא', 'כיסא', 'כיסא', 'כיסא']);
  assert.equal(new Set(rows.map(row => row.id)).size, 4);
  assert.deepEqual(rows.filter(row => row.currency === 'USD').map(row => row.cents).reduce((sum, cents) => sum + cents, 0), 8000);
  assert.equal(rows.find(row => row.currency === 'EUR')?.cents, 3000, 'no invented FX conversion or freight/tax allocation');
});

test('partial final months, issue-date fallback, missing item names and six-decimal quantities', () => {
  const docs = [
    bill('included', '2024-02-29', { splits: [{ accountId: 'inventory', itemId: 'missing', quantity: 0.123456, amountCents: 1, description: 'ספר / book' }] }),
    bill('later', '2024-03-01'),
    bill('issue-date', '', { issueDate: '2024-02-28', splits: [{ accountId: 'inventory', itemId: 'missing', quantity: 0.000001, amountCents: 2 }] }),
  ];
  const rows = purchaseItemTrends([], docs, '2024-02-29', 'ILS');
  assert.equal(rows.length, 1); assert.equal(rows[0].quantity, 0.123457); assert.equal(rows[0].cents, 3);
  assert.equal(rows[0].name, 'ספר / book'); assert.equal(rows[0].currency, 'ILS');
  for (const end of ['', '2026-02-30', '2026-13-01', 'broken']) assert.throws(() => purchaseItemTrends(items, bills, end), /valid report end/);
});

test('CSV has explicit currency and minor units, preserves Hebrew and escapes spreadsheet directives', () => {
  const rows = purchaseItemTrends([item('chair', '=SUM(1,2) שלום')], [bill('b', '2026-03-01')], '2026-03-31').map(row => ({ ...row, period: 'Current' }));
  assert.deepEqual(purchaseItemCsvRows(rows), [['Current', '2026-03', 'chair', '=SUM(1,2) שלום', 'USD', 2, 2000, 1]]);
  const csv = toCsv(PURCHASE_ITEM_CSV_HEADERS, purchaseItemCsvRows(rows));
  assert.match(csv, /Line amount \(minor units\)/); assert.match(csv, /שלום/); assert.match(csv, /'=SUM\(1,2\)/);
});

test('vendor report keeps its existing calculation and switches to an accessible item report', () => {
  setup();
  render(<PurchaseTrendsView endDate="2026-03-31" />);
  assert.ok(screen.getByRole('region', { name: 'Purchase trends by vendor' }));
  fireEvent.change(screen.getByLabelText('Group purchases by'), { target: { value: 'item' } });
  assert.ok(screen.getByRole('region', { name: 'Purchase trends by item' }));
  assert.equal(screen.queryByRole('region', { name: 'Purchase trends by vendor' }), null);
  assert.ok(screen.getByRole('columnheader', { name: 'Units' }));
  assert.ok(screen.getByRole('columnheader', { name: 'Currency' }));
  assert.ok(screen.getByRole('button', { name: 'Export item trends CSV' }));
  assert.match(screen.getByRole('status').textContent || '', /Provisional/);
});

test('full-history refresh is workspace-scoped, paginates and supersedes the capped cache', async () => {
  setup();
  useLedgerStore.setState({ bills: [], inventory: [], truncatedCollections: { bills: true } });
  const requested: Array<{ table: string; query: URLSearchParams }> = [];
  // Exactly a page of 1000 records requires a second read. The next page adds another bill.
  const firstPage = Array.from({ length: 1000 }, (_, number) => ({ id: `bill-${number}`, data: bill(`bill-${number}`, '2026-03-01') }));
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    const table = url.pathname.split('/').at(-1)!;
    requested.push({ table, query: url.searchParams });
    const rangeStart = new Headers(init?.headers).get('range')?.split('-')[0] || url.searchParams.get('offset') || '0';
    if (table === 'bills') return response(rangeStart === '0' ? firstPage : rangeStart === '1000' ? [{ id: 'last', data: bill('last', '2026-03-02') }] : []);
    if (table === 'inventory') return response(items.map(row => ({ id: row.id, data: row })));
    return response([]);
  }) as typeof fetch;
  render(<PurchaseItemTrendsView endDate="2026-03-31" />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load / refresh full history' })); });
  await waitFor(() => assert.match(screen.getByRole('status').textContent || '', /Full bill and item history loaded/));
  const body = screen.getByRole('table').querySelector('tbody')!;
  assert.match(body.textContent || '', /2002/);
  assert.match(body.textContent || '', /1001/);
  assert.deepEqual(requested.filter(row => row.table === 'bills').map(row => row.query.get('offset') || '0'), ['0', '1000', '2000', '3000', '4000']);
  for (const read of requested) assert.match(read.query.toString(), /component-workspace/);
  assert.equal(useLedgerStore.getState().bills.length, 0, 'full history is isolated from the capped application cache');
});

test('failed history read is explicit and retry retains separate comparison windows', async () => {
  setup();
  let refuse = true;
  globalThis.fetch = (async input => {
    const url = String(input);
    if (refuse) return response({ code: '42501', message: 'Read denied' }, 403);
    return response(url.includes('/bills?') ? bills.map(row => ({ id: row.id, data: row })) : items.map(row => ({ id: row.id, data: row })));
  }) as typeof fetch;
  render(<PurchaseItemTrendsView endDate="2026-03-31" compareEndDate="2025-04-30" />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load / refresh full history' })); });
  await waitFor(() => assert.match(screen.getByRole('alert').textContent || '', /Could not refresh complete bill history/));
  assert.match(screen.getByRole('status').textContent || '', /Provisional/);
  assert.ok(screen.getByRole('columnheader', { name: 'Window' }));
  assert.equal(within(screen.getByRole('table')).getAllByText('Previous').length, 2);
  refuse = false;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load / refresh full history' })); });
  assert.equal(screen.queryByRole('alert'), null);
  assert.match(screen.getByRole('status').textContent || '', /Full bill and item history loaded/);
});

test('obsolete full-history response cannot populate another workspace and old rows disappear', async () => {
  setup();
  const releases: Array<(value: Response) => void> = [];
  globalThis.fetch = (async () => new Promise<Response>(resolve => { releases.push(resolve); })) as typeof fetch;
  render(<PurchaseItemTrendsView endDate="2026-03-31" />);
  fireEvent.click(screen.getByRole('button', { name: 'Load / refresh full history' }));
  await waitFor(() => assert.equal(releases.length, 2));
  const workspace = useAuthStore.getState().getCurrentWorkspace()!;
  await act(async () => { useAuthStore.setState({ currentWorkspaceId: 'new', workspaces: [{ ...workspace, id: 'new' }] }); });
  await act(async () => { releases[0](response([{ id: 'old', data: bill('old', '2026-03-01') }])); releases[1](response(items.map(row => ({ id: row.id, data: row })))); });
  assert.match(screen.getByRole('status').textContent || '', /Provisional/);
  assert.equal(screen.queryByText('כיסא'), null);
  assert.ok(screen.getByRole('button', { name: 'Load / refresh full history' }));
});

test('guest mode never requests authenticated history and invalid report dates disable CSV', () => {
  setup(); useAuthStore.setState({ isGuest: true });
  render(<PurchaseItemTrendsView endDate="invalid" />);
  assert.equal(screen.queryByRole('button', { name: 'Load / refresh full history' }), null);
  assert.match(screen.getByRole('status').textContent || '', /Guest sample/);
  assert.equal((screen.getByRole('button', { name: 'Export item trends CSV' }) as HTMLButtonElement).disabled, true);
  assert.match(screen.getByRole('alert').textContent || '', /valid report end date/);
});

test('a failed refresh keeps the last good item rows but closes both CSV routes until retry succeeds', async () => {
  setup();
  const answer = (input: RequestInfo | URL) => response(String(input).includes('/bills?')
    ? [{ id: 'full', data: bill('full', '2026-03-05', { splits: [{ itemId: 'chair', quantity: 1, accountId: 'stock', amountCents: 3765 }] }) }]
    : items.map(row => ({ id: row.id, data: row })));
  globalThis.fetch = async input => answer(input);
  render(<PurchaseItemTrendsView endDate="2026-03-31" />);
  const load = () => fireEvent.click(screen.getByRole('button', { name: 'Load / refresh full history' }));
  const csv = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Export item trends CSV' });
  const displayed = () => screen.queryByRole('button', { name: 'Export displayed rows CSV' });
  fireEvent.click(await screen.findByRole('button', { name: 'Columns' }));
  assert.equal(csv().disabled, true); assert.equal(displayed(), null);
  await act(async () => { load(); });
  assert.ok(screen.getByText('$37.65')); assert.equal(csv().disabled, false); assert.ok(displayed());
  const requests: Array<(r: Response) => void> = [];
  globalThis.fetch = async () => new Promise(resolve => requests.push(resolve));
  load(); await waitFor(() => assert.equal(requests.length, 2));
  assert.equal(csv().disabled, true); assert.equal(displayed(), null);
  await act(async () => { requests[0](response([], 403)); requests[1](response([])); });
  assert.match(screen.getByRole('alert').textContent || '', /last successful history remains displayed/);
  assert.ok(screen.getByText('$37.65')); assert.equal(csv().disabled, true); assert.equal(displayed(), null);
  globalThis.fetch = async input => answer(input);
  await act(async () => { load(); });
  assert.equal(screen.queryByRole('alert'), null); assert.equal(csv().disabled, false); assert.ok(displayed());
});

test('an unknown guest cap, failed inventory, and an unmatched period are not empty books', async () => {
  setup(); useAuthStore.setState({ isGuest: true, user: null });
  useLedgerStore.setState({ bills: [], isDataTruncated: true, truncatedCollections: {} });
  render(<PurchaseItemTrendsView endDate="2026-03-31" />);
  const empty = () => screen.queryByRole('button', { name: 'Open Purchases' });
  assert.equal(empty(), null); assert.match(screen.getByRole('status').textContent || '', /missing/);
  await act(async () => { useDataNeedsStore.setState({ failed: { inventory: 'Unavailable' } }); useLedgerStore.setState({ isDataTruncated: false }); });
  assert.equal(empty(), null); assert.match(screen.getByRole('status').textContent || '', /missing/);
  await act(async () => { useDataNeedsStore.setState({ failed: {} }); useLedgerStore.setState({ bills: [bill('old', '2020-04-01')] }); });
  assert.ok(screen.getByText('No included item purchases in the current twelve-month window.')); assert.equal(empty(), null);
  await act(async () => useLedgerStore.setState({ bills: [] }));
  assert.ok(empty()); assert.equal(screen.getAllByRole('button').length, 1); assert.equal(screen.queryByRole('table'), null);
});
