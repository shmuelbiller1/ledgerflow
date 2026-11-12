/**
 * AF-007 — report cache regression probe, revalidated after #660 / #645.
 *
 * Historical evidence captured at 39b0012 showed unbounded cache growth. The
 * production cache was subsequently fixed in PR #660. This probe now exercises
 * the exported CURRENT cache helpers, never a hard-coded copy of the old bug.
 *
 * Run: NODE_ENV=test npx tsx audit/function-audit/probes/af007-report-cache-growth.ts
 * Requires dependencies; a failed import is NOT treated as a successful probe.
 */
import {
  REPORT_CACHE_LIMIT,
  getCacheKey,
  rememberReport,
  reportCacheSize,
} from '../../../src/server/routes/reportRoutes';

let failures = 0;
function check(name: string, pass: boolean, detail: string): void {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  if (!pass) failures += 1;
}

console.log('AF-007 current implementation (historical defect fixed in PR #660)');

const params = { workspaceId: 'ws-1', startDate: '2026-01-01', endDate: '2026-03-31', basis: 'accrual' };
const baseQuery = { workspaceId: params.workspaceId, startDate: params.startDate, endDate: params.endDate };
const key = (query: object) => getCacheKey({ path: '/profit-and-loss', query, body: {}, user: undefined } as never, 'none', params);

// The raw query remains part of the key, even when handlers ignore unknown
// fields. This can cause extra recomputations, but no longer unlimited growth.
const distinct = new Set([key(baseQuery), ...[1, 2, 3].map(n => key({ ...baseQuery, n: String(n) }))]).size;
console.log(`INFO C1: ${distinct} distinct keys for equal parsed report params with ignored query parameters; cache churn is possible, but bounded.`);

// Exercise the actual exported bounded cache, not the old local Map.
for (let n = 0; n < 2000; n += 1) {
  rememberReport(`af007-unique-${n}`, { rows: [{ account: n, cents: n * 100 }] });
}
const afterBurst = reportCacheSize();
check('C2 bounded after 2000 unique writes', afterBurst > 0 && afterBurst <= REPORT_CACHE_LIMIT,
  `actual ${afterBurst}, limit ${REPORT_CACHE_LIMIT}`);

// Supply a simulated future time to force TTL expiry without sleeping. When
// the cache is full, rememberReport must remove expired entries before insert.
rememberReport('af007-after-expiry', { rows: [] }, Date.now() + 120_000);
const afterExpirySweep = reportCacheSize();
check('C3 expired full cache is reclaimed', afterExpirySweep === 1,
  `actual ${afterExpirySweep}, expected one newly inserted future entry`);

if (failures) console.error(`${failures} AF-007 current-cache checks failed`);
process.exitCode = failures ? 1 : 0;
