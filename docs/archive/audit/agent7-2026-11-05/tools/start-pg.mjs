// Start a disposable embedded Postgres 17 for local test runs (never a real database).
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
const dir = '/home/user/agent7-tools/pgdata';
const fresh = !fs.existsSync(dir + '/PG_VERSION');
const pg = new EmbeddedPostgres({
  databaseDir: dir, user: 'postgres', password: 'postgres', port: 5432, persistent: true,
  postgresFlags: ['-c', 'max_connections=200', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'],
});
if (fresh) await pg.initialise();
await pg.start();
try { await pg.createDatabase('lf_test'); } catch (e) { console.log('createDatabase:', e.message); }
console.log('PG READY on 5432 (db lf_test)');
const stop = async () => { await pg.stop(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
setInterval(() => {}, 1 << 30);
