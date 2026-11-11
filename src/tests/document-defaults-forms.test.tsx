import './helpers/dom';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { stubFetchWithBodies } from './helpers/dom';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { makeChartAccount, makeCustomer, makeVendor } from './fixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import InvoiceModal from '../components/sales/InvoiceModal';
import BillModal from '../components/purchases/BillModal';
import PartyModal, { type PartyFields } from '../components/common/PartyModal';
import InventoryItemDialog from '../components/inventory/InventoryItemDialog';
import type { InventoryItem } from '../types';

const accounts = [makeChartAccount({ id: 'rev', name: 'Sales', type: 'income' }), makeChartAccount({ id: 'exp', name: 'Supplies', type: 'expense' }), makeChartAccount({ id: 'alt', name: 'Other', type: 'income' })];
const customers = [makeCustomer({ id: 'c', name: 'Client', metadata: { documentDefaults: { accountId: 'rev', taxCodeId: 'gst', dimensions: { project: 'P1' } } } })];
const vendors = [makeVendor({ id: 'v', name: 'Vendor', metadata: { documentDefaults: { accountId: 'exp', taxCodeId: 'gst', dimensions: { project: 'P1' } } } })];
const item = { id: 'i', uid: 'u', workspaceId: 'component-workspace', sku: 'SVC', reorderPoint: 0, createdAt: '', name: 'Service', itemType: 'service', unitPriceCents: 500, unitCostCents: 250, quantityAtHand: 0, defaultTaxCodeId: 'gst', metadata: { documentDefaults: { accountId: 'rev', dimensions: { project: 'P1' } } } } as InventoryItem;
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
beforeEach(() => {
  stubFetchWithBodies(200, {});
  const ws = setComponentWorkspace('owner');
  ws.dimensions = [{ id: 'project', name: 'Project' }];
  useAuthStore.setState({ workspaces: [ws] });
  markComponentCollectionsLoaded('inventory', 'invoices', 'bills', 'accounts', 'taxRates');
  useLedgerStore.setState({ accounts, inventory: [item], bills: [], invoices: [], dimensionNodes: [{ id: 'P1', dimensionId: 'project', description: 'House' }], taxRates: [{ id: 'gst', uid: 'u', workspaceId: ws.id, type: 'Sales', name: 'GST', rate: 10, createdAt: '' }] });
});
afterEach(() => cleanup());
const invoice = () => render(<InvoiceModal isOpen onClose={() => {}} onSave={() => {}} customers={customers} accounts={accounts} />);

