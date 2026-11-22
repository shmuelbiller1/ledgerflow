/**
 * SBX-2 Part 4: the version of everything one sandbox read can see, computed from the stored rows
 * (count and a hash of each row's id and xmin) of the live book tables the sandbox may read
 * (`sandbox.has_live_book_read`, SBX-1's reviewed list) for the workspace, and of every sandbox overlay
 * table for the sandbox. Any insert, update or delete there changes it; there is no separate clock.
 * Data layer: it names tables directly, which code outside src/server/db must not do.
 */
import type { Pool } from 'pg';
import { quoteIdent } from './sql';

interface VersionTables { live: string[]; overlays: string[] }
const tablesByPool = new WeakMap<Pool, Promise<VersionTables>>();

/** The live book tables the sandbox may read and the overlay tables, from the database's own catalog. */
function versionTables(pool: Pool): Promise<VersionTables> {
  let found = tablesByPool.get(pool);
  if (!found) {
    found = (async () => {
      const live = await pool.query<{ name: string }>(
        `select table_name as name from public.lf_rules where sandbox.has_live_book_read(table_name) order by table_name collate "C"`);
      const overlays = await pool.query<{ name: string }>(`
        select c.relname as name from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = 'sandbox_id' and not a.attisdropped
         where n.nspname = 'sandbox' and c.relkind = 'r'
         order by c.relname collate "C"`);
      return { live: live.rows.map(r => r.name), overlays: overlays.rows.map(r => r.name) };
    })();
    found.catch(() => tablesByPool.delete(pool));
    tablesByPool.set(pool, found);
  }
  return found;
}

const rowsPart = (label: string, from: string, where: string) =>
  `select ${quoteLiteral(label)} || ':' || count(*) || ':' || coalesce(sum(hashtextextended(id::text || ':' || xmin::text, 0)::numeric), 0) as part from ${from} where ${where}`;
const quoteLiteral = (s: string) => `'${s.replaceAll("'", "''")}'`;

/**
 * The version of everything a sandbox read can see: changes when any live book row of the workspace,
 * any overlay row of the sandbox, or any of its steps changes. Uses the server's own (live) pool.
 */
export async function booksVersion(pool: Pool, workspaceId: string, sandboxId: string): Promise<string> {
  const { live, overlays } = await versionTables(pool);
  const parts = [
    ...live.map(t => rowsPart(`l:${t}`, `public.${quoteIdent(t)}`, t === 'workspaces' ? 'id = $1' : 'workspace_id = $1')),
    ...overlays.map(t => rowsPart(`o:${t}`, `sandbox.${quoteIdent(t)}`, 'sandbox_id = $2::uuid')),
  ];
  const { rows } = await pool.query<{ version: string }>(
    `select md5(string_agg(part, ',' order by part collate "C")) as version from (${parts.join(' union all ')}) v`, [workspaceId, sandboxId]);
  return rows[0]?.version ?? '';
}

