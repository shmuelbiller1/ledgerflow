/**
 * Agent #7 Probe 03 (2026-11-13) — A7N-03
 * Proves against live PostgreSQL 16.2 (`lf_test`) + the real Express router that BOTH:
 *   1. `POST /api/v1/transactions/reconcile` (`src/server/routes/transactions/reconcileRoutes.ts:165-188`)
 *   2. `POST /api/v1/transactions/batch` (`src/server/routes/transactions/bulkRoutes.ts:154-160`)
 * bypass `#652` and `#662` (and are completely untouched by Fork PR #28!):
 *   - `/reconcile` lets a bookkeeper flip a posted invoice entry's `status` to `'void'` / `'failed'` in place
 *     (erasing the invoice from P&L and Balance Sheet while the invoice document remains `sent`!) AND rewrite
 *     `lines` on payroll-import / depreciation / deposit / FX-revaluation entries!
 *   - `/batch` lets a bookkeeper flip any posted entry's `status` to `'void'` / `'draft'` / `'failed'` in place
 *     with zero reversing entry!
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.SYSTEM_SALT ||= 'probe-test-salt-2026';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { getDb } from '../../../src/server/db/firestore';
import { transactionRouter } from '../../../src/server/routes/transactionRoutes';

async function main() {
  const db = getDb();
  const suffix = crypto.randomUUID().slice(0, 8);
  const wsId = `ws_probe03_${suffix}`;
  const ownerUid = `owner_${suffix}`;
  const bookkeeperUid = `bk_${suffix}`;

  const arId = `acc_ar_${suffix}`;
  const revId = `acc_rev_${suffix}`;
  const expId = `acc_exp_${suffix}`;
  const cashId = `acc_cash_${suffix}`;
  const invTxId = `tx_inv_${suffix}`;
  const postedHandTxId = `tx_hand_${suffix}`;
  const depTxId = `tx_dep_${suffix}`;

  await db.collection('workspaces').doc(wsId).set({
    id: wsId,
    name: 'Probe 03 Reconcile & Batch Immutability Bypass',
    uid: ownerUid,
    currency: 'USD',
    roles: { [ownerUid]: 'owner', [bookkeeperUid]: 'bookkeeper' },
  });

  for (const acc of [
    { id: arId, workspaceId: wsId, name: 'Accounts Receivable', code: '1100', type: 'asset', systemRole: 'ar' },
    { id: revId, workspaceId: wsId, name: 'Revenue', code: '4000', type: 'revenue' },
    { id: expId, workspaceId: wsId, name: 'Rent Expense', code: '5000', type: 'expense' },
    { id: cashId, workspaceId: wsId, name: 'Cash', code: '1010', type: 'asset', systemRole: 'cash' },
  ]) {
    await db.collection('chartAccounts').doc(acc.id).set(acc);
  }

  // 1) Posted invoice entry (#652 + #662)
  await db.collection('transactions').doc(invTxId).set({
    id: invTxId,
    workspaceId: wsId,
    uid: ownerUid,
    date: '2026-10-15',
    description: 'Invoice INV-900',
    status: 'completed',
    type: 'actual',
    currency: 'USD',
    totalAmountCents: 80000,
    invoiceId: 'inv_900',
    metadata: { type: 'invoice-posting', invoiceId: 'inv_900' },
    lines: [
      { id: 'l1', accountId: arId, accountName: 'Accounts Receivable', amountCents: 80000 },
      { id: 'l2', accountId: revId, accountName: 'Revenue', amountCents: -80000 },
    ],
  });

  // 2) Posted hand-entered journal entry (#662)
  await db.collection('transactions').doc(postedHandTxId).set({
    id: postedHandTxId,
    workspaceId: wsId,
    uid: ownerUid,
    date: '2026-10-16',
    description: 'Posted Office Rent',
    status: 'completed',
    type: 'actual',
    currency: 'USD',
    totalAmountCents: 50000,
    lines: [
      { id: 'l1', accountId: expId, accountName: 'Rent Expense', amountCents: 50000 },
      { id: 'l2', accountId: cashId, accountName: 'Cash', amountCents: -50000 },
    ],
  });

  // 3) Posted depreciation system entry (`metadata.type = 'depreciation'`)
  await db.collection('transactions').doc(depTxId).set({
    id: depTxId,
    workspaceId: wsId,
    uid: ownerUid,
    date: '2026-10-31',
    description: 'Depreciation 2026-10',
    status: 'completed',
    type: 'journal',
    currency: 'USD',
    totalAmountCents: 20000,
    metadata: { type: 'depreciation', month: '2026-10' },
    lines: [
      { id: 'l1', accountId: expId, accountName: 'Rent Expense', amountCents: 20000 },
      { id: 'l2', accountId: cashId, accountName: 'Cash', amountCents: -20000 },
    ],
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = { uid: bookkeeperUid, email: 'bk@test.local', admin: false };
    next();
  });
  app.use('/api/v1/transactions', transactionRouter);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;

  try {
    // Bypass 1: `/reconcile` voids a posted invoice entry in place + rewrites lines on a posted depreciation entry!
    const recRes = await fetch(`http://127.0.0.1:${port}/api/v1/transactions/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: wsId,
        operations: [
          { type: 'updateTransaction', id: invTxId, data: { status: 'void' } },
          {
            type: 'updateTransaction',
            id: depTxId,
            data: {
              lines: [
                { id: 'l1', accountId: expId, accountName: 'Rent Expense', amountCents: 1 },
                { id: 'l2', accountId: cashId, accountName: 'Cash', amountCents: -1 },
              ],
            },
          },
        ],
      }),
    });

    // Bypass 2: `/batch` un-posts a posted hand entry to `draft` in place with zero reversing entry!
    const batchRes = await fetch(`http://127.0.0.1:${port}/api/v1/transactions/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: wsId,
        updates: [{ id: postedHandTxId, data: { status: 'draft' } }],
      }),
    });

    const invAfter = (await db.collection('transactions').doc(invTxId).get()).data();
    const depAfter = (await db.collection('transactions').doc(depTxId).get()).data();
    const handAfter = (await db.collection('transactions').doc(postedHandTxId).get()).data();

    console.log(JSON.stringify({
      probe: 'A7N-03_reconcile_and_batch_immutability_bypass',
      reconcileStatus: recRes.status,
      batchStatus: batchRes.status,
      invoiceEntryStatusAfterReconcile: invAfter?.status,
      depreciationLineCentsAfterReconcile: depAfter?.lines?.[0]?.amountCents,
      postedHandStatusAfterBatch: handAfter?.status,
    }, null, 2));

    assert.equal(recRes.status, 200);
    assert.equal(batchRes.status, 200);
    assert.equal(invAfter?.status, 'void', 'Posted invoice entry un-posted in place via /reconcile');
    assert.equal(depAfter?.lines?.[0]?.amountCents, 1, 'Posted depreciation entry lines rewritten in place via /reconcile');
    assert.equal(handAfter?.status, 'draft', 'Posted hand entry un-posted to draft in place via /batch');
  } finally {
    server.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
