/**
 * SBX-2 Part 4: cached read results and report answers for the assistant, per workspace, sandbox and
 * the tool's inputs, dropped as soon as the real books or the sandbox change.
 *
 * When has something changed? SBX-1 versions what is stored, never a counter: a draft row keeps the
 * version of the live row it was copied from (`base_version`), and a step is re-checked when that
 * version no longer matches. The books version here uses the same idea for a whole read:
 *
 * - every live book table the sandbox may read (`sandbox.has_live_book_read`, SBX-1's reviewed list,
 *   including `auditLogs` and `workspaces` itself), scoped to the workspace;
 * - every overlay table of this sandbox, and its steps (an add, edit, reorder, reject or accept);
 *
 * and for each, the number of rows and a sum of hashes of each row's id and PostgreSQL row version
 * (`xmin`, new on every insert and update; a delete changes the count and the sum). It is computed
 * from the rows in the database at the moment of the read, so a save made on any server, by any path
 * (command, import, webhook), is seen by the next read. No second clock is kept or bumped anywhere.
 *
 * Only reads that cost more than this check are cached (reports, explain, ask_books, search); a
 * one-record read is cheaper to run again. The cache is in this server's memory, bounded, and every key
 * carries the workspace and the sandbox, so an entry can never answer for other books. Nothing is
 * logged: entries hold tool results only for as long as the books stay the same.
 */
import crypto from 'node:crypto';
import type { Pool } from 'pg';
import { quoteIdent } from '../db/pg/sql';

/** The read tools whose results are cached. Each costs more than the books-version check. */
export const CACHEABLE_TOOLS: ReadonlySet<string> = new Set(['ask_books', 'run_report', 'explain_number', 'search_records']);

export interface ToolCache {
  /**
   * The tool's result for these inputs: from the cache when the books are at the same version as when
   * it was stored (`hit`), otherwise from `run`. The version is read *before* `run`, and a fresh result
   * is stored under that version, so a save that lands during the read can never be served later.
   * `run` may return `{ cache: false }` to keep a result (an error, a partial answer) out of the cache.
   */
  read(tool: string, args: Record<string, unknown>, run: () => Promise<{ value: unknown; cache?: boolean }>): Promise<{ value: unknown; hit: boolean }>;
}

/** JSON with object keys sorted, so the same inputs in another order are the same key. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

interface Entry { workspaceId: string; sandboxId: string; value: unknown; expiry: number }

/**
 * A bounded in-memory map. When full, expired entries go first, then the oldest (Map keeps insertion
 * order). The TTL is only an upper bound on memory use: correctness comes from the version in the key.
 */
export class ReadCache {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly limit = 500, private readonly ttlMs = 10 * 60_000) {}

  static key(scope: { workspaceId: string; sandboxId: string }, version: string, tool: string, args: Record<string, unknown>, today: string): string {
    return crypto.createHash('sha256').update(canonicalJson({ w: scope.workspaceId, s: scope.sandboxId, v: version, t: tool, a: args, d: today })).digest('hex');
  }

  get(key: string, scope: { workspaceId: string; sandboxId: string }, now = Date.now()): { value: unknown } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiry <= now || entry.workspaceId !== scope.workspaceId || entry.sandboxId !== scope.sandboxId) {
      this.entries.delete(key);
      return undefined;
    }
    return { value: structuredClone(entry.value) };
  }

  set(key: string, scope: { workspaceId: string; sandboxId: string }, value: unknown, now = Date.now()): void {
    if (this.entries.size >= this.limit && !this.entries.has(key)) {
      for (const [k, v] of this.entries) if (v.expiry <= now) this.entries.delete(k);
      while (this.entries.size >= this.limit) this.entries.delete(this.entries.keys().next().value as string);
    }
    this.entries.set(key, { ...scope, value: structuredClone(value), expiry: now + this.ttlMs });
  }

  /** Forget everything held for one workspace (e.g. when it is purged). */
  dropWorkspace(workspaceId: string): void {
    for (const [k, v] of this.entries) if (v.workspaceId === workspaceId) this.entries.delete(k);
  }

  get size(): number { return this.entries.size; }
}

export const assistantReadCache = new ReadCache();

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

/** The tool cache for one sandbox: every read checks the books' version at that moment. */
export function sandboxToolCache(pool: Pool, scope: { workspaceId: string; sandboxId: string },
  cache: ReadCache = assistantReadCache, today: () => string = () => new Date().toISOString().slice(0, 10)): ToolCache {
  return {
    async read(tool, args, run) {
      if (!CACHEABLE_TOOLS.has(tool)) return { value: (await run()).value, hit: false };
      const key = ReadCache.key(scope, await booksVersion(pool, scope.workspaceId, scope.sandboxId), tool, args, today());
      const stored = cache.get(key, scope);
      if (stored) return { value: stored.value, hit: true };
      const fresh = await run();
      if (fresh.cache !== false) cache.set(key, scope, fresh.value);
      return { value: fresh.value, hit: false };
    },
  };
}

/** A cache with a fixed version, for the replay's test books (they never change during a run). */
export function memoryToolCache(scope: { workspaceId: string; sandboxId: string }, cache = new ReadCache(), version = 'fixture'): ToolCache {
  return {
    async read(tool, args, run) {
      if (!CACHEABLE_TOOLS.has(tool)) return { value: (await run()).value, hit: false };
      const key = ReadCache.key(scope, version, tool, args, 'fixture');
      const stored = cache.get(key, scope);
      if (stored) return { value: stored.value, hit: true };
      const fresh = await run();
      if (fresh.cache !== false) cache.set(key, scope, fresh.value);
      return { value: fresh.value, hit: false };
    },
  };
}
