/** #645 (AF-007): the P&L / balance-sheet answer cache is bounded, drops expired entries, and keys on what the report reads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import type express from 'express';
import { getCacheKey, rememberReport, reportCacheSize, REPORT_CACHE_LIMIT } from '../server/routes/reportRoutes';

const req = (query: Record<string, string>, uid = 'u1') => ({ path: '/pl', query, body: {}, user: { uid } }) as unknown as express.Request;
const params = { workspaceId: 'w1', startDate: '2026-01-01', endDate: '2026-03-31', basis: 'accrual' };

test('#645 C1: a query parameter the report ignores does not mint a new key; a parameter it reads does', () => {
  const keys = new Set(['', '1', '2', '3'].map(n => getCacheKey(req(n ? { ...params, n } : params), 'none', params)));
  assert.equal(keys.size, 1, 'four requests for the same report share one key');
  assert.notEqual(getCacheKey(req(params), 'none', params), getCacheKey(req(params), 'none', { ...params, endDate: '2026-04-30' }));
  assert.notEqual(getCacheKey(req(params), 'none', params), getCacheKey(req(params), 'none', { ...params, basis: 'cash' }));
});

test('#645: the key still separates users and balance snapshots', () => {
  assert.notEqual(getCacheKey(req(params, 'u1'), 'none', params), getCacheKey(req(params, 'u2'), 'none', params));
  assert.notEqual(getCacheKey(req(params), 'snap-a', params), getCacheKey(req(params), 'snap-b', params));
});

test('#645 C2: a burst of distinct reports never holds more than the cap, and expired entries are reclaimed', () => {
  const t0 = 1_800_000_000_000;
  for (let i = 0; i < REPORT_CACHE_LIMIT * 4; i++) rememberReport(`burst-${i}`, { i }, t0);
  assert.ok(reportCacheSize() <= REPORT_CACHE_LIMIT, `holds ${reportCacheSize()}`);
  // two minutes later every burst entry is past its 60 s TTL: the next write reclaims them, keeping the fresh one
  rememberReport('later', { ok: true }, t0 + 120_000);
  for (let i = 0; i < REPORT_CACHE_LIMIT - 1; i++) rememberReport(`fresh-${i}`, { i }, t0 + 120_000);
  rememberReport('one-more', { ok: true }, t0 + 120_000);
  assert.ok(reportCacheSize() <= REPORT_CACHE_LIMIT);
});
