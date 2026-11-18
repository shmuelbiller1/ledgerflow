import { stubFetchWithBodies } from './helpers/dom';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import TaxLiabilityView from '../components/reporting/TaxLiabilityView';

const originalConfirm = window.confirm;
beforeEach(() => {
  setComponentWorkspace();
  markComponentCollectionsLoaded('invoices', 'bills', 'creditNotes', 'vendorCredits');
  useLedgerStore.setState({ invoices: [], bills: [], creditNotes: [], vendorCredits: [] });
});
afterEach(() => { cleanup(); window.confirm = originalConfirm; });

test('tax filing sends the visible period and mixed-language reference only after confirmation', async () => {
  const calls = stubFetchWithBodies(200, { returns: [] });
  const view = render(<TaxLiabilityView startDate="2026-03-01" endDate="2026-03-31" />);
  await waitFor(() => assert.equal((view.getByRole('button', { name: 'File this return' }) as HTMLButtonElement).disabled, false));
  assert.equal((view.getByLabelText('From') as HTMLInputElement).value, '2026-03-01');
  assert.ok(view.getByText('0 documents'));
  fireEvent.change(view.getByLabelText('Reference (optional)'), { target: { value: '  רבעון Q1  ' } });
  window.confirm = () => false;
  fireEvent.click(view.getByRole('button', { name: 'File this return' }));
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  window.confirm = () => true;
  fireEvent.click(view.getByRole('button', { name: 'File this return' }));
  await waitFor(() => assert.equal(calls.filter(c => c.method === 'POST').length, 1));
  const request = calls.find(c => c.method === 'POST')!;
  assert.equal(request.url, '/api/v1/workspaces/component-workspace/tax-returns');
  assert.deepEqual(request.body, { startDate: '2026-03-01', endDate: '2026-03-31', reference: 'רבעון Q1' });
  await waitFor(() => assert.equal((view.getByRole('button', { name: 'File this return' }) as HTMLButtonElement).disabled, false));
});

test('viewer can read tax boxes but cannot file a return', async () => {
  setComponentWorkspace('viewer');
  const calls = stubFetchWithBodies(200, { returns: [] });
  const view = render(<TaxLiabilityView />);
  await waitFor(() => assert.equal(calls.length, 1));
  assert.ok(view.getByRole('table', { name: 'Tax return boxes' }));
  assert.equal(view.queryByRole('button', { name: 'File this return' }), null);
});
