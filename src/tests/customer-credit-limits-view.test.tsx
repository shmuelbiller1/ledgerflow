import { inlineEditName } from './helpers/inlineEditName';
/**
 * A-69 screen: customer credit limits. Hand-checked from the loaded customers and invoices: the
 * customer past their limit is first with its excess, a customer without a limit is never over, a
 * foreign-currency balance stays beside the row, and the limit is editable in place on the
 * customer's own record (the money box is shown to a non-viewer and to nobody else).
 */
import { stubFetch, stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CustomerCreditLimitReportView from '../components/reporting/CustomerCreditLimitReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { RMAS_METADATA_FIELD, WARRANTIES_METADATA_FIELD } from '../lib/warehouseRecords';

const customers = [
  { id: 'c1', name: 'Acme Ltd', metadata: { creditLimitCents: 100_000 }, workspaceId: 'w1' },
  { id: 'c2', name: 'Beta GmbH', metadata: {}, workspaceId: 'w1' },
];
const invoices = [
  { id: 'i1', customerId: 'c1', amountCents: 120_000, amountPaidCents: 0, currency: 'USD', status: 'sent', dueDate: '2026-09-01', workspaceId: 'w1' },
  { id: 'i2', customerId: 'c2', amountCents: 50_000, amountPaidCents: 0, currency: 'EUR', status: 'sent', workspaceId: 'w1' },
];

describe('Customer credit limits screen', () => {
  beforeEach(() => {
    stubFetch(404);
    useAuthStore.setState({ isGuest: true, user: null, currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD' }] } as never);
    useDataNeedsStore.setState({ failed: {} as never });
    useLedgerStore.setState({ customers: customers as never, invoices: invoices as never, truncatedCollections: {} as never });
  });
  afterEach(() => { cleanup(); });

  test('the customer past the limit is first and a customer without one is never over', () => {
    render(<CustomerCreditLimitReportView />);
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    assert.match(rows[0].textContent || '', /Acme Ltd/);
    assert.match(rows[0].textContent || '', /Over limit/);
    assert.match(rows[0].textContent || '', /1,200\.00/, 'the open balance in the base currency');
    assert.match(rows[0].textContent || '', /200\.00/, 'the headroom is negative: the excess');
    assert.match(rows[0].textContent || '', /120\.00%/);
    const beta = rows.find(row => (row.textContent || '').includes('Beta GmbH'))!;
    assert.match(beta.textContent || '', /No limit recorded/, 'never treated as over it');
    assert.match(beta.textContent || '', /€500\.00/, 'the foreign balance stays beside the row, in its own currency');
    assert.match(screen.getByText(/1 customer\(s\) over their recorded limit/).textContent || '', /^1 customer/);
    assert.match(screen.getByText(/never added in or converted/).textContent || '', /never added in or converted/);
  });

  test('the limit is an editable money field, and a customer without a record has nothing to edit', () => {
    useAuthStore.setState({ isGuest: false, user: { uid: 'u1' }, currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD', uid: 'u1' }] } as never);
    render(<CustomerCreditLimitReportView />);
    const acmeLimit = screen.getByLabelText(inlineEditName('Edit Credit limit of Acme Ltd'));
    assert.equal(acmeLimit.tagName, 'BUTTON');
    assert.match(acmeLimit.textContent || '', /1,000\.00/);
    const betaLimit = screen.getByLabelText(inlineEditName('Edit Credit limit of Beta GmbH'));
    assert.equal(betaLimit.tagName, 'BUTTON');
    assert.match(betaLimit.textContent || '', /Set a limit/);
  });

  test('editing the credit limit sends only its metadata patch, not protected customer histories', async () => {
    useAuthStore.setState({ isGuest: false, user: { uid: 'u1' }, currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD', uid: 'u1' }] } as never);
    useDataNeedsStore.setState({ loaded: { customers: true, invoices: true }, failed: {} as never });
    useLedgerStore.setState({ customers: [{
      ...customers[0], metadata: {
        creditLimitCents: 100_000,
        [WARRANTIES_METADATA_FIELD]: { serial_one: { endDate: '2028-01-01' } },
        [RMAS_METADATA_FIELD]: { rma_one: { status: 'approved' } },
      },
    }] as never });
    const calls = stubFetchWithBodies(200, { status: 'success', data: {} });
    render(<CustomerCreditLimitReportView />);
    fireEvent.click(screen.getByLabelText(inlineEditName('Edit Credit limit of Acme Ltd')));
    const input = screen.getByLabelText('Credit limit of Acme Ltd');
    fireEvent.change(input, { target: { value: '1500.00' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => assert.ok(calls.some(call => call.url.endsWith('/api/v1/commands/customer.update'))));
    const request = calls.find(call => call.url.endsWith('/api/v1/commands/customer.update'))!;
    assert.deepEqual((request.body as { input: { id: string; data: Record<string, unknown> } }).input, {
      id: 'c1', data: { metadata: { creditLimitCents: 150_000 } },
    });
  });
});
