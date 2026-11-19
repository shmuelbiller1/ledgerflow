import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InventoryTurnoverReportView from '../components/reporting/InventoryTurnoverReportView';
import InventoryDetailsReportView from '../components/reporting/InventoryDetailsReportView';
import ProjectProfitabilityView from '../components/ledger/ProjectProfitabilityView';
import TimeByProjectReportView from '../components/reporting/TimeByProjectReportView';
import { useAuthStore } from '../stores/useAuthStore';
import { makeTransaction } from './fixtures';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { isStockAge, isItemDetails, isReportTimeEntry } from '../lib/reportListRows';
import { getLocalDateISO } from '../lib/utils';
import { grossMarginByItemGroup, monthsBetween } from '../lib/grossMarginByGroup';
import { itemGroupMarginResponse } from '../lib/itemGroupMarginResponse';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });
const stock = { itemId: 'i', itemName: 'Valve', opening: { quantity: 1.25, valueCents: 750 }, closing: { quantity: 1.25, valueCents: 750 }, moves: [], received: 0, issued: 0 };
function deferredReads() {
  const reads: ((response: Response) => void)[] = [];
  globalThis.fetch = async () => new Promise<Response>(resolve => reads.push(resolve));
  const sent = (index: number) => waitFor(() => assert.ok(reads[index]));
  const reply = async (index: number, body: unknown, status = 200) => {
    await sent(index);
    await act(async () => reads[index](Response.json(body, { status })));
  };
  return { sent, reply };
}

test('returning to a stock period must refetch: old replies, refusal and missing arrays cannot unlock export or prove an empty period', async () => {
  setComponentWorkspace('viewer'); const { reply, sent } = deferredReads();
  render(<InventoryTurnoverReportView />);
  const csv = screen.getByRole<HTMLButtonElement>('button', { name: 'Export CSV' });
  const from = screen.getByLabelText<HTMLInputElement>('Period start'), original = from.value;
  assert.ok(csv.disabled); await reply(0, { items: [stock] }); assert.ok(!csv.disabled);
  fireEvent.change(from, { target: { value: '2001-01-01' } });
  await sent(1); // B actually reached fetch before returning to A.
  fireEvent.change(from, { target: { value: original } });
  assert.ok(csv.disabled); assert.equal(screen.queryByRole('table'), null);
  await reply(1, { items: [{ ...stock, itemName: 'Other period' }] });
  assert.equal(screen.queryByText('Other period'), null); assert.ok(csv.disabled);
  await reply(2, { error: 'Forbidden' }, 403);
  assert.match(screen.getByRole('alert').textContent!, /Forbidden/); assert.equal(screen.queryByText(/No item has/), null);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await reply(3, {});
  assert.match(screen.getByRole('alert').textContent!, /did not contain report rows/); assert.ok(csv.disabled);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await reply(4, { items: [] });
  assert.match(screen.getByRole('status').textContent!, /No item has/); assert.ok(csv.disabled);
});

test('an opening balance with no movements still has a closing balance, not an empty movement or a purchase', async () => {
  setComponentWorkspace('viewer'); globalThis.fetch = async () => Response.json({ items: [stock] });
  render(<InventoryDetailsReportView />); const table = await screen.findByRole('table', { name: 'Valve' });
  assert.deepEqual(Array.from(table.querySelectorAll('tbody tr, tfoot tr'), r => Array.from(r.children, c => c.textContent)), [
    ['Opening', '1.25', '$7.50'], ['Closing (in 0, out 0)', '1.25', '$7.50'],
  ]); assert.equal(screen.queryByText('Bought in the period'), null);
});

