import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PaymentFlowsByMethodPanel from '../components/reporting/PaymentFlowsByMethodPanel';
import PaymentMethodSummaryView from '../components/reporting/PaymentMethodSummaryView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makePayment } from './fixtures';

const originalFetch = globalThis.fetch;
const auth = useAuthStore.getState();
const ledger = useLedgerStore.getState();
const needs = useDataNeedsStore.getState();
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  useAuthStore.setState(auth, true);
  useLedgerStore.setState(ledger, true);
  useDataNeedsStore.setState(needs, true);
});

const payment = makePayment({ id: 'p1', workspaceId: 'component-workspace', amountCents: 12500,
  currency: 'USD', method: 'bank_transfer', direction: 'made', date: '2026-03-10', status: 'posted' });

test('E-23 read-only panel shows outgoing payments and makes CSV available for reviewed records', () => {
  render(<PaymentFlowsByMethodPanel payments={[payment]} workspaceId="component-workspace"
    homeCurrency="USD" startDate="2026-01-01" endDate="2026-12-31" loading={false} incomplete={false} />);
  const panel = screen.getByRole('region', { name: 'Payment in and out by method' });
  assert.match(panel.textContent || '', /Money in and out by payment method/);
  assert.ok(screen.getByRole('rowheader', { name: 'Bank transfer' }));
  assert.ok(screen.getByText(/1 \/ /));
  assert.equal((screen.getByRole('button', { name: 'Download payment method CSV' }) as HTMLButtonElement).disabled, false);
});

test('E-23 archive/export is blocked on incomplete or unverified payment history', () => {
  render(<PaymentFlowsByMethodPanel payments={[payment]} workspaceId="component-workspace"
    homeCurrency="USD" startDate="2026-01-01" endDate="2026-12-31" loading={false} incomplete />);
  assert.equal((screen.getByRole('button', { name: 'Download payment method CSV' }) as HTMLButtonElement).disabled, true);
  assert.match(screen.getByRole('alert').textContent || '', /incomplete/);
  cleanup();
  render(<PaymentFlowsByMethodPanel payments={[{ ...payment, date: '' }]} workspaceId="component-workspace"
    homeCurrency="USD" startDate="2026-01-01" endDate="2026-12-31" loading={false} incomplete={false} />);
  assert.equal((screen.getByRole('button', { name: 'Download payment method CSV' }) as HTMLButtonElement).disabled, true);
  assert.match(screen.getByRole('alert').textContent || '', /lack a valid date/);
});

test('E-23 new in/out section is reachable on the existing payment method report screen', () => {
  setComponentWorkspace();
  useLedgerStore.setState({ customers: [], payments: [payment] });
  useDataNeedsStore.setState({ loaded: { customers: true, payments: true }, loadedWorkspaceId: 'component-workspace', failed: {} });
  render(<PaymentMethodSummaryView startDate="2026-01-01" endDate="2026-12-31" />);
  assert.ok(screen.getByText('Sales payment summary by method'));
  assert.ok(screen.getByRole('region', { name: 'Payment in and out by method' }));
});

const period = { startDate: '2026-03-01', endDate: '2026-03-31', compareStartDate: '2026-02-01', compareEndDate: '2026-02-28' };
const received = { ...payment, direction: 'received' as const, method: 'card' as const };
function receipts() {
  setComponentWorkspace('viewer');
  useLedgerStore.setState({ customers: [], payments: [received], truncatedCollections: {}, isDataTruncated: false });
  useDataNeedsStore.setState({ loadedWorkspaceId: payment.workspaceId, loaded: { customers: true, payments: true }, failed: {} });
}
const receiptTable = () => within(screen.getByRole('table', { name: 'Customer receipts by method' }));
const flowCsv = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Download payment method CSV' });
const displayedCsv = () => screen.queryByRole('button', { name: 'Export displayed rows CSV' });
const reply = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status });

