import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import express from 'express';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { reportRouter } from '../server/routes/reportRoutes';
import { getDb } from '../server/db/firestore';
import PartyAgingReportView from '../components/reporting/PartyAgingReportView';
import ContactBalanceSummaryView from '../components/reporting/ContactBalanceSummaryView';
import PaymentMethodSummaryView from '../components/reporting/PaymentMethodSummaryView';
import BudgetActualReportView from '../components/reporting/BudgetActualReportView';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';

afterEach(async () => {
  cleanup();
  await getSupabase().auth.dispose();
});

test('M-1: operational report endpoints compute uncapped aging, party balances, payment methods, and budget-actual periods on server', async (t) => {
  if (!process.env.DATABASE_URL && !process.env.LF_TEST_DATABASE_URL) {
    t.skip('No Postgres test database configured');
    return;
  }
  if (!process.env.DATABASE_URL && process.env.LF_TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
  }

  const wsId = `ws-m1-server-${Date.now()}`;
  const uid = '00000000-0000-0000-0000-0000000000a1';
  const db = getDb();

  await db.collection('workspaces').doc(wsId).set({
    uid,
    name: 'M-1 Server Reports Co',
    members: [uid],
    roles: { [uid]: 'owner' },
    currency: 'USD',
  });
  await db.collection('customers').doc(`${wsId}-cust-1`).set({
    workspaceId: wsId,
    uid,
    name: 'Uncapped Customer',
    email: 'c@example.com',
  });
  await db.collection('vendors').doc(`${wsId}-vend-1`).set({
    workspaceId: wsId,
    uid,
    name: 'Uncapped Vendor',
    email: 'v@example.com',
  });
  await db.collection('invoices').doc(`${wsId}-inv-10001`).set({
    workspaceId: wsId,
    uid,
    customerId: `${wsId}-cust-1`,
    invoiceNumber: 'INV-10001',
    date: '2026-01-05',
    dueDate: '2026-01-20',
    status: 'sent',
    amountCents: 42500,
    paidAmountCents: 0,
    currency: 'USD',
  });
  await db.collection('bills').doc(`${wsId}-bill-10001`).set({
    workspaceId: wsId,
    uid,
    vendorId: `${wsId}-vend-1`,
    billNumber: 'BILL-10001',
    date: '2026-01-06',
    dueDate: '2026-01-25',
    status: 'unpaid',
    amountCents: 18000,
    paidAmountCents: 0,
    currency: 'USD',
  });
  await db.collection('payments').doc(`${wsId}-pay-10001`).set({
    workspaceId: wsId,
    uid,
    customerId: `${wsId}-cust-1`,
    date: '2026-01-15',
    amountCents: 12000,
    direction: 'received',
    method: 'wire',
    status: 'completed',
    currency: 'USD',
  });
  await db.collection('budgets').doc(`${wsId}-bud-1`).set({
    workspaceId: wsId,
    uid,
    targetId: `${wsId}-acct-rent`,
    targetType: 'account',
    period: '2026-01',
    amountCents: 100000,
    createdAt: '2026-01-01',
  });
  await db.collection('chartAccounts').doc(`${wsId}-acct-rent`).set({
    workspaceId: wsId,
    uid,
    code: '6100',
    name: 'Office Rent',
    type: 'expense',
    balanceCents: 0,
  });
  await db.collection('chartAccounts').doc(`${wsId}-acct-cash`).set({
    workspaceId: wsId,
    uid,
    code: '1000',
    name: 'Operating Cash',
    type: 'asset',
    balanceCents: 0,
  });
  await db.collection('transactions').doc(`${wsId}-tx-10001`).set({
    workspaceId: wsId,
    uid,
    date: '2026-01-12',
    type: 'actual',
    status: 'completed',
    description: 'January Rent',
    totalAmountCents: 65000,
    currency: 'USD',
    lines: [
      { accountId: `${wsId}-acct-rent`, amountCents: 65000 },
      { accountId: `${wsId}-acct-cash`, amountCents: -65000 },
    ],
  });

  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { user?: { uid: string; email_verified: boolean } }).user = {
      uid,
      email_verified: true,
    };
    next();
  });
  app.use('/api/v1/reports', reportRouter);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as { port: number };
  const base = `http://127.0.0.1:${addr.port}/api/v1/reports`;

  try {
    const agingRes = await fetch(`${base}/party-aging?workspaceId=${wsId}&side=customer&asOfDate=2026-03-01`);
    assert.equal(agingRes.status, 200);
    const agingBody = await agingRes.json();
    assert.equal(agingBody.provenance.source, 'server');
    assert.equal(agingBody.rows.length, 1);
    assert.equal(agingBody.rows[0].partyName, 'Uncapped Customer');
    assert.equal(agingBody.rows[0].total, 42500);

    const balancesRes = await fetch(`${base}/party-balances?workspaceId=${wsId}&asOfDate=2026-03-01`);
    assert.equal(balancesRes.status, 200);
    const balancesBody = await balancesRes.json();
    assert.equal(balancesBody.provenance.source, 'server');
    assert.equal(balancesBody.customerRows[0].totalInvoicedCents, 42500);
    assert.equal(balancesBody.vendorRows[0].totalBilledCents, 18000);
    assert.equal(balancesBody.contactRows.length, 2);

    const methodsRes = await fetch(`${base}/payment-methods?workspaceId=${wsId}&startDate=2026-01-01&endDate=2026-01-31`);
    assert.equal(methodsRes.status, 200);
    const methodsBody = await methodsRes.json();
    assert.equal(methodsBody.provenance.source, 'server');
    assert.equal(methodsBody.rows[0].cents, 12000);

    const budgetRes = await fetch(`${base}/budget-actual-periods?workspaceId=${wsId}&startDate=2026-01-01&endDate=2026-01-31&mode=total`);
    assert.equal(budgetRes.status, 200);
    const budgetBody = await budgetRes.json();
    assert.equal(budgetBody.provenance.source, 'server');
    assert.equal(budgetBody.report.columns[0].actualCents, 65000);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.terminate();
  }
});

