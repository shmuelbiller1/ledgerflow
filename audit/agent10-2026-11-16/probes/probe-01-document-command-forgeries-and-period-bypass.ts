/**
 * Independent Audit Probe 01 (2026-11-16, main f6ff005) — Findings B1–B5
 * Proves against live PostgreSQL (`lf_test`) + the real Express command router (`/api/v1/commands/*`) that:
 *   B1: `invoice.update` accepts client-forged `{ status: 'paid', amountPaidCents, settledByRecordsCents }`
 *       and closes A/R on the invoice with ZERO payment record & ZERO cash journal entry (`hasCashEntry: false`)!
 *   B2: `invoice.update({ status: 'void' })` voids an invoice already paid via `payment.receive`, leaving
 *       a live `paymentAllocations` row + `payment-posting` (-A/R) while reversing `invoice-accrual`!
 *   B3: `creditnote.update` accepts forged `{ remainingCents: 10000, status: 'open' }` on an applied credit,
 *       allowing a second `applyCredit` (double credit application)!
 *   B4: `invoice.update({ date: '2026-10-15' })` moves an invoice OUT of a hard-closed month (`lockDate: '2026-09-30'`)!
 *   B5: `invoice.delete` deletes an invoice that has an active `revenueSchedule` spread (`200`)!
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.SYSTEM_SALT ||= 'probe-test-salt-2026';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { getDb } from '../../../src/server/db/firestore';
import { commandRouter } from '../../../src/server/routes/commandRoutes';
import { applyCredit } from '../../../src/server/services/creditService';

async function main() {
  const db = getDb();
  const suffix = crypto.randomUUID().slice(0, 8);
  const wsId = `ws_a9p1_${suffix}`;
  const owner = `owner_${suffix}`;
  const arId = `${wsId}_ar`;
  const bankId = `${wsId}_bank`;
  const salesId = `${wsId}_sales`;
  const defRevId = `${wsId}_def`;

  await db.collection('workspaces').doc(wsId).set({
    id: wsId,
    uid: owner,
    name: 'Audit 2026-11-16 Probe 01',
    currency: 'USD',
    members: [owner],
    roles: { [owner]: 'owner' },
    defaultAccountMappings: { ar: arId, cash: bankId, revenue: salesId, 'deferred revenue': defRevId },
  });
  for (const acc of [
    { id: arId, workspaceId: wsId, name: 'Accounts Receivable', type: 'asset', category: 'Receivables', code: '1100' },
    { id: bankId, workspaceId: wsId, name: 'Bank', type: 'asset', category: 'Cash', code: '1000' },
    { id: salesId, workspaceId: wsId, name: 'Sales', type: 'income', category: 'Revenue', code: '4000' },
    { id: defRevId, workspaceId: wsId, name: 'Deferred Revenue', type: 'liability', category: 'Current Liabilities', code: '2400' },
  ]) {
    await db.collection('chartAccounts').doc(acc.id).set(acc);
  }
  await db.collection('customers').doc(`${wsId}_c1`).set({ id: `${wsId}_c1`, workspaceId: wsId, name: 'Acme', uid: owner });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = { uid: owner, email: 'owner@test.local', admin: false };
    next();
  });
  app.use('/api/v1/commands', commandRouter);
  const server = await new Promise<ReturnType<typeof app.listen>>(r => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const cmd = async (name: string, input: unknown) => {
    const res = await fetch(`${base}/api/v1/commands/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ workspaceId: wsId, input }),
    });
    return { status: res.status, body: await res.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  try {
    // B1: Forged settledByRecordsCents + paid status
    const b1Inv = `${wsId}_inv_b1`;
    await cmd('invoice.create', {
      invoice: {
        id: b1Inv, customerId: `${wsId}_c1`, customerName: 'Acme', number: 'INV-B1',
        date: '2026-10-10', dueDate: '2026-11-10', status: 'sent', currency: 'USD',
        amountCents: 10000, items: [{ id: '1', description: 'Work', quantity: 1, rateCents: 10000, amountCents: 10000, accountId: salesId }],
      },
    });
    const b1Res = await cmd('invoice.update', {
      id: b1Inv,
      data: { status: 'paid', amountPaidCents: 10000, settledByRecordsCents: 10000 },
    });
    const b1Txs = (await db.collection('transactions').where('workspaceId', '==', wsId).where('metadata.invoiceId', '==', b1Inv).get()).docs.map(d => d.data());
    const b1HasCash = b1Txs.some(t => t.metadata?.type === 'invoice-payment' || t.metadata?.type === 'payment-posting');

    // B2: Voiding invoice paid by payment.receive
    const b2Inv = `${wsId}_inv_b2`;
    await cmd('invoice.create', {
      invoice: {
        id: b2Inv, customerId: `${wsId}_c1`, customerName: 'Acme', number: 'INV-B2',
        date: '2026-10-10', dueDate: '2026-11-10', status: 'sent', currency: 'USD',
        amountCents: 10000, items: [{ id: '1', description: 'Work', quantity: 1, rateCents: 10000, amountCents: 10000, accountId: salesId }],
      },
    });
    await cmd('payment.receive', {
      customerId: `${wsId}_c1`, entityName: 'Acme', paymentDate: '2026-10-12',
      amountCents: 10000, cashAccountId: bankId, paymentMethod: 'bank',
      allocations: [{ documentId: b2Inv, documentType: 'invoice', amountCents: 10000 }],
    });
    const b2Res = await cmd('invoice.update', { id: b2Inv, data: { status: 'void' } });
    const b2Allocs = (await db.collection('paymentAllocations').where('workspaceId', '==', wsId).where('documentId', '==', b2Inv).get()).docs.map(d => d.data());

    // B3: Resetting applied credit remainingCents to apply twice
    const b3Inv1 = `${wsId}_inv_b3_1`;
    const b3Inv2 = `${wsId}_inv_b3_2`;
    const b3Cn = `${wsId}_cn_b3`;
    for (const [id, num] of [[b3Inv1, 'INV-B3-1'], [b3Inv2, 'INV-B3-2']]) {
      await cmd('invoice.create', {
        invoice: {
          id, customerId: `${wsId}_c1`, customerName: 'Acme', number: num,
          date: '2026-10-10', dueDate: '2026-11-10', status: 'sent', currency: 'USD',
          amountCents: 10000, items: [{ id: '1', description: 'Work', quantity: 1, rateCents: 10000, amountCents: 10000, accountId: salesId }],
        },
      });
    }
    await cmd('creditnote.create', {
      creditNote: {
        id: b3Cn, customerId: `${wsId}_c1`, customerName: 'Acme', number: 'CN-B3',
        date: '2026-10-10', status: 'open', currency: 'USD', amountCents: 10000, remainingCents: 10000,
      },
    });
    await applyCredit(db, { workspaceId: wsId, uid: owner, kind: 'customer', creditId: b3Cn, documentId: b3Inv1, amountCents: 10000, date: '2026-10-11' });
    const b3Forge = await cmd('creditnote.update', { id: b3Cn, data: { remainingCents: 10000, status: 'open' } });
    await applyCredit(db, { workspaceId: wsId, uid: owner, kind: 'customer', creditId: b3Cn, documentId: b3Inv2, amountCents: 10000, date: '2026-10-12' });
    const b3Allocs = (await db.collection('paymentAllocations').where('workspaceId', '==', wsId).where('sourceId', '==', b3Cn).get()).docs.map(d => d.data());
    const b3TotalApplied = b3Allocs.reduce((s, a) => s + Number(a.amountCents || 0), 0);

    // B4: Moving invoice out of hard-closed month
    const b4Inv = `${wsId}_inv_b4`;
    await cmd('invoice.create', {
      invoice: {
        id: b4Inv, customerId: `${wsId}_c1`, customerName: 'Acme', number: 'INV-B4',
        date: '2026-09-15', dueDate: '2026-10-15', status: 'sent', currency: 'USD',
        amountCents: 10000, items: [{ id: '1', description: 'Work', quantity: 1, rateCents: 10000, amountCents: 10000, accountId: salesId }],
      },
    });
    await db.collection('workspaces').doc(wsId).update({ lockDate: '2026-09-30' });
    const b4Res = await cmd('invoice.update', { id: b4Inv, data: { date: '2026-10-15' } });
    await db.collection('workspaces').doc(wsId).update({ lockDate: null });

    // B5: Deleting spread invoice
    const b5Inv = `${wsId}_inv_b5`;
    await cmd('invoice.create', {
      invoice: {
        id: b5Inv, customerId: `${wsId}_c1`, customerName: 'Acme', number: 'INV-B5',
        date: '2026-10-01', dueDate: '2026-11-01', status: 'sent', currency: 'USD',
        amountCents: 12000, items: [{ id: '1', description: 'Annual', quantity: 1, rateCents: 12000, amountCents: 12000, accountId: salesId }],
      },
    });
    await db.collection('invoices').doc(b5Inv).update({
      revenueSchedule: { id: `sched_${suffix}`, amountCents: 12000, months: 12, startMonth: '2026-10', revenueAccountId: salesId, deferredAccountId: defRevId, transactionIds: ['tx_s1'], createdAt: new Date().toISOString() },
    });
    const b5Res = await cmd('invoice.delete', { id: b5Inv });

    console.log(JSON.stringify({
      probe: 'A9_probe01_document_command_forgeries_and_period_bypass',
      B1_forgedPaidStatus: b1Res.status,
      B1_hasCashEntry: b1HasCash,
      B2_voidPaidInvoiceStatus: b2Res.status,
      B2_liveAllocationsLeft: b2Allocs.filter(a => !a.reversedBy).length,
      B3_resetRemainingStatus: b3Forge.status,
      B3_totalAppliedAcrossTwoInvoicesCents: b3TotalApplied,
      B4_redateClosedInvoiceStatus: b4Res.status,
      B5_deleteSpreadInvoiceStatus: b5Res.status,
    }, null, 2));

    assert.equal(b1Res.status, 200);
    assert.equal(b1HasCash, false);
    assert.equal(b2Res.status, 200);
    assert.equal(b2Allocs.filter(a => !a.reversedBy).length, 1);
    assert.equal(b3Forge.status, 200);
    assert.equal(b3TotalApplied, 20000);
    assert.equal(b4Res.status, 200);
    assert.equal(b5Res.status, 200);
  } finally {
    server.close();
    for (const table of ['transactions', 'invoices', 'payments', 'creditNotes', 'paymentAllocations', 'allocationOperations', 'chartAccounts', 'customers', 'idempotencyKeys', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [wsId]).catch(() => {});
    }
    await db.terminate();
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
