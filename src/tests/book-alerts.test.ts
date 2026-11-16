/**
 * Alerts about the books (S-08, S-10, S-11): a close reminder from the chosen day until last month
 * is closed, once a month; an account budget overspent in its month, quarter or year, once per
 * period; cash below the chosen amount, told once and again only after it was back above. Only
 * owners and accountants change the settings. The database part runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';
import {
  alertSettingsProblem, budgetPeriodMonths, budgetsOver, cashLowAction, cashPosition, closeReminderMonth,
} from '../lib/bookAlerts';
import type { SavedBudget } from '../lib/budgetActual';
import { makeChartAccount, makeTransaction } from './fixtures';

const budget = (fields: Partial<SavedBudget>): SavedBudget => ({ id: 'b1', uid: 'u', targetId: 'office', targetType: 'account', period: 'monthly', amountCents: 10000, createdAt: '2026-01-15T00:00:00Z', ...fields } as SavedBudget);

describe('Book alert rules', () => {
  test('settings: a positive cash amount, a day from 1 to 28, budget alerts on or off', () => {
    assert.equal(alertSettingsProblem({ cashLowCents: 500000, closeReminderDay: 5, budgetAlerts: true }), null);
    assert.equal(alertSettingsProblem({ cashLowCents: null, closeReminderDay: null }), null);
    assert.match(String(alertSettingsProblem({ cashLowCents: -1 })), /positive/);
    assert.match(String(alertSettingsProblem({ cashLowCents: 1.5 })), /positive/);
    assert.match(String(alertSettingsProblem({ closeReminderDay: 29 })), /1 and 28/);
    assert.match(String(alertSettingsProblem({ budgetAlerts: 'yes' })), /on or off/);
  });

  test('close reminder: from the day (the 5th unless chosen), for last month, until closed, once', () => {
    assert.equal(closeReminderMonth({}, '2026-10-04'), null);
    assert.equal(closeReminderMonth({}, '2026-10-05'), '2026-09');
    assert.equal(closeReminderMonth({}, '2026-01-20'), '2025-12');
    assert.equal(closeReminderMonth({ alerts: { closeReminderDay: 2 } }, '2026-10-02'), '2026-09');
    assert.equal(closeReminderMonth({ alerts: { closeReminderDay: null } }, '2026-10-20'), null);
    assert.equal(closeReminderMonth({ lockDate: '2026-09-30' }, '2026-10-20'), null);
    assert.equal(closeReminderMonth({ softLockDate: '2026-09-30', lockDate: '2026-06-30' }, '2026-10-20'), null, 'soft-closed counts');
    assert.equal(closeReminderMonth({ lockDate: '2026-08-31' }, '2026-10-20'), '2026-09');
    assert.equal(closeReminderMonth({ alertsSent: { closeReminder: '2026-09' } }, '2026-10-20'), null);
  });

  test('cash: told when it falls below, not again while below, forgotten once back above or turned off', () => {
    assert.equal(cashLowAction({ cashLowCents: 1000 }, {}, 999), 'tell');
    assert.equal(cashLowAction({ cashLowCents: 1000 }, { cashLow: true }, 500), null);
    assert.equal(cashLowAction({ cashLowCents: 1000 }, { cashLow: true }, 1000), 'reset');
    assert.equal(cashLowAction({ cashLowCents: 1000 }, {}, 5000), null);
    assert.equal(cashLowAction({ cashLowCents: null }, { cashLow: true }, 0), 'reset');
    assert.equal(cashLowAction(undefined, undefined, 0), null);
  });

  test('cash position: bank and cash accounts in the home currency, posted entries up to today', () => {
    const bank = makeChartAccount({ id: 'bank', name: 'Checking', type: 'asset', category: 'Cash', openingBalanceCents: 1000 });
    const euro = makeChartAccount({ id: 'eur', name: 'Euro account', type: 'asset', category: 'Cash', currency: 'EUR', openingBalanceCents: 9999 });
    const office = makeChartAccount({ id: 'office', name: 'Office', type: 'expense', category: 'Office' });
    const txs = [
      makeTransaction({ id: 't1', date: '2026-10-01', lines: [{ accountId: 'bank', amountCents: -300 }, { accountId: 'office', amountCents: 300 }] }),
      makeTransaction({ id: 't2', date: '2026-10-09', lines: [{ accountId: 'bank', amountCents: -100 }, { accountId: 'office', amountCents: 100 }] }),
    ];
    assert.equal(cashPosition([bank, euro, office], txs, '2026-10-07', 'USD'), 700);
  });

  test('a budget\'s period: its month, its quarter or year from when it started, or the dated month or year', () => {
    assert.deepEqual(budgetPeriodMonths(budget({}), '2026-10'), ['2026-10']);
    assert.deepEqual(budgetPeriodMonths(budget({ period: 'quarterly' }), '2026-10'), ['2026-10', '2026-11', '2026-12']);
    assert.deepEqual(budgetPeriodMonths(budget({ period: 'quarterly' }), '2026-03'), ['2026-01', '2026-02', '2026-03']);
    assert.deepEqual(budgetPeriodMonths(budget({ period: 'yearly', startDate: '2025-07-01' }), '2026-03')?.[0], '2025-07');
    assert.deepEqual(budgetPeriodMonths(budget({ period: '2026' }), '2026-10')?.length, 12);
    assert.equal(budgetPeriodMonths(budget({ period: '2025' }), '2026-10'), null);
    assert.deepEqual(budgetPeriodMonths(budget({ period: '2026-10' }), '2026-10'), ['2026-10']);
    assert.equal(budgetPeriodMonths(budget({}), '2025-12'), null, 'before it started');
  });

  test('over budget: spent more than the whole period\'s budget so far', () => {
    const office = makeChartAccount({ id: 'office', name: 'Office', type: 'expense', category: 'Office' });
    const bank = makeChartAccount({ id: 'bank', name: 'Bank', type: 'asset' });
    const spend = (id: string, date: string, cents: number) => makeTransaction({ id, date, lines: [{ accountId: 'bank', amountCents: -cents }, { accountId: 'office', amountCents: cents }] });
    const txs = [spend('a', '2026-10-02', 6000), spend('b', '2026-10-05', 5000), spend('c', '2026-09-20', 9000)];
    const over = budgetsOver([budget({}), budget({ id: 'b2', period: 'quarterly', amountCents: 30000 })], [office, bank], txs, '2026-10-07');
    assert.deepEqual(over.map(o => [o.budget.id, o.firstMonth, o.budgetCents, o.actualCents]), [['b1', '2026-10', 10000, 11000]]);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;
describe('Book alerts (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_alerts_${crypto.randomBytes(4).toString('hex')}`;
  const id = (name: string) => `${ws}_${name}`;
  let db: Firestore;
  let server: Server;
  let base = '';
  let check: typeof import('../server/services/bookAlertService').checkBookAlerts;
  const kinds = async () => (await db.pool.query(
    `select data->>'kind' as kind, count(*)::int as n from public.notifications where workspace_id = $1 group by 1 order by 1`, [ws])).rows.map(r => `${r.kind}:${r.n}`);
  const put = async (uid: string, body: unknown, operationId?: string) => {
    const res = await fetch(`${base}/api/v1/workspaces/${ws}/alerts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-test-uid': uid, ...(operationId ? { 'idempotency-key': operationId } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as { status?: string; message?: string; alerts?: Record<string, unknown> } };
  };
  const spend = (name: string, date: string, cents: number) => db.collection('transactions').doc(id(name)).set({
    workspaceId: ws, uid: 'owner-1', date, description: name, status: 'posted', currency: 'USD', totalAmountCents: cents,
    lines: [{ accountId: id('bank'), amountCents: -cents }, { accountId: id('office'), amountCents: cents }],
  });
  const at = (day: string) => new Date(`${day}T12:00:00Z`);

  before(async () => {
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    ({ checkBookAlerts: check } = await import('../server/services/bookAlertService'));
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Alerts Co', currency: 'USD', members: ['owner-1', 'acct-1', 'book-1'], roles: { 'acct-1': 'accountant', 'book-1': 'bookkeeper' } });
    await db.collection('chartAccounts').doc(id('bank')).set({ workspaceId: ws, name: 'Checking', type: 'asset', category: 'Cash', openingBalanceCents: 100000, balanceCents: 0 });
    await db.collection('chartAccounts').doc(id('office')).set({ workspaceId: ws, name: 'Office', type: 'expense', balanceCents: 0 });
    await db.collection('budgets').doc(id('b1')).set({ workspaceId: ws, uid: 'owner-1', targetType: 'account', targetId: id('office'), period: 'monthly', amountCents: 20000, createdAt: '2026-01-01T00:00:00Z' });
    await spend('a', '2026-10-02', 15000);
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'chartAccounts', 'budgets', 'notifications', 'auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('only owners and accountants change alerts; refusals, saved response and idempotent retry stay stable', async () => {
    assert.equal((await put('book-1', { cashLowCents: 90000 })).status, 403);
    const bad = await put('acct-1', { cashLowCents: -5 });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.message, 'The cash amount must be a positive amount');

    const settings = { cashLowCents: 80000, closeReminderDay: 5, budgetAlerts: true };
    const operationId = `${ws}-save-alerts`;
    const saved = await put('acct-1', settings, operationId);
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body, { status: 'success', alerts: settings });
    assert.deepEqual((await db.collection('workspaces').doc(ws).get()).data()?.alerts, settings);

    const replay = await put('acct-1', settings, operationId);
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, { status: 'success', alerts: settings });
    const changedRetry = await put('acct-1', { ...settings, budgetAlerts: false }, operationId);
    assert.equal(changedRetry.status, 409);
    assert.deepEqual((await db.collection('workspaces').doc(ws).get()).data()?.alerts, settings, 'a reused id cannot change settings');
    const auditRows = await db.pool.query(
      `select count(*)::int as n from public."auditLogs" where workspace_id = $1 and data->>'action' = 'ALERTS_SAVED'`, [ws]);
    assert.equal(auditRows.rows[0].n, 1, 'the replay does not duplicate the audit entry');
  });

  test('the 4th: nothing; the 7th: the close reminder once; cash and budget fine so far', async () => {
    await check(db, ws, at('2026-10-04'));
    assert.deepEqual(await kinds(), []);
    await check(db, ws, at('2026-10-07'));
    assert.deepEqual(await kinds(), ['close.reminder:2'], 'the owner and the accountant');
    await check(db, ws, at('2026-10-08'));
    assert.deepEqual(await kinds(), ['close.reminder:2'], 'not again for the same month');
  });

  test('spending past the budget and below the cash amount tells each once', async () => {
    await spend('b', '2026-10-08', 10000); // office 250.00 of 200.00; cash 1,000.00 - 250.00 = 750.00 < 800.00
    await check(db, ws, at('2026-10-09'));
    assert.deepEqual(await kinds(), ['budget.exceeded:2', 'cash.low:2', 'close.reminder:2']);
    await spend('c', '2026-10-09', 100);
    await check(db, ws, at('2026-10-10'));
    assert.deepEqual(await kinds(), ['budget.exceeded:2', 'cash.low:2', 'close.reminder:2'], 'still over, still low: not told again');
    const message = (await db.pool.query(`select data->>'message' as m from public.notifications where workspace_id = $1 and data->>'kind' = 'budget.exceeded' limit 1`, [ws])).rows[0].m;
    assert.equal(message, '$250.00 spent against $200.00 budgeted for October 2026.');
  });

  test('cash back above, then below again: told again; a new month: the budget can be told again', async () => {
    await db.collection('transactions').doc(id('in')).set({ workspaceId: ws, uid: 'owner-1', date: '2026-10-10', description: 'Sale', status: 'posted', currency: 'USD', totalAmountCents: 50000,
      lines: [{ accountId: id('bank'), amountCents: 50000 }, { accountId: id('office'), amountCents: -50000 }] });
    await check(db, ws, at('2026-10-11'));
    assert.equal((await db.collection('workspaces').doc(ws).get()).data()?.alertsSent.cashLow, false);
    await db.collection('transactions').doc(id('in')).delete();
    await check(db, ws, at('2026-10-12'));
    assert.deepEqual(await kinds(), ['budget.exceeded:2', 'cash.low:4', 'close.reminder:2']);
    await spend('d', '2026-11-02', 30000);
    await check(db, ws, at('2026-11-03'));
    assert.deepEqual(await kinds(), ['budget.exceeded:4', 'cash.low:4', 'close.reminder:2'], 'November over budget; not the 5th yet');
  });
});
