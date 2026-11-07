import pg from 'pg';
const [,, db, ...sqlParts] = process.argv;
const sql = sqlParts.join(' ');
const c = new pg.Client({ connectionString: `postgresql://postgres:postgres@127.0.0.1:5432/${db}` });
await c.connect();
const r = await c.query(sql);
console.log(JSON.stringify((Array.isArray(r) ? r.at(-1) : r).rows));
await c.end();
