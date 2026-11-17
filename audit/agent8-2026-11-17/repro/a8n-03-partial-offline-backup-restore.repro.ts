/**
 * A8N-03 reproduction — the browser's "offline backup" (only what the page had loaded) restores as if it were
 * a full backup, and the restore deletes every record the file does not carry.
 *
 * Audit evidence only. NOT part of the CI test glob and changes no product code. Real restoreWorkspaceBackup
 * against a real PostgreSQL database (LF_TEST_DATABASE_URL — isolated and disposable; never production).
 *
 * Run (Node 24):
 *   LF_TEST_DATABASE_URL=postgresql://... NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
 *     npx tsx --test --test-force-exit audit/agent8-2026-11-17/repro/a8n-03-partial-offline-backup-restore.repro.ts
 *
 * Where the file comes from (src/components/platform/settings/BackupExportSettings.tsx, exportJSON): when the
 * server export call fails for ANY reason, the screen builds the backup from the browser store instead — the
 * lists the page happened to have loaded — gives it a valid SHA-256 checksum, `metadata.serverAuthoritative:
 * false`, and the same file name as a full backup. Its keys are exactly the ones built below. It has no
 * payments, creditNotes, vendorCredits, bankLines, journalEntries, estimates, purchaseOrders, stockMoves,
 * paymentAllocations, periods or numberingSeries key at all.
 *
 * Books before (no month closed):
 *   3 ledger entries, 2 invoices, 1 customer, 1 payment, 1 credit note, 1 bank line, 1 payment-ledger row.
 * The page had loaded 1 of the 3 entries and had never opened Sales (invoices and customers lists empty).
 * Expected of a safe restore: refuse a file that says it is not a complete archive, or at least leave alone
 * what the file does not carry.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.LF_TEST_DATABASE_URL;
const evidencePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'evidence', 'a8n-03-observed.json');
const observed: Record<string, unknown> = { ranAt: new Date().toISOString(), node: process.version };

describe('A8N-03: restoring the browser\'s partial offline backup (real PostgreSQL)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_a8n03_${crypto.randomBytes(4).toString('hex')}`;
  const OWNER = 'owner-a8n03';
  let db: import('../../../src/server/db/pgFirestore').Firestore;
  let restore: typeof import('../../../src/server/services/workspaceRestoreService');
  const id = (s: string) => `${ws}_${s}`;
  const TABLES = ['transactions', 'invoices', 'customers', 'payments', 'creditNotes', 'bankLines', 'paymentAllocations', 'chartAccounts'];
  const accounts = [
    { id: id('cash'), name: 'Cash', type: 'asset', category: 'Cash', code: '1000' },
    { id: id('ar'), name: 'Accounts Receivable', type: 'asset', category: 'Receivables', code: '1100' },
    { id: id('sales'), name: 'Sales', type: 'income', category: 'Revenue', code: '4000' },
  ].map(a => ({ ...a, workspaceId: ws }));
  const entry = (key: string, date: string, debit: string, credit: string, cents: number) => ({
    id: id(key), workspaceId: ws, uid: OWNER, date, status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 1, totalAmountCents: cents,
    description: key, lines: [{ accountId: id(debit), amountCents: cents }, { accountId: id(credit), amountCents: -cents }],
  });
  const ledger = [entry('T1', '2026-10-01', 'ar', 'sales', 100_000), entry('T2', '2026-10-05', 'ar', 'sales', 250_000), entry('T3', '2026-10-09', 'cash', 'ar', 100_000)];
  const count = async () => Object.fromEntries(await Promise.all(TABLES.map(async t => [t, (await db.collection(t).where('workspaceId', '==', ws).get()).docs.length])));
  const wipe = async () => {
    for (const table of [...TABLES, 'auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
  };

  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../../../src/server/db/firestore')).getDb() as unknown as typeof db;
    restore = await import('../../../src/server/services/workspaceRestoreService');
    await wipe();
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'A8N-03 repro', currency: 'USD', timezone: 'UTC', members: [OWNER], roles: { [OWNER]: 'owner' } });
    for (const a of accounts) await db.collection('chartAccounts').doc(a.id).set(a as unknown as Record<string, unknown>);
    for (const t of ledger) { const { id: txId, ...data } = t; await db.collection('transactions').doc(txId).set(data); }
    await db.collection('customers').doc(id('acme')).set({ workspaceId: ws, name: 'Acme' });
    await db.collection('invoices').doc(id('INV-1')).set({ workspaceId: ws, number: 'INV-1', customerId: id('acme'), customerName: 'Acme', date: '2026-10-01', status: 'paid', currency: 'USD', amountCents: 100_000, amountPaidCents: 100_000 });
    await db.collection('invoices').doc(id('INV-2')).set({ workspaceId: ws, number: 'INV-2', customerId: id('acme'), customerName: 'Acme', date: '2026-10-05', status: 'sent', currency: 'USD', amountCents: 250_000, amountPaidCents: 0 });
    await db.collection('payments').doc(id('PAY-1')).set({ workspaceId: ws, customerId: id('acme'), paymentDate: '2026-10-09', amountCents: 100_000, transactionId: id('T3') });
    await db.collection('creditNotes').doc(id('CN-1')).set({ workspaceId: ws, number: 'CN-1', customerId: id('acme'), date: '2026-10-10', status: 'draft', currency: 'USD', amountCents: 5_000, remainingCents: 5_000 });
    await db.collection('bankLines').doc(id('BL-1')).set({ workspaceId: ws, date: '2026-10-09', amountCents: 100_000, description: 'ACME PAYMENT' });
    await db.collection('paymentAllocations').doc(id('AL-1')).set({ workspaceId: ws, documentId: id('INV-1'), documentType: 'invoice', kind: 'payment', amountCents: 100_000, date: '2026-10-09' });
    observed.workspace = ws;
  });
  after(async () => {
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, `${JSON.stringify(observed, null, 2)}\n`);
    await wipe();
    await db.terminate();
  });

  test('the partial file is accepted and the workspace is cut down to what the page had loaded', async () => {
    const before_ = await count();
    assert.deepEqual(before_, { transactions: 3, invoices: 2, customers: 1, payments: 1, creditNotes: 1, bankLines: 1, paymentAllocations: 1, chartAccounts: 3 });

    // exactly the object exportJSON builds in its fallback branch, from a store that had loaded one entry
    const loaded = [ledger[0]];
    const payload: Record<string, unknown> & { metadata: Record<string, unknown> } = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      workspace: { id: ws },
      transactions: loaded,
      accounts,
      projects: [], budgets: [], vendors: [], customers: [], invoices: [], bills: [], inventory: [], assets: [],
      recurringRules: [], employees: [], payRuns: [], taxRates: [], partners: [], reconciliations: [], autoRules: [],
      metadata: { transactionCount: loaded.length, totalCount: loaded.length, currency: 'USD', serverAuthoritative: false },
    };
    // the browser's checksum: SHA-256 of the payload before the checksum is added
    payload.metadata.checksum = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    let outcome: { accepted: boolean; status?: number; message?: string; result?: unknown };
    try {
      outcome = { accepted: true, result: await restore.restoreWorkspaceBackup(db, ws, JSON.parse(JSON.stringify(payload))) };
    } catch (err) {
      if (!(err instanceof restore.RestoreError)) throw err;
      outcome = { accepted: false, status: err.status, message: err.message };
    }
    const after_ = await count();
    observed.before = before_;
    observed.outcome = outcome;
    observed.after = after_;
    observed.auditLogRowsWritten = (await db.collection('auditLogs').where('workspaceId', '==', ws).get()).docs.length;
    assert.equal(outcome.accepted, true, `OBSERVED DEFECT: a file marked serverAuthoritative:false is restored. If now refused the check was added: ${outcome.message}`);
    assert.deepEqual(after_, { transactions: 1, invoices: 0, customers: 0, payments: 0, creditNotes: 0, bankLines: 0, paymentAllocations: 0, chartAccounts: 3 },
      '2 of 3 ledger entries, both invoices, the customer, the payment, the credit note, the bank line and the payment-ledger row are gone');
  });

  test('with a month closed the same file is refused (the only thing that stops it today)', async () => {
    await db.collection('workspaces').doc(ws).update({ lockDate: '2026-09-30' });
    const payload = { schemaVersion: 1, workspace: { id: ws }, transactions: [], accounts, metadata: { serverAuthoritative: false } };
    await assert.rejects(restore.restoreWorkspaceBackup(db, ws, payload), (e: unknown) => e instanceof restore.RestoreError && e.status === 409);
    observed.refusedWhenAMonthIsClosed = true;
  });
});
