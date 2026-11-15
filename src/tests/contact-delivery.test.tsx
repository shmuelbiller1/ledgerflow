/**
 * How a contact wants documents (Y-27). The choice lives on the customer or vendor, defaults to
 * Email (what the app did before anyone could choose), and is only obeyed by the things that happen
 * by themselves: the daily reminder job, the monthly statement batch and emailing an invoice when it
 * is saved as "sent". A person pressing Email still sends — the send log says it went against the
 * choice. Every expectation here is checked by hand.
 */
import { stubFetch, stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PartyModal from '../components/common/PartyModal';
import type { PartyFields } from '../components/common/PartyModal';
import PartyProfilePanel from '../components/common/PartyProfilePanel';
import {
  DELIVERY_METHODS, DEFAULT_DELIVERY, PAPER_DELIVERY_METHODS,
  againstPreference, deliveryLabel, deliveryPhrase, preferredDelivery, sendsByEmail,
} from '../lib/delivery';
import { separatePaperReminders } from '../lib/reminders';
import InvoiceEmailDialog from '../components/sales/InvoiceEmailDialog';
import { getSupabase } from '../lib/db/client';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeCustomer, makeVendor } from './fixtures';
import type { Invoice } from '../types';
import { setComponentWorkspace } from './helpers/componentFixtures';

describe('the choice a contact makes', () => {
  test('nothing chosen, empty or something unknown all mean Email', () => {
    assert.equal(preferredDelivery(undefined), 'email');
    assert.equal(preferredDelivery({}), 'email');
    assert.equal(preferredDelivery({ deliveryMethod: '' }), 'email');
    assert.equal(preferredDelivery({ deliveryMethod: null }), 'email');
    assert.equal(preferredDelivery({ deliveryMethod: 'FAX' }), 'email', 'an unknown method is never honoured');
    assert.equal(preferredDelivery({ deliveryMethod: '  Post  ' }), 'post', 'case and spaces around a stored value do not matter');
    assert.equal(preferredDelivery({ deliveryMethod: 'none' }), 'none');
  });

  test('the four choices, each with its own label and note', () => {
    assert.deepEqual(DELIVERY_METHODS.map(m => m.value), ['email', 'print', 'post', 'none']);
    assert.deepEqual(DELIVERY_METHODS.map(m => m.label), ['Email', 'Print', 'Post', 'Nothing automatic']);
    assert.ok(DELIVERY_METHODS.every(m => m.note.length > 10), 'every choice says what it means');
    assert.equal(DEFAULT_DELIVERY, 'email');
    assert.deepEqual(PAPER_DELIVERY_METHODS, ['print', 'post', 'none'], 'exactly these keep the daily emails away');
  });

  test('what to say about it', () => {
    assert.equal(deliveryLabel('post'), 'Post');
    assert.equal(deliveryLabel(''), 'Email', 'a contact that never chose is shown the default');
    assert.equal(deliveryLabel(undefined), 'Email');
    assert.equal(deliveryPhrase('email'), 'an emailed copy');
    assert.equal(deliveryPhrase('print'), 'a printed copy');
    assert.equal(deliveryPhrase('post'), 'a posted copy');
    assert.equal(deliveryPhrase('none'), 'nothing automatically');
  });

  test('only Email may go out by itself; paper is what the log marks', () => {
    assert.equal(sendsByEmail({}), true);
    assert.equal(sendsByEmail({ deliveryMethod: 'email' }), true);
    assert.equal(sendsByEmail({ deliveryMethod: 'print' }), false);
    assert.equal(sendsByEmail({ deliveryMethod: 'none' }), false);
    assert.equal(againstPreference({}), null);
    assert.equal(againstPreference({ deliveryMethod: 'post' }), 'post');
  });
});

describe('what the daily reminder job does with it', () => {
  test('reminders for paper customers are taken out of the emails, and the rest stay in order', () => {
    const due = [
      { invoiceId: 'i1', step: 1, daysOverdue: 5, customerId: 'c-email' },
      { invoiceId: 'i2', step: 1, daysOverdue: 5, customerId: 'c-paper' },
      { invoiceId: 'i3', step: 2, daysOverdue: 20 }, // no customer on the invoice: emailed as before
      { invoiceId: 'i4', step: 1, daysOverdue: 3, customerId: 'c-other' },
    ];
    const split = separatePaperReminders(due, new Set(['c-paper', 'c-none']));
    assert.deepEqual(split.email.map(d => d.invoiceId), ['i1', 'i3', 'i4']);
    assert.deepEqual(split.paper.map(d => d.invoiceId), ['i2']);
    assert.deepEqual(separatePaperReminders(due, new Set()), { email: due, paper: [] }, 'nobody asked for paper: nothing changes');
    assert.deepEqual(separatePaperReminders([], new Set(['c'])).email, []);
  });
});

