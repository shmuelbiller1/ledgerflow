/**
 * S-01: true PostgreSQL transaction and RLS contract checks. This suite MUST
 * run with LF_TEST_DATABASE_URL pointing to a disposable, migrated test DB.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Firestore } from '../server/db/pgFirestore';
import { SharedRateLimiter } from '../server/middleware/sharedRateLimiter';

const url = process.env.LF_TEST_DATABASE_URL;
const workspaceId = `rl_test_${randomBytes(8).toString('hex')}`;

describe('S-01 shared PostgreSQL limiter', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  let first: Firestore;
  let second: Firestore;
  before(async () => {
    first = new Firestore({ connectionString: url, max: 12 });
    second = new Firestore({ connectionString: url, max: 12 });
    const check = await first.pool.query(
      'select table_name from public.lf_rules where table_name = $1',
      ['rateLimitEntries'],
    );
    assert.equal(check.rows.length, 1, 'server adapter registry must include rateLimitEntries');
  });
  after(async () => {
    if (first) {
      await first.pool.query('delete from public."rateLimitEntries" where workspace_id = $1', [workspaceId]);
      await first.terminate();
    }
    if (second) await second.terminate();
  });

  test('20 concurrent requests across instances allow exactly five', async () => {
    const config = { keyPrefix: 's01-concurrency', windowMs: 60_000, max: 5 };
    // the window is the wall-clock minute: requests that straddle its end land in two windows and five more are
    // allowed (one CI run saw 6), so start well inside a window
    const intoWindow = Date.now() % config.windowMs;
    if (intoWindow > config.windowMs - 5_000) await new Promise(r => setTimeout(r, config.windowMs - intoWindow + 50));
    const a = new SharedRateLimiter(config, first);
    const b = new SharedRateLimiter(config, second);
    const outcomes = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      (i % 2 ? a : b).checkAndIncrement('same-user', workspaceId)));
    assert.equal(outcomes.filter(v => v.allowed).length, 5);
    assert.equal(outcomes.filter(v => !v.allowed).length, 15);
    assert.ok(outcomes.every(v => v.limit === 5));
    const [stored] = (await first.pool.query<{ data: { count: number }; id: string }>(
      'select id, data from public."rateLimitEntries" where workspace_id = $1',
      [workspaceId],
    )).rows;
    assert.equal(stored.data.count, 5);
    assert.match(stored.id, /^rl_[a-f0-9]{64}$/);
    assert.ok(!stored.id.includes('same-user'), 'no identifier in document id');
  });

  test('different namespaces, workspaces and identifiers remain separate', async () => {
    const a = new SharedRateLimiter({ keyPrefix: 's01-scope', windowMs: 60_000, max: 1 }, first);
    const b = new SharedRateLimiter({ keyPrefix: 's01-other', windowMs: 60_000, max: 1 }, second);
    assert.equal((await a.checkAndIncrement('u1', workspaceId)).allowed, true);
    assert.equal((await a.checkAndIncrement('u1', workspaceId)).allowed, false);
    assert.equal((await a.checkAndIncrement('u2', workspaceId)).allowed, true);
    assert.equal((await b.checkAndIncrement('u1', workspaceId)).allowed, true);
    assert.equal((await a.checkAndIncrement('u1', workspaceId + '_other')).allowed, true);
    await first.pool.query('delete from public."rateLimitEntries" where workspace_id = $1', [workspaceId + '_other']);
  });

  test('browser roles have no table policies or direct privileges', async () => {
    const policies = await first.pool.query(
      "select policyname from pg_policies where schemaname = 'public' and tablename = 'rateLimitEntries'",
    );
    assert.equal(policies.rows.length, 0);
    const rel = await first.pool.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public."rateLimitEntries"'::regclass`,
    );
    assert.equal(rel.rows[0].relrowsecurity, true);
    const permissions = await first.pool.query<{ anon: boolean; member: boolean }>(
      `select has_table_privilege('anon', 'public."rateLimitEntries"', 'SELECT,INSERT,UPDATE,DELETE') as anon,
       has_table_privilege('authenticated', 'public."rateLimitEntries"', 'SELECT,INSERT,UPDATE,DELETE') as member`,
    );
    assert.equal(permissions.rows[0].anon, false);
    assert.equal(permissions.rows[0].member, false);
  });
});