test('M-1: capped browser collections upgrade Aging, Contact Balance, Payment Method, and Budget Actual views from server endpoints', async () => {
  setComponentWorkspace();
  markComponentCollectionsLoaded(
    'bills', 'budgets', 'creditNotes', 'customers', 'invoices', 'payments', 'vendorCredits', 'vendors'
  );
  useLedgerStore.setState({
    customers: [],
    vendors: [],
    invoices: [],
    bills: [],
    payments: [],
    creditNotes: [],
    vendorCredits: [],
    budgets: [{
      id: 'b-cap',
      uid: 'test-user',
      targetId: 'acct-1',
      targetType: 'account',
      period: '2026-01',
      amountCents: 100000,
      createdAt: '2026-01-01',
    }],
    accounts: [{
      id: 'acct-1',
      uid: 'test-user',
      workspaceId: 'component-workspace',
      code: '6100',
      name: 'Cloud Hosting',
      type: 'expense',
      balanceCents: 0,
    }],
    transactions: [],
    truncatedCollections: {
      invoices: true,
      payments: true,
      transactions: true,
    },
  });

  let partyBalanceCalls = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/api/v1/reports/party-aging')) {
      return new Response(JSON.stringify({
        rows: [{
          partyId: 'c-server',
          partyName: 'Server Uncapped Co',
          buckets: { current: 99000, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 },
          total: 99000,
          documents: [],
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/v1/reports/party-balances')) {
      partyBalanceCalls += 1;
      return new Response(JSON.stringify({
        contactRows: [{
          key: 'c-server',
          name: 'Server Balance Contact',
          email: 'contact@server.test',
          customerId: 'c-server',
          receivableCents: 88000,
          payableCents: 0,
          netCents: 88000,
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/v1/reports/payment-methods')) {
      return new Response(JSON.stringify({
        rows: [{ id: 'ach', name: 'ACH', count: 3, cents: 77000, undated: 0 }],
        previousRows: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/v1/reports/budget-actual-periods')) {
      return new Response(JSON.stringify({
        budgets: useLedgerStore.getState().budgets,
        report: {
          account: { id: 'acct-1', code: '6100', name: 'Cloud Hosting', type: 'expense' },
          columns: [{
            period: { id: 'total', label: 'Total', startDate: '2026-01-01', endDate: '2026-01-31' },
            budgetCents: 100000,
            actualCents: 54300,
            differenceCents: 45700,
            percentUsed: 54.3,
            drillTransactions: [],
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    await act(async () => {
      render(<PartyAgingReportView side="customer" />);
    });
    await waitFor(() => assert.ok(screen.getByText('Server Uncapped Co')));
    cleanup();

    await act(async () => {
      render(<ContactBalanceSummaryView asOfDate="2026-03-01" />);
    });
    await waitFor(() => assert.ok(screen.getByText('Server Balance Contact')));

    // Mutating a subscribed invoice must invalidate requestKey and refetch updated server rows
    const beforeCalls = partyBalanceCalls;
    await act(async () => {
      useLedgerStore.setState({
        invoices: [{
          id: 'inv-mutated', workspaceId: 'ws-component', customerId: 'cust-1', customerName: 'Server Balance Contact',
          amountCents: 12000, amountPaidCents: 12000, status: 'paid', issueDate: '2026-02-01', dueDate: '2026-03-01',
        } as never],
      });
    });
    await waitFor(() => assert.ok(partyBalanceCalls > beforeCalls, 'Store mutation must refetch server operational report'));
    cleanup();

    await act(async () => {
      render(<PaymentMethodSummaryView startDate="2026-01-01" endDate="2026-01-31" />);
    });
    await waitFor(() => assert.ok(screen.getByText('ACH')));
    assert.equal(screen.queryByRole('alert'), null);
    cleanup();

    await act(async () => {
      render(<BudgetActualReportView startDate="2026-01-01" endDate="2026-01-31" />);
    });
    await waitFor(() => assert.equal(screen.getByRole('button', { name: /: entries for Cloud Hosting, Total$/ }).textContent, '$543.00'));
    assert.equal(screen.queryByRole('status'), null);
  } finally {
    globalThis.fetch = origFetch;
  }
});
