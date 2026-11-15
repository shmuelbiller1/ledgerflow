/** Adding a customer (H-25): a named dialog, trimmed fields, no blank names, Escape closes. */
import { stubFetch } from './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import CustomerModal from '../components/sales/CustomerModal';
import { RMAS_METADATA_FIELD, WARRANTIES_METADATA_FIELD } from '../lib/warehouseRecords';
import type { Customer } from '../types';

function setup() {
  stubFetch(404);
  const saved: Partial<Customer>[] = [];
  let closed = 0;
  render(<CustomerModal isOpen onClose={() => { closed++; }} onSave={c => { saved.push(c); }} />);
  return { saved, closed: () => closed };
}

describe('customer dialog', () => {
  afterEach(() => cleanup());

  test('saves the trimmed name, email and phone', () => {
    const { saved } = setup();
    assert.ok(screen.getByRole('dialog', { name: /Customer/ }));
    fireEvent.change(screen.getByLabelText('Customer Name'), { target: { value: '  Acme Ltd ' } });
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: ' billing@acme.test ' } });
    fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: ' 555 0100 ' } });
    fireEvent.submit(screen.getByLabelText('Customer Name').closest('form')!);
    assert.deepEqual(saved, [{ name: 'Acme Ltd', email: 'billing@acme.test', phone: '555 0100', status: 'active', balanceCents: 0 }]);
  });

  test('profile edits omit server-managed warranty and return histories from the metadata payload', () => {
    const saved: Partial<Customer>[] = [];
    const initial: Partial<Customer> = {
      id: 'customer-1', name: 'Acme Ltd', status: 'active',
      metadata: {
        documentLanguage: 'en', custom: 'keep', documentDefaults: { accountId: 'rent' },
        [WARRANTIES_METADATA_FIELD]: { serial_one: { endDate: '2028-01-01' } },
        [RMAS_METADATA_FIELD]: { rma_one: { status: 'approved' } },
      },
    };
    render(<CustomerModal isOpen onClose={() => {}} initial={initial} onSave={customer => { saved.push(customer); }} />);
    fireEvent.submit(screen.getByLabelText('Customer Name').closest('form')!);
    assert.deepEqual(saved[0].metadata, { documentLanguage: 'en', custom: 'keep', documentDefaults: { accountId: 'rent' } });
  });

  test('clearing a saved profile metadata field sends an explicit delete marker', () => {
    const saved: Partial<Customer>[] = [];
    render(<CustomerModal isOpen onClose={() => {}} initial={{
      id: 'customer-1', name: 'Acme Ltd', status: 'active', metadata: { documentLanguage: 'en', custom: 'keep' },
    }} onSave={customer => { saved.push(customer); }} />);
    fireEvent.change(screen.getByLabelText('Language of their documents'), { target: { value: '' } });
    fireEvent.submit(screen.getByLabelText('Customer Name').closest('form')!);
    assert.equal(saved[0].metadata?.documentLanguage, null);
    assert.equal(saved[0].metadata?.custom, 'keep');
  });

  test('a name of only spaces is not saved', () => {
    const { saved } = setup();
    fireEvent.change(screen.getByLabelText('Customer Name'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByLabelText('Customer Name').closest('form')!);
    assert.equal(saved.length, 0);
  });

  test('keeps the entered fields when an asynchronous save resolves false', async () => {
    let resolveSave!: (saved: boolean) => void;
    const save = new Promise<boolean>(resolve => { resolveSave = resolve; });
    const view = render(<CustomerModal isOpen onClose={() => {}} onSave={() => save} />);
    const name = view.getByLabelText('Customer Name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Acme' } });
    fireEvent.submit(name.closest('form')!);
    assert.equal(name.value, 'Acme', 'do not clear before the server confirms the save');
    await act(async () => { resolveSave(false); await save; });
    assert.equal(name.value, 'Acme', 'keep the draft available for retry');
  });

  test('Escape closes it', () => {
    const { closed } = setup();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    assert.equal(closed(), 1);
  });
});