test('time export follows reader, workspace and server limit, never the previous role’s rows', async () => {
  const ws = setComponentWorkspace('accountant'), { reply } = deferredReads();
  const entry = { workspaceId: ws.id, date: getLocalDateISO(), minutes: 17, billable: true, status: 'submitted', person: 'Coworker' };
  render(<TimeByProjectReportView />); const csv = screen.getByRole<HTMLButtonElement>('button', { name: 'Export CSV' });
  await reply(0, { entries: [entry] }); assert.ok(screen.getByRole('rowheader', { name: 'Coworker' }));
  await act(async () => useAuthStore.setState({ workspaces: [{ ...ws, roles: { 'test-user': 'viewer' } }] }));
  assert.equal(screen.queryByText('Coworker'), null); assert.ok(csv.disabled);
  const own = { ...entry, person: 'test-user' }, otherBook = { ...own, workspaceId: 'other', minutes: 100 };
  await reply(1, { entries: [entry, own, otherBook] });
  assert.equal(screen.queryByText('Coworker'), null); assert.match(screen.getByRole('table').textContent!, /0:17 h/); assert.ok(!csv.disabled);
  await act(async () => useAuthStore.setState({ workspaces: [ws] })); assert.ok(csv.disabled);
  await reply(2, { entries: Array.from({ length: 5000 }, () => own) });
  assert.ok(csv.disabled); assert.match(screen.getByRole('alert').textContent!, /5,000/);
  fireEvent.click(await screen.findByRole('button', { name: 'Columns' })); assert.equal(screen.queryByText('Export displayed rows CSV'), null);
});

test('project filters apply to matching line amounts; top 10 is a chart limit, not a ledger limit', () => {
  setComponentWorkspace('viewer'); globalThis.ResizeObserver = window.ResizeObserver;
  const tx = (project: string, income: number, expense: number) => makeTransaction({ projectId: project, lines: [
    { accountId: 'rev', category: 'Revenue', amountCents: -income }, { accountId: 'ex', accountName: 'Expense', amountCents: expense },
  ] });
  const entries = [tx('Over', 10000, 5999), tx('Exactly', 10000, 6000), tx('__proto__', 0, 7),
    ...Array.from({ length: 8 }, (_, i) => tx(`Other ${i}`, 100, 95)), { ...tx('Draft', 10000, 0), status: 'draft' as const }];
  render(<ProjectProfitabilityView transactions={entries} formatCurrency={String} />);
  const matrix = screen.getByRole('table', { name: 'Results by project' }); assert.equal(within(matrix).getAllByRole('rowheader').length, 11);
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  const chart = screen.getByRole('table', { name: 'Project income, expenses and margin data' });
  assert.equal(within(chart).getAllByRole('rowheader').length, 10); fireEvent.click(screen.getByRole('button', { name: 'Chart all 11 projects' }));
  assert.equal(within(chart).getAllByRole('rowheader').length, 11); assert.equal(screen.queryByText('Draft'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Margin over 40%' })); assert.deepEqual(within(matrix).getAllByRole('rowheader').map(c => c.textContent), ['Over']);
  fireEvent.click(screen.getByRole('button', { name: 'Loss' })); assert.deepEqual(within(matrix).getAllByRole('cell').map(c => c.textContent), ['2', '0', '7', '-7', '0%']);
});

test('a full-year CSV needs every month in order, safe amounts and the selected book, including for an empty result', () => {
  const months = monthsBetween('2026-01', '2026-12');
  const empty = grossMarginByItemGroup({ invoices: [], transactions: [], accounts: [], items: [], months });
  assert.deepEqual(itemGroupMarginResponse(empty, 'w', months), empty);
  const row = { group: 'Parts', months: empty.totals, salesCents: 0, costCents: 0, marginCents: 0, marginPct: null, costIsEstimate: false };
  const full = { ...empty, rows: [row] };
  for (const bad of [{ ...full, workspaceId: 'other' }, { ...full, months: months.slice(1) }, { ...full, totals: empty.totals.slice(1) },
    { ...full, rows: [row, row] }, { ...full, rows: [{ ...row, salesCents: 1.5 }] }, { ...full, rows: [{ ...row, months: [...row.months].reverse() }] },
    { ...full, provenance: { source: 'server', completeness: 'partial' } }]) assert.equal(itemGroupMarginResponse(bad, 'w', months), null);
  assert.deepEqual(itemGroupMarginResponse({ ...full, provenance: { source: 'server', completeness: 'complete' } }, 'w', months), full);
});


test('the rows used in a report must actually contain its balances, buckets or time', () => {
  assert.ok(isItemDetails(stock));
  assert.equal(isItemDetails({ ...stock, closing: {} }), false);
  assert.equal(isItemDetails({ ...stock, moves: [null] }), false);
  assert.equal(isStockAge({ ...stock, quantity: 3, valueCents: 750 }), false);
  assert.equal(isReportTimeEntry({ person: 'Avi', date: '2026-02-28', minutes: 30 }), false);
});
