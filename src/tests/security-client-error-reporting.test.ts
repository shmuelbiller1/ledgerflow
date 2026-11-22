/**
 * Agent #6 (security lane) — AF6-20261120-03: one crash-report path, and it asks first.
 *
 * `index.html` used to carry an inline reporter: on every `error` and `unhandledrejection` it POSTed
 * the message and the raw stack to `/api/health`. That route has only ever been a `GET`, so the
 * report was answered 404 and nothing was recorded, while the stack — which can name a customer, an
 * invoice number or a private path — still left the browser. It also had no consent check and no
 * redaction, unlike the app's own tracker, which asks (`isOptionalTelemetryAllowed`), redacts
 * (`redactForLogs`), de-duplicates and clears itself at an account/workspace boundary.
 *
 * The inline reporter is gone. This file keeps the two halves that matter from coming back: an inline
 * script in `index.html` that reports by itself, and error tracking that starts after render instead
 * of before it.
 *
 * Evidence: docs/verification/ai6-2026-11-20.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { APP_INLINE_SCRIPT_HASHES, inlineScriptHashes } from '../server/http/contentSecurityPolicy';

const read = (...parts: string[]) => fs.readFileSync(path.join(process.cwd(), ...parts), 'utf8');

test('AF6-20261120-03: index.html ships no inline script and no reporter of its own', () => {
  const html = read('index.html');
  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>/gi)].filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes));
  assert.deepEqual(inlineScripts.map(m => m[0]), [], 'index.html has an inline <script>: route it through errorTracker, or hash it in APP_INLINE_SCRIPT_HASHES');
  assert.deepEqual(inlineScriptHashes(html), APP_INLINE_SCRIPT_HASHES, 'the page hashes and APP_INLINE_SCRIPT_HASHES must agree');
  assert.equal(html.includes('/api/health'), false, 'the page must not post errors to the health endpoint');
});

test('AF6-20261120-03: the app\'s own tracker starts before the first render', () => {
  const main = read('src', 'main.tsx');
  const started = main.indexOf('initGlobalErrorTracking(');
  const rendered = main.indexOf('createRoot(');
  assert.ok(started > -1, 'main.tsx still starts the error tracker');
  assert.ok(rendered > -1, 'main.tsx still renders the app');
  assert.ok(started < rendered, 'the tracker must listen before the tree renders, or an early crash is lost');
});

test('AF6-20261120-03: what is reported is gated on consent and redacted', () => {
  const tracker = read('src', 'lib', 'errorTracker.ts');
  assert.match(tracker, /isOptionalTelemetryAllowed/, 'reporting is still gated on the visitor\'s choice');
  assert.match(tracker, /redactForLogs/, 'records are still redacted before they are sent');
  // The scope guard: a buffer or group must not carry one account's crash into another's view.
  assert.match(tracker, /useAuthStore\.subscribe/, 'the tracker still clears at the account/workspace boundary');
});
