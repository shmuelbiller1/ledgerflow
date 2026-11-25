/**
 * AUP-28 / AUP-29: the developer metrics endpoints report posted, book-currency figures and never invent one.
 * Same books as the audit probe: posted 10,000; draft 20,000; forecast 30,000; void 40,000; EUR 10,000 at 2.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, useLiveApiEnv } from './helpers/liveApiServer';

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('AUP-28/29: developer metrics', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), ws = `ws_aup28_${randomBytes(5).toString('hex')}`;
  const secret = randomBytes(32).toString('hex'), keyId = `lf_id_${ws}_test`;
  let server: Server | undefined, base = '', env: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../server/db/firestore'))['getDb']>>;
  const read = (path: string) => callApi(base, 'GET', path, { headers: { 'x-api-key': `${keyId}.${secret}` } });
  before(async () => {
    env = useLiveApiEnv('aup28-metrics', { CURRENCY_API_KEY: '', TAX_API_KEY: '', GEMINI_API_KEY: '' });
    const [{ getDb }, { createApp }] = await Promise.all([import('../server/db/firestore'), import('../../server')]);
    db = getDb();
    await db.pool.query("insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)", [owner, `${owner}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ id: ws, name: 'Metrics', uid: owner, members: [owner], roles: { [owner]: 'owner' }, currency: 'USD', bypassBilling: true });
    await db.collection('apiKeys').doc(keyId).set({ workspaceId: ws, uid: owner, keyHash: createHash('sha256').update(secret).digest('hex'), scopes: ['read:transactions', 'read:ledger'] });
    for (const [id, type] of [['cash', 'asset'], ['sales', 'revenue']]) await db.collection('chartAccounts').doc(`${ws}_${id}`).set({ workspaceId: ws, name: id, type, code: id });
    const rows = [
      ['posted', 'completed', 'actual', 10000, 'USD', 1],
      ['draft', 'draft', 'actual', 20000, 'USD', 1],
      ['forecast', 'completed', 'forecast', 30000, 'USD', 1],
      ['void', 'void', 'actual', 40000, 'USD', 1],
      ['foreign', 'completed', 'actual', 10000, 'EUR', 2],
    ] as const;
    for (const [name, status, type, amount, currency, exchangeRate] of rows) await db.collection('transactions').doc(`${ws}_${name}`).set({
      workspaceId: ws, date: '2026-04-01', status, type, currency, exchangeRate, totalAmountCents: amount,
      lines: [{ accountId: `${ws}_cash`, amountCents: amount }, { accountId: `${ws}_sales`, amountCents: -amount }],
    });
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      for (const table of ['transactions', 'chartAccounts', 'apiKeys', 'auditLogs']) await db.pool.query(`delete from public."${table}" where workspace_id = $1`, [ws]);
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = $1', [owner]);
      await db.pool.query('delete from auth.users where id = $1::uuid', [owner]);
    }
    restoreEnv(env);
  });

  it('AUP-28: the summary agrees with /metrics: posted only, converted to the book currency', async () => {
    const metrics = await read(`/api/v1/metrics?workspaceId=${ws}`);
    const summary = await read(`/api/v1/metrics/summary?workspaceId=${ws}`);
    assert.equal(metrics.status, 200, JSON.stringify(metrics.json)); assert.equal(summary.status, 200, JSON.stringify(summary.json));
    const core = (metrics.json as { coreMetrics: Record<string, number> }).coreMetrics;
    const sum = (summary.json as { metrics: Record<string, number>; transactionVolume: number });
    assert.equal(core.grossRevenueCents, 30000);
    assert.equal(sum.metrics.grossRevenueCents, 30000, 'no draft, forecast or void, and EUR 10,000 at 2 = 20,000');
    assert.equal(sum.metrics.currentAssetsCents, 30000);
    assert.equal(sum.transactionVolume, 2, 'only the posted entries are counted');
  });

  it('AUP-29: with no expenses nothing is invented, and net income is named as such', async () => {
    const metrics = await read(`/api/v1/metrics?workspaceId=${ws}`);
    const body = metrics.json as { coreMetrics: Record<string, number>; shiftingMetrics: { metrics: Record<string, number | null> } };
    assert.equal(body.shiftingMetrics.metrics.monthlyBurnCents, 0, 'not an invented 400,000');
    assert.equal(body.shiftingMetrics.metrics.runwayMonthsRemaining, null, 'no runway without a burn, not 99');
    assert.equal(body.coreMetrics.netIncomeCents, 30000);
    assert.equal(body.coreMetrics.netOperatingCashFlowCents, body.coreMetrics.netIncomeCents, 'the old name says the same number');
  });

  it('AUP-29: other business types give no assumed churn, baseline capital, COGS share or inventory', async () => {
    for (const businessType of ['saas', 'realestate', 'retail']) {
      await db.collection('workspaces').doc(ws).update({ businessType });
      const m = ((await read(`/api/v1/metrics?workspaceId=${ws}`)).json as { shiftingMetrics: { metrics: Record<string, number | null> } }).shiftingMetrics.metrics;
      if (businessType === 'saas') { assert.equal(m.churnPercentage, null); assert.equal(m.ltvCents, null); }
      if (businessType === 'realestate') { assert.equal(m.impliedCapitalInvestedCents, 30000, 'the recorded assets, not a $1,000,000 baseline'); }
      if (businessType === 'retail') {
        assert.equal(m.cogsCents, 0, 'no assumed 40% of expenses'); assert.equal(m.inventoryTurnoverRatio, null); assert.equal(m.inventoryAccountBalanceCents, 0);
        assert.equal(m.grossProfitCents, null, 'no COGS account: gross profit is unknown, not all revenue');
        assert.equal(m.grossMarginPercentage, null, 'no COGS account: no margin, not 100%');
      }
    }
  });

  it('AUP-29: with a cost-of-goods account, gross profit and margin come from it', async () => {
    await db.collection('workspaces').doc(ws).update({ businessType: 'retail' });
    await db.collection('chartAccounts').doc(`${ws}_cogs`).set({ workspaceId: ws, name: 'Cost of goods sold', type: 'expense', code: 'cogs' });
    await db.collection('transactions').doc(`${ws}_cogs1`).set({
      workspaceId: ws, date: '2026-04-02', status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 1, totalAmountCents: 12000,
      lines: [{ accountId: `${ws}_cogs`, amountCents: 12000 }, { accountId: `${ws}_cash`, amountCents: -12000 }],
    });
    try {
      const m = ((await read(`/api/v1/metrics?workspaceId=${ws}`)).json as { shiftingMetrics: { metrics: Record<string, number | null> } }).shiftingMetrics.metrics;
      assert.equal(m.cogsCents, 12000);
      assert.equal(m.grossProfitCents, 18000, '30,000 revenue - 12,000 cost of goods');
      assert.equal(m.grossMarginPercentage, 60);
    } finally {
      await db.collection('transactions').doc(`${ws}_cogs1`).delete();
      await db.collection('chartAccounts').doc(`${ws}_cogs`).delete();
    }
  });
});