test('receipt totals and payment flows wait for their own sources; neither mistakes the old workspace for empty books', async () => {
  receipts();
  globalThis.fetch = async () => reply({}, 403);
  useDataNeedsStore.setState({ loaded: { payments: true } });
  render(<PaymentMethodSummaryView {...period} />);
  assert.ok(screen.getByText('Loading payments…'));
  assert.equal(screen.queryByRole('table', { name: 'Customer receipts by method' }), null);
  assert.equal(flowCsv().disabled, false, 'the in/out file does not need the customer list');
  await act(async () => useDataNeedsStore.setState({ failed: { customers: 'Read denied' } }));
  assert.ok(receiptTable().getByText('$125.00'));
  assert.ok(receiptTable().getByText('—'), 'a missing prior method is unknown, not zero');
  fireEvent.click(await screen.findByRole('button', { name: 'Columns' }));
  assert.equal(displayedCsv(), null);
  assert.equal(flowCsv().disabled, false);
  await act(async () => useDataNeedsStore.setState({ loadedWorkspaceId: 'other', failed: {} }));
  assert.equal(screen.queryByRole('table'), null);
  assert.equal(screen.queryByText(/No payments recorded|No received payment documents/), null);
});

test('a cut, partial or refused comparison cannot reuse a previous success when the same cap returns', async () => {
  receipts();
  const capped = { payments: true };
  useLedgerStore.setState({ truncatedCollections: capped });
  const requests: Array<(r: Response) => void> = [];
  globalThis.fetch = async () => new Promise(resolve => requests.push(resolve));
  render(<PaymentMethodSummaryView {...period} />);
  await waitFor(() => assert.equal(requests.length, 1));
  const ach = { id: 'ach', name: 'ACH', count: 2, cents: 950, undated: 1 };
  const full = { rows: [ach], previousRows: [] };
  await act(async () => requests[0](reply(full)));
  assert.ok(receiptTable().getByText('ACH'));
  fireEvent.click(await screen.findByRole('button', { name: 'Columns' }));
  assert.ok(displayedCsv()); assert.equal(flowCsv().disabled, true);

  for (const response of [reply({ rows: [ach] }), reply({ ...full, provenance: { source: 'server', completeness: 'partial' } }),
    reply({ ...full, rows: [{ ...ach, undated: 3 }] }), reply({}, 403)]) {
    await act(async () => useLedgerStore.setState({ truncatedCollections: {} }));
    assert.ok(displayedCsv()); assert.equal(flowCsv().disabled, false);
    const index = requests.length;
    await act(async () => useLedgerStore.setState({ truncatedCollections: capped }));
    await waitFor(() => assert.equal(requests.length, index + 1));
    assert.ok(receiptTable().getByText('—')); assert.equal(displayedCsv(), null);
    await act(async () => requests[index](response));
    assert.ok(receiptTable().getByText('Card')); assert.equal(receiptTable().queryByText('ACH'), null);
    assert.equal(displayedCsv(), null); assert.equal(flowCsv().disabled, true);
  }
});

test('a late receipt answer for a previous sign-in is ignored, and empty aggregates alone never mean empty books', async () => {
  receipts(); useLedgerStore.setState({ truncatedCollections: { payments: true } });
  const requests: Array<(r: Response) => void> = [];
  globalThis.fetch = async () => new Promise(resolve => requests.push(resolve));
  render(<PaymentMethodSummaryView {...period} />);
  await waitFor(() => assert.equal(requests.length, 1));
  await act(async () => { const a = useAuthStore.getState(); a.setUser(a.user); });
  await waitFor(() => assert.equal(requests.length, 2));
  await act(async () => requests[0](reply({ rows: [{ id: 'late', name: 'Obsolete receipt', count: 1, cents: 9999, undated: 0 }], previousRows: [] })));
  assert.equal(screen.queryByText('Obsolete receipt'), null);
  await act(async () => requests[1](reply({ rows: [], previousRows: [] })));
  assert.ok(receiptTable().getByText('No received payment documents for this period.'));
  assert.equal(screen.queryByRole('button', { name: 'Open Sales' }), null);
  assert.equal(flowCsv().disabled, true);
});
