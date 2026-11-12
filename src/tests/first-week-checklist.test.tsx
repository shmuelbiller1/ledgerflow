import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import FirstWeekChecklist from '../components/dashboard/FirstWeekChecklist';
import { evaluateFirstWeekChecklist, firstWeekStorageKey } from '../lib/firstWeekChecklist';
import { useAuthStore } from '../stores/useAuthStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import { getSupabase } from '../lib/db/client';
import type { ChartAccount, Customer, Invoice, Payment } from '../types';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';

const realFetch = globalThis.fetch;
const ws = 'component-workspace';
const account = (overrides: Partial<ChartAccount> = {}): ChartAccount => ({
  id: 'bank-1', uid: 'test-user', workspaceId: ws, code: '1000', name: 'Checking account', type: 'asset',
  subtype: 'checking', balanceCents: 0, ...overrides,
});
const customer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'customer-1', uid: 'test-user', workspaceId: ws, name: 'Acme', category: 'customer', ...overrides,
} as Customer);
const invoice = (status: Invoice['status'], overrides: Partial<Invoice> = {}): Invoice => ({
  id: 'invoice-1', uid: 'test-user', workspaceId: ws, customerId: 'customer-1', amountCents: 1000,
  dueDate: '2026-12-01', status, ...overrides,
});
const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: 'payment-1', uid: 'test-user', workspaceId: ws, direction: 'received', contactId: 'customer-1', date: '2026-11-11',
  amountCents: 1000, method: 'bank_transfer', depositAccountId: 'bank-1', allocations: [], unappliedCents: 1000,
  status: 'posted', createdAt: '2026-11-11T12:00:00.000Z', ...overrides,
});

beforeEach(() => {
  setComponentWorkspace();
  globalThis.fetch = (async input => String(input).includes('/rest/v1/')
    ? new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response(JSON.stringify({ status: 'success' }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  useLedgerStore.setState({ accounts: [], customers: [], invoices: [], payments: [], truncatedCollections: {} });
  useDataNeedsStore.setState({ loadedWorkspaceId: ws, failed: {} });
  markComponentCollectionsLoaded('accounts', 'customers', 'invoices', 'payments');
  localStorage.removeItem(firstWeekStorageKey('test-user', ws));
  localStorage.removeItem(`${firstWeekStorageKey('test-user', ws)}:pnl`);
});

afterEach(async () => {
  cleanup();
  globalThis.fetch = realFetch;
  getSupabase().realtime.disconnect();
  await getSupabase().auth.dispose();
});

function evaluate(overrides: Partial<Parameters<typeof evaluateFirstWeekChecklist>[0]> = {}) {
  return evaluateFirstWeekChecklist({ workspaceId: ws, accounts: [], customers: [], invoices: [], payments: [], profitAndLossVisited: false, ...overrides });
}

describe('N-1 first-week checklist signals', () => {
  test('workspace-scoped cash/bank account and saved customer are the only matching records', () => {
    const result = evaluate({
      accounts: [account({ name: 'Petty cash', subtype: 'cash' }), account({ id: 'bank-2', workspaceId: 'other-books' })],
      customers: [customer({ workspaceId: 'other-books' })],
    });
    assert.equal(result.find(step => step.id === 'bank')?.done, false, 'petty cash is not a bank account and other books are excluded');
    assert.equal(result.find(step => step.id === 'customer')?.done, false, 'other books are excluded');
  });

  test('a bank account, a saved customer, and an issued invoice count, but a draft or void invoice does not', () => {
    assert.equal(evaluate({ accounts: [account()], customers: [customer()], invoices: [invoice('draft'), invoice('void', { id: 'void' })] }).filter(step => step.done).length, 2);
    assert.equal(evaluate({ invoices: [invoice('sent')] }).find(step => step.id === 'invoice')?.done, true);
    assert.equal(evaluate({ invoices: [invoice('paid')] }).find(step => step.id === 'invoice')?.done, true);
  });

  test('only a posted customer receipt counts as a recorded payment', () => {
    for (const row of [payment({ status: 'draft' }), payment({ status: 'void' }), payment({ direction: 'made' }), payment({ workspaceId: 'other-books' })]) {
      assert.equal(evaluate({ payments: [row] }).find(step => step.id === 'payment')?.done, false);
    }
    assert.equal(evaluate({ payments: [payment()] }).find(step => step.id === 'payment')?.done, true);
  });

  test('the report step reflects the explicit report action, independently of accounting records', () => {
    assert.equal(evaluate({ profitAndLossVisited: false }).find(step => step.id === 'profit-and-loss')?.done, false);
    assert.equal(evaluate({ profitAndLossVisited: true }).find(step => step.id === 'profit-and-loss')?.done, true);
  });
});

describe('N-1 first-week checklist UI', () => {
  test('shows actionable incomplete steps and updates from saved workspace records', async () => {
    render(<FirstWeekChecklist />);
    assert.ok(screen.getByRole('heading', { name: 'Your first week' }));
    assert.ok(screen.getByRole('button', { name: 'Open Customers' }));
    await act(async () => {
      useLedgerStore.setState({
        accounts: [account()], customers: [customer()], invoices: [invoice('sent')], payments: [payment()],
      });
    });
    assert.match(screen.getByText('4 of 5 steps complete').textContent || '', /4 of 5/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open profit and loss' })); });
    assert.equal(useUIStore.getState().activeTab, 'reports');
    assert.equal(useUIStore.getState().activeReportTab, 'pnl');
    assert.equal(screen.queryByRole('heading', { name: 'Your first week' }), null, 'all completed steps clear the checklist');
    assert.equal(localStorage.getItem(`${firstWeekStorageKey('test-user', ws)}:pnl`), 'visited');
  });

  test('hiding the checklist is persisted per user and workspace', async () => {
    render(<FirstWeekChecklist />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide first-week checklist' }));
    assert.equal(screen.queryByRole('heading', { name: 'Your first week' }), null);
    assert.equal(localStorage.getItem(firstWeekStorageKey('test-user', ws)), 'dismissed');
    assert.notEqual(firstWeekStorageKey('test-user', ws), firstWeekStorageKey('other-user', ws));
    assert.notEqual(firstWeekStorageKey('test-user', ws), firstWeekStorageKey('test-user', 'other-books'));
  });

  test('a failed document read reports uncertainty and retries instead of treating the list as empty', async () => {
    render(<FirstWeekChecklist />);
    await act(async () => { useDataNeedsStore.getState().markFailed('payments', 'offline'); });
    assert.match(screen.getByRole('alert').textContent || '', /progress is not shown/i);
    fireEvent.click(screen.getByRole('button', { name: 'Retry checklist' }));
    assert.equal(useDataNeedsStore.getState().failed.payments, undefined);
  });

  test('guest preview does not present sample records as a real first-week checklist', () => {
    useAuthStore.setState({ isGuest: true, user: null });
    render(<FirstWeekChecklist />);
    assert.equal(screen.queryByRole('heading', { name: 'Your first week' }), null);
  });
});
