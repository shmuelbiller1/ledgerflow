/**
 * Agent #6 probe (2026-11-10) — S-7/S-8 route-guard proof, read from source.
 *
 * `src/tests/route-policy-coverage.test.ts` (D-30, on main) decides a route file is "guarded"
 * when the file TEXT contains one of a set of words anywhere — including
 * `authenticate`, `requireAdmin`, `CRON_SECRET`, `requireSystemAdmin`.
 * In `adminRoutes.ts` two handlers carry NO middleware at all and rely on an in-handler
 * `isSystemJobAuthorized(...)` check, while every other route in the same file does carry
 * `authenticate, requireAdmin`. The file-level word test cannot tell those apart.
 *
 * This probe reads the individual `app.<verb>("/path", <middleware...>, handler)` registrations
 * and asserts the middleware on each. It is the shortest reproduction of the gap between what
 * the D-30 test proves and what it appears to prove.
 *
 * Run: NODE_ENV=test npx tsx --test audit/agent6-2026-11-10/probes/s7-route-guards.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROUTES = path.join(process.cwd(), 'src/server/routes');

/** Middleware names declared on one `app.<verb>("path", ...)` registration line. */
function middlewareOf(line: string): string[] {
  const m = /app\.(get|post|put|patch|delete|use)\(\s*(?:\[[^\]]*\]|"[^"]*"|'[^']*')\s*,([\s\S]*)$/.exec(line);
  if (!m) return [];
  const rest = m[2];
  const names: string[] = [];
  // middleware arguments up to the first `async (` / `(req` / arrow — the handler
  for (const part of splitTopLevel(rest)) {
    const p = part.trim();
    if (/^(async\s*)?\(?\s*(req|_req)\b\s*[:,)]/.test(p) || /^(async\s*)?\(\s*req\b/.test(p)) break;
    const name = /^([A-Za-z_$][\w$]*)/.exec(p)?.[1];
    if (name) names.push(name);
    else break;
  }
  return names;
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const linesOf = (file: string) => fs.readFileSync(path.join(ROUTES, file), 'utf8').split('\n');

test('every adminRoutes.ts registration carries authenticate + requireAdmin, except the documented cron-secret pair', () => {
  const registrations = linesOf('adminRoutes.ts')
    .map(l => l.trim())
    .filter(l => /^app\.(get|post|put|patch|delete)\(/.test(l));
  assert.ok(registrations.length >= 10, `found ${registrations.length} registrations`);

  const unguarded: string[] = [];
  for (const line of registrations) {
    const mw = middlewareOf(line);
    const authed = mw.includes('authenticate') || mw.includes('apiAuthenticate');
    const admin = mw.includes('requireAdmin');
    if (!authed || !admin) unguarded.push(`${line.slice(0, 90)}   [middleware: ${mw.join(', ') || 'none'}]`);
  }

  // OBSERVED on main dc40739: three registrations do not carry both guards —
  //  two with no middleware at all (they authorise inside the handler with isSystemJobAuthorized),
  //  and the integrity scan with `authenticate` only (no platform-admin check).
  assert.deepEqual(unguarded.length, 3, `registrations without authenticate+requireAdmin:\n${unguarded.join('\n')}`);
  assert.match(unguarded[0], /\/api\/v1\/system\/recurring\/process/);
  assert.match(unguarded[1], /\/api\/v1\/system\/telemetry\/errors\/digest/);
  assert.match(unguarded[2], /\/api\/v1\/admin\/integrity\/orphan-scan/);
});

test('the two unguarded routes do authorise in-handler (this is why they are P3, not P0)', () => {
  const src = fs.readFileSync(path.join(ROUTES, 'adminRoutes.ts'), 'utf8');
  for (const route of ['/api/v1/system/recurring/process', '/api/v1/system/telemetry/errors/digest']) {
    const at = src.indexOf(route);
    const body = src.slice(at, at + 2200);
    assert.match(body, /isSystemJobAuthorized\(/, `${route} must call isSystemJobAuthorized`);
    assert.match(body, /verifyIdToken\(/, `${route} must verify the bearer token itself`);
    assert.match(body, /cronSecret/, `${route} must compare CRON_SECRET`);
  }
});

test('the admin integrity scan (orphan-scan) is behind authenticate but NOT requireAdmin', () => {
  const line = linesOf('adminRoutes.ts').map(l => l.trim())
    .find(l => l.includes('/api/v1/admin/integrity/orphan-scan'));
  assert.ok(line, 'route present');
  const mw = middlewareOf(line!);
  assert.deepEqual(mw, ['authenticate'],
    'OBSERVED: authenticate only — a workspace member may call a platform-admin route');
});

test('route-policy-coverage.test.ts cannot see the difference: it passes on file-level words', () => {
  const test_ = fs.readFileSync(path.join(process.cwd(), 'src/tests/route-policy-coverage.test.ts'), 'utf8');
  // the word list that decides "guarded"
  assert.match(test_, /content\.includes\('authenticate'\)/);
  assert.match(test_, /content\.includes\('requireAdmin'\)/);
  // and it reads the whole file, not the registration
  assert.match(test_, /const content = fs\.readFileSync\(filePath, 'utf8'\)/);
});
