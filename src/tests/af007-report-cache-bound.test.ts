/** #645 (AF-007): the P&L / balance-sheet answer cache is bounded, drops expired entries, and keys on what the report reads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import type express from 'express';
import { getCacheKey, rememberReport, reportCacheSize, REPORT_CACHE_LIMIT } from '../server/routes/reportRoutes';

const req = (query: Record<string, string>, uid = 'u1') => ({ path: '/pl', query, body: {}, user: { uid } }) as unknown as express.Request;
const params = { workspaceId: 'w1', startDate: '2026-01-01', endDate: '2026-03-31', basis: 'accrual' };

test('#645 C1: the key follows the URL (AUD-10: a new URL reads fresh) and the parameters the report reads', () => {
  const keys = new Set(['', '1', '2', '3'].map(n => getCacheKey(req(n ? { ...params, n } : params), 'none', params)));
  assert.equal(keys.size, 4, 'each URL has its own key; the cap below bounds how many are kept');
  assert.equal(getCacheKey(req(params), 'none', params), getCacheKey(req({ ...params }), 'none', { ...params }), 'the same URL shares one key');
  assert.notEqual(getCacheKey(req(params), 'none', params), getCacheKey(req(params), 'none', { ...params, endDate: '2026-04-30' }));
  assert.notEqual(getCacheKey(req(params), 'none', params), getCacheKey(req(params), 'none', { ...params, basis: 'cash' }));
});

test('#645: the key still separates users and balance snapshots', () => {
  assert.notEqual(getCacheKey(req(params, 'u1'), 'none', params), getCacheKey(req(params, 'u2'), 'none', params));
  assert.notEqual(getCacheKey(req(params), 'snap-a', params), getCacheKey(req(params), 'snap-b', params));
});

test('#645 C2: a burst of distinct reports never holds more than the cap', () => {
  const t0 = 1_800_000_000_000;
  for (let i = 0; i < REPORT_CACHE_LIMIT * 4; i++) rememberReport(`burst-${i}`, { i }, t0);
  assert.ok(reportCacheSize() <= REPORT_CACHE_LIMIT, `holds ${reportCacheSize()}`);
});

test('#645 C2: when full, expired entries are dropped first and fresh ones are kept', () => {
  const t0 = 1_900_000_000_000;
  // fill the cache: half written at t0, half 50 s later
  rememberReport('reset', {}, t0 - 3_600_000); // the old write (an hour back) is expired by the next full write
  for (let i = 0; i < REPORT_CACHE_LIMIT; i++) rememberReport(`r-${i}`, { i }, i < REPORT_CACHE_LIMIT / 2 ? t0 : t0 + 50_000);
  assert.equal(reportCacheSize(), REPORT_CACHE_LIMIT);
  // at t0 + 70 s the first half (70 s old) is past the 60 s TTL; the second half (20 s old) is not
  rememberReport('next', { ok: true }, t0 + 70_000);
  assert.equal(reportCacheSize(), REPORT_CACHE_LIMIT / 2 + 1, '250 fresh entries kept + the new one');
});
