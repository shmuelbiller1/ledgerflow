import './helpers/dom';
import React from 'react';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAuthStore } from '../stores/useAuthStore';
import { loadGuestCompany } from '../lib/guestCompany';
import { guestRows } from '../lib/db/guestDatabase';
import NumberingSettings from '../components/platform/settings/NumberingSettings';
import { nextDocumentNumber } from '../services/documentNumbers';
import AlertsSettings from '../components/platform/settings/AlertsSettings';
import StagesSettings from '../components/platform/settings/StagesSettings';
import PriceListImportView from '../components/platform/settings/PriceListImportView';
import PriceListsSettings from '../components/platform/settings/PriceListsSettings';
import { StageChip } from '../components/collaboration/StageChip';
import { resetStages } from '../components/collaboration/stageStore';
import { useLedgerStore } from '../stores/useLedgerStore';

const realFetch = globalThis.fetch;
const initialAuth = useAuthStore.getState();
afterEach(() => {
  cleanup();
  resetStages();
  useAuthStore.getState().setIsGuest(false);
  useAuthStore.setState(initialAuth);
  globalThis.fetch = realFetch;
});
function sample() {
  useAuthStore.setState({ user: null, isGuest: false });
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  globalThis.fetch = (() => { throw new Error('Sample settings must not request a server'); }) as typeof fetch;
}
test('sample owner saves alert settings from the real form and sees them after remount', async () => {
  sample();
  render(<AlertsSettings />);
  assert.ok(screen.getByText(/No nightly checks or notifications/));
  fireEvent.change(screen.getByLabelText('Day of the month for the close reminder'), { target: { value: '9' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save alerts' })));
  assert.equal((guestRows('workspaces')[0].data.alerts as { closeReminderDay: number }).closeReminderDay, 9);
  cleanup();
  render(<AlertsSettings />);
  assert.equal((screen.getByLabelText('Day of the month for the close reminder') as HTMLSelectElement).value, '9');
});
test('sample owner defines stages, assigns one from a real row, and retains it after remount', async () => {
  sample();
  render(<StagesSettings />);
  const input = await screen.findByLabelText(/Invoices: one stage a line/);
  fireEvent.change(input, { target: { value: 'Checked\nFollowed up' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save stages' })));
  cleanup();
  const invoice = useLedgerStore.getState().invoices[0];
  const label = invoice.number || invoice.id;
  render(<StageChip kind="invoice" id={invoice.id} label={label} />);
  const select = await screen.findByLabelText(`Stage of ${label}`);
  await act(async () => fireEvent.change(select, { target: { value: 'Checked' } }));
  cleanup(); resetStages();
  render(<StageChip kind="invoice" id={invoice.id} label={label} />);
  await waitFor(() => assert.equal((screen.getByLabelText(`Stage of ${label}`) as HTMLSelectElement).value, 'Checked'));
});
test('sample owner creates a price list in Settings and sees it after remount', async () => {
  sample();
  render(<PriceListsSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'New price list' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Browser wholesale' } });
  fireEvent.change(screen.getByLabelText('Discount on every item, %'), { target: { value: '10' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save price list' })));
  assert.ok((guestRows('workspaces')[0].data.priceLists as Array<{ name: string }>).some(list => list.name === 'Browser wholesale'));
  cleanup();
  render(<PriceListsSettings />);
  assert.ok(screen.getByText('Browser wholesale', { selector: 'bdi' }));
});

test('sample document numbering form saves the same series the invoice form allocates', async () => {
  sample();
  const { within } = await import('@testing-library/react');
  render(<NumberingSettings />);
  const row = await screen.findByRole('group', { name: /^Invoices$/ });
  fireEvent.change(within(row).getByLabelText('Prefix'), { target: { value: 'LOCAL-' } });
  fireEvent.change(within(row).getByLabelText('Next number'), { target: { value: '25' } });
  await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Save invoices' })));
  assert.equal(await nextDocumentNumber('guest', 'invoice'), 'LOCAL-0025');
});

test('sample price-list CSV import and Undo both save locally', async () => {
  sample();
  const item = useLedgerStore.getState().inventory.find(row => row.sku);
  assert.ok(item, 'the sample year has an item with a SKU');
  const previous = guestRows('workspaces')[0].data.priceLists || [];
  render(<PriceListImportView />);
  fireEvent.change(screen.getByLabelText('CSV to import'), { target: { value: `Item,List,Price\n${item.sku},Browser CSV list,12.50` } });
  fireEvent.click(screen.getByRole('button', { name: 'Read the file' }));
  const save = screen.getByRole('button', { name: 'Save the import' });
  assert.equal((save as HTMLButtonElement).disabled, false);
  await act(async () => fireEvent.click(save));
  const saved = guestRows('workspaces')[0].data.priceLists as Array<{ name: string; prices: Record<string, number> }>;
  assert.equal(saved.find(list => list.name === 'Browser CSV list')?.prices[item.id], 1250);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Undo the import' })));
  assert.deepEqual(guestRows('workspaces')[0].data.priceLists, previous);
});
