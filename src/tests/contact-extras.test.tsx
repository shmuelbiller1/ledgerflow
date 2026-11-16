/**
 * Customer and vendor extras (Y-21 Y-22 Y-24 Y-25): the shared contact form adds and edits (the old
 * forms could only add, so a wrong email could not be fixed), people to contact, tags and a default
 * currency; the contact page shows them with a notes timeline; new invoices and bills start in the
 * contact's currency.
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PartyModal from '../components/common/PartyModal';
import type { PartyFields } from '../components/common/PartyModal';
import PartyProfilePanel from '../components/common/PartyProfilePanel';
import InvoiceModal from '../components/sales/InvoiceModal';
import BillModal from '../components/purchases/BillModal';
import { addNote, allTags, cleanContacts, hasTag, parseTags } from '../lib/contacts';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeChartAccount, makeCustomer, makeVendor } from './fixtures';
import type { Bill, Invoice, Workspace } from '../types';
import { setComponentWorkspace } from './helpers/componentFixtures';

describe('contact helpers', () => {
  test('tags: trimmed, no empties or repeats in any case', () => {
    assert.deepEqual(parseTags(' wholesale, VIP ,, vip,  late   payer '), ['wholesale', 'VIP', 'late payer']);
    assert.deepEqual(allTags([{ tags: ['b', 'A'] }, { tags: ['a', 'c'] }, {}]), ['A', 'b', 'c']);
    assert.equal(hasTag({ tags: ['VIP'] }, 'vip'), true);
    assert.equal(hasTag({ tags: [] }, 'vip'), false);
    assert.equal(hasTag({}, null), true);
  });

  test('people need a name; emails lower case; empty fields dropped', () => {
    assert.deepEqual(cleanContacts([{ name: ' Dana ', email: ' Dana@Acme.TEST ', role: '' }, { name: '  ', email: 'x@y.z' }]), [{ name: 'Dana', email: 'dana@acme.test' }]);
  });

  test('notes: newest first, empty ignored, author kept', () => {
    const one = addNote([], 'Called, will pay Friday', 'me@shop.test', '2026-10-01T09:00:00Z', 'n1');
    const two = addNote(one, 'Paid', undefined, '2026-10-03T09:00:00Z', 'n2');
    assert.deepEqual(two.map(n => n.id), ['n2', 'n1']);
    assert.equal(two[1].by, 'me@shop.test');
    assert.equal(addNote(two, '   ', 'x', 'now', 'n3'), two);
  });
});

describe('contact form', () => {
  beforeEach(() => useAuthStore.setState({ currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD' } as Workspace] }));
  afterEach(() => cleanup());

  test('a new customer with a currency, tags and a person to contact', () => {
    const saved: PartyFields[] = [];
    render(<PartyModal side="customer" isOpen onClose={() => {}} onSave={p => { saved.push(p); }} />);
    fireEvent.change(screen.getByLabelText('Customer Name'), { target: { value: 'Euro GmbH' } });
    fireEvent.change(screen.getByLabelText('Default currency for new invoices'), { target: { value: 'EUR' } });
    fireEvent.change(screen.getByLabelText('Tags (separated by commas)'), { target: { value: 'export, priority' } });
    fireEvent.click(screen.getByText('Add a person'));
    fireEvent.change(screen.getByLabelText('Contact 1 name'), { target: { value: 'Jonas' } });
    fireEvent.change(screen.getByLabelText('Contact 1 email'), { target: { value: 'AP@euro.test' } });
    fireEvent.submit(screen.getByLabelText('Customer Name').closest('form')!);
    assert.deepEqual(saved, [{ name: 'Euro GmbH', email: '', phone: '', status: 'active', balanceCents: 0, currency: 'EUR', tags: ['export', 'priority'], contacts: [{ name: 'Jonas', email: 'ap@euro.test' }] }]);
  });

  test('editing a vendor: its values filled in; cleared tags and people are saved cleared', () => {
    const saved: PartyFields[] = [];
    const vendor = makeVendor({ id: 'v1', name: 'Paper Co', email: 'old@paper.test', category: 'Supplies', tags: ['local'], contacts: [{ name: 'Ann' }], currency: 'GBP' });
    render(<PartyModal side="vendor" isOpen initial={vendor} onClose={() => {}} onSave={p => { saved.push(p); }} />);
    assert.ok(screen.getByRole('dialog', { name: 'Edit Vendor' }));
    assert.equal((screen.getByLabelText('Email Address') as HTMLInputElement).value, 'old@paper.test');
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'new@paper.test' } });
    fireEvent.change(screen.getByLabelText('Tags (separated by commas)'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Remove contact 1'));
    fireEvent.change(screen.getByLabelText('Default currency for new bills'), { target: { value: '' } });
    fireEvent.submit(screen.getByLabelText('Vendor Name').closest('form')!);
    assert.deepEqual(saved, [{ id: 'v1', name: 'Paper Co', email: 'new@paper.test', phone: '', status: 'active', category: 'Supplies', currency: '', tags: [], contacts: [] }]);
  });
});

describe('contact page panel', () => {
  afterEach(() => cleanup());

  test('shows address, currency, tags, people and notes; Edit opens the form with the values', () => {
    useAuthStore.setState({ user: { uid: 'owner', email: 'me@shop.test' } as never, currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', uid: 'owner', name: 'W', currency: 'USD' } as Workspace] });
    const customer = makeCustomer({
      id: 'c1', name: 'Acme', address: '1 Main St', currency: 'EUR', tags: ['vip'], contacts: [{ name: 'Dana', role: 'Accounts', email: 'dana@acme.test' }],
      noteLog: [{ id: 'n2', text: 'Promised to pay Friday', at: '2026-10-02T10:00:00Z', by: 'me@shop.test' }, { id: 'n1', text: 'First call', at: '2026-10-01T10:00:00Z' }],
    });
    render(<PartyProfilePanel side="customer" party={customer} />);
    const details = screen.getByRole('region', { name: 'Details' });
    for (const text of ['1 Main St', 'EUR', 'vip', 'Dana', 'dana@acme.test', 'Promised to pay Friday']) assert.ok(within(details).getByText(new RegExp(text)), text);
    const notes = within(details).getAllByRole('listitem').map(li => li.textContent || '');
    assert.ok(notes.findIndex(t => t.includes('Promised')) < notes.findIndex(t => t.includes('First call')), 'newest note first');
    fireEvent.click(screen.getByRole('button', { name: 'Edit customer' }));
    assert.equal((screen.getByLabelText('Customer Name') as HTMLInputElement).value, 'Acme');
  });

  test('a refused profile or note command keeps the edit dialog and note draft', async () => {
    const workspace = setComponentWorkspace('owner');
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {} });
      return Response.json({ message: 'Contact update refused' }, { status: 403 });
    }) as typeof fetch;
    render(<PartyProfilePanel side="customer" party={makeCustomer({ id: 'c1', name: 'Acme', workspaceId: workspace.id })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit customer' }));
    const name = screen.getByLabelText('Customer Name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Keep this contact draft' } });
    await act(async () => { fireEvent.submit(name.closest('form')!); });
    await waitFor(() => assert.equal(calls.length, 1));
    assert.ok(screen.getByRole('dialog', { name: 'Edit Customer' }));
    assert.equal((screen.getByLabelText('Customer Name') as HTMLInputElement).value, 'Keep this contact draft');
    assert.equal(calls[0].url, '/api/v1/commands/customer.update');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const note = screen.getByLabelText('New note') as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: 'Keep this note draft' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add note' })); });
    await waitFor(() => assert.equal(calls.length, 2));
    assert.equal(note.value, 'Keep this note draft');
  });

  test('a viewer reads but cannot edit or add notes', () => {
    useAuthStore.setState({ user: { uid: 'v1' } as never, currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', uid: 'owner', name: 'W', currency: 'USD', roles: { v1: 'viewer' } } as unknown as Workspace] });
    render(<PartyProfilePanel side="vendor" party={makeVendor({ id: 'v9', name: 'Paper Co' })} />);
    assert.equal(screen.queryByRole('button', { name: 'Edit vendor' }), null);
    assert.equal(screen.queryByLabelText('New note'), null);
    assert.ok(screen.getByText('No notes yet.'));
  });
});

describe('new documents start in the contact\'s currency (Y-22)', () => {
  beforeEach(() => {
    stubFetch(404);
    useAuthStore.setState({ currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD' } as Workspace] });
    useLedgerStore.setState({ inventory: [], taxRates: [], bills: [], transactions: [] });
  });
  afterEach(() => cleanup());

  test('an invoice for a customer billed in euros starts in EUR; a home-currency customer brings it back', () => {
    const customers = [makeCustomer({ id: 'c1', name: 'Euro GmbH', currency: 'EUR' }), makeCustomer({ id: 'c2', name: 'Local Ltd' })];
    render(<InvoiceModal isOpen onClose={() => {}} onSave={(_: Partial<Invoice>) => {}} customers={customers} accounts={[makeChartAccount({ id: 'rev', type: 'income' })]} />);
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'Euro GmbH' } });
    assert.equal((screen.getByLabelText('Currency') as HTMLSelectElement).value, 'EUR');
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'Local Ltd' } });
    assert.equal((screen.getByLabelText('Currency') as HTMLSelectElement).value, 'USD');
  });

  test('a bill from a vendor in pounds starts in GBP and is saved with the rate entered', async () => {
    const saved: Partial<Bill>[] = [];
    render(<BillModal isOpen onClose={() => {}} onSave={b => { saved.push(b); }} vendors={[makeVendor({ id: 'v1', name: 'UK Ltd', currency: 'GBP' })]} accounts={[makeChartAccount({ id: 'exp', type: 'expense' })]} />);
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'v1' } });
    assert.equal((screen.getByLabelText('Currency') as HTMLSelectElement).value, 'GBP');
    fireEvent.change(screen.getByLabelText('1 GBP = ? USD'), { target: { value: '1.25' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Paper' } });
    fireEvent.change(screen.getByLabelText('Expense Account'), { target: { value: 'exp' } });
    fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '100' } });
    await act(async () => { fireEvent.click(screen.getByText('Save & Close')); });
    await waitFor(() => assert.equal(saved.length, 1));
    assert.deepEqual({ currency: saved[0].currency, exchangeRate: saved[0].exchangeRate }, { currency: 'GBP', exchangeRate: 1.25 });
  });
});
