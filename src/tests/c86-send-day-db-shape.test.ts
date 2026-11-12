/**
 * C-86 (CodeRabbit on #665): the database's schedule check (lf_valid_report_schedules) accepts the chosen send day —
 * 1–7 weekly, 1–28 monthly — and refuses any other value. Real migrated Postgres.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const schedule = (extra: Record<string, unknown>) => [{ id: 's1', report: 'profit-and-loss', recipients: ['a@example.com'], ...extra }];

test('C-86: the database accepts a send day in range and refuses the rest', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, async () => {
  const client = new pg.Client({ connectionString: process.env.LF_TEST_DATABASE_URL });
  await client.connect();
  const valid = async (extra: Record<string, unknown>) =>
    (await client.query('select public.lf_valid_report_schedules($1::jsonb) as ok', [JSON.stringify(schedule(extra))])).rows[0].ok as boolean;
  try {
    assert.equal(await valid({ frequency: 'weekly' }), true, 'no send day, as saved before');
    assert.equal(await valid({ frequency: 'weekly', sendDay: 3 }), true);
    assert.equal(await valid({ frequency: 'weekly', sendDay: 7 }), true);
    assert.equal(await valid({ frequency: 'monthly', sendDay: 28 }), true);
    assert.equal(await valid({ frequency: 'weekly', sendDay: 8 }), false);
    assert.equal(await valid({ frequency: 'monthly', sendDay: 29 }), false);
    assert.equal(await valid({ frequency: 'monthly', sendDay: 0 }), false);
    assert.equal(await valid({ frequency: 'monthly', sendDay: 1.5 }), false);
    assert.equal(await valid({ frequency: 'monthly', sendDay: '15' }), false, 'a string is refused, not cast');
    assert.equal(await valid({ frequency: 'monthly', other: 1 }), false, 'other unknown keys still refused');
  } finally {
    await client.end();
  }
});

test('C-86: an owner saves a schedule with a chosen day through lf_update (weekly Wednesday, monthly the 15th); a bad day is refused', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, async () => {
  const client = new pg.Client({ connectionString: process.env.LF_TEST_DATABASE_URL });
  await client.connect();
  const id = `c86_save_${Date.now().toString(36)}`;
  const owner = `${id}_owner`;
  const asOwner = async (patch: Record<string, unknown>) => {
    await client.query('begin');
    try {
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: owner, role: 'authenticated', aal: 'aal1' })]);
      await client.query('select public.lf_update($1, $2, $3)', ['workspaces', id, patch]);
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; }
  };
  try {
    await client.query('insert into public.workspaces (id, data) values ($1, $2)', [id, { uid: owner, name: 'Send day books', currency: 'USD', createdAt: '2026-11-12' }]);
    const schedules = [
      { id: 'w', report: 'profit-and-loss', frequency: 'weekly', recipients: ['a@example.com'], sendDay: 3 },
      { id: 'm', report: 'balance-sheet', frequency: 'monthly', recipients: ['a@example.com'], sendDay: 15 },
    ];
    await asOwner({ scheduledReports: schedules });
    const saved = (await client.query('select data from public.workspaces where id = $1', [id])).rows[0].data;
    assert.deepEqual(saved.scheduledReports.map((s: { id: string; sendDay: number }) => [s.id, s.sendDay]), [['w', 3], ['m', 15]]);
    await assert.rejects(asOwner({ scheduledReports: [{ ...schedules[1], sendDay: 31 }] }), 'the 31st is refused');
    const after = (await client.query('select data from public.workspaces where id = $1', [id])).rows[0].data;
    assert.equal(after.scheduledReports[1].sendDay, 15, 'the refused save changed nothing');
  } finally {
    await client.query('delete from public.workspaces where id = $1', [id]);
    await client.end();
  }
});
