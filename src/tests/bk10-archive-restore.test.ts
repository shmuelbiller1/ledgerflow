/**
 * BK-10: the workspace archive (ZIP) is the backup made complete, and the existing restore brings it
 * back. A small workspace is seeded, archived, its records wiped and the workspace created again,
 * then the ZIP is restored: the reports, the record counts, the settings and the attachment list are
 * the same. Runs when LF_TEST_DATABASE_URL is set; skipped otherwise.
 *
 * Figures, worked by hand (USD, cents in the code):
 *   E1 2026-02-01 owner's capital   Dr Bank 1,000.00              / Cr Capital 1,000.00
 *   E2 2026-02-10 invoice INV-1     2 × 150.00 = 300.00 + 10% tax 30.00 = 330.00
 *                                   Dr Receivables 330.00         / Cr Sales 300.00, Cr Tax payable 30.00
 *   E3 2026-02-15 bill B-1          80.00 + 10% tax 8.00 = 88.00
 *                                   Dr Supplies 80.00, Dr Tax receivable 8.00 / Cr Payables 88.00
 *   E4 2026-02-20 payment of INV-1  Dr Bank 330.00                / Cr Receivables 330.00
 *   E5 2026-02-28 journal JE-1      Dr Bank fees 12.50            / Cr Bank 12.50
 * Trial balance (net): Bank 1,317.50 Dr · Receivables 0.00 · Tax receivable 8.00 Dr · Payables 88.00 Cr ·
 *   Tax payable 30.00 Cr · Capital 1,000.00 Cr · Sales 300.00 Cr · Supplies 80.00 Dr · Bank fees 12.50 Dr;
 *   debit lines total = credit lines total = 1,000 + 330 + 80 + 8 + 330 + 12.50 = 1,760.50.
 * Profit and loss: income 300.00, expenses 80.00 + 12.50 = 92.50, net income 207.50.
 * Balance sheet at 2026-02-28: assets 1,317.50 + 0 + 8.00 = 1,325.50; liabilities 88.00 + 30.00 = 118.00;
 *   equity 1,000.00; net income 207.50; 118.00 + 1,000.00 + 207.50 = 1,325.50 (balanced).
 * Settings: lock date 2026-01-31, opening-balance date 2026-02-01, one dimension (Region: North).
 * Attachment list: one file (contract.pdf, 5 bytes) on INV-1; one task kept in `documents`.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Firestore } from '../server/db/pgFirestore';
import { exportWorkspaceBackup, restoreWorkspaceBackup, RestoreError } from '../server/services/workspaceRestoreService';
import { backupFromWorkspaceArchive, buildWorkspaceArchive } from '../lib/workspaceArchive';
import { computeBalanceSheet, computeProfitAndLoss, computeTrialBalance } from '../server/reports/computeReports';
import { WORKSPACE_PURGE_ORDER } from '../constants/collections';
import type { ChartAccount, Transaction } from '../types';

const url = process.env.LF_TEST_DATABASE_URL;

describe('BK-10 workspace archive → restore (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const s = crypto.randomBytes(4).toString('hex');
  const ws = `ws_bk10_${s}`;
  const id = (n: string) => `${ws}_${n}`;
  const OWNER = 'owner-bk10';
  let db: Firestore;

  const rows = async (coll: string) => (await db.collection(coll).where('workspaceId', '==', ws).get()).docs
    .map(d => ({ ...d.data(), id: d.id }));
  const reports = async () => {
    const accounts = await rows('chartAccounts') as unknown as ChartAccount[];
    const entries = await rows('transactions') as unknown as Transaction[];
    const tb = computeTrialBalance(accounts, entries, '2026-02-28');
    const pl = computeProfitAndLoss(accounts, entries, '2026-02-01', '2026-02-28');
    const bs = computeBalanceSheet(accounts, entries, '2026-02-28');
    return {
      tb: Object.fromEntries(tb.accounts.map(a => [a.id.slice(ws.length + 1), a.netSigned])),
      tbTotals: [tb.totalDebit, tb.totalCredit],
      pl: [pl.income.total, pl.expense.total, pl.netIncome],
      bs: [bs.totalAssets, bs.totalLiabilities, bs.totalEquity, bs.netIncome, bs.isBalanced],
    };
  };
  const HAND = {
    tb: { bank: 131750, ar: 0, taxin: 800, ap: 8800, taxout: 3000, capital: 100000, sales: 30000, supplies: 8000, fees: 1250 },
    tbTotals: [176050, 176050],
    pl: [30000, 9250, 20750],
    bs: [132550, 11800, 100000, 20750, true],
  };
  const FILE_URL = 'data:application/pdf;base64,JVBERi0=';

  /** Every row of the workspace goes, as when it is deleted and made again; `keepFiles` keeps the stored files. */
  const wipe = async (keepFiles: boolean) => {
    for (const table of WORKSPACE_PURGE_ORDER) {
      if (table === 'documents' && keepFiles) continue;
      await db.pool.query(`delete from public."${table}" where workspace_id = $1`, [ws]);
    }
    if (keepFiles) {
      for (const d of (await db.collection('documents').where('workspaceId', '==', ws).get()).docs) {
        if (!d.data().fileUrl) await d.ref.delete();
      }
    }
    await db.collection('workspaces').doc(ws).delete();
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'New workspace', plan: 'starter', currency: 'USD' });
  };

  let archive: Uint8Array;
  let original: Record<string, unknown> & { metadata: Record<string, unknown> };

  before(async () => {
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    db = getDb() as unknown as Firestore;
    await db.collection('workspaces').doc(ws).set({
      uid: OWNER, name: 'Books BK-10', plan: 'starter', currency: 'USD', lockDate: '2026-01-31',
      openingBalanceDate: '2026-02-01', settings: { invoicePrefix: 'INV-' },
    });
    const accounts: [string, string, string][] = [['bank', 'asset', '1000'], ['ar', 'asset', '1100'], ['taxin', 'asset', '1300'],
      ['ap', 'liability', '2000'], ['taxout', 'liability', '2200'], ['capital', 'equity', '3000'], ['sales', 'income', '4000'],
      ['supplies', 'expense', '6000'], ['fees', 'expense', '6100']];
    for (const [n, type, code] of accounts) await db.collection('chartAccounts').doc(id(n)).set({ workspaceId: ws, name: n, code, type });
    const entry = (n: string, date: string, lines: [string, number][]) => db.collection('transactions').doc(id(n)).set({
      workspaceId: ws, date, description: n, status: 'completed', type: 'actual',
      totalAmountCents: lines.reduce((sum, [, c]) => sum + Math.max(0, c), 0),
      lines: lines.map(([a, amountCents]) => ({ accountId: id(a), amountCents })),
    });
    await entry('e1', '2026-02-01', [['bank', 100000], ['capital', -100000]]);
    await entry('e2', '2026-02-10', [['ar', 33000], ['sales', -30000], ['taxout', -3000]]);
    await entry('e3', '2026-02-15', [['supplies', 8000], ['taxin', 800], ['ap', -8800]]);
    await entry('e4', '2026-02-20', [['bank', 33000], ['ar', -33000]]);
    await entry('e5', '2026-02-28', [['fees', 1250], ['bank', -1250]]);
    await db.collection('customers').doc(id('c1')).set({ workspaceId: ws, name: 'Acme' });
    await db.collection('vendors').doc(id('v1')).set({ workspaceId: ws, name: 'Paper Co' });
    await db.collection('taxRates').doc(id('vat10')).set({ workspaceId: ws, name: 'VAT 10%', rate: 10 });
    await db.collection('invoices').doc(id('inv1')).set({
      workspaceId: ws, number: 'INV-1', customerId: id('c1'), status: 'paid', date: '2026-02-10', taxRate: 10,
      items: [{ description: 'Widget', quantity: 2, unitPriceCents: 15000 }], taxAmountCents: 3000, amountCents: 33000, amountPaidCents: 33000,
    });
    await db.collection('bills').doc(id('b1')).set({ workspaceId: ws, number: 'B-1', vendorId: id('v1'), status: 'approved', date: '2026-02-15', dueDate: '2026-03-15', taxRate: 10, taxAmountCents: 800, amountCents: 8800 });
    await db.collection('payments').doc(id('p1')).set({ workspaceId: ws, invoiceId: id('inv1'), amountCents: 33000, date: '2026-02-20' });
    await db.collection('journalEntries').doc(id('je1')).set({ workspaceId: ws, number: 'JE-1', date: '2026-02-28', transactionId: id('e5'), status: 'draft', lines: [] });
    await db.collection('dimensionNodes').doc(id('north')).set({ workspaceId: ws, dimension: 'Region', name: 'North' });
    await db.collection('customTemplates').doc(id('tpl')).set({ workspaceId: ws, name: 'Blue invoice' });
    await db.collection('loans').doc(id('loan')).set({ workspaceId: ws, name: 'Van loan', principalCents: 500000 });
    await db.collection('documents').doc(id('att')).set({
      workspaceId: ws, uid: OWNER, name: 'contract.pdf', fileUrl: FILE_URL, mimeType: 'application/pdf', sizeBytes: 5,
      tags: ['Attachment'], createdAt: '2026-02-10T09:00:00.000Z', linkedCollection: 'invoices', linkedId: id('inv1'), linkedLabel: 'Invoice INV-1',
    });
    await db.collection('documents').doc(id('task')).set({ workspaceId: ws, kind: 'task', title: 'Send INV-1', status: 'open' });

    // The archive as the Settings screen makes it: the server export, read as the browser receives it
    const exported = await exportWorkspaceBackup(db, ws, OWNER);
    original = JSON.parse(JSON.stringify(exported));
    const built = await buildWorkspaceArchive(JSON.parse(JSON.stringify(exported)), ws);
    archive = new Uint8Array(await built.blob.arrayBuffer());
  });

  after(async () => {
    for (const table of [...WORKSPACE_PURGE_ORDER, 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
  });

  test('the figures before archiving are the hand-worked ones', async () => {
    assert.deepEqual(await reports(), HAND);
  });

  test('the archive carries every record, the settings and the attachment list, without the file bytes', () => {
    const counts = original.metadata.counts as Record<string, number>;
    for (const [key, n] of Object.entries({ transactions: 5, accounts: 9, invoices: 1, bills: 1, payments: 1, journalEntries: 1, customers: 1,
      vendors: 1, taxRates: 1, dimensionNodes: 1, customTemplates: 1, loans: 1, documentRecords: 1, attachments: 1 })) {
      assert.equal(counts[key], n, key);
    }
    const [file] = original.attachments as Record<string, unknown>[];
    assert.equal(file.name, 'contract.pdf');
    assert.equal(file.linkedId, id('inv1'));
    assert.equal(file.fileUrl, undefined, 'the bytes are not in the backup');
    assert.equal(file.fileSha256, crypto.createHash('sha256').update(FILE_URL).digest('hex'));
    assert.equal((original.workspace as Record<string, unknown>).lockDate, '2026-01-31');
  });

  test('archive → new workspace → restore: the same reports, counts, settings and attachment list', async () => {
    await wipe(true);
    assert.deepEqual((await reports()).tbTotals, [0, 0], 'the new workspace starts empty');

    const { text } = await backupFromWorkspaceArchive(archive);
    const result = await restoreWorkspaceBackup(db, ws, JSON.parse(text));
    assert.deepEqual(result.attachments, { listed: 1, present: 1, missing: [] });
    assert.deepEqual(await reports(), HAND);

    const again = await exportWorkspaceBackup(db, ws, OWNER);
    assert.deepEqual(again.metadata.counts, original.metadata.counts);
    for (const key of ['invoices', 'bills', 'payments', 'journalEntries', 'dimensionNodes', 'customTemplates', 'loans', 'documentRecords', 'attachments']) {
      assert.deepEqual(JSON.parse(JSON.stringify(again[key])), original[key], key);
    }
    const settings = (await db.collection('workspaces').doc(ws).get()).data() || {};
    assert.equal(settings.name, 'Books BK-10');
    assert.equal(settings.lockDate, '2026-01-31', 'the lock date comes back');
    assert.equal(settings.openingBalanceDate, '2026-02-01');
    assert.deepEqual(settings.settings, { invoicePrefix: 'INV-' });
    assert.equal(settings.uid, OWNER, 'ownership is the new workspace\'s own');
  });

  test('a restore where the stored file is gone says so; a damaged archive is refused', async () => {
    await wipe(false);
    const { text } = await backupFromWorkspaceArchive(archive);
    const result = await restoreWorkspaceBackup(db, ws, JSON.parse(text));
    assert.deepEqual(result.attachments, { listed: 1, present: 0, missing: [id('att')] });
    assert.deepEqual(await reports(), HAND);
    assert.equal((await db.collection('documents').doc(id('task')).get()).data()?.title, 'Send INV-1');

    const damaged = archive.slice();
    const at = Buffer.from(damaged).indexOf('Books BK-10');
    damaged[at] = 'b'.charCodeAt(0);
    await assert.rejects(backupFromWorkspaceArchive(damaged), /damaged/);
  });

  test('a backup can\'t carry a file, or replace a stored one, through its document records', async () => {
    await assert.rejects(restoreWorkspaceBackup(db, ws, { workspace: { id: ws, lockDate: '2026-01-31' }, documentRecords: [{ id: id('x'), fileUrl: FILE_URL }] }),
      (e: unknown) => e instanceof RestoreError && e.status === 400 && /files are not restored/.test(e.message));
    await db.collection('documents').doc(id('att')).set({ workspaceId: ws, name: 'contract.pdf', fileUrl: FILE_URL });
    await assert.rejects(restoreWorkspaceBackup(db, ws, { workspace: { id: ws, lockDate: '2026-01-31' }, documentRecords: [{ id: id('att'), kind: 'task' }] }),
      (e: unknown) => e instanceof RestoreError && e.status === 409 && /replace a stored file/.test(e.message));
    assert.equal((await db.collection('documents').doc(id('att')).get()).data()?.fileUrl, FILE_URL);
  });
});
