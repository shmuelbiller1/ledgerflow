import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { RequestUser } from '../server/auth/requestUser';

const url = process.env.LF_TEST_DATABASE_URL;

test('record-compute accepts a viewer, clamps inputs, replays a retried legacy request once, and refuses outsiders', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, async t => {
  process.env.DATABASE_URL = url;
  const { getDb } = await import('../server/db/firestore');
  const { billingRouter } = await import('../server/routes/billingRoutes');
  const { commandRouter } = await import('../server/routes/commandRoutes');
  const express = (await import('express')).default;
  const db = getDb();
  const workspaceId = `compute-${randomUUID()}`;
  const ref = db.collection('workspaces').doc(workspaceId);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.header('x-test-uid') || 'viewer';
    const user: RequestUser = { uid, email: `${uid}@example.test` };
    Object.assign(req, { user });
    next();
  });
  app.use('/billing', billingRouter);
  app.use('/commands', commandRouter);
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const table of ['billingLedgerTraces', 'workspaceShards', 'auditLogs', 'idempotencyKeys']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1`, [workspaceId]);
    }
    await ref.delete();
    await db.terminate();
  });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await ref.create({ uid: 'owner', members: ['viewer'], roles: { viewer: 'viewer' }, concurrentUserLimit: 0,
    status: 'pending_deletion', apiQuotaTotalCentsUsed: 2, totalQueriesThisMonth: 4, computeHardnessScore: 5, computeCreditBalance: 20 });
  const input = { algorithmName: 'MODEL_TEST', complexityFormat: 'O(n)', weightScore: '-13.9', executionTimeMs: -90_000 };
  const post = async (body: unknown, uid = 'viewer', path = '/billing/record-compute', key = 'legacy-repeat') => {
    const response = await fetch(`${origin}${path}`, { method: 'POST', headers: {
      'content-type': 'application/json', 'x-test-uid': uid, 'idempotency-key': key,
    }, body: JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  const traces = () => db.collection('billingLedgerTraces').where('workspaceId', '==', workspaceId).get();
  assert.deepEqual(await post({ workspaceId }), { status: 400, json: { status: 'error', message: 'Missing required query parameters: workspaceId and algorithmName' } });
  assert.deepEqual(await post({ workspaceId, ...input }, 'outsider'), { status: 403, json: { status: 'error', message: 'FORBIDDEN: User does not belong to this workspace.' } });
  assert.deepEqual(await post({ workspaceId: `${workspaceId}-missing`, ...input }), { status: 500, json: { status: 'error', message: 'Workspace not found.' } });
  assert.equal((await traces()).size, 0);
  const first = await post({ workspaceId, ...input });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.status, 'success');
  assert.deepEqual(first.json.updatedMetrics, { apiQuotaTotalCentsUsed: 3, totalQueriesThisMonth: 5, computeHardnessScore: 18, computeCreditBalance: 7 });
  assert.deepEqual(first.json.traceRecord, {
    id: first.json.traceRecord.id, workspaceId, uid: 'viewer', userEmail: 'viewer@example.test',
    algorithmName: 'MODEL_TEST', complexityFormat: 'O(n)', weightScore: 13, executionTimeMs: 60_000,
    timestamp: first.json.traceRecord.timestamp, hash: first.json.traceRecord.hash,
  });
  // The old route overwrote its temporary `trace-...` value with the database auto ID.
  assert.match(first.json.traceRecord.id, /^[A-Za-z0-9]{20}$/);
  assert.equal((await db.collection('billingLedgerTraces').doc(first.json.traceRecord.id).get()).data()?.id, first.json.traceRecord.id);
  assert.match(first.json.traceRecord.hash, /^[0-9a-f]{64}$/);
  // AUP-32: the same request retried with the same key is metered once and answers the first result
  const retried = await post({ workspaceId, ...input });
  assert.equal(retried.status, 200, JSON.stringify(retried.json));
  assert.equal(retried.json.traceRecord.id, first.json.traceRecord.id);
  assert.equal((await traces()).size, 1);
  assert.equal((await ref.get()).data()?.apiQuotaTotalCentsUsed, 3);
  const again = await post({ workspaceId, ...input }, 'viewer', '/billing/record-compute', 'legacy-second');
  assert.equal(again.status, 200);
  assert.notEqual(again.json.traceRecord.id, first.json.traceRecord.id);
  assert.deepEqual(again.json.updatedMetrics, { apiQuotaTotalCentsUsed: 4, totalQueriesThisMonth: 6, computeHardnessScore: 31, computeCreditBalance: 0 });
  assert.equal((await traces()).size, 2);
  assert.equal((await ref.get()).data()?.apiQuotaTotalCentsUsed, 4);

  const named = '/commands/billing.recordcompute';
  const preview = await post({ workspaceId, input }, 'viewer', `${named}/preview`);
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.match(preview.json.preview.title, /MODEL_TEST/);
  assert.equal((await traces()).size, 2);
  const run = () => post({ workspaceId, input }, 'viewer', named, 'named-run');
  const parallel = await Promise.all([run(), run()]);
  assert.deepEqual(parallel.map(reply => reply.status), [200, 200], JSON.stringify(parallel));
  assert.deepEqual(parallel.map(reply => reply.json.replayed).toSorted(), [false, true]);
  assert.deepEqual(parallel[0].json.data, parallel[1].json.data);
  assert.deepEqual(parallel[0].json.data.updatedMetrics, { apiQuotaTotalCentsUsed: 5, totalQueriesThisMonth: 7, computeHardnessScore: 44, computeCreditBalance: 0 });
  assert.equal((await traces()).size, 3);
  assert.equal((await db.collection('auditLogs').where('workspaceId', '==', workspaceId).where('action', '==', 'COMPUTE_RECORDED').get()).size, 3);
  assert.equal((await post({ workspaceId, input: { ...input, weightScore: 50 } }, 'viewer', named, 'named-run')).status, 409);
  assert.equal((await post({ workspaceId, input }, 'outsider', named)).json.code, 'NOT_A_MEMBER');
  assert.equal((await traces()).size, 3);

  // Old clients had only a presence check on the name and JavaScript numeric coercion.
  // The named endpoint advertises and enforces its stricter schema.
  const legacyFields = { algorithmName: 17, complexityFormat: null, weightScore: true, executionTimeMs: [42] };
  const namedRefusal = await post({ workspaceId, input: legacyFields }, 'viewer', named);
  assert.equal(namedRefusal.status, 400);
  assert.equal(namedRefusal.json.code, 'INVALID_INPUT');
  const legacy = await post({ workspaceId, ...legacyFields }, 'viewer', '/billing/record-compute', 'legacy-fields');
  assert.equal(legacy.status, 200, JSON.stringify(legacy.json));
  assert.equal(legacy.json.traceRecord.algorithmName, 17);
  assert.equal(legacy.json.traceRecord.complexityFormat, null);
  assert.equal(legacy.json.traceRecord.weightScore, 1);
  assert.equal(legacy.json.traceRecord.executionTimeMs, 42);
});
