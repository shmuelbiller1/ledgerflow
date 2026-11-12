/**
 * EU-E6: a page for one label value. By hand, Property = Maui house: invoice INV-1 (open, a line on Maui) and INV-2
 * (paid) — only INV-1 is open; bill B-1 open on Maui; entries on 2026-03-01 and 2026-04-01 with Maui, one on Aspen.
 * Profit this year is the server's Profit by Label column for Maui: 6,500.00.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { labelValueView } from '../lib/labelValuePage';
import LabelValuePageView from '../components/reporting/LabelValuePageView';
import { makeTransaction } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { formatCurrency } from '../lib/utils';
import type { Bill, Invoice } from '../types';

const maui = { property: 'maui' };
const entry = (id: string, date: string, dims: Record<string, string>) => makeTransaction({ id, workspaceId: 'component-workspace', date, status: 'completed', description: id, totalAmountCents: 1000,
  lines: [{ accountId: 'rent', amountCents: -1000, dimensions: dims }, { accountId: 'bank', amountCents: 1000 }] });
const invoices = [
  { id: 'i1', number: 'INV-1', status: 'sent', customerName: 'Tenant', amountCents: 250000, items: [{ description: 'Rent', dimensions: maui }] },
  { id: 'i2', number: 'INV-2', status: 'paid', customerName: 'Tenant', amountCents: 250000, items: [{ description: 'Rent', dimensions: maui }] },
] as unknown as Invoice[];
const bills = [{ id: 'b1', number: 'B-1', status: 'pending', vendorName: 'Roofer', amountCents: 80000, dimensions: maui }] as unknown as Bill[];
const transactions = [entry('march', '2026-03-01', maui), entry('april', '2026-04-01', maui), entry('aspen', '2026-04-02', { property: 'aspen' })];

const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; window.history.pushState({}, '', '/'); });

test('EU-E6: the open documents and last entries of Maui house, newest first', () => {
  const v = labelValueView({ label: 'property', value: 'maui', transactions, invoices, bills });
  assert.deepEqual([v.openInvoices.map(i => i.number), v.openBills.map(b => b.number), v.entries.map(e => e.id)], [['INV-1'], ['B-1'], ['april', 'march']]);
});

test('EU-E6: the page opens on the value in the address and shows the server profit for it', async () => {
  setComponentWorkspace('owner');
  markComponentCollectionsLoaded('invoices', 'bills', 'transactions');
  const ws = useAuthStore.getState().getCurrentWorkspace()!;
  useAuthStore.setState({ workspaces: [{ ...ws, dimensions: [{ id: 'property', name: 'Property' }] }] as never });
  useLedgerStore.setState({ transactions, invoices, bills, dimensionNodes: [{ id: 'aspen', dimensionId: 'property', description: 'Aspen cabin' }, { id: 'maui', dimensionId: 'property', description: 'Maui house' }] });
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => { asked.push(String(url)); return new Response(JSON.stringify({ columns: [{ value: 'aspen', netIncome: 100 }, { value: 'maui', netIncome: 650000 }] }), { status: 200 }); }) as typeof fetch;
  window.history.pushState({}, '', '/?report=label-value&label=property&value=maui#reports');
  render(<LabelValuePageView />);
  assert.ok(screen.getByRole('heading', { name: 'Maui house' }));
  await waitFor(() => assert.equal(screen.getByTestId('label-value-profit').textContent, formatCurrency(650000, ws.currency || 'USD')));
  assert.match(asked[0], /\/api\/v1\/reports\/by-label\?.*dimensionId=property/);
  assert.ok(screen.getByText(/Open invoices \(1\)/));
  assert.ok(screen.getByText(/Open bills \(1\)/));
});