describe('the contact form', () => {
  beforeEach(() => setComponentWorkspace('owner'));
  afterEach(() => cleanup());

  const openForm = (party?: PartyFields) => {
    const saved: PartyFields[] = [];
    render(<PartyModal side="customer" isOpen initial={party ?? null} onClose={() => {}} onSave={p => { saved.push(p); }} />);
    return saved;
  };
  const choose = (value: string) => fireEvent.change(screen.getByLabelText('Preferred delivery for invoices and statements'), { target: { value } });
  const save = () => fireEvent.submit(screen.getByLabelText('Customer Name').closest('form')!);

  test('a new customer who wants paper carries the choice; the default is not written at all', () => {
    const saved = openForm();
    const chooser = screen.getByLabelText('Preferred delivery for invoices and statements') as HTMLSelectElement;
    assert.deepEqual([...chooser.options].map(o => o.value), ['email', 'print', 'post', 'none']);
    assert.deepEqual([...chooser.options].map(o => o.textContent), [
      'Email — the document is emailed as a PDF',
      'Print — someone prints it and hands it over',
      'Post — a paper copy is mailed',
      'Nothing automatic — nothing is sent by itself; the payment link still works',
    ]);
    assert.equal(chooser.value, 'email', 'nothing chosen yet means the old behaviour');
    fireEvent.change(screen.getByLabelText('Customer Name'), { target: { value: 'Paper Ltd' } });
    save();
    assert.equal('deliveryMethod' in saved[0], false, 'Email was never chosen, so the record stays as it was');
    cleanup();

    const withPost = openForm();
    fireEvent.change(screen.getByLabelText('Customer Name'), { target: { value: 'Post House' } });
    choose('post');
    save();
    assert.equal(withPost[0].deliveryMethod, 'post');
  });

  test('editing a paper customer back to Email saves Email, so the choice is not stuck', () => {
    const saved = openForm({ id: 'c1', name: 'Post House', deliveryMethod: 'post' });
    assert.equal((screen.getByLabelText('Preferred delivery for invoices and statements') as HTMLSelectElement).value, 'post');
    choose('email');
    save();
    assert.deepEqual({ id: saved[0].id, deliveryMethod: saved[0].deliveryMethod }, { id: 'c1', deliveryMethod: 'email' });
  });

  test('a vendor gets the same choice, worded for bills', () => {
    const saved: PartyFields[] = [];
    render(<PartyModal side="vendor" isOpen onClose={() => {}} onSave={p => { saved.push(p); }} />);
    fireEvent.change(screen.getByLabelText('Vendor Name'), { target: { value: 'Paper Co' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Supplies' } });
    fireEvent.change(screen.getByLabelText('Preferred delivery for bills and remittances'), { target: { value: 'print' } });
    fireEvent.submit(screen.getByLabelText('Vendor Name').closest('form')!);
    assert.equal(saved[0].deliveryMethod, 'print');
  });
});

describe("the contact's page", () => {
  beforeEach(() => setComponentWorkspace('owner'));
  afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });

  test('the choice is shown and saved from the row, through the normal contact update', async () => {
    const calls = stubFetchWithBodies(200, null);
    render(<PartyProfilePanel side="customer" party={makeCustomer({ id: 'c1', name: 'Acme', deliveryMethod: 'post' })} />);
    const select = screen.getByLabelText('Preferred delivery of Acme') as HTMLSelectElement;
    assert.equal(select.value, 'post');
    assert.match(screen.getByText(/a paper copy is mailed/).textContent || '', /emails still go when someone presses Email/, 'the page says what the choice means and what it does not stop');
    await act(async () => { fireEvent.change(select, { target: { value: 'email' } }); });
    await waitFor(() => assert.ok(calls.some(c => c.url.includes('/api/v1/commands/customer.update'))));
    const request = calls.find(c => c.url.includes('/api/v1/commands/customer.update'))!;
    const body = request.body as { workspaceId: string; input: { id: string; data: { deliveryMethod: string } } };
    assert.deepEqual([request.method, body.workspaceId, body.input.id, body.input.data.deliveryMethod], ['POST', 'component-workspace', 'c1', 'email']);
  });

  test('a vendor with nothing chosen reads Email, and a viewer gets no control', () => {
    render(<PartyProfilePanel side="vendor" party={makeVendor({ id: 'v1', name: 'Paper Co' })} />);
    assert.equal((screen.getByLabelText('Preferred delivery of Paper Co') as HTMLSelectElement).value, 'email');
    cleanup();
    setComponentWorkspace('viewer');
    render(<PartyProfilePanel side="vendor" party={makeVendor({ id: 'v2', name: 'Quiet Co', deliveryMethod: 'none' })} />);
    assert.equal(screen.queryByLabelText(/^Preferred delivery of/), null);
    assert.ok(screen.getByText('Nothing automatic'));
  });
});

describe("the invoice's Email dialog", () => {
  beforeEach(() => {
    setComponentWorkspace('owner');
    stubFetch(404, { events: [] });
  });
  afterEach(() => cleanup());

  const invoice = (customerId: string) => ({
    id: 'i1', uid: 'u1', workspaceId: 'component-workspace', customerId, number: 'INV-9',
    amountCents: 5000, dueDate: '2026-09-01', status: 'sent',
  } as Invoice);

  test('a customer who asked for paper is told, and the button says what it really does', () => {
    useLedgerStore.setState({ customers: [makeCustomer({ id: 'c1', name: 'Acme', email: 'ap@acme.test', deliveryMethod: 'post' })] });
    render(<InvoiceEmailDialog invoice={invoice('c1')} onClose={() => {}} />);
    assert.match(screen.getByText(/asked for a posted copy/).textContent || '', /emails it anyway/);
    assert.ok(screen.getByRole('button', { name: 'Email anyway' }));
  });

  test('nothing chosen: a plain Send, no warning', () => {
    useLedgerStore.setState({ customers: [makeCustomer({ id: 'c2', name: 'Plain Co', email: 'ap@plain.test' })] });
    render(<InvoiceEmailDialog invoice={invoice('c2')} onClose={() => {}} />);
    assert.equal(screen.queryByText(/asked for a/), null);
    assert.ok(screen.getByRole('button', { name: 'Send' }));
  });
});
