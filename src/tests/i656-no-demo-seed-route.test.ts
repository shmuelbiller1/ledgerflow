/** #656: the demo-seed route is gone: a writer's POST /workspaces/:id/seed is a 404 and writes nothing into the books. */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceRouterHarness } from './helpers/workspaceRouterHarness';

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const h = workspaceRouterHarness('ws_seed');
  before(() => h.start({ uid: 'owner-1', name: 'Seed', members: ['owner-1'], roles: {}, lockDate: '2026-09-30' }));
  after(() => h.stop());

  test('the owner sending the old request gets 404, and no entry, invoice or bill appears', async () => {
    assert.equal((await h.request('owner-1', 'POST', '/seed', {})).status, 404);
    for (const table of ['transactions', 'invoices', 'bills']) {
      const { rows } = await h.db.pool.query(`select count(*)::int as n from public."${table}" where workspace_id = $1`, [h.ws]) as { rows: Array<{ n: number }> };
      assert.equal(rows[0].n, 0, `${table} untouched`);
    }
  });
});
