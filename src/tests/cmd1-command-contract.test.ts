import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import { dimensionNodeCommand } from '../server/commands/dimensions';
import { CommandRegistry } from '../server/commands/registry';
import { Firestore } from '../server/db/firestore';
import { CommandRefusal, previewCommand, runRegisteredCommand } from '../server/utils/commandExecutor';
import { fakeRequest, MemoryDb, owner, recordingCommand, runnerDependencies, seedWorkspace, testInput, workspaceId } from './helpers/commandTestUtils';

test('the registered runner stops at each refusal and audits inside the winning transaction', async () => {
  const events: string[] = [];
  class OrderedDb extends MemoryDb {
    override read(path: string) {
      if (path.startsWith('workspaces/')) events.push('workspace');
      if (path.startsWith('idempotencyKeys/')) events.push('retry lookup');
      return super.read(path);
    }
  }
  const db = new OrderedDb();
  seedWorkspace(db, workspaceId, { members: [owner.uid, 'viewer'], roles: { viewer: 'viewer' }, lockDate: '2026-11-15' });
  db.beforeTransaction = () => { events.push('transaction'); };
  const recording = recordingCommand({ runs: 0, audits: 0, previews: 0, afterCommit: 0 });
  const registry = new CommandRegistry();
  registry.register({
    ...recording,
    input: z.preprocess(input => { events.push('input'); return input; }, testInput),
    capacity: 'transactions',
    async handler(ctx, tx, input) {
      events.push('handler');
      const result = await recording.handler(ctx, tx, input);
      ctx.afterCommit(() => {
        assert.equal(db.read('commandRecords/last')?.value, 'ok');
        assert.equal(db.entries('idempotencyKeys').length, 1);
        assert.equal(db.read('auditLogs/test')?.action, 'COMMAND_TEST');
        events.push('after commit');
      });
      return result;
    },
  });
  const command = registry.get('demo.record')!;
  let atLimit = true;
  const deps = runnerDependencies(db);
  deps.checkCapacity = async () => {
    events.push('capacity');
    if (atLimit) throw new CommandRefusal('Test plan is full', 403, 'PLAN_CAPACITY_EXCEEDED');
  };
  deps.auditWriter = async (entry, { tx, db: sameDb } = {}) => {
    events.push('audit');
    assert.ok(tx && sameDb);
    assert.equal(db.read('commandRecords/last'), undefined, 'handler has not committed before the audit');
    tx.set(sameDb.collection('auditLogs').doc('test'), { ...entry });
    return 'test';
  };
  const input = { workspaceId, value: 'ok', date: '2026-12-01' };
  const run = (uid = owner.uid, body: unknown = input, operationId?: string, ws = workspaceId) =>
    runRegisteredCommand(fakeRequest({ uid }, { workspaceId: ws, input: body }, operationId), { definition: command, workspaceId: ws, input: body }, deps);

  const cases = [
    [await run('', false), 'UNAUTHENTICATED', []],
    [await run(owner.uid, false, undefined, 'missing'), 'WORKSPACE_NOT_FOUND', ['workspace']],
    [await run('stranger', false), 'NOT_A_MEMBER', ['workspace']],
    [await run('viewer', false), 'ROLE_REQUIRED', ['workspace']],
    [await run(owner.uid, false), 'INVALID_INPUT', ['workspace', 'input']],
    [await run(owner.uid, { ...input, date: '2026-11-01' }), 'PERIOD_LOCKED', ['workspace', 'input']],
    [await run(), 'PLAN_CAPACITY_EXCEEDED', ['workspace', 'input', 'capacity']],
  ] as const;
  for (const [result, code] of cases) assert.equal(result.ok ? 'SUCCESS' : result.code, code);
  assert.deepEqual(events.splice(0), cases.flatMap(([, , order]) => order));
  assert.equal(db.entries('commandRecords').length, 0);
  assert.equal(db.entries('idempotencyKeys').length, 0);
  assert.equal(db.entries('auditLogs').length, 0);

  atLimit = false;
  const first = await run(owner.uid, input, 'ordered-retry');
  assert.equal(first.ok, true);
  assert.deepEqual(events.splice(0), ['workspace', 'input', 'retry lookup', 'capacity', 'transaction', 'retry lookup', 'workspace', 'handler', 'audit', 'after commit']);
  atLimit = true;
  seedWorkspace(db, workspaceId, { lockDate: '2026-12-31' });
  const replay = await run(owner.uid, input, 'ordered-retry');
  assert.ok(replay.ok && replay.replayed, 'replay already committed and does not consume capacity again');
  assert.deepEqual(events, ['workspace', 'input', 'retry lookup']);
});

