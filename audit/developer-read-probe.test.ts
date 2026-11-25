/** Local, disposable DB checks of developer read endpoints. AUP-28 is fixed: the summary now matches /metrics. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('developer read endpoints in a local app', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), stranger = randomUUID(), viewer = randomUUID(), ws = `ws_read_${randomBytes(5).toString('hex')}`;
  const secret = randomBytes(32).toString('hex'), keyId = `lf_id_${ws}_test`;
  let server: Server | undefined, base = '', ownerToken = '', outsiderToken = '', viewerToken = '';
  let env: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../src/server/db/firestore'))['getDb']>>;
  const read = (path: string, credential: 'owner' | 'outsider' | 'key' | 'none' = 'owner') => callApi(base, 'GET', path, credential === 'key'
    ? { headers: { 'x-api-key': `${keyId}.${secret}` } }
    : { token: credential === 'owner' ? ownerToken : credential === 'outsider' ? outsiderToken : undefined });
  before(async () => {
    env = useLiveApiEnv('developer-read-probe', { CURRENCY_API_KEY: '', TAX_API_KEY: '', GEMINI_API_KEY: '' });
    const [{ getDb }, { createApp }] = await Promise.all([import('../src/server/db/firestore'), import('../server')]);
    db = getDb();
    for (const uid of [owner, stranger, viewer]) await db.pool.query("insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)", [uid, `${uid}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ id: ws, name: 'Developer reads', uid: owner, members: [owner, viewer], roles: { [owner]: 'owner', [viewer]: 'viewer' }, currency: 'USD', bypassBilling: true });
    await db.collection('apiKeys').doc(keyId).set({ workspaceId: ws, uid: owner, keyHash: createHash('sha256').update(secret).digest('hex'), scopes: ['read:transactions', 'read:ledger', 'read:projects', 'read:workspaces'] });
    for (const [id, type] of [['cash', 'asset'], ['sales', 'revenue']]) await db.collection('chartAccounts').doc(`${ws}_${id}`).set({ workspaceId: ws, name: id, type, code: id });
    await db.collection('projects').doc(`${ws}_project`).set({ workspaceId: ws, name: 'Sample project' });
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
    ownerToken = await signTestJwt({ uid: owner, email: `${owner}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } });
    outsiderToken = await signTestJwt({ uid: stranger, email: `${stranger}@example.test`, userMetadata: { email_verified: true } });
    viewerToken = await signTestJwt({ uid: viewer, email: `${viewer}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } });
    ({ server, base } = await listenOnRandomPort(await createApp()));
    // Local non-production boot fills dummy provider keys; disable them after boot so these tests never call an external service.
    process.env.CURRENCY_API_KEY = '';
    process.env.TAX_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      for (const table of ['transactions', 'chartAccounts', 'projects', 'apiKeys', 'auditLogs', 'idempotencyKeys']) await db.pool.query(`delete from public."${table}" where workspace_id = any($1::text[])`, [[ws, `person:${owner}`, `person:${stranger}`]]);
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = any($1::text[])', [[owner, stranger, viewer]]);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [[owner, stranger, viewer]]);
    }
    restoreEnv(env);
  });
  for (const [path, key, count] of [['ledger', 'accountsCount', 2], ['projects', 'projectsCount', 1]] as const) {
    it(`${path}: returns the owned workspace, rejects outsider and unauthenticated requests`, async () => {
      for (const auth of ['owner', 'key'] as const) {
        const result = await read(`/api/v1/${path}?workspaceId=${ws}`, auth);
        assert.equal(result.status, 200, JSON.stringify(result.json));
        assert.equal((result.json as Record<string, unknown>)[key], count);
      }
      assert.equal((await read(`/api/v1/${path}?workspaceId=${ws}`, 'outsider')).status, 403);
      assert.equal((await read(`/api/v1/${path}?workspaceId=${ws}`, 'none')).status, 401);
    });
  }
  it('diagnostics reads posted balanced entries and excludes an outsider', async () => {
    const result = await read(`/api/v1/ledger/diagnostics?workspaceId=${ws}`, 'key');
    assert.equal(result.status, 200);
    assert.equal((result.json as { summary: { globalTrialImbalanceCents: number } }).summary.globalTrialImbalanceCents, 0);
    assert.equal((await read(`/api/v1/ledger/diagnostics?workspaceId=${ws}`, 'outsider')).status, 403);
  });
  it('AUP-28 (fixed): summary and metrics agree on posted, converted figures', async () => {
    const metrics = await read(`/api/v1/metrics?workspaceId=${ws}`, 'key');
    const summary = await read(`/api/v1/metrics/summary?workspaceId=${ws}`, 'key');
    assert.equal(metrics.status, 200); assert.equal(summary.status, 200);
    // Posted: 100 USD + 100 EUR at 2 USD/EUR = 300 USD. Summary uses 100 + 200 draft + 300 forecast + 100 EUR = 700.
    assert.equal((metrics.json as { coreMetrics: { grossRevenueCents: number } }).coreMetrics.grossRevenueCents, 30000);
    assert.equal((summary.json as { metrics: { grossRevenueCents: number } }).metrics.grossRevenueCents, 30000);
    assert.equal((await read(`/api/v1/metrics/summary?workspaceId=${ws}`, 'outsider')).status, 403);
  });
  it('command metadata is available to a signed-in person, with unknown names refused', async () => {
    const list = await read('/api/v1/commands');
    assert.equal(list.status, 200); assert.ok((list.json as { commands: Array<{ name: string }> }).commands.some(c => c.name === 'customer.create'));
    const one = await read('/api/v1/commands/customer.create');
    assert.equal(one.status, 200); assert.equal((one.json as { command: { name: string } }).command.name, 'customer.create');
    assert.equal((await read('/api/v1/commands/no-such-command')).status, 404);
    assert.equal((await read('/api/v1/commands', 'none')).status, 401);
  });
  it('workspace status, role and invite reads are scoped to a member', async () => {
    const status = await read(`/api/v1/status?workspaceId=${ws}`);
    assert.equal(status.status, 200); assert.equal((status.json as { workspaceId: string }).workspaceId, ws);
    const roles = await read(`/api/v1/workspaces/${ws}/roles`);
    assert.equal(roles.status, 200); assert.equal((roles.json as { ownerUid: string }).ownerUid, owner);
    const invites = await read(`/api/v1/workspaces/${ws}/invites`);
    assert.equal(invites.status, 200); assert.deepEqual((invites.json as { invites: unknown[] }).invites, []);
    for (const path of [`/api/v1/status?workspaceId=${ws}`, `/api/v1/workspaces/${ws}/roles`, `/api/v1/workspaces/${ws}/invites`]) {
      assert.equal((await read(path, 'outsider')).status, 403, path);
      assert.equal((await read(path, 'none')).status, 401, path);
    }
  });
  it('owned workspace list and personal export contain this person and not the outsider', async () => {
    const list = await read('/api/v1/workspaces');
    assert.equal(list.status, 200); assert.ok((list.json as { workspaces: Array<{ id: string }> }).workspaces.some(w => w.id === ws));
    const outsider = await read('/api/v1/workspaces', 'outsider');
    assert.equal(outsider.status, 200); assert.ok(!(outsider.json as { workspaces: Array<{ id: string }> }).workspaces.some(w => w.id === ws));
    assert.equal((await read('/api/v1/workspaces', 'none')).status, 401);
    const mine = await read('/api/v1/account/my-data');
    assert.equal(mine.status, 200); assert.equal((mine.json as { person: { uid: string } }).person.uid, owner);
    assert.ok((mine.json as { workspaces: Array<{ id: string }> }).workspaces.some(w => w.id === ws));
    const theirs = await read('/api/v1/account/my-data', 'outsider');
    assert.equal(theirs.status, 200); assert.ok(!(theirs.json as { workspaces: Array<{ id: string }> }).workspaces.some(w => w.id === ws));
    assert.equal((await read('/api/v1/account/my-data', 'none')).status, 401);
  });
  it('public registration status hides user count unless signed in', async () => {
    const anonymous = await read('/api/v1/public/registration-status', 'none');
    const signed = await read('/api/v1/public/registration-status');
    assert.equal(anonymous.status, 200); assert.equal(signed.status, 200);
    assert.equal(Object.hasOwn(anonymous.json as object, 'totalUsers'), false);
    assert.equal(typeof (signed.json as { totalUsers: unknown }).totalUsers, 'number');
  });
  it('currency and tax proxies refuse unsupported paths and report unconfigured providers', async () => {
    for (const [prefix, valid] of [['currency', 'live'], ['tax', 'tax_rates']]) {
      assert.equal((await read(`/api/v1/${prefix}/invalid`)).status, 400);
      assert.equal((await read(`/api/v1/${prefix}/${valid}`)).status, 503);
      assert.equal((await read(`/api/v1/${prefix}/${valid}`, 'none')).status, 401);
    }
  });
  it('FX routes return injected rates and refuse malformed codes without external network', async t => {
    const { FxService } = await import('../src/server/services/FxService');
    t.mock.method(FxService, 'transport', async () => ({ rates: { EUR: 0.8, USD: 1 } }));
    const pair = await read('/api/v1/fx/rate?from=USD&to=EUR');
    assert.equal(pair.status, 200); assert.equal((pair.json as { rate: number }).rate, 0.8);
    const rates = await read('/api/v1/fx/rates/USD');
    assert.equal(rates.status, 200); assert.equal((rates.json as { rates: { EUR: number } }).rates.EUR, 0.8);
    assert.equal((await read('/api/v1/fx/rate?from=invalid&to=EUR')).status, 503);
    assert.equal((await read('/api/v1/fx/rates/invalid')).status, 503);
    assert.equal((await read('/api/v1/fx/rates/USD', 'none')).status, 401);
  });
  it('lease rent roll and trust checks accept an owner and refuse an outsider', async () => {
    const post = (path: string, body: object, who = ownerToken) => callApi(base, 'POST', `/api/v1/lease/${path}`, { token: who, body: { workspaceId: ws, ...body } });
    const rent = { asOfDate: '2026-01-01', units: [{ unitId: 'unit', propertyId: 'p', propertyName: 'Building', unitLabel: 'One', tenantName: 'Tenant', tenantId: 'tenant', monthlyRentCents: 100000, securityDepositHeldCents: 25000 }] };
    const trust = { asOfDate: '2026-01-01', bankStatementTrustCents: 25000, trustCashBookBalanceCents: 25000, trustLiabilityAccountBalanceCents: 25000, tenantSubledgers: [{ unitId: 'unit', tenantName: 'Tenant', heldCents: 25000 }] };
    assert.equal((await post('rent-roll', rent)).status, 200);
    assert.equal((await post('trust-reconciliation', trust)).status, 200);
    assert.equal((await post('rent-roll', rent, outsiderToken)).status, 403);
    assert.equal((await post('trust-reconciliation', trust, outsiderToken)).status, 403);
    assert.equal((await post('rent-roll', { units: [] })).status, 400);
  });
  it('activity, request logs, consolidation close and audit chain are workspace scoped', async () => {
    for (const path of [`/api/activity-feed?workspaceId=${ws}`, `/api/v1/logs?workspaceId=${ws}`, `/api/v1/consolidation/close-status?workspaceId=${ws}&asOfDate=2026-05-01`, `/api/v1/workspaces/${ws}/audit-chain/verify`]) {
      assert.equal((await read(path)).status, 200, path);
      assert.equal((await read(path, 'outsider')).status, 403, path);
      assert.equal((await read(path, 'none')).status, 401, path);
    }
  });
  it('matching and labeling handle input and refuse workspace outsiders', async () => {
    const post = (path: string, body: object, token = ownerToken) => callApi(base, 'POST', path, { token, body });
    const match = { workspaceId: ws, descriptions: ['Sample bank charge'] };
    const result = await post('/api/v1/ledger/match', match);
    assert.equal(result.status, 200); assert.equal((result.json as { matches: unknown[] }).matches.length, 1);
    assert.equal((await post('/api/v1/ledger/match', match, outsiderToken)).status, 403);
    assert.equal((await post('/api/v1/ledger/match', { workspaceId: ws, descriptions: 'invalid' })).status, 400);
    const label = { workspaceId: ws, transactions: [{ id: 'one', description: 'Software subscription', amountCents: 100 }] };
    const labeled = await post('/api/v1/label-transactions', label);
    assert.equal(labeled.status, 200, JSON.stringify(labeled));
    assert.equal((await post('/api/v1/label-transactions', label, outsiderToken)).status, 403);
  });
  it('cron refuses requests without its secret; public unknown invite lookup returns 404', async () => {
    assert.equal((await read('/api/cron/daily', 'none')).status, 401);
    assert.equal((await read('/api/v1/invites/00000000-0000-4000-8000-000000000000', 'none')).status, 404);
  });
  it('legacy AI mount requires authentication and an explicitly configured provider', async () => {
    const post = (token?: string) => callApi(base, 'POST', '/api/ai/process', { token, body: { task: 'chat', payload: { workspaceId: ws } } });
    assert.equal((await post()).status, 401);
    assert.equal((await post(ownerToken)).status, 503);
  });
  it('legacy and versioned workspace export mounts serve the same CSV to the owner and refuse outsiders', async () => {
    const get = async (path: string, token: string) => {
      const res = await fetch(`${base}${path}?format=csv`, { headers: { Authorization: `Bearer ${token}` } });
      return { status: res.status, text: await res.text() };
    };
    const a = await get(`/api/workspaces/${ws}/export`, ownerToken), b = await get(`/api/v1/workspaces/${ws}/export`, ownerToken);
    assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(a.text, b.text);
    assert.equal((await get(`/api/workspaces/${ws}/export`, outsiderToken)).status, 403);
  });
  it('payment volume returns an owned workspace summary and refuses an outsider', async () => {
    const path = `/api/v1/payments/volume-summary?workspaceId=${ws}&month=2026-04`;
    const result = await read(path);
    assert.equal(result.status, 200); assert.ok((result.json as { summary?: object }).summary);
    assert.equal((await read(path, 'outsider')).status, 403);
  });
  it('workspace saved-list routes accept owner changes and refuse an outsider', async () => {
    for (const [method, path, body] of [
      ['PUT', 'allocation-rules', { rules: [] }],
      ['POST', 'payment-types', { op: 'add', name: 'Local test', method: 'card' }],
      ['POST', 'customer-groups', { op: 'add', name: 'Local group' }],
    ] as const) {
      const call = (token: string) => callApi(base, method, `/api/v1/workspaces/${ws}/${path}`, { token, body });
      const result = await call(ownerToken);
      assert.equal(result.status, 200, `${path}: ${JSON.stringify(result)}`);
      assert.equal((await call(outsiderToken)).status, 403, path);
    }
  });
  it('personal AI key set, status and remove operate only on the signed-in user', async () => {
    const path = '/api/v1/user/ai-key';
    const before = await read('/api/v1/user/ai-key-status');
    assert.equal((before.json as { hasCustomApiKey: boolean }).hasCustomApiKey, false);
    const saved = await callApi(base, 'POST', path, { token: ownerToken, body: { apiKey: 'synthetic-test-key-abcd' } });
    assert.equal(saved.status, 200, JSON.stringify(saved));
    const status = await read('/api/v1/user/ai-key-status');
    assert.equal((status.json as { hasCustomApiKey: boolean; apiKeySuffix: string }).hasCustomApiKey, true);
    assert.equal((status.json as { apiKeySuffix: string }).apiKeySuffix, 'abcd');
    const otherStatus = await read('/api/v1/user/ai-key-status', 'outsider');
    assert.equal((otherStatus.json as { hasCustomApiKey: boolean }).hasCustomApiKey, false);
    const deleted = await callApi(base, 'DELETE', path, { token: ownerToken });
    assert.equal(deleted.status, 200);
    assert.equal(((await read('/api/v1/user/ai-key-status')).json as { hasCustomApiKey: boolean }).hasCustomApiKey, false);
  });
  it('reconciliation status and matching suggestions use the workspace scope', async () => {
    const statusPath = `/api/v1/transactions/reconciliation/status?workspaceId=${ws}`;
    const status = await read(statusPath);
    assert.equal(status.status, 200); assert.equal((status.json as { unclearedCount: number }).unclearedCount, 2);
    assert.equal((await read(statusPath, 'outsider')).status, 403);
    const body = { workspaceId: ws, externalBankLines: [] };
    const match = (token: string) => callApi(base, 'POST', '/api/v1/transactions/reconciliation/match', { token, body });
    assert.equal((await match(ownerToken)).status, 200); assert.equal((await match(outsiderToken)).status, 403);
  });
  it('viewer cannot perform valid owner-only role, invite, reset and deletion actions', async () => {
    const before = (await db.collection('workspaces').doc(ws).get()).data();
    const transactionCount = (await db.collection('transactions').where('workspaceId', '==', ws).get()).size;
    for (const [method, path, body] of [
      ['POST', `/api/v1/workspaces/${ws}/roles`, { targetUid: viewer, role: 'owner' }],
      ['PATCH', `/api/v1/workspaces/${ws}/roles/${viewer}`, { role: 'owner' }],
      ['POST', `/api/v1/workspaces/${ws}/invites`, { email: 'invite@example.test', role: 'viewer' }],
      ['POST', '/api/v1/transactions/reset', { workspaceId: ws, confirmReset: true }],
      ['DELETE', `/api/v1/workspaces/${ws}`, {}],
    ] as const) {
      const response = await callApi(base, method, path, { token: viewerToken, body });
      assert.equal(response.status, 403, `${method} ${path}: ${JSON.stringify(response.json)}`);
    }
    const after = (await db.collection('workspaces').doc(ws).get()).data();
    assert.deepEqual(after?.roles, before?.roles);
    assert.equal(after?.deletedAt, before?.deletedAt);
    assert.equal((await db.collection('transactions').where('workspaceId', '==', ws).get()).size, transactionCount);
    assert.equal((await db.collection('invites').where('workspaceId', '==', ws).get()).size, 0);
  });
  it('dangerous and admin actions refuse selected unauthorized or incomplete requests', async () => {
    const cases = [
      ['POST', '/api/v1/admin/integrity/orphan-scan', { workspaceId: ws }],
      ['PUT', `/api/v1/admin/users/${owner}`, {}],
      ['POST', '/api/v1/system/recurring/process', {}],
      ['POST', '/api/v1/system/telemetry/errors/digest', {}],
      ['POST', '/api/v1/billing/portal', { workspaceId: ws }],
      ['POST', '/api/v1/payments/payout-run', { workspaceId: ws }],
      ['POST', '/api/v1/transactions/migrate-dimensions', { workspaceId: ws, dimensions: [] }],
      ['POST', '/api/v1/transactions/revaluation/undo', { workspaceId: ws, date: '2026-04-30' }],
      ['DELETE', `/api/v1/workspaces/${ws}`, {}],
      ['POST', `/api/v1/workspaces/${ws}/assets/missing/in-service`, {}],
      ['DELETE', `/api/v1/workspaces/${ws}/assets/missing/in-service`, {}],
      ['POST', `/api/v1/workspaces/${ws}/roles`, { targetUid: stranger, role: 'owner' }],
    ] as const;
    for (const [method, path, body] of cases) {
      const result = await callApi(base, method, path, { token: outsiderToken, body });
      assert.equal(result.status, 403, `${method} ${path}: ${JSON.stringify(result)}`);
    }
    assert.equal((await callApi(base, 'POST', '/api/v1/transactions/reset', { token: ownerToken, body: { workspaceId: ws } })).status, 400);
    const before = (await db.collection('transactions').where('workspaceId', '==', ws).get()).size;
    assert.equal((await callApi(base, 'POST', '/api/v1/transactions/reset', { token: ownerToken, body: { workspaceId: ws, confirmReset: true } })).status, 409);
    assert.equal((await db.collection('transactions').where('workspaceId', '==', ws).get()).size, before, 'a real workspace must not be emptied');
  });
  it('AUP-29 (fixed): zero expenses give a zero monthly burn, not an invented one', async () => {
    const result = await read(`/api/v1/metrics?workspaceId=${ws}`);
    assert.equal(result.status, 200);
    const body = result.json as { coreMetrics: { operatingExpenseCents: number }; shiftingMetrics: { metrics: { monthlyBurnCents: number } } };
    assert.equal(body.coreMetrics.operatingExpenseCents, 0);
    assert.equal(body.shiftingMetrics.metrics.monthlyBurnCents, 0);
  });
});
