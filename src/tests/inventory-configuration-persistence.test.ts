import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { expectBrowserPatchDenied, pgWorkspaceCommands } from './helpers/pgWriteBoundary';

test('bundle and mixed-language unit settings persist through the named command without stock or money changes', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, async () => {
  const client = new pg.Client({ connectionString: process.env.LF_TEST_DATABASE_URL });
  await client.connect();
  const commands = pgWorkspaceCommands();
  const key = `item_config_${randomBytes(6).toString('hex')}`;
  const book = `${key}_book`, viewer = `${key}_viewer`;
  const original = { workspaceId: key, uid: `${key}_owner`, name: 'ערכה Kit', sku: 'KIT', itemType: 'stock', quantityAtHand: 0, unitPriceCents: 1000, unitCostCents: 500, reorderPoint: 0, createdAt: '2026-10-01' };
  const read = async () => (await client.query('select data from public.inventory where id = $1', [key])).rows[0].data;
  const save = (uid: string, fields: Record<string, unknown>) => commands.run(uid, key, 'inventoryitem.save', { id: key, ...fields });
  try {
    await client.query('insert into public.workspaces (id, data) values ($1, $2)', [key, { uid: original.uid, name: 'Synthetic inventory', currency: 'USD', members: [original.uid, book, viewer], roles: { [book]: 'bookkeeper', [viewer]: 'viewer' } }]);
    await client.query('insert into public.inventory (id, data) values ($1, $2)', [key, original]);
    await client.query('insert into public.inventory (id, data) values ($1, $2)', [`${key}_part`, { ...original, name: 'חלק Widget', sku: 'PART' }]);
    const settings = { bundleParts: [{ itemId: `${key}_part`, quantity: 3 }], measurementUnit: 'קופסה Box', unitsPerPackage: 24 };
    await expectBrowserPatchDenied(client, book, 'inventory', key, settings);
    assert.deepEqual(await read(), original);
    const written = await save(book, settings);
    assert.ok(written.ok, JSON.stringify(written));
    let saved = await read();
    for (const [field, value] of Object.entries({ ...original, ...settings })) assert.deepEqual(saved[field], value, field);
    for (const [uid, code] of [[viewer, 'ROLE_REQUIRED'], [`${key}_outsider`, 'NOT_A_MEMBER']]) {
      const refused = await save(uid, { measurementUnit: 'Refused', bundleParts: [] });
      assert.ok(!refused.ok);
      assert.equal(refused.code, code);
      assert.deepEqual(await read(), saved);
    }
    const cleared = await save(original.uid, { bundleParts: [] });
    assert.ok(cleared.ok, JSON.stringify(cleared));
    saved = await read();
    assert.deepEqual(saved.bundleParts, []);
    assert.equal(saved.measurementUnit, 'קופסה Box');
    assert.equal(saved.unitsPerPackage, 24);
    assert.equal(saved.quantityAtHand, 0);
    assert.equal(saved.unitPriceCents, 1000);
    assert.equal(saved.unitCostCents, 500);
    assert.equal((await client.query('select count(*)::int as count from public.transactions where workspace_id = $1', [key])).rows[0].count, 0);
  } finally {
    await commands.close();
    await client.query('delete from public."auditLogs" where workspace_id = $1', [key]);
    await client.query('delete from public.inventory where workspace_id = $1', [key]);
    await client.query('delete from public.workspaces where id = $1', [key]);
    await client.end();
  }
});
