import { inlineEditName } from './helpers/inlineEditName';
/**
 * Payment runs (K-24): every open bill due by a date, one payment per vendor, and a bank file with
 * each vendor's bank details; vendors keep their bank details on their page (an IBAN must pass its
 * check digits; viewers see only the last four).
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PaymentRunDialog from '../components/purchases/PaymentRunDialog';
import VendorDetailView from '../components/purchases/VendorDetailView';
import { accountNumberProblem, bankFileCsv, billsDueBy, ibanValid, maskAccount, missingBankDetails } from '../lib/paymentRun';
import { paymentPlan } from '../lib/bulkDocuments';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount } from './fixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { Bill, Vendor } from '../types';

const bill = (id: string, vendorId: string, vendorName: string, dueDate: string, amountCents: number, over: Partial<Bill> = {}) =>
  ({ id, uid: 'u', workspaceId: 'component-workspace', number: id.toUpperCase(), vendorId, vendorName, date: '2026-01-01', dueDate, amountCents, status: 'approved', currency: 'USD', ...over }) as Bill;
const bills = [
  bill('b-2', 'paper', 'Paper Co', '2026-02-10', 5000),
  bill('b-1', 'paper', 'Paper Co', '2026-01-31', 2500, { amountPaidCents: 500 }),
  bill('b-3', 'ink', 'Ink Ltd', '2026-02-01', 9900),
  bill('later', 'ink', 'Ink Ltd', '2099-01-01', 100),
  bill('paid', 'ink', 'Ink Ltd', '2026-01-01', 100, { status: 'paid', amountPaidCents: 100 }),
  bill('draft', 'ink', 'Ink Ltd', '2026-01-01', 100, { status: 'draft' }),
  bill('eur', 'euro', 'Euro AG', '2026-01-15', 700, { currency: 'EUR', exchangeRate: 1.1 }),
];
const vendors = [
  { id: 'paper', name: 'Paper Co', bankDetails: { accountName: 'Paper Co Ltd', accountNumber: 'GB82 WEST 1234 5698 7654 32', routingCode: 'WEST GB2L' } },
  { id: 'ink', name: 'Ink Ltd' },
  { id: 'euro', name: 'Euro AG' },
] as Vendor[];

describe('Which bills, and the bank file', () => {
  test('open bills due by the date, oldest due first', () => {
    assert.deepEqual(billsDueBy(bills, '2026-02-05').map(b => b.id), ['eur', 'b-1', 'b-3']);
    assert.deepEqual(billsDueBy(bills, '2026-12-31').map(b => b.id), ['eur', 'b-1', 'b-3', 'b-2']);
  });

  test('IBAN check digits, account number rules and the masked view', () => {
    assert.equal(ibanValid('GB82 WEST 1234 5698 7654 32'), true);
    assert.equal(ibanValid('DE89370400440532013000'), true);
    assert.equal(ibanValid('GB82 WEST 1234 5698 7654 33'), false, 'one digit off');
    assert.equal(accountNumberProblem('GB82WEST12345698765433'), 'This IBAN has a typo (its check digits don’t match)');
    assert.equal(accountNumberProblem('12345678'), null, 'a plain account number');
    assert.equal(accountNumberProblem('12 34'), null);
    assert.equal(accountNumberProblem('12$4'), 'Use letters and digits only (4 to 34)');
    assert.equal(maskAccount('GB82 WEST 1234 5698 7654 32'), '•••• 5432');
  });

  test('one line per vendor with their bank details and the bills it pays; who has none', () => {
    const { payments } = paymentPlan(billsDueBy(bills, '2026-12-31').filter(b => b.id !== 'eur'), 'bill', 'USD');
    const bank = (id: string) => vendors.find(v => v.id === id)?.bankDetails;
    assert.equal(bankFileCsv(payments, bank, { date: '2026-02-12', currency: 'USD' }), [
      '"Payee","Account name","Account number / IBAN","Routing / sort code / BIC","Amount","Currency","Payment date","Reference"',
      '"Paper Co","Paper Co Ltd","GB82WEST12345698765432","WESTGB2L","70.00","USD","2026-02-12","B-1, B-2"',
      '"Ink Ltd","Ink Ltd","","","99.00","USD","2026-02-12","B-3"',
    ].join('\r\n'));
    assert.deepEqual(missingBankDetails(payments, bank).map(p => p.partyName), ['Ink Ltd']);
  });
});

describe('The payment run dialog', () => {
  const realClick = HTMLAnchorElement.prototype.click;
  let downloads = 0;
  beforeEach(() => {
    setComponentWorkspace('bookkeeper');
    useLedgerStore.setState({ accounts: [makeChartAccount({ id: 'bank', code: '1000', name: 'Checking', type: 'asset', category: 'Cash' })] });
    URL.createObjectURL = () => 'blob:run';
    URL.revokeObjectURL = () => {};
    downloads = 0;
    HTMLAnchorElement.prototype.click = function click() { downloads++; };
  });
  afterEach(() => { cleanup(); HTMLAnchorElement.prototype.click = realClick; });

  test('ticks the overdue bills, warns about missing bank details, pays one payment per vendor', async () => {
    const calls = stubFetchWithBodies(200, { status: 'success', data: { paymentId: 'p' } });
    let closed = 0;
    render(<PaymentRunDialog bills={bills} vendors={vendors} onClose={() => closed++} />);
    assert.match(document.body.textContent || '', /4 bills due by/);
    assert.match(document.body.textContent || '', /EUR: it is in EUR: record it from the bill/);
    assert.match(screen.getByRole('alert').textContent || '', /No bank details for Ink Ltd/);
    assert.match(document.body.textContent || '', /2 payments to 2 vendors for 3 bills: \$169\.00/);
    fireEvent.click(screen.getByLabelText('Pay bill B-3 from Ink Ltd'));
    assert.match(document.body.textContent || '', /1 payment to 1 vendor for 2 bills: \$70\.00/);
    assert.equal(screen.queryByRole('alert'), null, 'Paper Co has bank details');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pay and download bank file' })); });
    const posted = calls.filter(c => c.url === '/api/v1/payments');
    assert.equal(posted.length, 1);
    const body = posted[0].body as { vendorId: string; amountCents: number; cashAccountId: string; allocations: unknown[] };
    assert.deepEqual([body.vendorId, body.amountCents, body.cashAccountId], ['paper', 7000, 'bank']);
    assert.deepEqual(body.allocations, [{ documentId: 'b-1', documentType: 'bill', amountCents: 2000 }, { documentId: 'b-2', documentType: 'bill', amountCents: 5000 }]);
    assert.equal(downloads, 1, 'the bank file was downloaded');
    assert.equal(closed, 1);
  });

  test('nothing due says so', () => {
    stubFetchWithBodies(200, {});
    render(<PaymentRunDialog bills={bills.filter(b => b.id === 'later')} vendors={vendors} onClose={() => {}} />);
    assert.match(document.body.textContent || '', /No open bills are due by/);
    assert.equal((screen.getByRole('button', { name: 'Pay and download bank file' }) as HTMLButtonElement).disabled, true);
  });
});

describe('Bank details on the vendor page', () => {
  let writes: { url: string; method: string; body: Record<string, unknown> }[] = [];
  beforeEach(() => {
    writes = [];
    markComponentCollectionsLoaded('bills', 'payments', 'vendors');
    useLedgerStore.setState({ vendors, bills: [], payments: [] });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/commands/vendor.update') {
        writes.push({ url, method: init?.method || 'GET', body: JSON.parse(String(init?.body || '{}')) });
        return new Response(JSON.stringify({ status: 'success', data: { vendor: {} } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('an IBAN with a typo is refused; a good one is saved without spaces', async () => {
    setComponentWorkspace('owner');
    render(<VendorDetailView vendorId="ink" onBack={() => {}} />);
    const label = 'Account number or IBAN of Ink Ltd';
    fireEvent.click(screen.getByRole('button', { name: inlineEditName(`Edit ${label}`) }));
    fireEvent.change(screen.getByLabelText(label), { target: { value: 'GB82 WEST 1234 5698 7654 33' } });
    await act(async () => { fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' }); });
    assert.match(document.body.textContent || '', /This IBAN has a typo/);
    assert.equal(writes.length, 0);
    fireEvent.change(screen.getByLabelText(label), { target: { value: 'gb82 west 1234 5698 7654 32' } });
    await act(async () => { fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' }); });
    await waitFor(() => assert.equal(writes.length, 1));
    assert.equal(writes[0].url, '/api/v1/commands/vendor.update');
    const request = writes[0].body as { input: { id: string; data: { bankDetails: { accountNumber: string } } } };
    assert.deepEqual([writes[0].method, request.input.id, request.input.data.bankDetails.accountNumber], ['POST', 'ink', 'GB82WEST12345698765432']);
  });

  test('a viewer sees only the last four digits', () => {
    setComponentWorkspace('viewer');
    render(<VendorDetailView vendorId="paper" onBack={() => {}} />);
    assert.match(document.body.textContent || '', /•••• 5432/);
    assert.doesNotMatch(document.body.textContent || '', /GB82 WEST/);
  });
});
