import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { expectBrowserPatchDenied, pgWorkspaceCommands } from './helpers/pgWriteBoundary';

/**
 * 27 Oct, live site: "Set up your books" could not save the business. The server had written fields of its own onto
 * the workspace (modules, setupCompletedAt, branding...), and the guard refused every later user save of a document
 * with a field outside the allowed list. Real migrated Postgres/RLS.
 */
test('the owner saves the business step on a workspace the server has written to, and cannot change the server fields', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, async () => {
  const client = new pg.Client({ connectionString: process.env.LF_TEST_DATABASE_URL }); await client.connect();
  const id = `setup_save_${randomBytes(6).toString('hex')}`;
  const owner = `${id}_owner`;
  const commands = pgWorkspaceCommands();
  const asOwner = (patch: Record<string, unknown>) => commands.run(owner, id, 'workspace.settings', patch);
  const read = async () => (await client.query('select data from public.workspaces where id = $1', [id])).rows[0].data;
  try {
    await client.query('insert into public.workspaces (id, data) values ($1, $2)', [id, {
      uid: owner, name: 'Personal Workspace', businessType: 'personal', currency: 'USD', createdAt: '2026-10-27',
      modules: { inventory: false }, setupCompletedAt: '2026-10-27T05:00:00Z', branding: { color: '#123456' }, requireTwoStep: false,
    }]);
    const fields = { name: 'Biller Books', currency: 'ILS', timezone: 'Asia/Jerusalem', fiscalYearStartMonth: 1, fiscalYearStartDay: 1 };
    await expectBrowserPatchDenied(client, owner, 'workspaces', id, fields);
    const business = await asOwner(fields);
    assert.ok(business.ok, JSON.stringify(business));
    const saved = await read();
    assert.equal(saved.name, 'Biller Books'); assert.equal(saved.currency, 'ILS'); assert.equal(saved.timezone, 'Asia/Jerusalem');
    // Y-35: the tax rounding policy is a setting the owner may change
    const rounding = await asOwner({ taxRounding: 'half_even' });
    assert.ok(rounding.ok, JSON.stringify(rounding));
    const after = await read();
    assert.equal(after.taxRounding, 'half_even');
    assert.deepEqual(after.modules, { inventory: false });
    assert.equal(after.setupCompletedAt, '2026-10-27T05:00:00Z');
    assert.deepEqual(after.branding, { color: '#123456' });
    assert.equal(after.requireTwoStep, false);
    for (const patch of [{ modules: { inventory: true } }, { setupCompletedAt: null }, { requireTwoStep: true }]) {
      const refused = await asOwner(patch);
      assert.ok(!refused.ok, JSON.stringify(patch));
      assert.equal(refused.code, 'INVALID_INPUT');
      assert.deepEqual(await read(), after);
    }
  } finally {
    await commands.close();
    await client.query('delete from public."auditLogs" where workspace_id = $1', [id]);
    await client.query('delete from public.workspaces where id = $1', [id]); await client.end();
  }
});
