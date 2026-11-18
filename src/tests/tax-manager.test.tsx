import { inlineEditName } from './helpers/inlineEditName';
/**
 * The Taxes screen opened from the menu (no props, L-184): it lists the workspace's tax codes and
 * saves through the normal path; name and rate change in place (I-22); viewers only read.
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TaxManager from '../components/finance/TaxManager';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import { setComponentWorkspace } from './helpers/componentFixtures';
import type { TaxRate } from '../types';

const vat = { id: 'vat', name: 'VAT', rate: 0.2, type: 'Sales', workspaceId: 'component-workspace' } as TaxRate;
const gst = { id: 'gst', name: 'GST+PST', rate: 0.12, type: 'Sales', workspaceId: 'component-workspace', components: [{ name: 'GST', rate: 5 }, { name: 'PST', rate: 7 }] } as TaxRate;
/** A tax rate is an ordinary record: the save names `record.save` and the patch is `input.data`. */
const updates = (calls: Array<{ url: string; body?: unknown }>) => calls
  .filter(c => c.url.includes('/commands/record.'))
  .map(c => {
    const { input } = (c.body as { input: { collection: string; id: string; data?: Record<string, unknown> } });
    return { p_table: input.collection, p_id: input.id, p_set: input.data || {} };
  });

beforeEach(() => {
  setComponentWorkspace('owner');
  useLedgerStore.setState({ taxRates: [vat, gst], transactions: [], accounts: [] });
});
afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });

test('lists the workspace\'s tax codes; rename and change a one-part rate in place', async () => {
  const calls = stubFetchWithBodies(200, null);
  render(<TaxManager />);
  assert.ok(screen.getByRole('button', { name: inlineEditName('Edit Name of tax VAT') }));
  fireEvent.click(screen.getByRole('button', { name: inlineEditName('Edit Name of tax VAT') }));
  fireEvent.change(screen.getByLabelText('Name of tax VAT'), { target: { value: 'VAT standard' } });
  await act(async () => { fireEvent.keyDown(screen.getByLabelText('Name of tax VAT'), { key: 'Enter' }); });
  await waitFor(() => assert.equal(updates(calls).length, 1));
  assert.deepEqual([updates(calls)[0].p_table, updates(calls)[0].p_id, updates(calls)[0].p_set.name], ['taxRates', 'vat', 'VAT standard']);

  fireEvent.click(screen.getByRole('button', { name: inlineEditName('Edit Rate of tax VAT (%)') }));
  fireEvent.change(screen.getByLabelText('Rate of tax VAT (%)'), { target: { value: '17.5' } });
  await act(async () => { fireEvent.keyDown(screen.getByLabelText('Rate of tax VAT (%)'), { key: 'Enter' }); });
  await waitFor(() => assert.equal(updates(calls).length, 2));
  assert.equal(updates(calls)[1].p_set.rate, 0.175);
  assert.equal(screen.queryByRole('button', { name: inlineEditName('Edit Rate of tax GST+PST (%)') }), null, 'a tax with several parts changes in its dialog');
});

test('a rate above 100% is refused; delete asks first', async () => {
  const calls = stubFetchWithBodies(200, null);
  const asked: string[] = [];
  window.confirm = (m?: string) => { asked.push(String(m)); return false; };
  render(<TaxManager />);
  fireEvent.click(screen.getByRole('button', { name: inlineEditName('Edit Rate of tax VAT (%)') }));
  fireEvent.change(screen.getByLabelText('Rate of tax VAT (%)'), { target: { value: '120' } });
  await act(async () => { fireEvent.keyDown(screen.getByLabelText('Rate of tax VAT (%)'), { key: 'Enter' }); });
  assert.match(screen.getByRole('alert').textContent || '', /Between 0 and 100/);
  fireEvent.keyDown(screen.getByLabelText('Rate of tax VAT (%)'), { key: 'Escape' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete tax VAT' })); });
  assert.match(asked[0], /Delete the tax "VAT"/);
  assert.equal(calls.filter(c => c.url.includes('/rpc/')).length, 0);
});

test('an empty tax list says what to add and opens the same new-tax dialog', () => {
  useLedgerStore.setState({ taxRates: [] });
  stubFetchWithBodies(200, null);
  render(<TaxManager />);
  assert.ok(screen.getByText('No tax codes yet'));
  fireEvent.click(screen.getByRole('button', { name: 'Add first tax code' }));
  assert.ok(screen.getByRole('heading', { name: 'New tax' }));
});

test('viewers see the codes but cannot change them', () => {
  setComponentWorkspace('viewer');
  stubFetchWithBodies(200, null);
  render(<TaxManager />);
  assert.ok(screen.getByText('VAT'));
  assert.equal(screen.queryByRole('button', { name: /Edit Name of tax|New tax|Delete tax/ }), null);
});
