/**
 * SEC-SCAN-1 + API Hardening Contracts (Agent #6, 2026-11-16):
 *  - SEC-NEW-02 (ST105): JSON body-parser syntax and 413 payload errors return structured JSON
 *    without HTML stack traces or server filesystem paths.
 *  - SEC-NEW-03 (Z-02): Syntactically valid `/api/v1/*` API-key traffic bypasses the 100/min IP
 *    ceiling so per-key `rateLimitPerMinute` (up to 10,000/min) governs, while forged/invalid
 *    `lf_` keys (401) remain throttled at 60/min/IP.
 *  - API-NEW-02 (ST103): OpenAPI 3.1 operations document standard 400/401/403/429 JSON error
 *    responses (plus 413/422 on JSON body operations).
 *  - SEC-SCAN-1: Schemathesis PR/push workflow, nightly OWASP ZAP baseline workflow, and
 *    `.zap/rules.tsv` follow exact-pinning, local-target-only, and zero-secret rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { applyJsonBodyParser } from '../server/http/securityMiddleware';
import { requireOpenPeriod } from '../server/middleware/periodLock';
import { requireLedgerWriter } from '../server/middleware/requireLedgerWriter';
import { createAppRateLimiters, hasStructuredApiKeyHeader } from '../server/middleware/rateLimiters';
import { openApiDocument } from '../server/openapi';

const VALID_SAMPLE_KEY = `lf_id_ws_demo_0123456789abcdef.${'a'.repeat(64)}`;

test('SEC-NEW-02: malformed, primitive, and oversized JSON bodies return JSON without stack traces', async () => {
  const app = express();
  applyJsonBodyParser(app);
  app.post('/api/v1/transactions', (req, res) => {
    res.status(200).json({ ok: true, body: req.body });
  });

  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    for (const badBody of ['"AAA"', '{bad json', '12345']) {
      const res = await fetch(`${base}/api/v1/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: badBody,
      });
      assert.equal(res.status, 400);
      assert.match(String(res.headers.get('content-type') || ''), /application\/json/i);
      const text = await res.text();
      assert.doesNotMatch(text, /<!DOCTYPE html>|SyntaxError|node_modules|body-parser/i);
      const parsed = JSON.parse(text) as { status?: string; message?: string };
      assert.equal(parsed.status, 'error');
      assert.match(String(parsed.message || ''), /Malformed JSON/i);
    }

    const oversized = JSON.stringify({ pad: 'x'.repeat(1_150_000) });
    const tooLarge = await fetch(`${base}/api/v1/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversized,
    });
    assert.equal(tooLarge.status, 413);
    assert.match(String(tooLarge.headers.get('content-type') || ''), /application\/json/i);
    const tooLargeText = await tooLarge.text();
    assert.doesNotMatch(tooLargeText, /<!DOCTYPE html>|PayloadTooLargeError|node_modules/i);

    const nulByte = await fetch(`${base}/api/v1/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"workspaceId":"ws_1\\u0000bad"}',
    });
    assert.equal(nulByte.status, 400);
    assert.match(String(nulByte.headers.get('content-type') || ''), /application\/json/i);
    assert.match(await nulByte.text(), /NUL bytes/i);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('SEC-NEW-05: periodLock and requireLedgerWriter reject non-string or slash-containing workspaceId with 400 JSON instead of 500', async () => {
  const app = express();
  applyJsonBodyParser(app);
  app.use((req, _res, next) => {
    (req as express.Request & { user?: { uid: string } }).user = { uid: 'user_test_1' };
    next();
  });
  app.post('/api/v1/transactions', requireLedgerWriter, requireOpenPeriod('transactions'), (_req, res) => {
    res.status(200).json({ ok: true });
  });

  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const payload of [
      { workspaceId: {} },
      { transaction: { workspaceId: {} } },
      { workspaceId: 'ws/subcollection' },
    ]) {
      const res = await fetch(`${base}/api/v1/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(res.status, 400);
      assert.match(String(res.headers.get('content-type') || ''), /application\/json/i);
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('SEC-NEW-03: structured API keys bypass the 100/min IP ceiling when authenticated, while 401 key brute-force stays throttled', async () => {
  assert.equal(
    hasStructuredApiKeyHeader({
      originalUrl: '/api/v1/transactions?workspaceId=ws_1',
      headers: { authorization: `Bearer ${VALID_SAMPLE_KEY}` },
    }),
    true,
  );
  assert.equal(
    hasStructuredApiKeyHeader({
      originalUrl: '/api/v1/transactions',
      headers: { authorization: 'Bearer short.not64hex' },
    }),
    false,
  );
  assert.equal(
    hasStructuredApiKeyHeader({
      originalUrl: '/api/health',
      headers: { authorization: `Bearer ${VALID_SAMPLE_KEY}` },
    }),
    false,
  );

  const app = express();
  const { limiter, apiLimiter } = createAppRateLimiters();
  app.use('/api/', limiter);
  app.use('/api/v1', apiLimiter);
  app.get('/api/v1/ping', (req, res) => {
    if (req.headers.authorization === `Bearer ${VALID_SAMPLE_KEY}`) {
      return res.status(200).json({ ok: true });
    }
    if (req.headers.authorization?.startsWith('Bearer lf_')) {
      return res.status(401).json({ status: 'error', message: 'Invalid API key' });
    }
    return res.status(200).json({ ok: true, mode: 'anonymous' });
  });

  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // 1. Authenticated structured API key exceeds 100 req/min without IP 429
    const okStatuses: number[] = [];
    for (let i = 0; i < 115; i += 1) {
      const r = await fetch(`${base}/api/v1/ping`, {
        headers: { Authorization: `Bearer ${VALID_SAMPLE_KEY}` },
      });
      okStatuses.push(r.status);
    }
    assert.ok(okStatuses.every(code => code === 200), `Expected 115 x 200 for valid API key, got ${new Set(okStatuses).size} distinct codes`);

    // 2. Forged structured API key returning 401 is throttled after 60 failed attempts/min
    const badKey = `lf_id_ws_forged_abcdef0123456789.${'b'.repeat(64)}`;
    let saw429OnForgedKey = false;
    for (let i = 0; i < 65; i += 1) {
      const r = await fetch(`${base}/api/v1/ping`, {
        headers: { Authorization: `Bearer ${badKey}` },
      });
      if (r.status === 429) {
        saw429OnForgedKey = true;
        break;
      }
      assert.equal(r.status, 401);
    }
    assert.equal(saw429OnForgedKey, true, 'Forged API-key 401 brute-force must hit 429');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('API-NEW-02: every OpenAPI 3.1 operation documents 400, 401, 403, and 429 JSON error responses', () => {
  const doc = openApiDocument();
  for (const [routePath, methods] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(methods as Record<string, { responses?: Record<string, unknown>; requestBody?: unknown }>)) {
      const responses = operation.responses || {};
      for (const code of ['400', '401', '403', '429']) {
        assert.ok(responses[code], `${method.toUpperCase()} ${routePath} missing response ${code}`);
      }
      if (operation.requestBody) {
        assert.ok(responses['413'], `${method.toUpperCase()} ${routePath} with requestBody missing response 413`);
      }
    }
  }
});

test('SEC-SCAN-1: api-fuzz.yml, zap-baseline.yml, and .zap/rules.tsv satisfy pinning and safety invariants', () => {
  const root = process.cwd();
  const apiFuzz = fs.readFileSync(path.join(root, '.github/workflows/api-fuzz.yml'), 'utf8');
  const zapBaseline = fs.readFileSync(path.join(root, '.github/workflows/zap-baseline.yml'), 'utf8');
  const zapRules = fs.readFileSync(path.join(root, '.zap/rules.tsv'), 'utf8');

  assert.match(apiFuzz, /schemathesis==4\.33\.4/);
  assert.match(apiFuzz, /continue-on-error:\s*true/);
  assert.match(apiFuzz, /http:\/\/127\.0\.0\.1:3000\/api\/v1\/openapi\.json/);
  assert.match(apiFuzz, /actions\/upload-artifact@v4/);

  assert.match(zapBaseline, /ghcr\.io\/zaproxy\/zaproxy:2\.16\.1/);
  assert.match(zapBaseline, /schedule:/);
  assert.match(zapBaseline, /workflow_dispatch:/);
  assert.doesNotMatch(zapBaseline, /^\s*pull_request:/m);
  assert.match(zapBaseline, /http:\/\/127\.0\.0\.1:3000/);
  assert.doesNotMatch(zapBaseline, /https:\/\/.*ledgerflow/i);

  const ruleLines = zapRules.split('\n');
  let activeRuleCount = 0;
  for (let idx = 0; idx < ruleLines.length; idx += 1) {
    const trimmed = ruleLines[idx].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    activeRuleCount += 1;
    const cols = trimmed.split('\t');
    assert.ok(cols.length >= 2 && cols.length <= 3, `.zap/rules.tsv line ${idx + 1} must have 2-3 tab-separated columns`);
    assert.match(cols[0], /^\d+$/);
    assert.ok(['IGNORE', 'INFO', 'WARN', 'FAIL'].includes(cols[1]));
    const prevComment = ruleLines[idx - 1]?.trim() || '';
    assert.ok(prevComment.startsWith('#'), `.zap/rules.tsv rule ${cols[0]} must be preceded by an explanatory comment`);
  }
  assert.ok(activeRuleCount >= 1);
});
