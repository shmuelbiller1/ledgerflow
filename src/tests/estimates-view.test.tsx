import { stubFetchWithBodies } from './helpers/dom';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { makeCustomer } from './fixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import EstimatesView from '../components/sales/EstimatesView';

beforeEach(() => {
  setComponentWorkspace();
  markComponentCollectionsLoaded('customers', 'estimates');
  useLedgerStore.setState({ customers: [makeCustomer({ name: 'לקוח Acme' })], estimates: [] });
});
afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });

test('estimate creation preserves mixed-language fields in the persisted request', async () => {
  const calls = stubFetchWithBodies(200, { number: 'EST-2026-1' });
  const view = render(<EstimatesView />);
  assert.ok(view.getByText(/No estimates yet/));
  fireEvent.click(view.getByRole('button', { name: 'New Estimate' }));
  fireEvent.change(view.getByLabelText('Customer *'), { target: { value: 'cust-1' } });
  fireEvent.change(view.getByLabelText('Amount ($) *'), { target: { value: '123.45' } });
  fireEvent.change(view.getByLabelText('Expiration Date'), { target: { value: '2026-12-31' } });
  fireEvent.change(view.getByLabelText('Description / Project Scope'), { target: { value: 'מערכת ERP / פרויקט א' } });
  fireEvent.click(view.getByRole('button', { name: 'Save Estimate' }));
  await waitFor(() => assert.ok(calls.some(c => c.url.includes('/rpc/lf_set'))));
  const request = calls.find(c => c.url.includes('/rpc/lf_set'))!;
  const body = request.body as { p_table: string; p_data: Record<string, unknown> };
  assert.equal(body.p_table, 'estimates');
  for (const [key, value] of Object.entries({ number: 'EST-2026-1', customerId: 'cust-1', customerName: 'לקוח Acme', amountCents: 12345, expiryDate: '2026-12-31', description: 'מערכת ERP / פרויקט א', status: 'draft', workspaceId: 'component-workspace' })) assert.equal(body.p_data[key], value);
  assert.deepEqual(calls.find(c => c.url.endsWith('/next-number'))!.body, { type: 'estimate' });
  await waitFor(() => assert.equal(view.queryByRole('button', { name: 'Save Estimate' }), null));
});

test('saved estimates have a linked-file panel in the workspace scope', async () => {
  const calls = stubFetchWithBodies(200, []);
  useLedgerStore.setState({ estimates: [{
    id: 'est-1', uid: 'test-user', workspaceId: 'component-workspace', customerId: 'cust-1', customerName: 'לקוח Acme',
    number: 'EST-1', amountCents: 12345, date: '2026-10-01', status: 'draft', lines: [], createdAt: '2026-10-01T00:00:00Z',
  } as never] });
  const view = render(<EstimatesView />);
  fireEvent.click(view.getByRole('button', { name: 'Manage files for estimate EST-1' }));
  await waitFor(() => assert.ok(view.getByRole('region', { name: 'Files of Estimate EST-1' })));
  assert.ok(calls.some(call => call.url.includes('linkedId=eq.est-1')));
});

test('estimate validation and Cancel send no create request', () => {
  const calls = stubFetchWithBodies(200, {});
  const view = render(<EstimatesView />);
  fireEvent.click(view.getByRole('button', { name: 'New Estimate' }));
  const amount = view.getByLabelText('Amount ($) *');
  fireEvent.change(amount, { target: { value: '-1' } });
  fireEvent.submit(amount.closest('form')!);
  fireEvent.change(amount, { target: { value: '10' } });
  fireEvent.submit(amount.closest('form')!);
  assert.equal(calls.length, 0);
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  assert.equal(view.queryByRole('button', { name: 'Save Estimate' }), null);
  assert.equal(calls.length, 0);
});

test('without a number from the series nothing is saved (no random EST-1234 that could repeat; L-189)', async () => {
  const calls = stubFetchWithBodies(503, { message: 'unavailable' });
  const view = render(<EstimatesView />);
  fireEvent.click(view.getByRole('button', { name: 'New Estimate' }));
  fireEvent.change(view.getByLabelText('Customer *'), { target: { value: 'cust-1' } });
  fireEvent.change(view.getByLabelText('Amount ($) *'), { target: { value: '10' } });
  fireEvent.click(view.getByRole('button', { name: 'Save Estimate' }));
  await waitFor(() => assert.ok(calls.some(c => c.url.endsWith('/next-number'))));
  await waitFor(() => assert.ok(view.getByRole('button', { name: 'Save Estimate' })));
  assert.equal(calls.some(c => c.url.includes('/rpc/lf_set')), false, 'nothing written');
});
