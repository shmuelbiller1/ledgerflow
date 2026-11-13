/**
 * Agent #7 Probe 06 (2026-11-13) — A7N-07 & A7N-08
 * Proves:
 *   Part A (`A7N-07`, `src/server/reports/computeReports.ts:378-460`):
 *     `computeStatement` sums raw `inv.amountCents` / `p.amountCents` / `c.amountCents` without converting
 *     foreign currencies via `toBaseCents` or separating by currency. A customer with a `¥100,000 JPY` invoice
 *     (`$670.00` USD at `0.0067`) + a `$500.00 USD` invoice gets `endingBalanceCents = 150,000` (`$1,500.00`!)
 *     while `computeCustomerBalanceSummary` properly computes `117,000` (`$1,170.00`).
 *   Part B (`A7N-08`, `src/server/routes/transactions/crudRoutes.ts:374,388` + `src/hooks/transactionActions/entryActions.ts:435-515`):
 *     `PUT /api/v1/transactions/:id` writes `updatedAt: FieldValue.serverTimestamp()` in PostgreSQL (`T_server`)
 *     but returns `data: transaction` carrying the client's stale `updatedAt` (`T_client`). The very next edit
 *     or Undo toast click sends `expectedUpdatedAt: T_client` and fails with `409 version_conflict` against
 *     the user's own save!
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.SYSTEM_SALT ||= 'probe-test-salt-2026';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { getDb } from '../../../src/server/db/firestore';
import { computeCustomerBalanceSummary, computeStatement } from '../../../src/server/reports/computeReports';
import { transactionRouter } from '../../../src/server/routes/transactionRoutes';
import type { Customer, Invoice } from '../../../src/types';

async function main() {
  // Part A: Multi-currency Customer Statement vs Customer Balance Summary
  const customer = { id: 'cust_mc', name: 'Pacific Trade Corp' } as Customer;
  const invoices: Invoice[] = [
    {
      id: 'inv_jpy', customerId: 'cust_mc', number: 'INV-JPY-1', date: '2026-10-05',
      status: 'sent', currency: 'JPY', exchangeRate: 0.0067, amountCents: 100000, amountPaidCents: 0,
    } as Invoice,
    {
      id: 'inv_usd', customerId: 'cust_mc', number: 'INV-USD-2', date: '2026-10-06',
      status: 'sent', currency: 'USD', exchangeRate: 1, amountCents: 50000, amountPaidCents: 0,
    } as Invoice,
  ];

  const statement = computeStatement(customer, invoices, [], [], '2026-10-01', '2026-10-31', 'customer', []);
  const summary = computeCustomerBalanceSummary([customer], invoices, [], [], '2026-10-31', undefined, undefined, 'USD');

  // Part B: PUT /api/v1/transactions/:id stale `updatedAt` -> self-409 on Undo / 2nd edit
  const db = getDb();
  const suffix = crypto.randomUUID().slice(0, 8);
  const wsId = `ws_probe06_${suffix}`;
  const uid = `owner_${suffix}`;
  const expId = `acc_exp_${suffix}`;
  const cashId = `acc_cash_${suffix}`;
  const txId = `tx_edit_${suffix}`;

  await db.collection('workspaces').doc(wsId).set({
    id: wsId, name: 'Probe 06 Self Conflict', uid, currency: 'USD', roles: { [uid]: 'owner' },
  });
  await db.collection('chartAccounts').doc(expId).set({ id: expId, workspaceId: wsId, name: 'Supplies', code: '5200', type: 'expense' });
  await db.collection('chartAccounts').doc(cashId).set({ id: cashId, workspaceId: wsId, name: 'Cash', code: '1010', type: 'asset', systemRole: 'cash' });

  const initialUpdatedAt = '2026-10-01T12:00:00.000Z';
  const baseTx = {
    id: txId, workspaceId: wsId, uid, date: '2026-10-01', description: 'Draft Supplies',
    status: 'draft', type: 'actual', currency: 'USD', totalAmountCents: 2500, updatedAt: initialUpdatedAt,
    lines: [
      { id: 'l1', accountId: expId, accountName: 'Supplies', amountCents: 2500 },
      { id: 'l2', accountId: cashId, accountName: 'Cash', amountCents: -2500 },
    ],
  };
  await db.collection('transactions').doc(txId).set(baseTx);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = { uid, email: 'owner@test.local', admin: false };
    next();
  });
  app.use('/api/v1/transactions', transactionRouter);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;

  try {
    const clientEdit1Timestamp = '2026-10-01T12:01:00.000Z';
    const put1 = await fetch(`http://127.0.0.1:${port}/api/v1/transactions/${txId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaction: { ...baseTx, description: 'Edited Once', updatedAt: clientEdit1Timestamp },
        expectedUpdatedAt: initialUpdatedAt,
      }),
    });
    const put1Body = await put1.json();
    const storedAfterPut1 = (await db.collection('transactions').doc(txId).get()).data();

    // Immediate 2nd edit / Undo using the `updatedAt` held by client store / returned in `put1Body.data.updatedAt`:
    const put2 = await fetch(`http://127.0.0.1:${port}/api/v1/transactions/${txId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaction: { ...baseTx, description: 'Edited Twice / Undo', updatedAt: '2026-10-01T12:02:00.000Z' },
        expectedUpdatedAt: put1Body.data.updatedAt,
      }),
    });

    console.log(JSON.stringify({
      probe: 'A7N-07_statement_multicurrency_and_A7N-08_put_self_conflict',
    statementMismatch: {
      statementEndingBalanceCents: statement.endingBalanceCents,
      customerBalanceSummaryBaseCents: summary[0]?.balanceCents,
    },
      putSelfConflict: {
        put1Status: put1.status,
        returnedDataUpdatedAt: put1Body.data?.updatedAt,
        storedDbUpdatedAt: storedAfterPut1?.updatedAt,
        put2StatusUsingReturnedUpdatedAt: put2.status,
      },
    }, null, 2));

    assert.equal(statement.endingBalanceCents, 150000);
    assert.equal(summary[0]?.balanceCents, 117000);
    assert.equal(put1.status, 200);
    assert.notEqual(put1Body.data?.updatedAt, storedAfterPut1?.updatedAt);
    assert.equal(put2.status, 409, 'Immediate 2nd PUT / Undo hits 409 version_conflict against own save');
  } finally {
    server.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
