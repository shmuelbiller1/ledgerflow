/**
 * AF-007 probe — the report cache grows without bound and is never pruned.
 *
 * `src/server/routes/reportRoutes.ts` keeps a module-level `REPORT_CACHE` (line 37) with a 60 s TTL (line 38).
 * Two things are checked here, both against the real exported `getCacheKey` (line 50):
 *
 *   C1  the key hashes the RAW `req.query` (line 51), while the handler parses into a stripped `result.data`
 *       (line 106/138). So a query parameter the computation ignores still makes a new key — and because the
 *       cache then misses, the full report is recomputed AND a new entry is stored. The cache is defeated and
 *       memory grows from the same request.
 *   C2  nothing ever removes an entry. Lines 113-114 and 146-147 read the entry and compare `expiry` to now,
 *       but an expired entry is left in the Map. There is no `delete`, no `clear`, no sweep and no size cap
 *       (verified by grep: `REPORT_CACHE.delete|.clear|prune|evict` → no match). So peak size is permanent.
 *
 * C2 is reproduced here faithfully from lines 37-53 because the Map itself is module-private; C1 uses the real
 * function. The bounding convention used everywhere else in this server is shown as the control (C3): the other
 * four in-process caches are all deliberately bounded, and one is tested.
 *
 * Run: NODE_ENV=test npx tsx audit/function-audit/probes/af007-report-cache-growth.ts
 * Prints OBSERVED vs EXPECTED per case and exits 0 on purpose: it documents behaviour, it does not gate CI.
 */
import crypto from 'crypto';

/**
 * The real `getCacheKey` is used when the server's dependencies are installed. Importing
 * `src/server/routes/reportRoutes` pulls in `express` and the Firestore layer, so in a workspace where
 * `node_modules` is absent (it is not persisted between agent sessions) the import fails; the fallback below
 * is a line-for-line copy of reportRoutes.ts:50-53 and prints which mode ran, so the output is never
 * ambiguous about whether it exercised the shipped function.
 */
type CacheKeyFn = (req: { path: string; query: unknown; body: unknown }, snapshot?: string) => string;
let getCacheKey: CacheKeyFn;
let keySource: string;
try {
  ({ getCacheKey } = await import('../../../src/server/routes/reportRoutes'));
  keySource = 'the real getCacheKey exported from src/server/routes/reportRoutes.ts:50';
} catch {
  // verbatim reportRoutes.ts:50-53 (requestUser(req)?.uid contributes nothing for these synthetic requests)
  getCacheKey = (req, snapshot = 'none') => {
    const payload = JSON.stringify({ path: req.path, query: req.query, body: req.body, user: undefined, snapshot });
    return crypto.createHash('sha256').update(payload).digest('hex');
  };
  keySource = 'a line-for-line copy of reportRoutes.ts:50-53 (node_modules absent, so the route could not be imported)';
}
console.log(`key function under test: ${keySource}`);
console.log('');

