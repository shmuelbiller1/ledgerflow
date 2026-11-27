/**
 * The merge dialog on a contact's page (Y-23 BA-01): likely duplicates first, what will move,
 * and the request to the server (the page's contact is kept).
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MergePartyDialog from '../components/common/MergePartyDialog';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeCustomer, makeInvoice, makePayment } from './fixtures';
import { setComponentWorkspace } from './helpers/componentFixtures';

const keep = makeCustomer({ id: 'c-keep', name: 'Acme Ltd', email: 'ap@acme.test' });
const customers = [keep, makeCustomer({ id: 'c-zeta', name: 'Zeta' }), makeCustomer({ id: 'c-dup', name: 'ACME LTD.', email: 'other@acme.test' }), makeCustomer({ id: 'c-beta', name: 'Beta' })];

describe('Merge a duplicate contact', () => {
  beforeEach(() => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({
      customers,
      invoices: [makeInvoice({ id: 'i1', customerId: 'c-dup' }), makeInvoice({ id: 'i2', customerId: 'c-dup' }), makeInvoice({ id: 'i3', customerId: 'c-beta' })],
      payments: [makePayment({ id: 'p1', contactId: 'c-dup' })],
      bills: [],
    });
  });
  afterEach(() => cleanup());

  test('the likely duplicate is listed first; the summary says what moves; the page\'s contact is kept', async () => {
    const calls = stubFetchWithBodies(200, { status: 'success', moved: { invoices: 2 } });
    let closed = 0;
    render(<MergePartyDialog side="customer" party={keep} onClose={() => { closed++; }} />);
    const select = screen.getByLabelText('Duplicate customer to merge in') as HTMLSelectElement;
    const labels = [...select.options].map(o => o.textContent);
    assert.deepEqual(labels, ['Choose a customer…', 'ACME LTD. (other@acme.test) · likely duplicate', 'Beta', 'Zeta']);
    assert.equal((screen.getByRole('button', { name: 'Merge' }) as HTMLButtonElement).disabled, true);
    fireEvent.change(select, { target: { value: 'c-dup' } });
    assert.match(screen.getByRole('status').textContent || '', /2 invoices, 1 payment and everything else of "ACME LTD\." will belong to "Acme Ltd"/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Merge' })); });
    await waitFor(() => assert.equal(closed, 1));
    assert.equal(calls[0].url, '/api/v1/workspaces/component-workspace/contacts/merge');
    assert.deepEqual(calls[0].body, { side: 'customer', keepId: 'c-keep', mergeId: 'c-dup' });
  });

  test('a refusal keeps the dialog open', async () => {
    const calls = stubFetchWithBodies(403, { message: 'Only owners and accountants merge contacts' });
    let closed = 0;
    render(<MergePartyDialog side="customer" party={keep} onClose={() => { closed++; }} />);
    fireEvent.change(screen.getByLabelText('Duplicate customer to merge in'), { target: { value: 'c-dup' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Merge' })); });
    await waitFor(() => assert.equal(calls.length, 1));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(closed, 0);
  });

  test('two contacts that share no name, email or tax number need "same business" ticked, and say so to the server', async () => {
    const calls = stubFetchWithBodies(200, { status: 'success', moved: { invoices: 1 } });
    render(<MergePartyDialog side="customer" party={keep} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Duplicate customer to merge in'), { target: { value: 'c-beta' } });
    assert.match(screen.getByRole('alert').textContent || '', /"Beta" and "Acme Ltd" share no name, email or tax number/);
    const merge = screen.getByRole('button', { name: 'Merge' }) as HTMLButtonElement;
    assert.equal(merge.disabled, true, 'not until confirmed');
    fireEvent.click(screen.getByLabelText('Yes, these are the same business'));
    assert.equal(merge.disabled, false);
    await act(async () => { fireEvent.click(merge); });
    await waitFor(() => assert.equal(calls.length, 1));
    assert.deepEqual(calls[0].body, { side: 'customer', keepId: 'c-keep', mergeId: 'c-beta', confirmSameBusiness: true });
    // choosing another contact clears the confirmation
    fireEvent.change(screen.getByLabelText('Duplicate customer to merge in'), { target: { value: 'c-zeta' } });
    assert.equal((screen.getByLabelText('Yes, these are the same business') as HTMLInputElement).checked, false);
  });
});
