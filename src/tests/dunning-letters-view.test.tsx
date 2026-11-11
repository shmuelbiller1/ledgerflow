/**
 * A-70 screen (task A-176): dunning letters. Hand-checked: an invoice 60 days past due gets step 3
 * on the 7/21/45 schedule and its final-notice letter in English and Hebrew, a 10-day one step 1, and
 * a paid, draft or not-yet-due invoice is never a letter. Nothing is sent from the screen.
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import DunningLettersReportView from '../components/reporting/DunningLettersReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { getLocalDateISO } from '../lib/utils';

const shift = (iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const today = getLocalDateISO();

const customers = [{ id: 'c1', workspaceId: 'w1', name: 'Acme Ltd' }];
const invoices = [
  { id: 'i1', workspaceId: 'w1', customerId: 'c1', number: 'INV-1', amountCents: 120_000, amountPaidCents: 0, currency: 'USD', status: 'sent', dueDate: shift(today, -60), date: '2026-08-01' },
  { id: 'i2', workspaceId: 'w1', customerId: 'c1', number: 'INV-2', amountCents: 50_000, amountPaidCents: 0, currency: 'USD', status: 'sent', dueDate: shift(today, -10), date: '2026-09-10' },
  { id: 'i3', workspaceId: 'w1', customerId: 'c1', number: 'INV-3', amountCents: 70_000, amountPaidCents: 70_000, currency: 'USD', status: 'paid', dueDate: shift(today, -60), date: '2026-08-01' },
  { id: 'i4', workspaceId: 'w1', customerId: 'c1', number: 'INV-4', amountCents: 10_000, currency: 'USD', status: 'draft', dueDate: shift(today, -60), date: '2026-08-01' },
  { id: 'i5', workspaceId: 'w1', customerId: 'c1', number: 'INV-5', amountCents: 10_000, currency: 'USD', status: 'sent', dueDate: shift(today, 10), date: '2026-10-01' },
];

describe('Dunning letters screen', () => {
  beforeEach(() => {
    stubFetch(404);
    useAuthStore.setState({ isGuest: true, user: null, currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD' }] } as never);
    useDataNeedsStore.setState({ failed: {} as never });
    useLedgerStore.setState({ customers: customers as never, invoices: invoices as never, truncatedCollections: {} as never });
  });
  afterEach(() => { cleanup(); });

  test('overdue invoices get the step their age calls for, oldest first', () => {
    render(<DunningLettersReportView />);
    assert.match(screen.getByText(/overdue invoice\(s\)/).textContent || '', /2 overdue invoice\(s\) · 2 with a letter due today/);
    const rows = within(screen.getByRole('table', { name: /Overdue invoices and the reminder due/ })).getAllByRole('row').slice(1);
    assert.match(rows[0].textContent || '', new RegExp(`INV-1Acme Ltd${shift(today, -60)}60\\$1,200\\.00Step 3`));
    assert.match(rows[1].textContent || '', new RegExp(`INV-2Acme Ltd${shift(today, -10)}10\\$500\\.00Step 1`));
    assert.equal(rows.length, 2, 'the paid, draft and not-yet-due invoices are not letters');
    assert.ok(screen.getByText(/Nothing is sent from this screen/), 'the screen says so');
  });

  test('the letter preview reads the invoice figures, in English and in Hebrew', () => {
    render(<DunningLettersReportView />);
    assert.match(screen.getByRole('heading', { name: /Letter for INV-1/ }).textContent || '', /step 3 \(English\)/);
    assert.match(screen.getByText(/Final notice: invoice INV-1/).textContent || '', /Final notice: invoice INV-1/);
    assert.match(screen.getByText(/remains unpaid 60 days after its due date/).textContent || '', /1,200\.00 USD/);
    fireEvent.change(screen.getByLabelText('Letter language'), { target: { value: 'he' } });
    assert.match(screen.getByText(/הודעה אחרונה: חשבונית INV-1/).textContent || '', /הודעה אחרונה/);
    assert.match(screen.getByRole('heading', { name: /Letter for INV-1/ }).textContent || '', /עברית/);
  });

  test('the schedule is checked: step days must rise', () => {
    render(<DunningLettersReportView />);
    fireEvent.change(screen.getByLabelText('Step 2 from days overdue'), { target: { value: '3' } });
    assert.ok(screen.getByText(/The step days rise/));
    assert.equal(screen.queryByRole('table', { name: /Overdue invoices/ }), null, 'no letters on a broken schedule');
  });
});
