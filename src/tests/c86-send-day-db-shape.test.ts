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
