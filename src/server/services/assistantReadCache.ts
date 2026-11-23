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
 * The check grows with the rows of the tables it covers, so it covers only what the read can use: a
 * search, its own collections; reports and explanations, the book tables (not the append-only audit
 * log). Measured on one workspace with 200,000 audit rows and 5,000 customers: 72 ms per check when
 * it hashed everything, 13 ms for a report and 6–9 ms for a search after. A report reads those same
 * tables and does far more with them, so a hit saves most of it. A one-record read is cheaper to run
 * again and is not cached. The cache is in this server's memory, bounded, and every key
 * carries the workspace and the sandbox, so an entry can never answer for other books. Nothing is
 * logged: entries hold tool results only for as long as the books stay the same.
 */
import crypto from 'node:crypto';
import type { Pool } from 'pg';
import { booksVersion } from '../db/pg/booksVersion';

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
/** Plain code-unit order (locale-independent), so the same inputs always give the same key. */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort(byCodeUnit).filter(k => (value as Record<string, unknown>)[k] !== undefined)
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

export { booksVersion };

/**
 * The day part of a cache key: the UTC date and the workspace's own date. Answers that depend on
 * "today" (aging buckets, "this month") use the workspace's timezone, so its midnight must start new
 * keys too, not only UTC midnight. An unknown timezone counts as UTC.
 */
export function cacheDay(now: Date, timeZone: unknown): string {
  const utc = now.toISOString().slice(0, 10);
  if (typeof timeZone !== 'string' || !timeZone) return `${utc}|${utc}`;
  try {
    return `${utc}|${new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)}`;
  } catch {
    return `${utc}|${utc}`;
  }
}

/**
 * The live tables a read names, when it names them: a search reads only its collections, so only they
 * (and the workspace row) decide whether its answer is still current. Reports and explanations may
 * read any book table, so they are checked against all of them.
 */
export function tablesRead(tool: string, args: Record<string, unknown>): readonly string[] | undefined {
  if (tool !== 'search_records') return undefined;
  const collections = args.collections;
  if (!Array.isArray(collections) || !collections.length || !collections.every(c => typeof c === 'string' && /^[A-Za-z]+$/.test(c))) return undefined;
  return collections as string[];
}

/**
 * The tool cache for one sandbox: every read checks the books' version at that moment. `namespace`
 * keeps each caller's stored shape apart: the HTTP tool route keeps `{ status, body }`, the assistant
 * turn keeps the tool's result, and one must never be served to the other.
 */
export function sandboxToolCache(pool: Pool, scope: { workspaceId: string; sandboxId: string }, namespace: 'http' | 'turn' | 'turn-private-v1',
  options: { cache?: ReadCache; today?: () => string; timeZone?: unknown } = {}): ToolCache {
  const cache = options.cache ?? assistantReadCache;
  const today = options.today ?? (() => cacheDay(new Date(), options.timeZone));
  return {
    async read(tool, args, run) {
      if (!CACHEABLE_TOOLS.has(tool)) return { value: (await run()).value, hit: false };
      const key = ReadCache.key(scope, await booksVersion(pool, scope.workspaceId, scope.sandboxId, tablesRead(tool, args)), `${namespace}:${tool}`, args, today());
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
