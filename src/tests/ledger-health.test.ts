/**
 * Ledger health monitor (CA-32): the nightly run checks each workspace whose books changed since its
 * last check, keeps what it found on the workspace, and tells owners and accountants (not
 * bookkeepers) about serious problems once: a problem already told is not told again, a new one is,
 * and an unchanged workspace is not checked again. The run stops at its time budget. The database
 * part runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Firestore } from '../server/db/pgFirestore';
import { healthSummary, newSeriousProblems, problemNotice, type LedgerHealth } from '../lib/ledgerHealth';
import type { CheckFinding } from '../lib/dataChecks';

const finding = (id: string, checkId: string, severity: CheckFinding['severity']): CheckFinding => ({ id, checkId, severity, title: id, description: '' });

describe('Ledger health rules', () => {
  test('the summary counts each severity and keeps the serious ids only', () => {
    const summary = healthSummary([finding('a', 'unbalanced', 'high'), finding('b', 'future-dated', 'medium'), finding('c', 'missing-account', 'high'), finding('d', 'x', 'low')], '2026-10-06T02:00:00Z');
    assert.deepEqual(summary, { checkedAt: '2026-10-06T02:00:00Z', counts: { high: 2, medium: 1, low: 1 }, highIds: ['a', 'c'] });
  });

  test('new serious problems: everything serious the first time, then only what was not seen', () => {
    const now = [finding('a', 'unbalanced', 'high'), finding('b', 'unbalanced', 'high'), finding('m', 'future-dated', 'medium')];
    assert.deepEqual(newSeriousProblems(now, undefined).map(f => f.id), ['a', 'b']);
    assert.deepEqual(newSeriousProblems(now, { highIds: ['a'] }).map(f => f.id), ['b']);
    assert.deepEqual(newSeriousProblems(now, { highIds: ['a', 'b'] }), []);
  });

  test('the notice counts the new problems by kind, in words', () => {
    const one = problemNotice([finding('a', 'unbalanced', 'high')]);
    assert.equal(one.title, 'A new problem in the books');
    assert.equal(one.message, 'Entries whose debits and credits differ (1). Open Data Health to see and fix it.');
    const many = problemNotice([finding('a', 'unbalanced', 'high'), finding('b', 'unbalanced', 'high'), finding('c', 'missing-account', 'high'),
      finding('d', 'duplicate-invoice-number', 'high'), finding('e', 'overpaid', 'high')]);
    assert.equal(many.title, '5 new problems in the books');
    assert.match(many.message, /^Entries whose debits and credits differ \(2\); Entry lines pointing to an account that no longer exists \(1\); .+ \(1\); and 1 more kinds\. Open Data Health to see and fix them\.$/);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;
describe('Ledger health monitor (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_health_${crypto.randomBytes(4).toString('hex')}`;
  const id = (name: string) => `${ws}_${name}`;
  let db: Firestore;
  let run: typeof import('../server/services/ledgerHealthService').runLedgerHealthMonitor;
  const health = async () => (await db.collection('workspaces').doc(ws).get()).data()?.ledgerHealth as LedgerHealth | undefined;
  const told = async () => (await db.pool.query(
    `select data->>'uid' as uid from public.notifications where workspace_id = $1 and data->>'kind' = 'health.problem' order by data->>'createdAt', data->>'uid'`, [ws])).rows.map(r => r.uid as string);
  const entry = (name: string, lines: Array<{ accountId: string; amountCents: number }>) => db.collection('transactions').doc(id(name)).set({
    workspaceId: ws, uid: 'owner-1', date: '2026-09-14', description: name, status: 'posted', currency: 'USD', totalAmountCents: 1000, lines,
  });

  before(async () => {
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    ({ runLedgerHealthMonitor: run } = await import('../server/services/ledgerHealthService'));
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Health Co', currency: 'USD', members: ['owner-1', 'acct-1', 'book-1'], roles: { 'acct-1': 'accountant', 'book-1': 'bookkeeper' } });
    await db.collection('chartAccounts').doc(id('bank')).set({ workspaceId: ws, name: 'Bank', type: 'asset', code: '1000' });
    await db.collection('chartAccounts').doc(id('sales')).set({ workspaceId: ws, name: 'Sales', type: 'revenue', code: '4000' });
    await entry('fine', [{ accountId: id('bank'), amountCents: 1000 }, { accountId: id('sales'), amountCents: -1000 }]);
    // Simulate a legacy pre-trigger corrupted row so the health doctor can prove it detects it
    await db.pool.query('alter table public."transactions" disable trigger lf_balanced_ledger');
    try {
      await entry('lopsided', [{ accountId: id('bank'), amountCents: 1000 }, { accountId: id('sales'), amountCents: -900 }]);
    } finally {
      await db.pool.query('alter table public."transactions" enable trigger lf_balanced_ledger');
    }
  });

  after(async () => {
    for (const table of ['transactions', 'chartAccounts', 'reconciliations', 'notifications', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('the first check keeps what it found and tells the owner and the accountant, not the bookkeeper', async () => {
    assert.deepEqual(await run(db, { workspaceIds: [ws] }), { checked: 1, notified: 1, left: 0 });
    const h = await health();
    assert.equal(h?.counts.high, 1);
    assert.deepEqual(h?.highIds, [`unbalanced-${id('lopsided')}`]);
    assert.deepEqual(await told(), ['acct-1', 'owner-1']);
  });

  test('nothing changed: not checked again; a new problem: checked and told once more', async () => {
    assert.deepEqual(await run(db, { workspaceIds: [ws] }), { checked: 0, notified: 0, left: 0 });
    await entry('ghost', [{ accountId: id('bank'), amountCents: 500 }, { accountId: id('gone'), amountCents: -500 }]);
    assert.deepEqual(await run(db, { workspaceIds: [ws] }), { checked: 1, notified: 1, left: 0 });
    assert.equal((await health())?.counts.high, 2);
    assert.equal((await told()).length, 4, 'the new problem is told; the old one is not told twice');
  });

  test('a reconciled period that moves tells the owner and the accountant once (S-07)', async () => {
    const recon = (await db.pool.query(`select count(*)::int as n from public.notifications where workspace_id = $1 and data->>'kind' = 'reconciliation.discrepancy'`, [ws]));
    assert.equal(recon.rows[0].n, 0);
    // the first look keeps the books-minus-statement difference on 2026-09-30, whatever it is
    await db.collection('reconciliations').doc(id('rec')).set({ workspaceId: ws, accountId: id('bank'), statementDate: '2026-09-30', statementBalanceCents: 0, reconciledIds: [] });
    await run(db, { workspaceIds: [ws] });
    const kept = (await health())?.reconciled?.[id('rec')];
    assert.equal(typeof kept, 'number');
    await entry('backdated', [{ accountId: id('bank'), amountCents: 700 }, { accountId: id('sales'), amountCents: -700 }]);
    await run(db, { workspaceIds: [ws] });
    const told = (await db.pool.query(`select data->>'uid' as uid, data->>'message' as m from public.notifications where workspace_id = $1 and data->>'kind' = 'reconciliation.discrepancy' order by 1`, [ws])).rows;
    assert.deepEqual(told.map(r => r.uid), ['acct-1', 'owner-1']);
    assert.match(told[0].m, /^On 2026-09-30 the books now differ from the statement by \$\d/);
    assert.equal((await health())?.reconciled?.[id('rec')], (kept as number) + 700);
    await db.collection('transactions').doc(id('backdated')).delete();
    await db.collection('reconciliations').doc(id('rec')).delete();
    await run(db, { workspaceIds: [ws] });
  });

  test('fixed: checked again, nothing told; the time budget stops the run', async () => {
    await db.collection('transactions').doc(id('lopsided')).delete();
    await db.collection('transactions').doc(id('ghost')).delete();
    assert.deepEqual(await run(db, { workspaceIds: [ws] }), { checked: 1, notified: 0, left: 0 });
    assert.deepEqual((await health())?.counts, { high: 0, medium: 0, low: 0 });
    await entry('later', [{ accountId: id('bank'), amountCents: 1 }, { accountId: id('sales'), amountCents: -1 }]);
    assert.deepEqual(await run(db, { workspaceIds: [ws], budgetMs: -1 }), { checked: 0, notified: 0, left: 1 });
    assert.deepEqual(await run(db, { workspaceIds: [ws, `${ws}_missing`] }), { checked: 1, notified: 0, left: 0 });
  });
});