let failures = 0;
function report(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? 'OK    ' : 'DEFECT'} ${name}: ${detail}`);
}

/** the exact shape of lines 37-47: TTL, `remember`, and a read that checks expiry without evicting */
const REPORT_CACHE = new Map<string, { data: object; expiry: number; at: number }>();
const CACHE_TTL_MS = 60000;
function remember(key: string, data: object) {
  REPORT_CACHE.set(key, { data, expiry: Date.now() + CACHE_TTL_MS, at: Date.now() });
}
/** lines 113-114: a hit is returned, a miss falls through to a recompute — an expired entry stays in the Map */
function readCached(key: string): object | undefined {
  const cached = REPORT_CACHE.get(key);
  if (cached && cached.expiry > Date.now()) return cached.data;
  return undefined;
}

console.log('=== C1: a query parameter the report ignores still makes a new cache key ===');
{
  // ReportRangeSchema (src/schemas.ts:109-112) is WorkspaceIdSchema.extend({...}) and is NOT .strict(), and
  // zod strips unknown keys from the PARSED value — but line 51 hashes req.query, not result.data. The handler
  // reads only workspaceId, startDate, endDate (lines 108/140) and basis (line 117/142).
  const base = { workspaceId: 'ws-1', startDate: '2026-01-01', endDate: '2026-03-31' };
  const keys = [1, 2, 3].map(n => getCacheKey({ path: '/profit-and-loss', query: { ...base, n: String(n) }, body: {} } as never));
  const withoutExtra = getCacheKey({ path: '/profit-and-loss', query: { ...base }, body: {} } as never);
  const distinct = new Set([...keys, withoutExtra]).size;
  report(
    'C1 an ignored query parameter does not change the cache key',
    distinct === 1,
    `four requests that compute the SAME report (identical workspaceId/startDate/endDate, one with no extra ` +
      `parameter and three with n=1,2,3) produced ${distinct} distinct keys. Each is a cache miss, so each ` +
      `recomputes the whole report and each stores a new entry: keys ${keys.map(k => k.slice(0, 8)).join(', ')}, ` +
      `no-extra ${withoutExtra.slice(0, 8)}.`,
  );

  // the date parameters alone are already an unbounded space, without any extra parameter at all
  const byDate = new Set(
    Array.from({ length: 365 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      return getCacheKey({ path: '/profit-and-loss', query: { ...base, endDate: d }, body: {} } as never);
    }),
  );
  report(
    'C1b the documented parameters alone bound the key space',
    byDate.size <= 1,
    `varying only endDate over one year of valid YYYY-MM-DD values gives ${byDate.size} distinct keys. Both the ` +
      `extra-parameter route and the ordinary date-range route grow the Map; the second needs no crafted input at all.`,
  );
}

console.log('');
console.log('=== C2: entries are never removed, so peak size is permanent ===');
{
  const base = { workspaceId: 'ws-1', startDate: '2026-01-01', endDate: '2026-03-31' };
  // a burst of distinct queries — e.g. one authenticated member paging date ranges, or the C1 amplifier
  for (let n = 0; n < 2000; n++) {
    const key = getCacheKey({ path: '/profit-and-loss', query: { ...base, n: String(n) }, body: {} } as never);
    readCached(key); // miss
    remember(key, { rows: Array.from({ length: 200 }, (_, i) => ({ account: `acct-${i}`, cents: i * 100 })) }); // a stand-in for a real report body
  }
  const afterBurst = REPORT_CACHE.size;

  // now expire every entry by rewinding the stored expiry, exactly as the 60 s TTL does in real time
  for (const entry of REPORT_CACHE.values()) entry.expiry = Date.now() - 1;
  const servedAfterExpiry = readCached(getCacheKey({ path: '/profit-and-loss', query: { ...base, n: '0' }, body: {} } as never));
  const afterExpiry = REPORT_CACHE.size;

  report(
    'C2 expired entries are evicted',
    afterExpiry === 0,
    `${afterBurst} entries stored during the burst; after every one expired, the read correctly returned ` +
      `${servedAfterExpiry === undefined ? 'nothing (stale data is NOT served)' : 'STALE DATA'} but the Map still holds ` +
      `${afterExpiry} entries. Nothing deletes them: no delete, no clear, no sweep, no size cap. The memory is ` +
      `retained for the life of the process, and each further distinct query adds to it.`,
  );
  report(
    'C2b stale data is never served (the TTL itself works — this part is correct)',
    servedAfterExpiry === undefined,
    'the expiry check at lines 113-114/146-147 does its job: an expired entry is not returned. The defect is that it is ' +
      'also never removed, so correctness of the answer is not what is at risk here — availability is.',
  );

  // what one entry costs, so the consequence is a number rather than an adjective
  const bytes = Buffer.byteLength(JSON.stringify([...REPORT_CACHE.values()][0]?.data ?? {}));
  console.log(
    `       scale: a stand-in body of 200 account rows is ${bytes} bytes; a real P&L or balance sheet for a ` +
      `busy workspace is larger. ${afterExpiry} such entries ≈ ${(afterExpiry * bytes / 1024 / 1024).toFixed(1)} MB ` +
      `retained from one burst, and the burst can be repeated with new parameter values indefinitely.`,
  );
}

console.log('');
console.log('=== C3 control: every other in-process cache in this server IS bounded ===');
{
  // Verified by reading each site; the cap and its mechanism are quoted so this is not an assertion of intent.
  const others = [
    { site: 'src/server/http/cspViolations.ts:43,130-133', bound: 'MAX_VIOLATION_GROUPS = 200, then counted as `dropped` and not stored', tested: 'src/tests/csp-report-only.test.ts:352-358 pushes cap+50 and asserts groups.length === cap' },
    { site: 'src/server/auth/supabaseAuth.ts:92', bound: '`if (authenticatorCache.size > 10_000) authenticatorCache.clear()` before each insert', tested: 'not tested' },
    { site: 'src/server/auth/supabaseAuth.ts:112', bound: '`if (twoStepCache.size > 10_000) twoStepCache.clear()` before each insert', tested: 'not tested' },
    { site: 'src/server/routes/plaidWebhookRoutes.ts:30-43', bound: 'an unknown `kid` throws at line 37 BEFORE the set at line 43, so only real Plaid key ids are ever cached; plus plaidWebhookLimiter', tested: 'clearPlaidWebhookKeysForTests seam exists' },
  ];
  for (const o of others) console.log(`       bounded: ${o.site} — ${o.bound} (${o.tested})`);
  report(
    'C3 REPORT_CACHE follows the same convention as its four siblings',
    false,
    'it is the only module-level cache in src/server/ with no cap, no delete and no sweep. Its own comment at line 49 ' +
      'explains that the snapshot is part of the key "so a stale or rebuilt one is never answered from the cache" — the ' +
      'author was thinking carefully about staleness here, which is why the absence of any eviction looks like an ' +
      'oversight rather than a decision. Note the key is per-user (line 51 includes requestUser(req)?.uid), so this is ' +
      'NOT cross-tenant data exposure: it is unbounded growth, not a leak of figures.',
  );
}

console.log('');
console.log(failures === 0 ? 'all cases OK' : `${failures} case(s) reported DEFECT`);
process.exit(0);
