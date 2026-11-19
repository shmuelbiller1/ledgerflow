/**
 * The bill dialog (H-02): what it saves is what the vendor is owed. Amounts as on the vendor's
 * bill (tax included by default) or before tax; approval over the limit waits; an edited bill
 * keeps its number; nothing is saved without a vendor.
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BillModal, { type BillDraft } from '../components/purchases/BillModal';
import { markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { Bill, InventoryItem, Workspace } from '../types';
import { makeChartAccount, makeVendor } from './fixtures';

const vendors = [makeVendor({ id: 'v1', name: 'Paper Co' })];
const accounts = [makeChartAccount({ id: 'exp', name: 'Office supplies', type: 'expense' }), makeChartAccount({ id: 'exp2', name: 'Postage', type: 'expense' })];
let fetched: string[] = [];

function setup(initialBill?: Partial<Bill>) {
  const saved: BillDraft[] = [];
  render(<BillModal isOpen onClose={() => {}} onSave={b => { saved.push(b); }} vendors={vendors} accounts={accounts} initialBill={initialBill} />);
  return saved;
}
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const click = (text: string) => act(async () => { fireEvent.click(screen.getByText(text)); });

function fillTwoLines() {
  fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'v1' } });
  type(screen.getByLabelText('Description'), 'Paper');
  fireEvent.change(screen.getByLabelText('Expense Account'), { target: { value: 'exp' } });
  type(screen.getByLabelText(/^Amount \(/), '100');
  fireEvent.click(screen.getByLabelText('Add Split Expense'));
  fireEvent.change(screen.getAllByLabelText('Expense Account')[1], { target: { value: 'exp2' } });
  type(screen.getAllByLabelText(/^Amount \(/)[1], '50');
  fireEvent.change(screen.getByLabelText('Tax'), { target: { value: 'gst' } });
}

describe('Bill dialog', () => {
  beforeEach(() => {
    fetched = stubFetch(404);
    useAuthStore.setState({ currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD' } as Workspace] });
    useLedgerStore.setState({
      bills: [], transactions: [],
      taxRates: [{ id: 'gst', uid: 'u', workspaceId: 'w1', name: 'GST', rate: 10, type: 'Sales', createdAt: '2026-01-01' }],
    });
  });
  // the Files panel (K-07) opens the database client: close it so the test process ends
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('amounts as on the vendor\'s bill (tax included): owed 150.00, of which tax 13.64', async () => {
    const saved = setup();
    fillTwoLines();
    await click('Save & Close');
    await waitFor(() => assert.equal(saved.length, 1));
    const bill = saved[0];
    assert.equal(bill.status, 'pending');
    assert.equal(bill.vendorId, 'v1');
    assert.equal(bill.amountCents, 15000);
    assert.equal(bill.lineSumCents, 15000);
    assert.equal(bill.taxAmountCents, 1364);
    assert.equal(bill.taxVersion, 2);
    assert.equal(bill.pricesIncludeTax, true);
    assert.deepEqual(bill.splits?.map(s => [s.accountId, s.amountCents]), [['exp', 10000], ['exp2', 5000]]);
  });

  test('moving bill lines changes only their order; accounts, amounts and tax stay intact', async () => {
    const saved = setup();
    fillTwoLines();
    fireEvent.click(screen.getByLabelText('Move line 2 up'));
    assert.deepEqual(screen.getAllByLabelText('Description').map(field => (field as HTMLInputElement).value), ['', 'Paper']);
    await click('Save & Close');
    await waitFor(() => assert.equal(saved.length, 1));
    assert.deepEqual(saved[0].splits?.map(line => [line.accountId, line.amountCents]), [['exp2', 5000], ['exp', 10000]]);
    assert.equal(saved[0].amountCents, 15000);
    assert.equal(saved[0].taxAmountCents, 1364);
  });

  test('Repeat (BE-08): the chosen frequency goes with the save; editing a bill offers no Repeat', async () => {
    const saved = setup();
    fillTwoLines();
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'monthly' } });
    await click('Save & Close');
    await waitFor(() => assert.equal(saved.length, 1));
    assert.equal(saved[0].recurringInterval, 'monthly');
    cleanup();
    setup({ id: 'b1', vendorId: 'v1', number: 'V-1', amountCents: 100, dueDate: '2026-02-01', status: 'pending' });
    assert.equal(screen.queryByLabelText('Repeat'), null);
  });

  test('amounts before tax: owed 165.00, tax 15.00', async () => {
    const saved = setup();
    fillTwoLines();
    fireEvent.click(screen.getByLabelText(/Amounts include tax/));
    await click('Save Draft');
    await waitFor(() => assert.equal(saved.length, 1));
    assert.equal(saved[0].status, 'draft');
    assert.equal(saved[0].amountCents, 16500);
    assert.equal(saved[0].taxAmountCents, 1500);
  });

  test('approving a bill over 5,000 leaves it pending; under, it is approved', async () => {
    let saved = setup();
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'v1' } });
    type(screen.getByLabelText(/^Amount \(/), '6000');
    await click('Approve Bill');
    await waitFor(() => assert.equal(saved.length, 1));
    assert.equal(saved[0].status, 'pending');
    cleanup();
    saved = setup();
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'v1' } });
    type(screen.getByLabelText(/^Amount \(/), '60');
    await click('Approve Bill');
    await waitFor(() => assert.equal(saved.length, 1));
    assert.equal(saved[0].status, 'approved');
  });

  test('G-19: approving an already-pending bill over the threshold finishes the decision', async () => {
    // A bill held for approval (status 'pending') is being decided by the reviewer, not
    // submitted again. The submission threshold must not loop it back to 'pending'.
    const saved = setup({ id: 'b1', number: 'B-701', vendorId: 'v1', vendorName: 'Paper Co', status: 'pending', date: '2026-09-01', dueDate: '2026-09-30', splits: [{ amountCents: 600000, accountId: 'exp', description: 'Paper' }] });
    await click('Approve Bill');
    await waitFor(() => assert.equal(saved.length, 1));
    assert.equal(saved[0].status, 'approved');
    assert.equal(saved[0].id, 'b1');
  });

  test('A8-034: a bookkeeper is not offered the approval decision; an accountant and a named delegate are', async () => {
    const before = useAuthStore.getState();
    const workspace = { id: 'w1', name: 'W', currency: 'USD', uid: 'owner', roles: { book: 'bookkeeper', acc: 'accountant', del: 'bookkeeper' } } as unknown as Workspace;
    const as = (uid: string) => useAuthStore.setState({ currentWorkspaceId: 'w1', workspaces: [workspace], user: { uid, email: `${uid}@example.test` } as never });
    const pending = { id: 'b1', number: 'B-702', vendorId: 'v1', vendorName: 'Paper Co', status: 'pending' as const, date: '2026-09-01', dueDate: '2026-09-30', splits: [{ amountCents: 2500, accountId: 'exp', description: 'Paper' }] };

    as('book');
    setup(pending);
    assert.equal(screen.queryByText('Approve Bill'), null, 'a bookkeeper may not approve a bill');
    assert.ok(screen.getByText('An owner or accountant approves a bill'), 'the dialog says who decides');
    cleanup();

    as('acc');
    setup(pending);
    assert.ok(screen.getByText('Approve Bill'), 'an accountant approves');
    cleanup();

    // BG-07: a bookkeeper named to approve in an accountant's place may decide until that day
    as('del');
    useAuthStore.setState({ workspaces: [{ ...workspace, approvalDelegates: [{ from: 'acc', to: 'del', until: '2999-12-31' }] } as never] });
    setup(pending);
    assert.ok(screen.getByText('Approve Bill'), 'a delegate approves in place');
    // the auth store is shared by the whole file: put the signed-in identity back
    useAuthStore.setState({ user: before.user, workspaces: before.workspaces, currentWorkspaceId: before.currentWorkspaceId });
  });

  test('an edited bill keeps its number (no new number is asked for); no vendor, no save', async () => {
    const saved = setup({ id: 'b1', number: 'A-100', vendorId: 'v1', vendorName: 'Paper Co', status: 'pending', date: '2026-09-01', dueDate: '2026-09-30', splits: [{ amountCents: 2500, accountId: 'exp', description: 'Ink' }] });
    await click('Save & Close');
    await waitFor(() => assert.equal(saved.length, 1));
    assert.equal(saved[0].id, 'b1');
    assert.equal(saved[0].number, 'A-100');
    assert.equal(saved[0].amountCents, 2500);
    assert.equal(fetched.filter(u => u.includes('next-number')).length, 0);
    cleanup();
    const none = setup();
    await click('Save & Close');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(none.length, 0);
  });
});

/** D-87: the bill form follows the same field rules as the invoice form (D-86). */
describe('Bill dialog — labels above fields and errors under the field (D-87)', () => {
  const input = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement;

  beforeEach(() => {
    stubFetch(404);
    useAuthStore.setState({ currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD' } as Workspace] });
    markComponentCollectionsLoaded('inventory');
    useLedgerStore.setState({ bills: [], transactions: [], taxRates: [], inventory: [] });
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('every labelled field has its label above the control, not beside it', () => {
    setup();
    for (const id of ['bill-vendor', 'bill-number', 'bill-status', 'bill-date', 'bill-due-date', 'bill-split-desc-0', 'bill-split-acc-0', 'bill-split-amount-0', 'bill-memo']) {
      const control = document.getElementById(id);
      assert.ok(control, `${id} exists`);
      const label = document.querySelector(`label[for="${id}"]`);
      assert.ok(label, `${id} has a label`);
      const order = label.compareDocumentPosition(control);
      assert.ok(order & Node.DOCUMENT_POSITION_FOLLOWING, `${id}: label comes before its field`);
    }
  });

  test('all save actions report the missing vendor under its field and keep the draft', async () => {
    const saved = setup();
    fillTwoLinesWithoutVendor();
    for (const action of ['Save Draft', 'Save & Close', 'Approve Bill']) {
      await act(async () => { fireEvent.click(screen.getByText(action)); });
      assert.equal(saved.length, 0, `${action}: nothing saved without a vendor`);
      assert.equal(input('Vendor').getAttribute('aria-invalid'), 'true');
      assert.ok(document.getElementById('bill-vendor-error')?.textContent, 'the refusal is written under the field');
    }
    fireEvent.change(input('Vendor'), { target: { value: 'v1' } });
    assert.equal(document.getElementById('bill-vendor-error'), null, 'choosing the vendor clears it');
    type(input('Bill Number'), '');
    await act(async () => { fireEvent.click(screen.getByText('Save Draft')); });
    assert.equal(saved.length, 0, 'a required field is still required');
    assert.equal(input('Bill Number').getAttribute('aria-invalid'), 'true');
    assert.equal(input('Vendor').value, 'v1', 'the draft is kept');
  });

  test('a stock line without units is refused under the units field and focuses the correction', async () => {
    useLedgerStore.setState({ inventory: [{ id: 'chair', name: 'Chair', quantityAtHand: 2, unitCostCents: 1000 } as InventoryItem] });
    const saved = setup();
    fireEvent.change(input('Vendor'), { target: { value: 'v1' } });
    fireEvent.change(input('Expense Account'), { target: { value: 'exp' } });
    type(input(/^Amount \(/), '36');
    fireEvent.change(screen.getByLabelText('Stock item on line 1'), { target: { value: 'chair' } });
    await act(async () => { fireEvent.click(screen.getByText('Save & Close')); });
    assert.equal(saved.length, 0, 'a stock line cannot post without its units');
    const units = screen.getByLabelText('Units on line 1');
    assert.equal(units.getAttribute('aria-invalid'), 'true');
    assert.equal(document.getElementById('bill-split-units-0')?.getAttribute('aria-describedby'), 'bill-split-units-0-error');
    assert.equal(document.getElementById('bill-split-units-0-error')?.textContent, 'Enter how many units came in');
    assert.equal(document.activeElement, units, 'the correction is focused');
    fireEvent.change(units, { target: { value: '3' } });
    assert.equal(document.getElementById('bill-split-units-0-error'), null, 'typing the units clears it');
    await act(async () => { fireEvent.click(screen.getByText('Save & Close')); });
    await waitFor(() => assert.equal(saved.length, 1));
    assert.deepEqual(saved[0].splits?.map(s => [s.itemId, s.quantity, s.amountCents]), [['chair', 3, 3600]]);
  });

  test('a stock line without its cost is refused under the amount field, not the units field', async () => {
    useLedgerStore.setState({ inventory: [{ id: 'chair', name: 'Chair', quantityAtHand: 2, unitCostCents: 1000 } as InventoryItem] });
    const saved = setup();
    fireEvent.change(input('Vendor'), { target: { value: 'v1' } });
    fireEvent.change(input('Expense Account'), { target: { value: 'exp' } });
    fireEvent.change(screen.getByLabelText('Stock item on line 1'), { target: { value: 'chair' } });
    fireEvent.change(screen.getByLabelText('Units on line 1'), { target: { value: '3' } });
    await act(async () => { fireEvent.click(screen.getByText('Save & Close')); });
    assert.equal(saved.length, 0);
    assert.equal(document.getElementById('bill-split-amount-0-error')?.textContent, 'Enter what the units cost');
    assert.equal(document.getElementById('bill-split-amount-0')?.getAttribute('aria-invalid'), 'true');
    assert.equal(document.activeElement, document.getElementById('bill-split-amount-0'), 'the amount is focused');
    assert.equal(document.getElementById('bill-split-units-0-error'), null, 'the units are already answered');
    type(input(/^Amount \(/), '36');
    assert.equal(document.getElementById('bill-split-amount-0-error'), null);
    await act(async () => { fireEvent.click(screen.getByText('Save & Close')); });
    await waitFor(() => assert.equal(saved.length, 1));
  });

  test('the save actions live outside the scrolling form, so they keep their place (D-87)', () => {
    setup();
    const footer = document.getElementById('bill-save-footer');
    assert.ok(footer, 'the footer has its own place');
    assert.equal(footer.closest('form'), null, 'it does not scroll away with the fields');
    for (const action of ['Cancel', 'Save Draft', 'Save & Close', 'Approve Bill']) {
      assert.ok(footer.contains(screen.getByText(action).closest('button')), `${action} sits in the footer`);
    }
  });

  test('a save in flight locks every save button and a hurried second click saves once', async () => {
    let finish: (() => void) | undefined;
    const saved: BillDraft[] = [];
    render(<BillModal isOpen onClose={() => {}} onSave={b => { saved.push(b); return new Promise<void>(resolve => { finish = resolve; }); }} vendors={vendors} accounts={accounts} />);
    fireEvent.change(input('Vendor'), { target: { value: 'v1' } });
    type(input(/^Amount \(/), '100');
    await act(async () => { fireEvent.click(screen.getByText('Save & Close')); fireEvent.click(screen.getByText('Save & Close')); });
    for (const action of ['Save Draft', 'Approve Bill']) {
      assert.equal((screen.getByText(action).closest('button') as HTMLButtonElement).disabled, true, `${action} is locked`);
    }
    assert.equal(saved.length, 1, 'the second click did not save again');
    await act(async () => { finish?.(); });
  });
});

function fillTwoLinesWithoutVendor() {
  type(screen.getByLabelText('Description'), 'Paper');
  fireEvent.change(screen.getByLabelText('Expense Account'), { target: { value: 'exp' } });
  type(screen.getByLabelText(/^Amount \(/), '100');
}
