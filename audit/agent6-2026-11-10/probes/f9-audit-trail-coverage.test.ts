/**
 * Agent #6 probe (2026-11-10) — F-09: the audit trail does not cover the writes that keep the books.
 *
 * Three separate facts, each asserted against the SHIPPED code at the pin
 * (dc40739708a013ad080ffb306fe461554a2391fc). Nothing is re-implemented.
 *
 * 1. Most routes that persist money in a handler never write an audit entry in that handler.
 *    Measured over the real registrations in src/server/routes/*.ts.
 * 2. The "last sign-in" column of Settings → Security → Access review, and the USER_LOGIN rows of
 *    the audit evidence pack, read `auditLogs` rows with action `USER_LOGIN`. The server never writes
 *    such a row: `recordAuthEvent` writes `loginAudits` with `event: 'login'`, and the only
 *    `USER_LOGIN` writer in the tree is a browser `addDoc` in `useLedgerData` — and the browser
 *    Firestore shim has no `addDoc`/`CollectionReference.add` at all.
 * 3. `loginAudits` is written by the server and read by no route: the security screen cannot show a
 *    sign-in recorded by the only writer that exists.
 *
 * Run: NODE_ENV=test npx tsx --test audit/agent6-2026-11-10/probes/f9-audit-trail-coverage.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const ROUTES = path.join(ROOT, 'src/server/routes');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const REG = /\b(?:app|router|workspaceRouter|emailWebhookRouter|[a-zA-Z]+Router)\s*\.\s*(post|put|patch|delete)\s*\(\s*(['"`])(.*?)\2/g;
const WRITE = /\.doc\([^)]*\)\s*\.\s*(?:set|update|delete)\(|\.add\(|batch\.commit|\.commit\(\)|runTransaction|FieldValue\.(?:serverTimestamp|arrayUnion|increment)|insert into|UPDATE /i;
const AUDIT = /writeServerAuditLog\s*\(|writeAuditLog\s*\(/;

function persistingHandlers() {
  const out: { file: string; method: string; route: string; audited: boolean }[] = [];
  for (const file of readdirSync(ROUTES).filter(f => f.endsWith('.ts'))) {
    const src = readFileSync(path.join(ROUTES, file), 'utf8');
    const starts = [...src.matchAll(REG)];
    starts.forEach((m, i) => {
      const body = src.slice(m.index! + m[0].length, i + 1 < starts.length ? starts[i + 1].index! : src.length);
      if (!WRITE.test(body)) return;
      out.push({ file, method: m[1].toUpperCase(), route: m[3], audited: AUDIT.test(body) });
    });
  }
  return out;
}

test('F-09a: most money-writing handlers never write an audit entry', () => {
  const all = persistingHandlers();
  const audited = all.filter(h => h.audited);
  const pct = (100 * audited.length) / all.length;

  // The point is the ratio, not a brittle number: assert the finding still holds.
  assert.ok(all.length >= 25, `expected >= 25 persisting write handlers, found ${all.length}`);
  assert.ok(pct < 50, `audit coverage is now ${pct.toFixed(1)}% — F-09a may be fixed, re-read the finding`);

  // Spot-check handlers that post double-entry journals and are known to be unaudited.
  const unaudited = new Set(all.filter(h => !h.audited).map(h => `${h.method} ${h.route}`));
  for (const route of ['POST /capitalize', 'POST /recognize', 'POST /cogs', 'POST /api/v1/ledger']) {
    assert.ok(unaudited.has(route),
      `expected ${route} to be unaudited; got ${[...unaudited].join(' | ')}`);
  }
  console.log(`F-09a: ${audited.length}/${all.length} persisting write handlers audit (${pct.toFixed(1)}%)`);
});

test('F-09b: the server never writes the USER_LOGIN row the security screens read', () => {
  const readers = read('src/lib/accessReview.ts');
  assert.match(readers, /action === 'USER_LOGIN'/, 'access review still looks for USER_LOGIN');

  // The only USER_LOGIN writer in the tree is the browser hook.
  const hook = read('src/hooks/useLedgerData.ts');
  assert.match(hook, /action: 'USER_LOGIN'/);
  assert.match(hook, /addDoc\(collection\(db, 'auditLogs'\)/);
  // The call is started with `void` and only console.errors its own failure, so a refusal is silent.
  assert.match(hook, /void addDoc\(collection\(db, 'auditLogs'\)/, 'USER_LOGIN write is still fire-and-forget');
  assert.match(hook, /\.catch\(err => console\.error\('Failed to write login audit:'/);

  // The shim DOES have addDoc, so the row can be written — but only through the member_insert policy.
  const shim = read('src/lib/db/firestore.ts');
  assert.match(shim, /export async function addDoc\b/, 'shim lost addDoc — re-read F-09b');

  // The database decides whether that insert lands: a viewer may only write action = USER_LOGIN, and
  // auditLogs is insert-only (no update or delete policy), which is the half of the design that is right.
  const sql = read('supabase/migrations/20260924190000_init.sql');
  assert.match(sql, /create policy member_insert on public\."auditLogs" for insert to authenticated/);
  assert.match(sql, /public\.lf_can_write\(workspace_id\) or data->>'action' = 'USER_LOGIN'/,
    'the "only sign-ins from a viewer" carve-out is gone');
  assert.doesNotMatch(sql, /create policy \w+ on public\."auditLogs" for (update|delete)/,
    'auditLogs gained an update/delete policy — append-only may be broken');

  // The server's own auth audit writes to a different collection under a different event name.
  const server = read('src/server/services/authAuditService.ts');
  assert.match(server, /collection\('loginAudits'\)/);
  assert.doesNotMatch(server, /USER_LOGIN/);
});

test('F-09c: loginAudits has no reader and no policy: the one real sign-in record is write-only', () => {
  const routes = readdirSync(ROUTES).filter(f => f.endsWith('.ts'));
  const readers = routes.filter(f => /loginAudits/.test(readFileSync(path.join(ROUTES, f), 'utf8')));
  assert.deepEqual(readers, [], `a route now reads loginAudits (${readers.join(', ')}) — F-09c may be fixed`);

  const users = read('src/server/services/personalDataService.ts');
  assert.match(users, /loginAudits/, 'personal-data export still reads loginAudits (that is the one consumer)');

  // And no RLS policy was ever written for it, so not even a member can read their own sign-ins.
  const sql = read('supabase/migrations/20260924190000_init.sql');
  const policies = [...sql.matchAll(/create policy \w+ on public\."?(\w+)"? for/g)].map(m => m[1]);
  assert.equal(policies.includes('loginAudits'), false, 'loginAudits gained a policy — F-09c may be fixed');
  assert.match(sql, /'stripeProcessedEvents','idempotencyKeys','external_api_cache','jobRuns','loginAudits'/,
    'loginAudits is still declared server-only');
});
