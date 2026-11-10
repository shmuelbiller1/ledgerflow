/**
 * Agent #6 probe (2026-11-10) — F-10: a failed operation is frozen, and a retry of it is answered
 * with the cached *success* body.
 *
 * Three routes read their own idempotency record instead of going through the shared, tested
 * `executeIdempotent`/`createPaymentIdempotent` helpers. All three store the record with the same
 * shape (`{ response }`) and **no status field**, and all three answer a hit with
 * `res.json(record.response)` — the same 200, whatever the first attempt actually did:
 *
 *   POST /inventory/cogs          src/server/routes/inventoryRoutes.ts:52-56,153-160,178-182
 *   POST /leases/capitalize       src/server/routes/leaseRoutes.ts:45-50,104-112,116-121
 *   POST /revenue/recognize       src/server/routes/revenueRoutes.ts:46-51,105-113,117-125
 *
 * A first attempt that fails *after* the response body was built (two real reachable cases, both after
 * the board is built and before/inside the commit):
 *   - insufficient stock          `inventoryRoutes.ts:146`  → `Error('Insufficient inventory stock…')`
 *   - a closed period at commit    `assertPostingOpen` inside `ledgerBulkCommit`/the route's own commit
 *   - a concurrent second request  `idempSnap.exists` → `return` with the *other* request's response
 *
 * …never writes `idempotencyKeys/{ws}_inv_{key}`, so the retry is not a replay; it runs again. Conversely,
 * once the record *is* written, the route answers with `{status:'ok', message:'… recorded successfully'}` for
 * that key for ever — including when the caller's *intent* was to post something that has since been
 * deleted, or when a second, different quantity is sent under the same key. There is no payload hash on
 * this path, so "same key, different request" is not refused here (the tested helper at
 * `src/server/utils/idempotency.ts` does refuse it — that comparison is the fix).
 *
 * Severity is *not* "money is wrong twice"; it is "the client cannot tell a stored success from a
 * fresh one, and a key is not bound to a request". Two of the three handlers post to the general ledger.
 *
 * Run: NODE_ENV=test npx tsx --test audit/agent6-2026-11-10/probes/f10-handwritten-idempotency.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const ROUTES: [string, string, string][] = [
  ['src/server/routes/inventoryRoutes.ts', 'inv', 'COGS'],
  ['src/server/routes/leaseRoutes.ts', 'lease', 'lease'],
  ['src/server/routes/revenueRoutes.ts', 'rev', 'revenue'],
];

test('F-10a: the three handwritten idempotency records carry no status and no payload hash', () => {
  for (const [file, , label] of ROUTES) {
    const src = read(file);
    const block = src.match(/idempRef, \{\s*response: responsePayload,[\s\S]*?\}\);/) ??
                  src.match(/t\.set\(idempRef, \{[\s\S]*?\}\);/);
    assert.ok(block, `${file}: idempotency write not found — re-read F-10 before trusting it`);
    const written = block[0];
    assert.match(written, /response: responsePayload/, `${file} (${label}): shape changed, re-read`);
    assert.doesNotMatch(written, /\bstatus\s*:/, `${file}: the record now has a status — F-10a may be fixed`);
    assert.doesNotMatch(written, /payloadHash|hash\s*:/, `${file}: the record now binds a request hash — F-10a may be fixed`);
    // and the hit path answers with it unconditionally
    assert.match(src, /return res\.json\(idempDoc\.data\(\)\?\.response\)/,
      `${file}: the pre-check no longer replays blindly — F-10a may be fixed`);
  }
});

test('F-10b: the shared helper does bind a request to the key, which is the contrast', () => {
  const shared = read('src/server/utils/idempotency.ts');
  assert.match(shared, /export function deriveScopedOperationKey/);
  assert.match(shared, /export function requestPayloadHash/);
  const payments = read('src/server/services/paymentService.ts');
  assert.match(payments, /old\.payloadHash !== payloadHash/);
  assert.match(payments, /Idempotency key reused for different payment details or actor/);
  assert.match(payments, /status: 'success'/);
  // the three handwritten routes do not use either helper
  for (const [file] of ROUTES) {
    assert.doesNotMatch(read(file), /executeIdempotent|createPaymentIdempotent/,
      `${file} now uses the shared helper — F-10a/b may be fixed, re-run`);
  }
});

test('F-10c: the failure bodies those three handlers can answer are stable, and one of them is the stock check', () => {
  const inv = read('src/server/routes/inventoryRoutes.ts');
  // the check that can fail after the success payload exists
  assert.match(inv, /Insufficient inventory stock\. Requested \$\{quantitySold\}, available \$\{currentQty\}\./);
  // and the concurrent second request returns the FIRST request's answer without posting
  assert.match(inv, /if \(idempSnap\.exists\) \{\s*resultResponse = idempSnap\.data\(\)\?\.response \|\| responsePayload;\s*return;/);
  const lease = read('src/server/routes/leaseRoutes.ts');
  assert.match(lease, /if \(idempSnap\.exists\) \{\s*resultResponse = idempSnap\.data\(\)\?\.response \|\| responsePayload;\s*return;/);
  const rev = read('src/server/routes/revenueRoutes.ts');
  assert.match(rev, /idempSnap\.exists/);
});
