/**
 * Closing the books: the lock rule (src/lib/periodLock.ts), the close checklist
 * (src/lib/closeChecklist.ts), the posting check, and the close / reopen / partial unlock /
 * sign-off endpoints (src/server/services/periodCloseService.ts, database part with
 * LF_TEST_DATABASE_URL).
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { dayBefore, effectiveLockDate, isLockedDate, monthCloseState, monthEnd, postingLock } from '../lib/periodLock';
import { buildCloseChecklist, readyToClose } from '../lib/closeChecklist';
import { TransactionValidator } from '../kernel/validation/TransactionValidator';
import { depreciationThrough } from '../lib/depreciationEngine';
import type { FixedAsset } from '../types';
import { makeBill, makeInvoice, makeTransaction } from './fixtures';
import type { DocumentData, Firestore } from '../server/db/pgFirestore';
import {
  PeriodCloseError,
  validateClosePeriodInput,
  validateCloseSteps,
  validatePartialUnlockInput,
  validateReopenPeriodInput,
  validateSignOffInput,
} from '../server/services/periodCloseService';

const ws = { uid: 'owner-1', roles: { 'acct-1': 'accountant', 'book-1': 'bookkeeper' }, lockDate: '2026-01-31', softLockDate: '2026-03-31' };

describe('Closed periods', () => {
  test('hard close stops everyone; soft close stops bookkeepers only', () => {
    assert.deepEqual(postingLock('2026-01-15', ws, 'owner-1'), { kind: 'hard', through: '2026-01-31' });
    assert.equal(postingLock('2026-02-15', ws, 'owner-1'), null);
    assert.equal(postingLock('2026-02-15', ws, 'acct-1'), null);
    assert.deepEqual(postingLock('2026-02-15', ws, 'book-1'), { kind: 'soft', through: '2026-03-31' });
    assert.deepEqual(postingLock('2026-03-31', ws, 'stranger'), { kind: 'soft', through: '2026-03-31' });
    assert.equal(postingLock('2026-04-01', ws, 'book-1'), null);
    assert.ok(postingLock(undefined, ws, 'owner-1'), 'no date while closed: refused');
    assert.equal(effectiveLockDate(ws, 'acct-1'), '2026-01-31');
    assert.equal(effectiveLockDate(ws, 'book-1'), '2026-03-31');
  });

  test('a partial unlock opens its dates, for the hard and the soft close', () => {
    const unlocked = { ...ws, lockException: { fromDate: '2026-01-20', toDate: '2026-02-10' } };
    assert.equal(postingLock('2026-01-25', unlocked, 'book-1'), null);
    assert.equal(postingLock('2026-02-10', unlocked, 'book-1'), null);
    assert.ok(postingLock('2026-01-19', unlocked, 'owner-1'));
    assert.ok(postingLock('2026-02-11', unlocked, 'book-1'));
    assert.equal(isLockedDate('2026-01-25T10:00:00Z', '2026-01-31', unlocked.lockException), false);
  });

  test('month ends, the day before, and how a month shows', () => {
    assert.equal(monthEnd('2028-02'), '2028-02-29');
    assert.equal(monthEnd('2100-02'), '2100-02-28');
    assert.equal(monthEnd('2026-12'), '2026-12-31');
    assert.equal(dayBefore('2026-03-01'), '2026-02-28');
    assert.equal(dayBefore('2026-01-01'), '2025-12-31');
    assert.equal(monthCloseState('2026-01', ws), 'hard');
    assert.equal(monthCloseState('2026-03', ws), 'soft');
    assert.equal(monthCloseState('2026-04', ws), 'open');
    assert.equal(monthCloseState('2026-02', { ...ws, lockException: { fromDate: '2026-02-05', toDate: '2026-02-06' } }), 'partly-open');
    assert.equal(monthCloseState('2026-03', { ...ws, softLockDate: '2026-03-28' }), 'open', 'a lock on the 28th does not close March');
  });

  test('the posting check follows the role: a bookkeeper cannot post into a soft-closed month, an accountant can', async () => {
    const accountsMap = new Map([
      ['cash', { id: 'cash', name: 'Cash', workspaceId: 'w1', type: 'asset' }],
      ['rev', { id: 'rev', name: 'Sales', workspaceId: 'w1', type: 'revenue' }],
    ]);
    const tx = () => ({ id: `t-${crypto.randomBytes(3).toString('hex')}`, date: '2026-03-10', description: 'Adjustment', lines: [{ accountId: 'cash', amountCents: 100 }, { accountId: 'rev', amountCents: -100 }] });
    await assert.rejects(TransactionValidator.validateAndPrepare(tx(), { workspaceId: 'w1', user: { uid: 'book-1' }, wsData: ws, accountsMap }), /soft-closed/);
    const ok = await TransactionValidator.validateAndPrepare(tx(), { workspaceId: 'w1', user: { uid: 'acct-1' }, wsData: ws, accountsMap });
    assert.equal(ok.date, '2026-03-10');
  });
});

test('period mutation validators keep legacy path/body errors ahead of stateful authorization', () => {
  const invalid = (work: () => unknown, message: string) => {
    assert.throws(work, (error: unknown) => {
      assert.ok(error instanceof PeriodCloseError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'INVALID_INPUT');
      assert.equal(error.message, message);
      return true;
    });
  };

  invalid(() => validateClosePeriodInput({ month: '2026-13', mode: 'soft' }), 'Month must be YYYY-MM');
  invalid(() => validateReopenPeriodInput({ month: '2026-03', reason: ' no ' }), 'Say why the period is reopened (at least 5 characters)');
  invalid(() => validatePartialUnlockInput({ fromDate: '2026-99-01', toDate: '2026-99-02', reason: 'Fix a date' }), 'Choose a date range (from ≤ to)');
  invalid(() => validateSignOffInput({ month: '2026-03', itemId: 'unknown' }), 'Unknown checklist item');
  invalid(() => validateCloseSteps([{ title: 'x', frequency: 'monthly' }]), 'Each step needs a name of 2 to 120 characters');
  assert.equal(validatePartialUnlockInput({ fromDate: '2026-01-01', toDate: '2026-01-02', reason: '  Fix a date  ' }), 'Fix a date');
});

describe('Close checklist', () => {
  const lines = (cents: number) => [{ id: 'l1', accountId: 'cash', amountCents: cents }, { id: 'l2', accountId: 'rev', amountCents: -cents }];

  test('drafts and an unbalanced trial balance block the close; the rest needs a sign-off', () => {
    const items = buildCloseChecklist({
      month: '2026-03',
      transactions: [
        makeTransaction({ id: 't1', date: '2026-03-05', status: 'completed', lines: lines(500) }),
        makeTransaction({ id: 't2', date: '2026-03-06', status: 'draft', lines: lines(100) }),
        makeTransaction({ id: 't3', date: '2026-03-07', status: 'completed', lines: [{ id: 'l', accountId: '', amountCents: 0 }] }),
        makeTransaction({ id: 't4', date: '2026-04-01', status: 'completed', lines: [{ id: 'l', accountId: 'cash', amountCents: 7 }] }),
      ],
      bankLines: [{ date: '2026-03-02', status: 'pending' }, { date: '2026-03-03', status: 'matched', matchedTransactionId: 't1' }],
      invoices: [makeInvoice({ status: 'sent', dueDate: '2026-01-15' }), makeInvoice({ status: 'draft', date: '2026-03-20' } as never)],
      bills: [makeBill({ status: 'open', dueDate: '2026-02-15' } as never)],
    });
    const byId = Object.fromEntries(items.map(i => [i.id, i]));
    assert.equal(byId.drafts.status, 'blocker');
    assert.equal(byId.drafts.count, 2);
    assert.equal(byId.categorize.count, 1);
    assert.equal(byId.reconcile.count, 1);
    assert.equal(byId['trial-balance'].status, 'done', 'the April entry is after the month end');
    assert.equal(byId.aging.count, 1, 'only the invoice is more than 60 days overdue on 31 March');
    assert.equal(readyToClose(items).ready, false);
  });

  test('ready when nothing blocks and every item needing attention is signed off', () => {
    const items = buildCloseChecklist({
      month: '2026-03',
      transactions: [makeTransaction({ id: 't1', date: '2026-03-05', status: 'completed', lines: lines(500) })],
      bankLines: [{ date: '2026-03-02', status: 'pending' }],
      invoices: [], bills: [],
    });
    assert.match(readyToClose(items).reason || '', /Bank lines matched/);
    assert.deepEqual(readyToClose(items, { reconcile: { by: 'a@x.test', at: '2026-04-02T10:00:00Z' } }), { ready: true });
    const unbalanced = buildCloseChecklist({ month: '2026-03', transactions: [makeTransaction({ id: 'x', date: '2026-03-01', status: 'completed', lines: [{ id: 'l', accountId: 'cash', amountCents: 5 }] })], bankLines: [], invoices: [], bills: [] });
    assert.equal(unbalanced.find(i => i.id === 'trial-balance')?.status, 'blocker');
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('Closing and reopening a month', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const wsId = `ws_close_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  const call = async (
    uid: string,
    path: string,
    body: Record<string, unknown> = {},
    options: { method?: 'POST' | 'PUT'; operationId?: string } = {},
  ) => {
    const res = await fetch(`${base}/api/v1/workspaces/${wsId}/periods${path}`, {
      method: options.method || 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-uid': uid,
        ...(options.operationId ? { 'x-operation-id': options.operationId } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const workspace = async (): Promise<DocumentData> => (await db.collection('workspaces').doc(wsId).get()).data() || {};

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(wsId).set({
      uid: 'owner-1', name: 'Close', currency: 'USD', timezone: 'UTC',
      members: ['owner-1', 'acct-1', 'book-1', 'view-1'], roles: { 'acct-1': 'accountant', 'book-1': 'bookkeeper', 'view-1': 'viewer' },
    });
    await db.collection('invoices').doc(`${wsId}_draft`).set({ workspaceId: wsId, status: 'draft', date: '2026-03-10', number: 'INV-9' });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: `${req.header('x-test-uid')}@test.local` }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['invoices', 'periods', 'idempotencyKeys', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [wsId]);
    }
    await db.terminate();
  });

  test('only owners and accountants close; a month that has not ended cannot be closed', async () => {
    assert.equal((await call('view-1', '/2026-03/close', { mode: 'soft' })).status, 403);
    assert.equal((await call('book-1', '/2026-03/close', { mode: 'soft' })).status, 403);
    assert.equal((await call('book-1', '/2026-13/close', { mode: 'soft' })).status, 400, 'legacy route validates the month before checking the close role');
    assert.equal((await call('acct-1', '/2999-01/close', { mode: 'soft' })).status, 400);
    assert.equal((await call('acct-1', '/2026-13/close', { mode: 'soft' })).status, 400);
  });

  test('custom close steps keep the PUT route, validate roles, and replay one generated step set', async () => {
    const input = { steps: [{ title: 'Review payroll report', frequency: 'monthly' }] };
    assert.equal((await call('book-1', '/close-steps', input, { method: 'PUT' })).status, 403);
    assert.equal((await call('book-1', '/close-steps', { steps: [{ title: 'x', frequency: 'monthly' }] }, { method: 'PUT' })).status, 400, 'legacy route validates steps before role refusals');
    assert.equal((await call('acct-1', '/close-steps', { steps: [{ title: 'x', frequency: 'monthly' }] }, { method: 'PUT' })).status, 400);

    const operationId = 'period-close-steps-route';
    const saved = await call('acct-1', '/close-steps', input, { method: 'PUT', operationId });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.status, 'success');
    const closeSteps = saved.body.closeSteps as Array<{ id: string; title: string; frequency: string }>;
    assert.equal(closeSteps.length, 1);
    assert.match(closeSteps[0].id, /^cs_[a-f0-9]{12}$/);
    assert.deepEqual(closeSteps[0], { id: closeSteps[0].id, title: 'Review payroll report', frequency: 'monthly' });

    const retried = await call('acct-1', '/close-steps', input, { method: 'PUT', operationId });
    assert.deepEqual(retried, saved);
    assert.equal((await call('acct-1', '/close-steps', { steps: [] }, { method: 'PUT', operationId })).status, 409);
    assert.deepEqual((await workspace()).closeSteps, closeSteps);
    const audits = await db.collection('auditLogs').where('workspaceId', '==', wsId).get();
    assert.equal(audits.docs.filter(doc => doc.data().action === 'CLOSE_STEPS_SAVED').length, 1);
  });

  test('drafts dated in the month block the close and are listed', async () => {
    const res = await call('acct-1', '/2026-03/close', { mode: 'soft' });
    assert.equal(res.status, 409);
    assert.deepEqual((res.body.details as Array<{ id: string }>).map(d => d.id), [`${wsId}_draft`]);
    await db.collection('invoices').doc(`${wsId}_draft`).delete();
  });

  test('soft close, sign-offs, hard close; sign-offs are final once hard-closed', async () => {
    const closeOperationId = 'period-close-soft-route';
    const soft = await call('acct-1', '/2026-03/close', { mode: 'soft' }, { operationId: closeOperationId });
    assert.equal(soft.status, 200, JSON.stringify(soft.body));
    assert.deepEqual(await call('acct-1', '/2026-03/close', { mode: 'soft' }, { operationId: closeOperationId }), soft);
    assert.equal((await call('acct-1', '/2026-03/close', { mode: 'hard' }, { operationId: closeOperationId })).status, 409, 'the same operation ID cannot close in a different mode');
    assert.equal((await workspace()).softLockDate, '2026-03-31');
    assert.equal((await workspace()).lockDate, undefined);
    assert.equal((await call('acct-1', '/2026-03/close', { mode: 'soft' })).status, 409, 'already closed');

    assert.equal((await call('book-1', '/2026-13/sign-off', { itemId: 'reconcile' })).status, 400);
    assert.equal((await call('book-1', '/2026-03/sign-off', { itemId: 'nope' })).status, 400);
    const signOffInput = { itemId: 'reconcile', note: 'Two card fees, fine' };
    const signOffOperationId = 'period-signoff-route';
    const signed = await call('book-1', '/2026-03/sign-off', signOffInput, { operationId: signOffOperationId });
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    assert.deepEqual(await call('book-1', '/2026-03/sign-off', signOffInput, { operationId: signOffOperationId }), signed);
    assert.equal((await call('book-1', '/2026-03/sign-off', { ...signOffInput, note: 'Different review' }, { operationId: signOffOperationId })).status, 409);
    const period = (await db.collection('periods').doc(`${wsId}_2026-03`).get()).data();
    assert.equal(period?.signOffs.reconcile.by, 'book-1@test.local');
    assert.equal(period?.status, 'soft_closed');

    const hard = await call('acct-1', '/2026-03/close', { mode: 'hard' });
    assert.equal(hard.status, 200, JSON.stringify(hard.body));
    assert.equal((await workspace()).lockDate, '2026-03-31');
    assert.equal((await call('book-1', '/2026-03/sign-off', { itemId: 'aging' })).status, 409);
  });

  test('reopening a hard-closed month needs the owner and a reason; later months reopen too', async () => {
    assert.equal((await call('acct-1', '/2026-02/reopen', { reason: 'Missed a bill' })).status, 403);
    assert.equal((await call('owner-1', '/2026-02/reopen', { reason: 'no' })).status, 400);
    const reopenInput = { reason: 'Missed a supplier bill' };
    const reopenOperationId = 'period-reopen-route';
    const res = await call('owner-1', '/2026-02/reopen', reopenInput, { operationId: reopenOperationId });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await call('owner-1', '/2026-02/reopen', reopenInput, { operationId: reopenOperationId }), res);
    assert.equal((await call('owner-1', '/2026-02/reopen', { reason: 'Missed another supplier bill' }, { operationId: reopenOperationId })).status, 409);
    const w = await workspace();
    assert.equal(w.lockDate, '2026-01-31');
    assert.equal(w.softLockDate, '2026-01-31');
    assert.equal((await call('owner-1', '/2026-03/reopen', { reason: 'Again please' })).status, 409, 'March is open now');
  });

  test('partial unlock: owner only for hard-closed dates; closing again removes it', async () => {
    assert.equal((await call('acct-1', '/unlock', { fromDate: '2026-01-10', toDate: '2026-01-20', reason: 'Fix a date' })).status, 403);
    assert.equal((await call('book-1', '/unlock', { fromDate: '2026-99-01', toDate: '2026-99-02', reason: 'Fix a date' })).status, 400, 'legacy route validates unlock dates before role refusals');
    assert.equal((await call('owner-1', '/unlock', { fromDate: '2026-02-10', toDate: '2026-02-20', reason: 'Fix a date' })).status, 400, 'not closed');
    const unlockInput = { fromDate: '2026-01-10', toDate: '2026-01-20', reason: 'Fix a date' };
    const unlockOperationId = 'period-unlock-route';
    const res = await call('owner-1', '/unlock', unlockInput, { operationId: unlockOperationId });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await call('owner-1', '/unlock', unlockInput, { operationId: unlockOperationId }), res);
    assert.equal((await call('owner-1', '/unlock', { ...unlockInput, reason: 'Correct a date' }, { operationId: unlockOperationId })).status, 409);
    assert.deepEqual({ ...(await workspace()).lockException, at: undefined, byUid: undefined }, { fromDate: '2026-01-10', toDate: '2026-01-20', reason: 'Fix a date', by: 'owner-1@test.local', at: undefined, byUid: undefined });

    const relockOperationId = 'period-relock-route';
    const relocked = await call('acct-1', '/relock', {}, { operationId: relockOperationId });
    assert.equal(relocked.status, 200, JSON.stringify(relocked.body));
    assert.deepEqual(await call('acct-1', '/relock', {}, { operationId: relockOperationId }), relocked);
    assert.equal((await workspace()).lockException, null);
    assert.equal((await call('acct-1', '/relock')).status, 409);

    const audits = (await db.collection('auditLogs').where('workspaceId', '==', wsId).get()).docs;
    const actions = audits.map(d => d.get('action')).sort();
    assert.deepEqual([...new Set(actions)], ['CLOSE_STEPS_SAVED', 'PERIOD_CLOSED', 'PERIOD_PARTIAL_UNLOCK', 'PERIOD_RELOCKED', 'PERIOD_REOPENED', 'PERIOD_SIGN_OFF']);
    assert.equal(actions.filter(action => action === 'PERIOD_CLOSED').length, 2, 'soft and hard close each commit once');
    assert.equal(actions.filter(action => action === 'PERIOD_PARTIAL_UNLOCK').length, 1);
    assert.equal(actions.filter(action => action === 'PERIOD_RELOCKED').length, 1);
  });
});

describe('Depreciation', () => {
  const asset = (fields: Partial<FixedAsset> = {}): FixedAsset => ({
    id: 'a1', uid: 'u', workspaceId: 'w', name: 'Van', purchaseDate: '2026-01-15', purchasePriceCents: 120000, salvageValueCents: 0,
    usefulLifeYears: 1, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0, status: 'active', createdAt: '2026-01-15', ...fields,
  });

  test('straight line: starts the month after purchase, exact total, nothing after the life ends', () => {
    assert.equal(depreciationThrough(asset(), '2026-01'), 0);
    assert.equal(depreciationThrough(asset(), '2026-02'), 10000);
    assert.equal(depreciationThrough(asset(), '2026-06'), 50000);
    assert.equal(depreciationThrough(asset(), '2027-01'), 120000);
    assert.equal(depreciationThrough(asset(), '2030-01'), 120000);
    assert.equal(depreciationThrough(asset({ purchasePriceCents: 100000, salvageValueCents: 10000, usefulLifeYears: 0.25 }), '2026-04'), 90000, 'rounding goes to the last month');
  });

  test('declining balance: more at the start, never below salvage, ends exactly at salvage', () => {
    const dd = asset({ depreciationMethod: 'declining-balance', salvageValueCents: 20000 });
    const first = depreciationThrough(dd, '2026-02');
    assert.equal(first, Math.round(120000 * 2 / 12));
    assert.ok(depreciationThrough(dd, '2026-03') - first < first, 'the second month is smaller');
    assert.equal(depreciationThrough(dd, '2027-01'), 100000);
  });

  test('the close checklist asks for the run when an asset is behind', () => {
    const items = buildCloseChecklist({ month: '2026-03', transactions: [], bankLines: [], invoices: [], bills: [], assets: [asset({ accumulatedDepreciationCents: 10000 })] });
    assert.equal(items.find(i => i.id === 'depreciation')?.count, 1);
    const upToDate = buildCloseChecklist({ month: '2026-03', transactions: [], bankLines: [], invoices: [], bills: [], assets: [asset({ accumulatedDepreciationCents: 20000 })] });
    assert.equal(upToDate.find(i => i.id === 'depreciation')?.status, 'done');
  });
});

describe('Depreciation run', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const wsId = `ws_dep_${crypto.randomBytes(4).toString('hex')}`;
  const id = (name: string) => `${wsId}_${name}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  const run = async (uid: string, month: string, operationId?: string) => {
    const res = await fetch(`${base}/api/v1/workspaces/${wsId}/periods/${month}/depreciation`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-uid': uid,
        ...(operationId ? { 'x-operation-id': operationId } : {}),
      },
      body: '{}',
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const entries = async () => (await db.collection('transactions').where('workspaceId', '==', wsId).get()).docs.map(d => d.data());

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(wsId).set({ uid: 'owner-1', name: 'Dep', currency: 'USD', timezone: 'UTC', members: ['owner-1', 'view-1'], roles: { 'view-1': 'viewer' } });
    await db.collection('chartAccounts').doc(id('exp')).set({ workspaceId: wsId, name: 'Depreciation Expense', type: 'expense', code: '6400' });
    await db.collection('chartAccounts').doc(id('acc')).set({ workspaceId: wsId, name: 'Accumulated Depreciation', type: 'asset', code: '1590', isContra: true });
    await db.collection('assets').doc(id('van')).set({ workspaceId: wsId, name: 'Van', purchaseDate: '2026-01-15', purchasePriceCents: 120000, salvageValueCents: 0, usefulLifeYears: 1, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0, status: 'active' });
    await db.collection('assets').doc(id('pc')).set({ workspaceId: wsId, name: 'Laptop', purchaseDate: '2026-02-01', purchasePriceCents: 36000, salvageValueCents: 0, usefulLifeYears: 3, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0, status: 'active', expenseAccountId: id('exp'), accumulatedAccountId: id('acc') });
    await db.collection('assets').doc(id('old')).set({ workspaceId: wsId, name: 'Sold desk', purchaseDate: '2025-01-01', purchasePriceCents: 50000, salvageValueCents: 0, usefulLifeYears: 1, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0, status: 'disposed' });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['assets', 'chartAccounts', 'transactions', 'idempotencyKeys', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [wsId]);
    }
    await db.terminate();
  });

  test('viewers cannot run it; malformed and unended months cannot be run', async () => {
    assert.equal((await run('view-1', '2026-03')).status, 403);
    assert.equal((await run('owner-1', '2026-13')).status, 400);
    assert.equal((await run('owner-1', '2999-01')).status, 400);
  });

  test('one entry for all assets through the month (catching up missed months), replay once, then a plain no-op', async () => {
    const operationId = 'period-depreciation-route';
    const res = await run('owner-1', '2026-03', operationId);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await run('owner-1', '2026-03', operationId), res);
    // Van: Feb + Mar = 2 × 10000; Laptop (bought in Feb): Mar = 1000; the disposed desk is skipped
    assert.equal(res.body.totalCents, 21000);
    assert.equal(res.body.assets, 2);
    const [entry] = await entries();
    assert.equal(entry.date, '2026-03-31');
    assert.deepEqual(entry.lines.map((l: { accountId: string; amountCents: number }) => [l.accountId, l.amountCents]), [[id('exp'), 21000], [id('acc'), -21000]]);
    const van = (await db.collection('assets').doc(id('van')).get()).data();
    assert.equal(van?.accumulatedDepreciationCents, 20000);
    assert.equal(van?.depreciatedThrough, '2026-03');

    const again = await run('owner-1', '2026-03');
    assert.equal(again.body.totalCents, 0);
    assert.equal((await entries()).length, 1);
    const audits = await db.collection('auditLogs').where('workspaceId', '==', wsId).get();
    assert.equal(audits.docs.filter(doc => doc.data().action === 'DEPRECIATION_RUN').length, 1);
  });

  test('a locked month is refused', async () => {
    await db.collection('workspaces').doc(wsId).update({ lockDate: '2026-04-30' });
    assert.equal((await run('owner-1', '2026-04')).status, 409);
    await db.collection('workspaces').doc(wsId).update({ lockDate: null });
  });
});

describe('Bad debt write-off', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const wsId = `ws_bd_${crypto.randomBytes(4).toString('hex')}`;
  const id = (name: string) => `${wsId}_${name}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  const call = async (uid: string, path: string, body: Record<string, unknown> = {}) => {
    const res = await fetch(`${base}/api/v1/workspaces/${wsId}/invoices/${id('inv')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const invoice = async (): Promise<DocumentData> => (await db.collection('invoices').doc(id('inv')).get()).data() || {};
  const ledger = async () => (await db.collection('transactions').where('workspaceId', '==', wsId).get()).docs.map(d => ({ ...d.data(), id: d.id }) as DocumentData);

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(wsId).set({ uid: 'owner-1', name: 'BD', currency: 'USD', timezone: 'UTC', members: ['owner-1', 'book-1'], roles: { 'book-1': 'bookkeeper' } });
    await db.collection('chartAccounts').doc(id('ar')).set({ workspaceId: wsId, name: 'Accounts Receivable', type: 'asset', category: 'Receivables', code: '1100' });
    await db.collection('chartAccounts').doc(id('bd')).set({ workspaceId: wsId, name: 'Bad Debt Expense', type: 'expense', code: '6800' });
    await db.collection('invoices').doc(id('inv')).set({ workspaceId: wsId, customerId: 'c1', customerName: 'Acme', number: 'INV-7', amountCents: 10000, amountPaidCents: 3000, status: 'partially_paid', exchangeRate: 1.1, date: '2026-01-10', dueDate: '2026-02-10' });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['invoices', 'chartAccounts', 'transactions', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [wsId]);
    }
    await db.terminate();
  });

  test('bookkeepers cannot write off; the account must be an expense', async () => {
    assert.equal((await call('book-1', '/write-off', {})).status, 403);
    assert.equal((await call('owner-1', '/write-off', { badDebtAccountId: id('ar') })).status, 400);
  });

  test('what is still due is written off in the base currency and the invoice is settled; the sale stays', async () => {
    const res = await call('owner-1', '/write-off', { date: '2026-06-30', reason: 'Customer closed' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.writtenOffCents, 7000);
    assert.equal(res.body.baseCents, 7700, '7000 at 1.1');
    const [entry] = await ledger();
    assert.deepEqual(entry.lines.map((l: { accountId: string; amountCents: number }) => [l.accountId, l.amountCents]), [[id('bd'), 7700], [id('ar'), -7700]]);
    const inv = await invoice();
    assert.equal(inv.status, 'paid');
    assert.equal(inv.amountPaidCents, 10000);
    assert.equal(inv.settledByRecordsCents, 7000, 'not posted again as cash when the invoice is re-posted');
    assert.equal((await call('owner-1', '/write-off', {})).status, 409, 'nothing left');
  });

  test('the customer pays after all: the write-off is reversed once and the invoice is due again', async () => {
    const res = await call('owner-1', '/write-off/reverse', { date: '2026-07-15' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const reversal = (await ledger()).find(t => t.metadata?.type === 'invoice-bad-debt-recovery');
    assert.deepEqual(reversal?.lines.map((l: { accountId: string; amountCents: number }) => [l.accountId, l.amountCents]), [[id('bd'), -7700], [id('ar'), 7700]]);
    const inv = await invoice();
    assert.equal(inv.status, 'partially_paid');
    assert.equal(inv.amountPaidCents, 3000);
    assert.equal(inv.writtenOffCents, 0);
    assert.equal((await call('owner-1', '/write-off/reverse', {})).status, 409);
  });
});
