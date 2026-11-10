/**
 * Merging two accounts (CA-33): every record that points at the merged account (entry lines with
 * their account name, bills, rules, budgets, items, child accounts, workspace settings) points at
 * the kept one afterwards; opening balances are added up; the merged account is gone; the audit
 * trail keeps its history as it was and gains one line. Refused for bookkeepers, for accounts of
 * different kinds, for an account LedgerFlow uses itself, and when a closed period would change.
 * The database part runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';
import { mergedAccount, mergeProblem, replaceAccountId } from '../lib/accountMerge';
import type { ChartAccount } from '../types';

import { BRAND_NAME } from '../config/brand';
const account = (id: string, fields: Partial<ChartAccount> = {}): ChartAccount =>
  ({ id, uid: 'u', workspaceId: 'w', code: '', name: id, type: 'expense', balanceCents: 0, ...fields } as ChartAccount);

describe('Account merge rules', () => {
  test(`only two different accounts of the same kind and currency; not one ${BRAND_NAME} uses itself`, () => {
    assert.equal(mergeProblem(account('a'), account('b')), null);
    assert.match(String(mergeProblem(account('a'), account('a'))), /two different/);
    assert.match(String(mergeProblem(account('a', { type: 'asset' }), account('b'))), /"a" is an asset account and "b" is an expense account/);
    assert.match(String(mergeProblem(account('a', { currency: 'EUR' }), account('b', { currency: 'USD' }))), /EUR/);
    assert.match(String(mergeProblem(account('a', { isSystem: true }), account('b'))), new RegExp(String.raw`used by ${BRAND_NAME} itself`));
    assert.match(String(mergeProblem(undefined, account('b'))), /Both accounts/);
    assert.match(String(mergeProblem(account('a', { openingBalanceCents: 5, asOfDate: '2026-01-01' }), account('b', { openingBalanceCents: 7, asOfDate: '2026-02-01' }))), /different dates/);
  });

  test('the id is replaced as a value and as a key; a renamed line takes the kept name; lists keep one', () => {
    const record = {
      lines: [{ accountId: 'old', accountName: 'Old', amountCents: 5 }, { accountId: 'other', accountName: 'Other', amountCents: -5 }],
      defaults: { expense: 'old' },
      amounts: { old: 300, keep: 200, other: 1 },
      notes: { old: 'theirs', keep: 'mine' },
      accountIds: ['old', 'keep', 'x'],
      description: 'old school',
    };
    const { value, changes } = replaceAccountId(record, 'old', 'keep', 'Kept');
    assert.deepEqual(value, {
      lines: [{ accountId: 'keep', accountName: 'Kept', amountCents: 5 }, { accountId: 'other', accountName: 'Other', amountCents: -5 }],
      defaults: { expense: 'keep' },
      amounts: { keep: 500, other: 1 },
      notes: { keep: 'mine' },
      accountIds: ['keep', 'x'],
      description: 'old school',
    });
    assert.equal(changes, 5);
    const untouched = { a: 1 };
    assert.equal(replaceAccountId(untouched, 'old', 'keep', 'Kept').value, untouched);
  });

  test('the kept account adds up the opening balance, the stored balance and project shares, and leaves the merged parent', () => {
    const from = account('old', { openingBalanceCents: 1000, asOfDate: '2026-01-01', balanceCents: 300, projectAllocations: { p1: 50 }, parentId: 'top' });
    assert.deepEqual(mergedAccount(from, account('keep', { balanceCents: 200, projectAllocations: { p1: 25, p2: 25 }, parentId: 'old' })), {
      balanceCents: 500, openingBalanceCents: 1000, asOfDate: '2026-01-01', projectAllocations: { p1: 75, p2: 25 }, parentId: 'top',
    });
  });
});

const url = process.env.LF_TEST_DATABASE_URL;
describe('Account merge (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_merge_${crypto.randomBytes(4).toString('hex')}`;
  const id = (name: string) => `${ws}_${name}`;
  let db: Firestore;
  let server: Server;
  let base = '';
  const post = async (uid: string, path: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1/workspaces/${ws}/chart-accounts${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as { message?: string; changes?: Record<string, number>; total?: number; details?: { closed: string[] } } };
  };
  const get = async (table: string, name: string) => (await db.collection(table).doc(id(name)).get()).data();
  const merge = { fromId: id('office2'), intoId: id('office') };

  before(async () => {
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Merge Co', currency: 'USD', members: ['owner-1', 'acct-1', 'book-1'], roles: { 'acct-1': 'accountant', 'book-1': 'bookkeeper' },
      defaultAccounts: { expense: id('office2') } });
    const acc = (name: string, fields: Record<string, unknown>) => db.collection('chartAccounts').doc(id(name)).set({ workspaceId: ws, uid: 'owner-1', name, balanceCents: 0, ...fields });
    await acc('office', { code: '6100', name: 'Office', type: 'expense', openingBalanceCents: 0 });
    await acc('office2', { code: '6101', name: 'Office 2', type: 'expense', openingBalanceCents: 1500, asOfDate: '2026-01-01' });
    await acc('pens', { code: '6102', name: 'Pens', type: 'expense', parentId: id('office2') });
    await acc('bank', { code: '1000', name: 'Bank', type: 'asset' });
    await acc('ar', { code: '1100', name: 'Receivable', type: 'expense', isSystem: true });
    await db.collection('transactions').doc(id('t1')).set({ workspaceId: ws, uid: 'owner-1', date: '2026-09-02', description: 'Paper', status: 'posted', currency: 'USD', totalAmountCents: 500,
      lines: [{ accountId: id('bank'), accountName: 'Bank', amountCents: -500 }, { accountId: id('office2'), accountName: 'Office 2', amountCents: 500 }] });
    await db.collection('transactions').doc(id('t2')).set({ workspaceId: ws, uid: 'owner-1', date: '2026-09-03', description: 'Toner', status: 'posted', currency: 'USD', totalAmountCents: 100,
      lines: [{ accountId: id('bank'), amountCents: -100 }, { accountId: id('office'), amountCents: 100 }] });
    await db.collection('bills').doc(id('b1')).set({ workspaceId: ws, date: '2026-09-04', number: 'B-1', status: 'pending', amountCents: 900, lineItems: [{ description: 'Desk', accountId: id('office2'), amountCents: 900 }] });
    await db.collection('autoRules').doc(id('r1')).set({ workspaceId: ws, uid: 'owner-1', condition: { vendor: 'Staples' }, accountId: id('office2') });
    await db.collection('budgets').doc(id('bu1')).set({ workspaceId: ws, uid: 'owner-1', targetType: 'account', targetId: id('office2'), period: '2026', amountCents: 10000 });
    await db.collection('inventory').doc(id('i1')).set({ workspaceId: ws, name: 'Paper', expenseAccountId: id('office2') });
    await db.collection('auditLogs').doc(id('log')).set({ workspaceId: ws, action: 'ACCOUNT_CREATED', entityId: id('office2'), timestamp: '2026-01-01T00:00:00Z' });
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: `${req.header('x-test-uid')}@example.test` }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'bills', 'autoRules', 'budgets', 'inventory', 'chartAccounts', 'auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test(`refused for a bookkeeper, for different kinds, and for an account ${BRAND_NAME} uses itself`, async () => {
    assert.equal((await post('book-1', '/merge', merge)).status, 403);
    const kinds = await post('acct-1', '/merge', { fromId: id('office2'), intoId: id('bank') });
    assert.equal(kinds.status, 400);
    assert.match(String(kinds.body.message), /same kind/);
    assert.equal((await post('acct-1', '/merge', { fromId: id('ar'), intoId: id('office') })).status, 400);
    assert.ok(await get('chartAccounts', 'office2'));
  });

  test('the preview counts what would change and changes nothing', async () => {
    const res = await post('acct-1', '/merge/preview', merge);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.changes, { transactions: 1, bills: 1, autoRules: 1, budgets: 1, inventory: 1, chartAccounts: 1, settings: 1 });
    assert.equal(res.body.total, 7);
    assert.equal((await get('transactions', 't1'))?.lines[1].accountId, id('office2'));
  });

  test('a closed period that would change refuses the whole merge', async () => {
    await db.collection('workspaces').doc(ws).update({ lockDate: '2026-09-02' });
    const res = await post('acct-1', '/merge', merge);
    assert.equal(res.status, 409);
    assert.match(String(res.body.message), /1 record in a closed period \(for example entry Paper \(2026-09-02\)\)/);
    assert.ok(await get('chartAccounts', 'office2'));
    await db.collection('workspaces').doc(ws).update({ lockDate: null });
  });

  test('the merge moves everything to the kept account, adds the opening balance and removes the merged one', async () => {
    const res = await post('owner-1', '/merge', merge);
    assert.equal(res.status, 200);
    assert.deepEqual((await get('transactions', 't1'))?.lines[1], { accountId: id('office'), accountName: 'Office', amountCents: 500 });
    assert.equal((await get('bills', 'b1'))?.lineItems[0].accountId, id('office'));
    assert.equal((await get('autoRules', 'r1'))?.accountId, id('office'));
    assert.equal((await get('budgets', 'bu1'))?.targetId, id('office'));
    assert.equal((await get('inventory', 'i1'))?.expenseAccountId, id('office'));
    assert.equal((await get('chartAccounts', 'pens'))?.parentId, id('office'));
    assert.equal((await db.collection('workspaces').doc(ws).get()).data()?.defaultAccounts.expense, id('office'));
    const kept = await get('chartAccounts', 'office');
    assert.equal(kept?.openingBalanceCents, 1500);
    assert.equal(kept?.asOfDate, '2026-01-01');
    assert.equal(await get('chartAccounts', 'office2'), undefined);
    assert.equal((await get('auditLogs', 'log'))?.entityId, id('office2'), 'history is kept as it was');
    const line = (await db.pool.query(`select data->'details'->>'description' as d from public."auditLogs" where workspace_id = $1 and data->>'action' = 'ACCOUNT_MERGED'`, [ws])).rows[0]?.d;
    assert.equal(line, 'Merged "6101 Office 2" into "6100 Office": 7 records moved');
    const left = (await db.pool.query(`select count(*)::int as n from public."transactions" where workspace_id = $1 and position($2 in data::text) > 0`, [ws, JSON.stringify(id('office2'))])).rows[0].n;
    assert.equal(left, 0);
  });
});
