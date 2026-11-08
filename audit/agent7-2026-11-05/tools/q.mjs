/** Run one SQL statement against a local throwaway Postgres, printing the rows as JSON. */
import pg from 'pg';

const [,, rawDb, ...sqlParts] = process.argv;
// The caller is an agent, so treat argv as hostile: a database name is an identifier, never a
// fragment of a connection string. Refuse anything that is not a plain lowercase identifier
// instead of concatenating it into the URL (connection-string injection).
const db = String(rawDb || '');
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(db)) {
  console.error(`refusing database name ${JSON.stringify(db)}: expected ^[a-z_][a-z0-9_]*$`);
  process.exit(2);
}
const sql = sqlParts.join(' ');

const client = new pg.Client({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: db,
});
await client.connect();
const result = await client.query(sql);
console.log(JSON.stringify((Array.isArray(result) ? result.at(-1) : result).rows));
await client.end();
