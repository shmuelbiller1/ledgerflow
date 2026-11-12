// Runs one SQL file against the disposable local test database and prints every result set.
// usage: node audit/agent7-2026-11-11/probes/run-sql.mjs <file.sql>     (reads LF_TEST_DATABASE_URL)
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require('pg');
const url = process.env.LF_TEST_DATABASE_URL;
if (!url) { console.error('Set LF_TEST_DATABASE_URL to a test Postgres database.'); process.exit(1); }
if (/supabase\.(co|com)/.test(new URL(url).hostname)) { console.error('Refusing to run audit probes against a hosted database.'); process.exit(1); }
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const results = await client.query(fs.readFileSync(process.argv[2], 'utf8'));
  for (const r of Array.isArray(results) ? results : [results]) {
    if (r.rows?.length && Object.keys(r.rows[0]).some(k => !['as_user', 'as_server', 'try'].includes(k))) {
      for (const row of r.rows) console.log(Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(' | '));
      console.log('');
    }
  }
} catch (err) {
  console.error('SQL error:', err.message);
  process.exitCode = 1;
  await client.query('rollback').catch(() => {});
} finally {
  await client.end();
}
