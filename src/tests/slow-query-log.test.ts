import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { queryShape, slowQueryThresholdMs, timeQueries, timePoolQueries } from '../server/db/slowQueryLog';

/** D-22 / BN-02: slow queries are logged by shape, never with their values. */
describe('slow-query log (D-22)', () => {
  it('a query shape carries no literal values', () => {
    const shape = queryShape(`select * from "invoices"\n  where data->>'email' = 'alice@example.com' and total > 1250.50 limit 10`);
    assert.equal(shape, `select * from "invoices" where data->>? = ? and total > ? limit ?`);
    assert.doesNotMatch(shape, /alice|1250/);
    assert.equal(queryShape(`select $$secret body$$`), 'select ?');
    // a huge statement (a big multi-row insert) is shaped quickly and cut short (CodeRabbit on #474)
    const huge = 'insert into t values ' + Array.from({ length: 50_000 }, (_, n) => `(${n}, 'name-${n}@example.com')`).join(', ');
    const hugeShape = queryShape(huge);
    // the scan stops early: the shape of the huge statement equals that of its first few thousand characters
    assert.equal(hugeShape, queryShape(huge.slice(0, 5000)));
    assert.ok(hugeShape.endsWith('…') && hugeShape.length <= 301);
    assert.doesNotMatch(hugeShape, /example\.com/);
    assert.ok(queryShape('select ' + 'x, '.repeat(200)).endsWith('…'));
  });

  it('tagged dollar quotes, escape strings, quotes inside $$ and comments never leak (Codex on #474)', () => {
    const cases: Array<[string, string]> = [
      ['select $tag$alice@example.com$tag$', 'select ?'],
      [`select $$O'Brien$$, 'confidential'`, 'select ?, ?'],
      [`select E'it\\'s secret', 'x''y'`, 'select ?, ?'],
      [`select "Order Total", col1 from t where a = $1 -- note: bob@example.com\n and b = 2 /* carol */`, 'select "Order Total", col1 from t where a = $? and b = ?'],
      [`select $a$ $$inner$$ $a$`, 'select ?'],
      ['select 1 /* outer /* inner */ dave@example.com */ from t', 'select ? from t'],
      [`select $${'t'.repeat(255)}$erin@example.com$${'t'.repeat(255)}$ from t`, 'select ? from t'],
      ['select $é$frank@example.com$é$ from t', 'select ? from t'],
      ['select $1, col$x from t where a = $ grace@example.com', 'select $?, col$x from t where a = ?…'],
    ];
    for (const [sql, expected] of cases) assert.equal(queryShape(sql), expected, sql);
    assert.doesNotMatch(cases.map(([sql]) => queryShape(sql)).join(' '), /alice|Brien|confidential|secret|bob|carol|dave|erin|frank|grace|inner/);
  });

  it('the threshold is 500 ms unless SLOW_QUERY_MS sets a positive number', () => {
    assert.equal(slowQueryThresholdMs({}), 500);
    assert.equal(slowQueryThresholdMs({ SLOW_QUERY_MS: '1200' }), 1200);
    assert.equal(slowQueryThresholdMs({ SLOW_QUERY_MS: 'nope' }), 500);
    assert.equal(slowQueryThresholdMs({ SLOW_QUERY_MS: '-5' }), 500);
  });

  const fakeClient = (delayMs: number, fail = false) => ({
    query: (..._args: unknown[]) => new Promise((resolve, reject) => setTimeout(() => (fail ? reject(new Error('boom')) : resolve({ rows: [] })), delayMs)),
  });

  it('logs a slow query once with its shape and parameter count, never the parameters', async () => {
    const logged: Record<string, unknown>[] = [];
    const client = fakeClient(30);
    timeQueries(client, 10, (_msg, fields) => logged.push(fields));
    await client.query('select * from t where id = $1 and email = $2', ['id-1', 'bob@example.com']);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].query, 'select * from t where id = $? and email = $?');
    assert.equal(logged[0].params, 2);
    assert.ok(Number(logged[0].ms) >= 10);
    assert.doesNotMatch(JSON.stringify(logged), /bob@example\.com|id-1/);
  });

  it('a fast query is not logged; a slow failure is logged as failed and still throws', async () => {
    const logged: Record<string, unknown>[] = [];
    const fast = fakeClient(0);
    timeQueries(fast, 1000, (_m, f) => logged.push(f));
    await fast.query('select 1');
    assert.equal(logged.length, 0);
    const failing = fakeClient(30, true);
    timeQueries(failing, 10, (_m, f) => logged.push(f));
    await assert.rejects(() => failing.query({ text: 'select pg_sleep(1)', values: [] }) as Promise<unknown>, /boom/);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].failed, true);
  });

  it('wrapping twice logs once, and callback-style calls pass through', async () => {
    const logged: Record<string, unknown>[] = [];
    let callbacks = 0;
    const client = { query: (...args: unknown[]) => { const cb = args[args.length - 1]; if (typeof cb === 'function') { callbacks++; return undefined; } return new Promise(r => setTimeout(() => r({}), 20)); } };
    timeQueries(client, 5, (_m, f) => logged.push(f));
    timeQueries(client, 5, (_m, f) => logged.push(f));
    await client.query('select 1');
    client.query('select 1', () => {});
    assert.equal(logged.length, 1);
    assert.equal(callbacks, 1);
  });

  it('on a real database, slow pool and transaction queries are logged by shape, fast ones are not', { skip: !process.env.LF_TEST_DATABASE_URL }, async () => {
    const lines: Record<string, unknown>[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as unknown as { write: (c: string) => boolean }).write = (chunk: string) => {
      try { lines.push(JSON.parse(chunk)); return true; } catch { return realWrite(chunk); }
    };
    const pool = new pg.Pool({ connectionString: process.env.LF_TEST_DATABASE_URL });
    try {
      // a client opened before instrumentation (idle in the pool) must still be timed when it is checked out again
      (await pool.connect()).release();
      timePoolQueries(pool as never, 50);
      await pool.query('select pg_sleep(0.1), $1::text as x', ['secret-value']);
      const client = await pool.connect();
      try { await client.query('select pg_sleep(0.08)'); } finally { client.release(); }
      await pool.query('select 1');
    } finally {
      (process.stderr as unknown as { write: typeof realWrite }).write = realWrite;
      await pool.end();
    }
    const slow = lines.filter(l => l.msg === 'slow query');
    assert.deepEqual(slow.map(l => l.query), ['select pg_sleep(?), $?::text as x', 'select pg_sleep(?)']);
    assert.doesNotMatch(JSON.stringify(lines), /secret-value/);
  });
});
