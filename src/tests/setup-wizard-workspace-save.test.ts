import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

/**
 * 27 Oct, live site: "Set up your books" could not save the business. The server had written fields of its own onto
 * the workspace (modules, setupCompletedAt, branding...), and the guard refused every later user save of a document
 * with a field outside the allowed list. Real migrated Postgres/RLS.
 */
test('the owner saves the business step on a workspace the server has written to, and cannot change the server fields', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, async () => {
  const client = new pg.Client({ connectionString: process.env.LF_TEST_DATABASE_URL }); await client.connect();
  const id = `setup_save_${randomBytes(6).toString('hex')}`;
  const owner = `${id}_owner`;
  async function asOwner(patch: Record<string, unknown>) {
    await client.query('begin');
    try {
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: owner, role: 'authenticated', aal: 'aal1' })]);
      await client.query('select public.lf_update($1, $2, $3)', ['workspaces', id, patch]);
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; }
  }
  try {
    await client.query('insert into public.workspaces (id, data) values ($1, $2)', [id, {
      uid: owner, name: 'Personal Workspace', businessType: 'personal', currency: 'USD', createdAt: '2026-10-27',
      modules: { inventory: false }, setupCompletedAt: '2026-10-27T05:00:00Z', branding: { color: '#123456' }, requireTwoStep: false,
    }]);
    await asOwner({ name: 'Biller Books', currency: 'ILS', timezone: 'Asia/Jerusalem', fiscalYearStartMonth: 1, fiscalYearStartDay: 1, updatedAt: '2026-10-27T05:01:00Z' });
    const saved = (await client.query('select data from public.workspaces where id = $1', [id])).rows[0].data;
    assert.equal(saved.name, 'Biller Books'); assert.equal(saved.currency, 'ILS'); assert.equal(saved.timezone, 'Asia/Jerusalem');
    for (const patch of [{ modules: { inventory: true } }, { setupCompletedAt: null }, { requireTwoStep: true }]) {
      await assert.rejects(asOwner(patch), /cannot be changed/, JSON.stringify(patch));
    }
  } finally {
    await client.query('delete from public.workspaces where id = $1', [id]); await client.end();
  }
});