const url = process.env.LF_TEST_DATABASE_URL;
test('inline label create-only keeps the first writer, returns the conflict, and previews and replays safely', { skip: !url && 'LF_TEST_DATABASE_URL not set', timeout: 20_000 }, async t => {
  const db = new Firestore({ connectionString: url, max: 4 });
  const ws = `label-${randomUUID()}`;
  const wsRef = db.collection('workspaces').doc(ws);
  const label = db.collection('dimensionNodes').doc(`${ws}_property_P6`);
  const actor = `${ws}-owner`;
  const foreign = db.collection('dimensionNodes').doc(`${ws}_property_P7`);
  t.after(async () => {
    for (const table of ['dimensionNodes', 'idempotencyKeys', 'auditLogs']) await db.pool.query(`delete from public."${table}" where workspace_id = $1`, [ws]);
    await foreign.delete();
    await wsRef.delete();
    await db.terminate();
  });
  await wsRef.create({ uid: actor, name: 'Label race', members: ['viewer'], roles: { viewer: 'viewer' } });
  const args = (description: string, id = 'P6') => ({ createOnly: true, node: { id, dimensionId: 'property', description, status: 'active' } });
  const invoke = (uid: string, description: string, key: string, id?: string, definition = dimensionNodeCommand) => {
    const input = args(description, id);
    return [fakeRequest({ uid }, { workspaceId: ws, input }, key), { definition, workspaceId: ws, input }, { getDb: () => db }] as const;
  };
  const foreignData = { ...args('Another workspace', 'P7').node, workspaceId: `${ws}-foreign` };
  await foreign.set(foreignData);
  const foreignResult = await runRegisteredCommand(...invoke(actor, 'Not yours', 'foreign', 'P7'));
  assert.equal(foreignResult.ok ? undefined : foreignResult.code, 'DUPLICATE_RECORD');
  assert.deepEqual((await foreign.get()).data(), foreignData);
  const refused = await runRegisteredCommand(...invoke('viewer', 'Do not create', 'refused'));
  assert.equal(refused.ok ? undefined : refused.code, 'ROLE_REQUIRED');
  assert.equal((await previewCommand(...invoke(actor, 'Before', 'preview'))).ok, true);
  assert.equal((await label.get()).exists, false);
  // Force both real transactions to read the unclaimed slot and queue the write before either can
  // commit. Merely sending concurrent requests can give a false positive if one arrives late.
  let contenders = 0;
  let compete!: () => void;
  const bothReady = new Promise<void>((resolve, reject) => {
    compete = resolve;
    t.signal.addEventListener('abort', () => reject(t.signal.reason), { once: true });
  });
  const raced: typeof dimensionNodeCommand = {
    ...dimensionNodeCommand,
    async handler(ctx, tx, input) {
      const saved = await dimensionNodeCommand.handler(ctx, tx, input);
      if (++contenders === 2) compete();
      await bothReady;
      return saved;
    },
  };
  const values = ['First description', 'Second description'];
  const results = await Promise.all(values.map((text, i) => runRegisteredCommand(...invoke(actor, text, `race-${i}`, undefined, raced))));
  assert.equal(contenders, 2);
  const win = results.findIndex(result => result.ok);
  assert.notEqual(win, -1, JSON.stringify(results));
  const loser = results[1 - win];
  assert.equal(loser.ok ? undefined : loser.code, 'DUPLICATE_RECORD', JSON.stringify(results));
  assert.equal((await label.get()).data()?.description, values[win]);
  const replay = await runRegisteredCommand(...invoke(actor, values[win], `race-${win}`));
  assert.ok(replay.ok && replay.replayed);
  const conflict = await previewCommand(...invoke(actor, 'Another', 'stale'));
  assert.equal(conflict.ok ? undefined : conflict.code, 'DUPLICATE_RECORD');
  assert.equal((await db.collection('auditLogs').where('workspaceId', '==', ws).get()).size, 1);
});
