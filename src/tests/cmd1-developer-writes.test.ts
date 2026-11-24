import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Firestore } from '../server/db/firestore';
import type { ServerContext } from '../server/http/serverKit';

const url = process.env.LF_TEST_DATABASE_URL;
describe('Developer API compatibility (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_dev_${crypto.randomBytes(4).toString('hex')}`;
  const owner = `${ws}_owner`;
  const keyId = `lf_id_${ws}_test`;
  const seed = crypto.randomBytes(32).toString('hex');
  let db: Firestore;
  let server: Server;
  let base: string;

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { getDb } = await import('../server/db/firestore');
    const { registerDeveloperApiRoutes } = await import('../server/routes/developerApiRoutes');
    const { registerMetricsAuditRoutes } = await import('../server/routes/metricsAuditRoutes');
    const { apiAuthenticate } = await import('../server/auth/apiAuthenticate');
    const { commandRouter } = await import('../server/routes/commandRoutes');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: owner, name: 'Developer test', bypassBilling: true });
    await db.collection('apiKeys').doc(keyId).set({ workspaceId: ws, uid: owner, keyHash: crypto.createHash('sha256').update(seed).digest('hex'), scopes: ['write:projects', 'write:ledger', 'write:transactions', 'read:transactions'] });
    const app = express();
    app.use(express.json());
    registerDeveloperApiRoutes(app, {} as ServerContext);
    registerMetricsAuditRoutes(app, {} as ServerContext);
    app.use('/api/v1/commands', apiAuthenticate, commandRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['projects', 'chartAccounts', 'apiKeys', 'idempotencyKeys', 'auditLogs', 'deepAuditJobs', 'billingLedgerTraces', 'workspaceShards', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  const post = async (path: string, input: unknown, key = 'legacy-ignored') => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': `${keyId}.${seed}`, 'idempotency-key': key },
      body: JSON.stringify(input),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  const count = async (collection: string) => (await db.collection(collection).where('workspaceId', '==', ws).get()).size;
  const chargedCredits = async () => {
    const shards = (await db.collection('workspaceShards').where('workspaceId', '==', ws).where('metric', '==', 'computeCreditBalance').get()).docs;
    return -shards.reduce((sum, d) => sum + Number(d.data().value), 0);
  };
  async function waitForCharge(expected: number) {
    // Join the background work before deleting its rows; allow for slower CI workers.
    const deadline = Date.now() + 20_000;
    let credits = await chargedCredits();
    while (credits < expected && Date.now() < deadline) {
      await delay(100);
      credits = await chargedCredits();
    }
    assert.equal(credits, expected);
  }

  test('projects accept scoped-key fallback, refuse unnamed projects, and replay a retry with the same key (AUP-26)', async () => {
    const path = '/api/v1/projects';
    assert.deepEqual(await post(path, {}), { status: 400, body: { status: 'error', message: "Missing required fields: 'name'" } });
    const input = { name: 'Fit-out', budgetLimitCents: '12300' };
    const first = await post(path, input);
    const { id, createdAt } = first.body.project as Record<string, unknown>;
    assert.match(String(id), /^proj_[a-f0-9]{32}$/);
    assert.deepEqual(first, { status: 201, body: { status: 'success', message: 'Project resource created successfully.', project: {
      id, workspaceId: ws, name: 'Fit-out', code: '', description: '', budgetLimitCents: 12300, managerEmail: '', status: 'active', createdAt,
    } } });
    const retried = await post(path, input);
    assert.equal(retried.status, 201);
    assert.equal((retried.body.project as { id: string }).id, id, 'the same key replays the first project');
    assert.equal(await count('projects'), 1);
    const again = await post(path, input, 'second-project');
    assert.equal(again.status, 201);
    assert.notEqual((again.body.project as { id: string }).id, id);
    const audits = (await db.collection('auditLogs').where('workspaceId', '==', ws).where('action', '==', 'PROJECT_CREATED').get()).docs;
    assert.equal(audits.length, 2);
    assert.deepEqual(audits[0].data().details, { description: 'Created project "Fit-out"', code: '', budgetLimitCents: 12300 });
  });

  test('chart POST preserves its slim row shape, schema refusal, and duplicate-ID refusal on retry', async () => {
    const path = '/api/v1/ledger';
    const invalid = await post(path, { name: '', type: 'asset' });
    assert.equal(invalid.status, 400);
    assert.match(String(invalid.body.message), /^Validation Error: name: /);
    const input = { id: `${ws}_cash`, name: 'Cash', type: 'asset', balanceCents: 500, currency: 'USD' };
    const first = await post(path, input);
    const { createdAt } = first.body.account as Record<string, unknown>;
    assert.deepEqual(first, { status: 201, body: { status: 'success', message: 'Chart of Accounts entry created.', account: {
      id: input.id, workspaceId: ws, name: 'Cash', type: 'asset', code: '', parentId: null, isActive: true, tags: [], createdAt,
    } } });
    assert.deepEqual(await post(path, input), { status: 409, body: { status: 'error', message: 'Chart account ID already exists' } });
    const audits = (await db.collection('auditLogs').where('workspaceId', '==', ws).where('action', '==', 'ACCOUNT_CREATED').get()).docs;
    assert.equal(audits.length, 1);
    assert.equal(audits[0].data().entityId, input.id);
  });

  test('the old developer budget and workspace gates still refuse a request', async () => {
    const wsRef = db.collection('workspaces').doc(ws);
    await wsRef.update({ bypassBilling: false, apiQuotaMonthlyLimitCents: 50, apiQuotaTotalCentsUsed: 50 });
    try {
      const refused = await post('/api/v1/projects', { name: 'Must not be saved' });
      assert.equal(refused.status, 500); // original developer API quota status
      assert.match(String(refused.body.message), /^QUOTA_EXCEEDED:/);
      const foreign = await post('/api/v1/projects', { name: 'Foreign', workspaceId: `${ws}_foreign` });
      // #914: a key used on another workspace is refused (403), not a server fault, and the guard wording stays in the log
      assert.equal(foreign.status, 403);
      assert.equal(foreign.body.message, 'Forbidden');
      const named = await post('/api/v1/commands/project.create', { input: { name: 'Must not be saved' } });
      assert.equal(named.status, 429);
      assert.equal(named.body.code, 'QUOTA_EXCEEDED');
      assert.equal((await db.collection('projects').where('workspaceId', '==', ws).where('name', '==', 'Must not be saved').get()).size, 0);
    } finally { await wsRef.update({ bypassBilling: true }); }
  });

  test('bank mapping returns suggestions without importing anything or changing the chart', async () => {
    const count = await db.collection('chartAccounts').where('workspaceId', '==', ws).get();
    const result = await post('/api/v1/bank/map', { workspaceId: ws, transactions: [{ id: 'sample', description: 'Cash', amountCents: 400 }] });
    assert.deepEqual(result, { status: 200, body: { status: 'success', workspaceId: ws, mappedTransactions: [{
      id: 'sample', description: 'Cash', amountCents: 400, suggestedAccountId: `${ws}_cash`, suggestedAccountName: 'Cash', confidence: 0.85,
    }] } });
    assert.equal((await db.collection('bankLines').where('workspaceId', '==', ws).get()).size, 0);
    assert.equal((await db.collection('transactions').where('workspaceId', '==', ws).get()).size, 0);
    assert.equal((await db.collection('chartAccounts').where('workspaceId', '==', ws).get()).size, count.size);
  });

  test('deep audit returns 202, rejects a different workspace, and accepts another job on legacy retry', async () => {
    const path = '/api/v1/audit/deep';
    assert.equal((await post(path, { workspaceId: `${ws}_other` })).status, 403); // #914: a refusal, not a 500
    const jobs: string[] = [];
    for (const result of await Promise.all([post(path, { scenario: 'preview-a' }), post(path, { scenario: 'preview-a' })])) {
      const job = String(result.body.job_id);
      assert.equal(result.status, 202, JSON.stringify(result.body));
      assert.match(job, /^job_[a-f0-9]{32}$/);
      assert.deepEqual(result.body, {
        status: 'processing', message: 'Strategic simulation launched asynchronously. Please poll job endpoint for results.',
        job_id: job, check_status_url: `/api/v1/audit/jobs/${job}`,
      });
      jobs.push(job);
    }
    assert.equal(new Set(jobs).size, 2);
    await waitForCharge(2400);
    for (const job of jobs) assert.equal((await db.collection('deepAuditJobs').doc(job).get()).data()?.status, 'completed');
    assert.equal((await db.collection('billingLedgerTraces').where('workspaceId', '==', ws).where('algorithmName', '==', 'STRATEGIC_DEEP_AUDIT_JOB').get()).size, 2);
  });

  test('a read-only audit preview and concurrent keyed retries leave exactly one job, trace, and charge', async () => {
    const path = '/api/v1/commands/audit.deep';
    const input = { payload: { scenario: 'named' } };
    const envelope = { input }; // a real API key supplies the workspace at the HTTP boundary
    const key = 'named-audit-retry';
    const jobsBefore = await count('deepAuditJobs');
    const auditsBefore = await count('auditLogs');
    const tracesBefore = await count('billingLedgerTraces');
    const creditsBefore = await chargedCredits();
    const preview = await post(`${path}/preview`, envelope, key);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.match(JSON.stringify(preview.body.preview), /1,200 compute credits/);
    assert.equal(await count('deepAuditJobs'), jobsBefore);
    assert.equal(await count('auditLogs'), auditsBefore);
    assert.equal(await count('billingLedgerTraces'), tracesBefore);
    assert.equal(await chargedCredits(), creditsBefore);
    assert.equal((await db.collection('idempotencyKeys').doc(`${ws}:audit.deep:${key}`).get()).exists, false);

    const foreign = await post(path, { ...envelope, workspaceId: `${ws}_other` }, key);
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.code, 'WORKSPACE_SCOPE');
    const results = await Promise.all([post(path, envelope, key), post(path, envelope, key)]);
    assert.deepEqual(results.map(r => r.status), [200, 200], JSON.stringify(results));
    assert.deepEqual(results.map(r => Number(r.body.replayed)).sort(), [0, 1]);
    assert.deepEqual(results[0].body.data, results[1].body.data);
    const { jobId } = results[0].body.data as { jobId: string };
    const conflict = await post(path, { input: { payload: { scenario: 'different' } } }, key);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'CONFLICT');
    await waitForCharge(creditsBefore + 1200);

    const poll = await fetch(`${base}/api/v1/audit/jobs/${jobId}`, { headers: { 'x-api-key': `${keyId}.${seed}` } });
    assert.equal(poll.status, 200);
    assert.equal((await poll.json()).jobStatus, 'completed');
    assert.equal(await count('deepAuditJobs'), jobsBefore + 1);
    assert.equal(await count('billingLedgerTraces'), tracesBefore + 1);
    const audit = await db.collection('auditLogs').where('workspaceId', '==', ws).where('entityId', '==', jobId).get();
    assert.deepEqual(audit.docs.map(d => d.data().action), ['DEEP_AUDIT_QUEUED']);
  });

  test('a read-only integration key cannot queue or preview a deep audit', async () => {
    const apiKey = db.collection('apiKeys').doc(keyId);
    const original = (await apiKey.get()).data()!.scopes;
    const jobsBefore = await count('deepAuditJobs');
    await apiKey.update({ scopes: ['read:transactions'] });
    try {
      for (const suffix of ['', '/preview']) {
        const refused = await post(`/api/v1/commands/audit.deep${suffix}`, { input: {} }, 'readonly-audit');
        assert.equal(refused.status, 403);
        assert.match(String(refused.body.message), /requires 'write:transactions' scope/);
      }
      assert.equal(await count('deepAuditJobs'), jobsBefore);
    } finally { await apiKey.update({ scopes: original }); }
  });
});