test('party defaults fill empty invoice fields and new lines; preserve typed and explicitly cleared fields', () => {
  invoice();
  change('Customer', 'Client');
  assert.equal((screen.getByLabelText('Income Account') as HTMLInputElement).value, 'Sales');
  assert.equal((screen.getByLabelText('Tax') as HTMLSelectElement).value, 'gst');
  fireEvent.click(screen.getByRole('button', { name: /Labels for line 1/ }));
  assert.equal((screen.getByLabelText('Project for line 1') as HTMLInputElement).value, 'P1');
  change('Project for line 1', 'Typed'); change('Income Account', 'Other'); change('Tax', '');
  change('Item / Description', 'Service');
  assert.equal((screen.getByLabelText('Income Account') as HTMLInputElement).value, 'Other');
  assert.equal((screen.getByLabelText('Project for line 1') as HTMLInputElement).value, 'Typed');
  assert.equal((screen.getByLabelText('Tax') as HTMLSelectElement).value, '', 'explicit No tax wins');
  change('Project for line 1', ''); change('Income Account', '');
  change('Item / Description', 'Not an item'); change('Item / Description', 'Service');
  change('Customer', 'Client');
  assert.equal((screen.getByLabelText('Income Account') as HTMLInputElement).value, '');
  assert.equal((screen.getByLabelText('Project for line 1') as HTMLInputElement).value, '');
  fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));
  assert.equal((screen.getAllByLabelText('Income Account')[1] as HTMLInputElement).value, 'Sales');
});
test('existing invoice party selection does not introduce defaults or change its tax', () => {
  render(<InvoiceModal isOpen onClose={() => {}} onSave={() => {}} customers={customers} accounts={accounts} initialInvoice={{ id: 'saved', customerId: 'c', customerName: 'Client', items: [{ id: 'l', description: 'Original', quantity: 1, rateCents: 100, amountCents: 100, accountId: '' }] }} />);
  change('Customer', 'Client');
  assert.equal((screen.getByLabelText('Income Account') as HTMLInputElement).value, '');
  assert.equal((screen.getByLabelText('Tax') as HTMLSelectElement).value, '');
});
test('service item fills defaults without linking stock or booking stock cost; saved labels travel on line', async () => {
  const saved: Array<{ items?: unknown[] }> = [];
  render(<InvoiceModal isOpen onClose={() => {}} onSave={value => { saved.push(value); }} customers={customers} accounts={accounts} />);
  change('Item / Description', 'Service');
  assert.equal((screen.getByLabelText('Income Account') as HTMLInputElement).value, 'Sales');
  change('Customer', 'Client');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Draft' })); });
  await waitFor(() => assert.equal(saved.length, 1));
  assert.deepEqual(saved[0].items?.map(line => { const l = line as Record<string, unknown>; return [l.itemId, l.unitCostCents, l.accountId, l.dimensions]; }), [[undefined, undefined, 'rev', { project: 'P1' }]]);
});
test('vendor defaults fill empty bill lines and tax, never replace typed account or no-tax choice', () => {
  render(<BillModal isOpen onClose={() => {}} onSave={() => {}} vendors={vendors} accounts={accounts} />);
  change('Vendor', 'v');
  assert.equal((screen.getByLabelText('Expense Account') as HTMLSelectElement).value, 'exp');
  assert.equal((screen.getByLabelText('Tax') as HTMLSelectElement).value, 'gst');
  change('Expense Account', ''); change('Tax', ''); change('Vendor', 'v');
  assert.equal((screen.getByLabelText('Expense Account') as HTMLSelectElement).value, '');
  assert.equal((screen.getByLabelText('Tax') as HTMLSelectElement).value, '');
});
test('party form saves defaults, clears them on edit, and preserves unrelated metadata', async () => {
  let saved: PartyFields | undefined;
  const initial = { id: 'c', name: 'Client', metadata: { note: 'שלום', documentDefaults: { accountId: 'rev' } } };
  render(<PartyModal side="customer" isOpen initial={initial} onClose={() => {}} onSave={value => { saved = value; }} />);
  change('Default account', '');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Customer' })); });
  assert.deepEqual(saved?.metadata, { note: 'שלום' });
  cleanup();
  render(<PartyModal side="vendor" isOpen onClose={() => {}} onSave={value => { saved = value; }} />);
  change('Vendor Name', 'Vendor'); change('Default account', 'exp'); change('Default Project', 'P1'); change('Default tax', 'gst');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Vendor' })); });
  assert.deepEqual(saved?.metadata, { documentDefaults: { accountId: 'exp', taxCodeId: 'gst', dimensions: { project: 'P1' } } });
});
test('viewer defaults are disabled; switching edited contacts starts with the new defaults', async () => {
  const { rerender } = render(<PartyModal side="customer" isOpen initial={{ id: 'a', name: 'A', metadata: { documentDefaults: { accountId: 'rev' } } }} onClose={() => {}} onSave={() => {}} />);
  rerender(<PartyModal side="customer" isOpen initial={{ id: 'b', name: 'B' }} onClose={() => {}} onSave={() => {}} />);
  assert.equal((screen.getByLabelText('Default account') as HTMLSelectElement).value, '');
  await act(async () => { const ws = setComponentWorkspace('viewer'); useAuthStore.setState({ workspaces: [ws] }); });
  assert.equal((screen.getByRole('group', { name: 'Document defaults' }) as HTMLFieldSetElement).disabled, true);
});
test('inventory dialog submits account and labels as a form field; tax keeps its existing field', () => {
  render(<InventoryItemDialog open editingItem={item} categories={[]} canChangeStock onClose={() => {}} onSubmit={() => {}} onAdjust={() => {}} />);
  change('Default account', 'exp');
  const form = screen.getByLabelText('Default account').closest('form')!;
  const hidden = form.querySelector<HTMLInputElement>('[name="documentDefaults"]')!;
  assert.equal(JSON.parse(hidden.value).accountId, 'exp');
  assert.ok(form.querySelector('[name="defaultTaxCodeId"]'));
});
