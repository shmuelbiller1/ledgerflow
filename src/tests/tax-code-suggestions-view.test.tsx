import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import TaxCodeSuggestionsReportView, { historyFromDocuments } from '../components/reporting/TaxCodeSuggestionsReportView';
import { suggestTaxCode } from '../lib/tax/taxSuggestions';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';

afterEach(() => cleanup());

function setWorkspace(id = 'test-ws') {
  useAuthStore.setState({
    isGuest: false,
    user: { uid: 'tester' } as never,
    currentWorkspaceId: id,
    workspaces: [{ id, uid: 'tester', name: 'Test', currency: 'USD' } as never],
  });
  useDataNeedsStore.setState({ loaded: { invoices: true, bills: true } as never, failed: {} as never, loadedWorkspaceId: id });
}

test('history builder groups invoice and bill tax codes by date', () => {
  const hist = historyFromDocuments(
    [{ dueDate: '2026-01-05', date: '2026-01-05', taxCodeId: 'zero', customerId: 'c1', workspaceId: 'ws1' } as never,
     { dueDate: '2026-02-01', date: '2026-02-01', taxCodeId: 'vat18', customerId: 'c1', items: [{ itemId: 'i1' }], workspaceId: 'ws1' } as never],
    [{ dueDate: '2026-01-10', taxCodeId: 'vat17', vendorId: 'v1', splits: [{ itemId: 'i2' }], workspaceId: 'ws1' } as never],
    'ws1',
  );
  assert.equal(hist.length, 3);
  assert.equal(hist[0].taxCodeId, 'zero');
  assert.equal(hist[2].taxCodeId, 'vat18');
  // recent vat18 outweighs older zero for same contact
  const s = suggestTaxCode(hist, { contactId: 'c1' }, '2026-02-02');
  assert.equal(s?.taxCodeId, 'vat18');
});

test('C-120 screen shows suggestion, share, unusual flag and export, with calculation-only disclaimer', () => {
  setWorkspace();
  useLedgerStore.setState({
    invoices: [
      { id: 'i1', workspaceId: 'test-ws', customerId: 'c1', date: '2026-01-05', dueDate: '2026-01-20', status: 'sent', taxCodeId: 'vat18', items: [{ itemId: 'i1', description: 'x', quantity: 1, rateCents: 1000, amountCents: 1000, accountId: 'a1' }] } as never,
      { id: 'i2', workspaceId: 'test-ws', customerId: 'c1', date: '2026-02-05', dueDate: '2026-02-20', status: 'sent', taxCodeId: 'vat18', items: [{ itemId: 'i1', description: 'x', quantity: 1, rateCents: 1000, amountCents: 1000, accountId: 'a1' }] } as never,
      { id: 'i3', workspaceId: 'test-ws', customerId: 'c1', date: '2026-03-05', dueDate: '2026-03-20', status: 'sent', taxCodeId: 'vat18', items: [{ itemId: 'i1', description: 'x', quantity: 1, rateCents: 1000, amountCents: 1000, accountId: 'a1' }] } as never,
      { id: 'i4', workspaceId: 'test-ws', customerId: 'c2', date: '2026-03-05', dueDate: '2026-03-20', status: 'sent', taxCodeId: 'zero', items: [{ itemId: 'i9', description: 'x', quantity: 1, rateCents: 1000, amountCents: 1000, accountId: 'a1' }] } as never,
    ],
    bills: [],
    truncatedCollections: {} as never,
  } as never);

  render(<TaxCodeSuggestionsReportView/>);
  assert.ok(screen.getByRole('heading', { name: 'Tax code suggestions from history' }));
  assert.match(document.body.textContent || '', /calculation status only/i);
  assert.match(document.body.textContent || '', /never applied automatically/i);

  // Initially need at least one filter
  const contact = screen.getByLabelText('Customer/Vendor ID (contact)');

  fireEvent.change(contact, { target: { value: 'c1' } });
  const item = screen.getByLabelText('Item ID');
  fireEvent.change(item, { target: { value: 'i1' } });
  // Should show suggestion vat18
  assert.match(document.body.textContent || '', /Suggested code:/);
  assert.match(document.body.textContent || '', /vat18/);
  assert.match(document.body.textContent || '', /Based on:.*3 document/);

  // Unusual check: enter zero should be unusual
  fireEvent.change(screen.getByLabelText('Draft tax code'), { target: { value: 'zero' } });
  assert.match(document.body.textContent || '', /Unusual:/);
  assert.match(document.body.textContent || '', /usually got.*vat18/);

  // Change to usual => not flagged
  fireEvent.change(screen.getByLabelText('Draft tax code'), { target: { value: 'vat18' } });
  assert.match(document.body.textContent || '', /Not flagged as unusual/);

  // CSV button enabled
  const exportBtn = screen.getByRole('button', { name: 'Export history CSV' });
  assert.equal((exportBtn as HTMLButtonElement).disabled, false);

  // Entity filter falls back: no row has entity il, so the contact+item+entity level fails and it falls back to contact+item and still suggests vat18
  fireEvent.change(screen.getByLabelText('Entity label value'), { target: { value: 'il' } });
  assert.match(document.body.textContent || '', /Match: contact\+item/);
  assert.match(document.body.textContent || '', /Suggested code:.*vat18/);
});

test('C-120 empty state says what to do', () => {
  setWorkspace();
  useLedgerStore.setState({ invoices: [], bills: [], truncatedCollections: {} as never } as never);
  render(<TaxCodeSuggestionsReportView/>);
  assert.match(document.body.textContent || '', /No saved invoice or bill.*has a tax code yet/);
});

test('C-120 provisional banner when capped', () => {
  setWorkspace();
  useLedgerStore.setState({
    invoices: [{ id: 'i1', workspaceId: 'test-ws', customerId: 'c1', date: '2026-01-05', dueDate: '2026-01-05', status: 'sent', taxCodeId: 'vat18', items: [] } as never],
    bills: [],
    truncatedCollections: { invoices: true } as never,
  } as never);
  render(<TaxCodeSuggestionsReportView/>);
  assert.match(screen.getByRole('alert').textContent || '', /capped/);
});
