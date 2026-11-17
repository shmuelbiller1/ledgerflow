/**
 * A8N-02 reproduction — an UNSIGNED backup can change the closed months it is supposed to leave alone.
 *
 * Audit evidence only. NOT part of the CI test glob and changes no product code. It calls the real
 * restoreWorkspaceBackup / exportWorkspaceBackup services against a real PostgreSQL database
 * (LF_TEST_DATABASE_URL — an isolated, disposable test database; never a production one). The HTTP route
 * (POST /api/v1/workspaces/:id/restore) adds only "owner of this workspace" on top of this service.
 *
 * Run (Node 24):
 *   LF_TEST_DATABASE_URL=postgresql://... NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
 *     npx tsx --test --test-force-exit audit/agent8-2026-11-17/repro/a8n-02-restore-closed-period.repro.ts
 *
 * The rule under test (workspaceRestoreService.ts, "A8-017"): when books are closed and the backup carries no
 * verified server signature, every posted closed-period entry must come back identical, else 409. "Identical" is
 * canonicalTxFingerprint: date, status, total, currency, rate, lines (account, amount, base amount).
 *
 * Books (USD), closed through 2026-05-31:
 *   T1 2026-05-15 completed  DR Cash 1,000.00 / CR Sales 1,000.00
 *   T2 2026-05-20 completed  DR Rent   400.00 / CR Cash    400.00
 *   T3 2026-05-25 void       DR Cash 9,999.00 / CR Sales 9,999.00   (a voided entry: not in the books)
 *   T4 2026-06-10 completed  DR Cash    50.00 / CR Sales    50.00   (open month)
 *   May profit and loss: income 1,000.00, expense 400.00, net 600.00.
 *
 * Each case starts from those books and restores one unsigned file whose `workspace.lockDate` says 2026-05-31:
 *   control-a  T2 left out                          → refused (the rule works)
 *   control-b  T2's amounts changed to 100.00       → refused (the rule works)
 *   case 1     T2 identical + deletedAt             → if accepted: May expense 0.00, net 1,000.00
 *   case 2     T2 identical + type "forecast"       → if accepted: May expense 0.00, net 1,000.00
 *   case 3     T2 identical + metadata.isGhost      → if accepted: May expense 0.00, net 1,000.00
 *   case 4     a NEW entry T5 2026-05-28 DR Rent 5,000.00 / CR Cash 5,000.00
 *                                                    → if accepted: May expense 5,400.00, net −4,400.00
 *   case 5     T3 (void) comes back "completed"     → if accepted: May income 10,999.00, net 10,599.00
 *   case 6     a genuine signed export, T2 given deletedAt, then metadata.checksum and metadata.lockSignature
 *              removed from the file                → if accepted: the signature adds nothing against editing
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeProfitAndLoss } from '../../../src/server/reports/computeReports';
import type { ChartAccount, Transaction } from '../../../src/types';

const url = process.env.LF_TEST_DATABASE_URL;
const evidencePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'evidence', 'a8n-02-observed.json');
const observed: Record<string, unknown> = { ranAt: new Date().toISOString(), node: process.version, cases: {} };

describe('A8N-02: unsigned restore over closed books (real PostgreSQL)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_a8n02_${crypto.randomBytes(4).toString('hex')}`;
  const OWNER = 'owner-a8n02';
  let db: import('../../../src/server/db/pgFirestore').Firestore;
  let restore: typeof import('../../../src/server/services/workspaceRestoreService');
  const id = (s: string) => `${ws}_${s}`;
  const accounts = [
    { id: id('cash'), name: 'Cash', type: 'asset', category: 'Cash', code: '1000' },
    { id: id('sales'), name: 'Sales', type: 'income', category: 'Revenue', code: '4000' },
    { id: id('rent'), name: 'Rent', type: 'expense', category: 'Operating Expenses', code: '6100' },
  ].map(a => ({ ...a, workspaceId: ws }));
  const entry = (key: string, date: string, status: string, debit: string, credit: string, cents: number) => ({
    id: id(key), workspaceId: ws, uid: OWNER, date, status, type: 'actual', currency: 'USD', exchangeRate: 1, totalAmountCents: cents,
    description: key, lines: [{ accountId: id(debit), amountCents: cents }, { accountId: id(credit), amountCents: -cents }],
  });
  const BOOKS = [
    entry('T1', '2026-05-15', 'completed', 'cash', 'sales', 100_000),
    entry('T2', '2026-05-20', 'completed', 'rent', 'cash', 40_000),
    entry('T3', '2026-05-25', 'void', 'cash', 'sales', 999_900),
    entry('T4', '2026-06-10', 'completed', 'cash', 'sales', 5_000),
  ];
  const CLOSED = '2026-05-31';

  const wipe = async () => {
    for (const table of ['transactions', 'chartAccounts', 'periodBalances', 'stockClosings', 'repostQueue', 'paymentAllocations', 'allocationOperations', 'periodClosings', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
  };
  /** The books as they stand before each case. */
  const seed = async () => {
    await wipe();
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'A8N-02 repro', currency: 'USD', timezone: 'UTC', members: [OWNER], roles: { [OWNER]: 'owner' }, lockDate: CLOSED });
    for (const a of accounts) await db.collection('chartAccounts').doc(a.id).set(a as unknown as Record<string, unknown>);
    for (const t of BOOKS) { const { id: txId, ...data } = t; await db.collection('transactions').doc(txId).set(data); }
  };
  const mayProfitAndLoss = async () => {
    const transactions = (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id })) as unknown as Transaction[];
    const pl = computeProfitAndLoss(accounts as unknown as ChartAccount[], transactions, '2026-05-01', CLOSED);
    return { incomeCents: pl.income.total, expenseCents: pl.expense.total, netIncomeCents: pl.netIncome };
  };
  const unsigned = (transactions: Array<Record<string, unknown>>) => ({ schemaVersion: 1, workspace: { id: ws, lockDate: CLOSED }, accounts, transactions });
  const attempt = async (name: string, backup: unknown) => {
    await seed();
    const before_ = await mayProfitAndLoss();
    let outcome: { accepted: boolean; status?: number; message?: string };
    try {
      await restore.restoreWorkspaceBackup(db, ws, backup);
      outcome = { accepted: true };
    } catch (err) {
      if (!(err instanceof restore.RestoreError)) throw err;
      outcome = { accepted: false, status: err.status, message: err.message };
    }
    const after_ = await mayProfitAndLoss();
    const lockDateAfter = (await db.collection('workspaces').doc(ws).get()).data()?.lockDate;
    const auditRows = (await db.collection('auditLogs').where('workspaceId', '==', ws).get()).docs.length;
    const record = { ...outcome, closedMayBefore: before_, closedMayAfter: after_, lockDateAfter, auditLogRowsWritten: auditRows };
    (observed.cases as Record<string, unknown>)[name] = record;
    return record;
  };
  const MAY = { incomeCents: 100_000, expenseCents: 40_000, netIncomeCents: 60_000 };

  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../../../src/server/db/firestore')).getDb() as unknown as typeof db;
    restore = await import('../../../src/server/services/workspaceRestoreService');
    observed.workspace = ws;
  });
  after(async () => {
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, `${JSON.stringify(observed, null, 2)}\n`);
    await wipe();
    await db.terminate();
  });

  test('controls: leaving a closed entry out, or changing its amounts, is refused (409) and May is untouched', async () => {
    const withoutT2 = await attempt('control-a: T2 left out', unsigned(BOOKS.filter(t => t.id !== id('T2'))));
    assert.deepEqual([withoutT2.accepted, withoutT2.status], [false, 409]);
    assert.deepEqual(withoutT2.closedMayAfter, MAY);
    const changed = BOOKS.map(t => t.id === id('T2') ? entry('T2', '2026-05-20', 'completed', 'rent', 'cash', 10_000) : t);
    const amounts = await attempt('control-b: T2 amounts changed', unsigned(changed));
    assert.deepEqual([amounts.accepted, amounts.status], [false, 409]);
    assert.deepEqual(amounts.closedMayAfter, MAY);
  });

  for (const [name, patch] of [
    ['case 1: T2 identical + deletedAt', { deletedAt: '2026-11-17T00:00:00.000Z' }],
    ['case 2: T2 identical + type forecast', { type: 'forecast' }],
    ['case 3: T2 identical + metadata.isGhost', { metadata: { isGhost: true } }],
  ] as Array<[string, Record<string, unknown>]>) {
    test(`${name}: the closed 400.00 expense leaves the reports`, async () => {
      const r = await attempt(name, unsigned(BOOKS.map(t => t.id === id('T2') ? { ...t, ...patch } : t)));
      assert.equal(r.accepted, true, `OBSERVED DEFECT: accepted. If now refused the rule was tightened: ${r.message}`);
      assert.deepEqual(r.closedMayBefore, MAY);
      assert.deepEqual(r.closedMayAfter, { incomeCents: 100_000, expenseCents: 0, netIncomeCents: 100_000 }, 'May net 600.00 → 1,000.00');
      assert.equal(r.lockDateAfter, CLOSED, 'the books still say they are closed through May');
    });
  }

  test('case 4: a NEW entry dated in the closed month is written: May net 600.00 → −4,400.00', async () => {
    const r = await attempt('case 4: new closed-period entry T5', unsigned([...BOOKS, entry('T5', '2026-05-28', 'completed', 'rent', 'cash', 500_000)]));
    assert.equal(r.accepted, true, `OBSERVED DEFECT: accepted. If now refused the rule was tightened: ${r.message}`);
    assert.deepEqual(r.closedMayAfter, { incomeCents: 100_000, expenseCents: 540_000, netIncomeCents: -440_000 });
    assert.equal(r.lockDateAfter, CLOSED);
  });

  test('case 5: a voided closed-period entry comes back posted: May net 600.00 → 10,599.00', async () => {
    const r = await attempt('case 5: void T3 restored as completed', unsigned(BOOKS.map(t => t.id === id('T3') ? { ...t, status: 'completed' } : t)));
    assert.equal(r.accepted, true, `OBSERVED DEFECT: accepted. If now refused the rule was tightened: ${r.message}`);
    assert.deepEqual(r.closedMayAfter, { incomeCents: 1_099_900, expenseCents: 40_000, netIncomeCents: 1_059_900 });
    assert.equal(r.lockDateAfter, CLOSED);
  });

  test('case 6: a genuine signed export, edited, with its checksum and signature removed, is accepted', async () => {
    await seed();
    const genuine = await restore.exportWorkspaceBackup(db, ws, OWNER);
    assert.equal(typeof genuine.metadata.checksum, 'string');
    assert.equal(typeof genuine.metadata.lockSignature, 'string');
    // edited but still carrying its checksum: refused (the checksum works when it is present)
    const edited = JSON.parse(JSON.stringify(genuine)) as typeof genuine & { transactions: Array<Record<string, unknown>> };
    edited.transactions = edited.transactions.map(t => t.id === id('T2') ? { ...t, deletedAt: '2026-11-17T00:00:00.000Z' } : t);
    const kept = await attempt('case 6a: edited, checksum kept', edited);
    assert.deepEqual([kept.accepted, kept.status], [false, 400]);
    // the same file with the two metadata fields removed
    const stripped = JSON.parse(JSON.stringify(edited)) as typeof edited;
    delete stripped.metadata.checksum;
    delete stripped.metadata.lockSignature;
    const r = await attempt('case 6b: edited, checksum and signature removed', stripped);
    assert.equal(r.accepted, true, `OBSERVED DEFECT: accepted. If now refused the rule was tightened: ${r.message}`);
    assert.deepEqual(r.closedMayAfter, { incomeCents: 100_000, expenseCents: 0, netIncomeCents: 100_000 });
  });

  test('observation: a restore writes no audit-log row from the service (the route adds none either)', async () => {
    const cases = observed.cases as Record<string, { accepted: boolean; auditLogRowsWritten: number }>;
    const accepted = Object.values(cases).filter(c => c.accepted);
    assert.ok(accepted.length > 0);
    assert.ok(accepted.every(c => c.auditLogRowsWritten === 0), 'no auditLogs row exists after an accepted restore');
  });
});
