/**
 * Re-verification of Agent #10 findings B1–B5 (first reported 2026-11-16 on `f6ff005`)
 * against the current HEAD. The probe reports, it does not assert: every line says
 * whether the server refuses the forged write (FIXED) or accepts it (LIVE).
 *
 * Run (PGlite socket server on 127.0.0.1:5433, migrations applied):
 *   DATABASE_URL=$LF_TEST_DATABASE_URL PG_POOL_MAX=1 NODE_ENV=test \
 *   SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx tsx audit/agent10-2026-11-19/probes/r1-documents-reverify.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.SYSTEM_SALT ||= 'probe-test-salt-2026';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { getDb } from '../../../src/server/db/firestore';
import { commandRouter } from '../../../src/server/routes/commandRoutes';
import { applyCredit } from '../../../src/server/services/creditService';

const results: Array<Record<string, unknown>> = [];

async function main() {
  const db = getDb();
  const suffix = crypto.randomUUID().slice(0, 8);
  const wsId = `ws_r1_${suffix}`;
  const owner = `owner_${suffix}`;
  const arId = `${wsId}_ar`;
  const bankId = `${wsId}_bank`;
  const salesId = `${wsId}_sales`;
  const returnsId = `${wsId}_returns`;
  const defRevId = `${wsId}_def`;

  await db.collection('workspaces').doc(wsId).set({
    id: wsId, uid: owner, name: 'Reverify R1', currency: 'USD', members: [owner], roles: { [owner]: 'owner' },
    defaultAccountMappings: { ar: arId, cash: bankId, revenue: salesId, 'sales returns': returnsId, 'deferred revenue': defRevId },
  });
  for (const acc of [
    { id: arId, workspaceId: wsId, name: 'Accounts Receivable', type: 'asset', category: 'Receivables', code: '1100' },
    { id: bankId, workspaceId: wsId, name: 'Bank', type: 'asset', category: 'Cash', code: '1000' },
    { id: salesId, workspaceId: wsId, name: 'Sales', type: 'income', category: 'Revenue', code: '4000' },
    { id: returnsId, workspaceId: wsId, name: 'Sales Returns', type: 'income', category: 'Revenue', code: '4900' },
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
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const record = (id: string, live: boolean, evidence: Record<string, unknown>, note: string) => {
    results.push({ id, verdict: live ? 'LIVE' : 'FIXED', evidence, note });
  };
  const invoice = (id: string, number: string, date: string, amountCents: number, extra: Record<string, unknown> = {}) => ({
    invoice: {
      id, customerId: `${wsId}_c1`, customerName: 'Acme', number, date, dueDate: date, status: 'sent', currency: 'USD',
      amountCents, items: [{ id: '1', description: 'Work', quantity: 1, rateCents: amountCents, amountCents, accountId: salesId }],
      ...extra,
    },
  });

  try {
    // B1 — forged settlement closes A/R with no payment.
    const b1Inv = `${wsId}_inv_b1`;
    const b1Create = await cmd('invoice.create', invoice(b1Inv, 'INV-B1', '2026-10-10', 10000));
    const b1Update = await cmd('invoice.update', { id: b1Inv, data: { status: 'paid', amountPaidCents: 10000, settledByRecordsCents: 10000 } });
    const b1Doc = (await db.collection('invoices').doc(b1Inv).get()).data();
    const b1Txs = (await db.collection('transactions').where('workspaceId', '==', wsId).where('metadata.invoiceId', '==', b1Inv).get()).docs.map(d => d.data());
    record('B1', b1Update.status === 200 && Number(b1Doc?.settledByRecordsCents || 0) === 10000,
      { create: b1Create.status, update: b1Update.status, storedSettledCents: b1Doc?.settledByRecordsCents, storedStatus: b1Doc?.status, cashEntries: b1Txs.filter(t => String(t.metadata?.type || '').includes('payment')).length, txs: b1Txs.map(t => ({ type: t.metadata?.type, desc: t.description, lines: (t.lines||[]).map((l:any)=>[l.accountId, l.amountCents]) })), body: b1Update.body },
      'A client-forged settledByRecordsCents/amountPaidCents/status must be refused with 409 and must not land on the document.');

    // B2 — voiding an invoice settled by a real payment.
    const b2Inv = `${wsId}_inv_b2`;
    await cmd('invoice.create', invoice(b2Inv, 'INV-B2', '2026-10-10', 10000));
    const pay = await cmd('payment.receive', {
      customerId: `${wsId}_c1`, entityName: 'Acme', paymentDate: '2026-10-12',
      amountCents: 10000, cashAccountId: bankId, paymentMethod: 'bank',
      allocations: [{ documentId: b2Inv, documentType: 'invoice', amountCents: 10000 }],
    });
    const b2Res = await cmd('invoice.update', { id: b2Inv, data: { status: 'void' } });
    const b2Allocs = (await db.collection('paymentAllocations').where('workspaceId', '==', wsId).where('documentId', '==', b2Inv).get()).docs.map(d => d.data());
    record('B2', b2Res.status === 200,
      { payment: pay.status, voidStatus: b2Res.status, liveAllocations: b2Allocs.filter(a => !a.reversedBy).length, body: b2Res.body },
      'Voiding an invoice that a live payment allocation settles must be refused.');

    // B3 — resetting an applied credit's remainingCents to apply it twice.
    const b3Inv1 = `${wsId}_inv_b3_1`;
    const b3Inv2 = `${wsId}_inv_b3_2`;
    const b3Cn = `${wsId}_cn_b3`;
    await cmd('invoice.create', invoice(b3Inv1, 'INV-B3-1', '2026-10-10', 10000));
    await cmd('invoice.create', invoice(b3Inv2, 'INV-B3-2', '2026-10-10', 10000));
    const cnCreate = await cmd('creditnote.create', {
      creditNote: { id: b3Cn, customerId: `${wsId}_c1`, customerName: 'Acme', number: 'CN-B3', date: '2026-10-10', status: 'open', currency: 'USD', amountCents: 10000, remainingCents: 10000 },
    });
    await applyCredit(db, { workspaceId: wsId, uid: owner, kind: 'customer', creditId: b3Cn, documentId: b3Inv1, amountCents: 10000, date: '2026-10-11' });
    const b3Forge = await cmd('creditnote.update', { id: b3Cn, data: { remainingCents: 10000, status: 'open' } });
    let secondApplyError = '';
    try {
      await applyCredit(db, { workspaceId: wsId, uid: owner, kind: 'customer', creditId: b3Cn, documentId: b3Inv2, amountCents: 10000, date: '2026-10-12' });
    } catch (err) { secondApplyError = err instanceof Error ? err.message : String(err); }
    const b3Allocs = (await db.collection('paymentAllocations').where('workspaceId', '==', wsId).where('sourceId', '==', b3Cn).get()).docs.map(d => d.data());
    const b3TotalApplied = b3Allocs.reduce((s, a) => s + Number(a.amountCents || 0), 0);
    record('B3', b3Forge.status === 200 && b3TotalApplied > 10000,
      { creditCreate: cnCreate.status, forgeStatus: b3Forge.status, secondApplyError, totalAppliedCents: b3TotalApplied, body: b3Forge.body },
      'A credit already applied cannot have remainingCents rewritten by the client; a 20,000 application on a 10,000 credit is the defect.');

    // B4 — re-dating a posted invoice out of a closed period.
    const b4Inv = `${wsId}_inv_b4`;
    await cmd('invoice.create', invoice(b4Inv, 'INV-B4', '2026-09-15', 10000));
    await db.collection('workspaces').doc(wsId).update({ lockDate: '2026-09-30' });
    const b4Res = await cmd('invoice.update', { id: b4Inv, data: { date: '2026-10-15' } });
    await db.collection('workspaces').doc(wsId).update({ lockDate: null });
    const b4Doc = (await db.collection('invoices').doc(b4Inv).get()).data();
    record('B4', b4Res.status === 200 && b4Doc?.date === '2026-10-15',
      { updateStatus: b4Res.status, storedDate: b4Doc?.date, body: b4Res.body },
      'Moving a document out of a hard-closed month must be refused (both the old and the new date are checked).');

    // B5 — deleting a document that carries a revenue spread / live allocation.
    const b5Inv = `${wsId}_inv_b5`;
    await cmd('invoice.create', invoice(b5Inv, 'INV-B5', '2026-10-01', 12000));
    await db.collection('invoices').doc(b5Inv).update({
      revenueSchedule: { id: `sched_${suffix}`, amountCents: 12000, months: 12, startMonth: '2026-10', revenueAccountId: salesId, deferredAccountId: defRevId, transactionIds: ['tx_s1'], createdAt: new Date().toISOString() },
    });
    const b5Res = await cmd('invoice.delete', { id: b5Inv });
    const b5Doc = (await db.collection('invoices').doc(b5Inv).get()).data();
    record('B5', b5Res.status === 200 && !b5Doc,
      { deleteStatus: b5Res.status, documentStillExists: Boolean(b5Doc), body: b5Res.body },
      'A document with an active revenue/prepaid spread must not be deletable.');
  } finally {
    server.close();
    for (const table of ['transactions', 'invoices', 'payments', 'creditNotes', 'paymentAllocations', 'allocationOperations', 'chartAccounts', 'customers', 'idempotencyKeys', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [wsId]).catch(() => {});
    }
    await db.terminate();
  }

  console.log(JSON.stringify({ probe: 'r1-documents-reverify', results }, null, 2));
  assert.ok(results.some(r => r.verdict === 'LIVE') || results.every(r => r.verdict === 'FIXED'));
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
