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
import { createAppRateLimiters, isVerifiedApiKeyRequest } from '../server/middleware/rateLimiters';
import { openApiDocument } from '../server/openapi';

interface ZapEvalAlert {
  pluginid: string;
  alertRef?: string;
  name?: string;
}
interface ZapEvalResult {
  passed: boolean;
  actionable: ZapEvalAlert[];
  acceptedBaseline: ZapEvalAlert[];
  lowAndInfo: ZapEvalAlert[];
  errors: string[];
}
interface ZapEvalModule {
  classifyZapAlert: (alert: Record<string, unknown>, optionsOrOrigin?: Record<string, unknown> | string) => { accepted: boolean; reason?: string };
  evaluateZapReportJson: (raw: string, options?: { cspRollout?: string }) => ZapEvalResult;
  formatZapSummaryMarkdown: (result: ZapEvalResult) => string;
}
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — runtime ESM script in scripts/ evaluated directly by zap-baseline.yml under node
import * as zapEvalRaw from '../../scripts/evaluate-zap-report.mjs';
const { classifyZapAlert, evaluateZapReportJson, formatZapSummaryMarkdown } = zapEvalRaw as unknown as ZapEvalModule;

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

test('SEC-NEW-03: verified API keys bypass the 100/min IP ceiling, while forged lf_ headers on public or 401 routes remain IP-throttled', async () => {
  assert.equal(isVerifiedApiKeyRequest({ user: { usedApiKeyId: 'lf_id_ws_demo_0123456789abcdef' } }), true);
  assert.equal(isVerifiedApiKeyRequest({ user: {} }), false);
  assert.equal(isVerifiedApiKeyRequest({}), false);

  const app = express();
  const { limiter, apiLimiter } = createAppRateLimiters();
  app.use('/api/', limiter);
  app.use('/api/v1', apiLimiter);
  app.get('/api/v1/protected', (req, res) => {
    if (req.headers.authorization === `Bearer ${VALID_SAMPLE_KEY}`) {
      (req as express.Request & { user?: { usedApiKeyId: string } }).user = {
        usedApiKeyId: 'lf_id_ws_demo_0123456789abcdef',
      };
      return res.status(200).json({ ok: true });
    }
    return res.status(401).json({ status: 'error', message: 'Invalid API key' });
  });
  // Public route under /api/v1 that does not run apiAuthenticate (e.g. invite lookup returning 404)
  app.get('/api/v1/invites/:token', (_req, res) => {
    return res.status(404).json({ error: 'Invite not found' });
  });

  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // 1. Authenticated API key (`req.user.usedApiKeyId` set) exceeds 100 req/min without IP 429
    const okStatuses: number[] = [];
    for (let i = 0; i < 115; i += 1) {
      const r = await fetch(`${base}/api/v1/protected`, {
        headers: { Authorization: `Bearer ${VALID_SAMPLE_KEY}` },
      });
      okStatuses.push(r.status);
    }
    assert.ok(okStatuses.every(code => code === 200), `Expected 115 x 200 for verified API key, got ${new Set(okStatuses).size} distinct codes`);

    // 2. Forged structured lf_ header sent to a PUBLIC /api/v1 route MUST remain capped at 100/min/IP
    const badKey = `lf_id_ws_forged_abcdef0123456789.${'b'.repeat(64)}`;
    let saw429OnPublicRoute = false;
    for (let i = 0; i < 105; i += 1) {
      const r = await fetch(`${base}/api/v1/invites/probe-${i}`, {
        headers: { Authorization: `Bearer ${badKey}` },
      });
      if (r.status === 429) {
        saw429OnPublicRoute = true;
        break;
      }
      assert.equal(r.status, 404);
    }
    assert.equal(saw429OnPublicRoute, true, 'Forged lf_ header on public /api/v1/invites route must still hit 100/min IP 429');
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
  const schemathesisInstall = apiFuzz.match(/^\s*run:\s*python -m pip install.*$/m)?.[0] || '';
  // YAML reads the colon-space in `--only-binary :all:` as a mapping delimiter and rejects this workflow.
  assert.match(schemathesisInstall, /--only-binary=['"]:all:['"]/);
  assert.doesNotMatch(schemathesisInstall, /--only-binary\s+:all:/);
  assert.match(apiFuzz, /continue-on-error:\s*true/);
  assert.match(apiFuzz, /http:\/\/127\.0\.0\.1:3000\/api\/v1\/openapi\.json/);
  assert.match(apiFuzz, /--url http:\/\/127\.0\.0\.1:3000\b/);
  assert.match(apiFuzz, /APP_URL=http:\/\/127\.0\.0\.1:3000/);
  assert.match(apiFuzz, /::add-mask::\$FUZZ_API_KEY/);
  assert.doesNotMatch(apiFuzz, /keyHashAlg:\s*['"]scrypt-v1['"]/);
  const apiFuzzTriggers = apiFuzz.match(/^on:\r?\n([\s\S]*?)(?=^[A-Za-z_][A-Za-z0-9_-]*:)/m)?.[1] || '';
  assert.match(apiFuzzTriggers, /^ {2}push:\s*$/m);
  assert.match(apiFuzzTriggers, /^ {2}pull_request:\s*$/m);
  assert.match(apiFuzzTriggers, /^ {2}workflow_dispatch:\s*$/m);
  assert.match(apiFuzzTriggers, /^ {4}branches:\s*\[main\]\s*$/m);

  assert.match(zapBaseline, /ghcr\.io\/zaproxy\/zaproxy:2\.16\.1/);
  const zapTriggers = zapBaseline.match(/^on:\r?\n([\s\S]*?)(?=^[A-Za-z_][A-Za-z0-9_-]*:)/m)?.[1] || '';
  assert.match(zapTriggers, /^ {2}schedule:\s*$/m);
  assert.match(zapTriggers, /^ {2}workflow_dispatch:\s*$/m);
  assert.doesNotMatch(zapTriggers, /^ {2}pull_request:\s*$/m);
  assert.match(zapBaseline, /APP_URL=http:\/\/127\.0\.0\.1:3000/);
  assert.match(zapBaseline, /node build\/server\.cjs/);
  assert.doesNotMatch(zapBaseline, /tsx server\.ts/);
  // #762: runner UID 1001 vs container `zap` UID 1000 broke /home/zap/zap.yaml; never override `-u`.
  assert.doesNotMatch(zapBaseline, /-u\s+["']?\$\(id -u\)/);
  assert.match(zapBaseline, /sudo chown -R 1000:1000 zap-out/);
  assert.doesNotMatch(zapBaseline, /chmod\s+[01]?777/);
  assert.match(zapBaseline, /-z\s+"-silent"/);
  assert.match(zapBaseline, /test -s zap-out\/zap-report\.json/);
  assert.match(zapBaseline, /node scripts\/evaluate-zap-report\.mjs/);
  assert.match(zapBaseline, /http:\/\/127\.0\.0\.1:3000/);
  assert.doesNotMatch(zapBaseline, /https:\/\/.*ledgerflow/i);

  assert.match(apiFuzz, /runs-on:\s*ubuntu-24\.04/);
  assert.match(zapBaseline, /runs-on:\s*ubuntu-24\.04/);
  assert.match(apiFuzz, /image:\s*postgres:17\.12\b/);
  assert.match(zapBaseline, /image:\s*postgres:17\.12\b/);
  assert.match(apiFuzz, /node-version:\s*24\.22\.3\b/);
  assert.match(zapBaseline, /node-version:\s*24\.22\.3\b/);
  assert.match(apiFuzz, /python-version:\s*'3\.11\.18'/);

  const scannerActionRefs = [apiFuzz, zapBaseline]
    .flatMap(workflow => [...workflow.matchAll(/^\s*uses:\s*(\S+)/gm)].map(match => match[1]));
  const expectedPinnedActions = [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1',
    'actions/setup-python@6d4fd22b20465ccc0f7354476588e8df7c9ca0e0',
    'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9',
  ];
  assert.equal(scannerActionRefs.length, 7);
  for (const actionRef of scannerActionRefs) {
    assert.match(actionRef, /^[^@]+@[0-9a-f]{40}$/,
      `Scanner action reference must be pinned to a full commit SHA: ${actionRef}`);
  }
  for (const expectedRef of expectedPinnedActions) {
    assert.ok(scannerActionRefs.includes(expectedRef), `Missing immutable scanner action pin ${expectedRef}`);
  }

  // Broad CSP (10055) and Cross-Domain JS (10017) rules must NEVER be muted in `.zap/rules.tsv`.
  const ruleLines = zapRules.split('\n');
  const broadlyMutedForbidden = new Set(['10055', '10017', '10038', '10020', '40012', '40018']);
  let activeRuleCount = 0;
  for (let idx = 0; idx < ruleLines.length; idx += 1) {
    const trimmed = ruleLines[idx].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    activeRuleCount += 1;
    const cols = trimmed.split('\t');
    assert.ok(cols.length >= 2 && cols.length <= 3, `.zap/rules.tsv line ${idx + 1} must have 2-3 tab-separated columns`);
    assert.match(cols[0], /^\d+$/);
    assert.ok(['IGNORE', 'INFO', 'WARN', 'FAIL'].includes(cols[1]));
    assert.equal(broadlyMutedForbidden.has(cols[0]), false, `Rule ${cols[0]} must not be suppressed wholesale in .zap/rules.tsv`);
    const prevComment = ruleLines[idx - 1]?.trim() || '';
    assert.ok(prevComment.startsWith('#'), `.zap/rules.tsv rule ${cols[0]} must be preceded by an explanatory comment`);
  }
  assert.ok(activeRuleCount >= 1);
});

test('SEC-SCAN-1: evaluate-zap-report fails closed on corrupt reports and blocks unexpected CSP or third-party script alerts', () => {
  assert.throws(() => evaluateZapReportJson(''), /empty or missing/i);
  assert.throws(() => evaluateZapReportJson('{bad'), /parsed/i);
  assert.throws(() => evaluateZapReportJson(JSON.stringify({ '@version': '2.16.1', site: [] })), /no scanned site/i);

  // Documented loopback S-23 baseline + allowlisted Plaid script + Low 10063 -> PASS with full visibility
  const baselineReport = JSON.stringify({
    '@version': '2.16.1',
    '@generated': '2026-11-18T02:00:00Z',
    site: [{
      '@name': 'http://127.0.0.1:3000',
      alerts: [
        {
          pluginid: '10055',
          alertRef: '10055-6',
          riskcode: '2',
          riskdesc: 'Medium (High)',
          name: 'CSP: style-src unsafe-inline',
          instances: [{ uri: 'http://127.0.0.1:3000/' }],
        },
        {
          pluginid: '10055',
          alertRef: '10055-5',
          riskcode: '2',
          riskdesc: 'Medium (High)',
          name: 'CSP: script-src unsafe-inline',
          instances: [{ uri: 'http://127.0.0.1:3000/' }],
        },
        {
          pluginid: '10055',
          alertRef: '10055-4',
          riskcode: '2',
          riskdesc: 'Medium (High)',
          name: 'CSP: Wildcard Directive',
          otherinfo: 'The following directives either allow wildcard sources (or ancestors), are not defined, or are overly broadly defined:\nimg-src',
          instances: [{ uri: 'http://127.0.0.1:3000/' }],
        },
        {
          pluginid: '10017',
          alertRef: '10017',
          riskcode: '1',
          riskdesc: 'Low (Medium)',
          name: 'Cross-Domain JavaScript Source File Inclusion',
          instances: [{ uri: 'http://127.0.0.1:3000/', param: 'https://cdn.plaid.com/link/v2/stable/link-initialize.js' }],
        },
        {
          pluginid: '10063',
          alertRef: '10063-1',
          riskcode: '1',
          riskdesc: 'Low (Medium)',
          name: 'Permissions Policy Header Not Set',
          instances: [{ uri: 'http://127.0.0.1:3000/' }],
        },
      ],
    }],
  });
  const okResult = evaluateZapReportJson(baselineReport, { cspRollout: 'report-only' });
  assert.equal(okResult.passed, true);
  assert.equal(okResult.actionable.length, 0);
  assert.equal(okResult.acceptedBaseline.length, 3);
  assert.equal(okResult.lowAndInfo.length, 2);
  assert.match(formatZapSummaryMarkdown(okResult), /PASS/);
  assert.match(formatZapSummaryMarkdown(okResult), /10063-1/);

  // Under S-23 `enforce`, script-src unsafe-inline MUST fail!
  const enforceResult = evaluateZapReportJson(baselineReport, { cspRollout: 'enforce' });
  assert.equal(enforceResult.passed, false);
  assert.deepEqual(enforceResult.actionable.map(a => a.alertRef), ['10055-5']);

  // CSP wildcard in script-src / connect-src / frame-ancestors, unsafe-eval, malformed CSP, and unknown CDN script MUST all fail!
  assert.equal(
    classifyZapAlert({
      pluginid: '10055',
      alertRef: '10055-4',
      riskcode: '2',
      name: 'CSP: Wildcard Directive',
      otherinfo: 'The following directives either allow wildcard sources: img-src, script-src',
      instances: [{ uri: 'http://127.0.0.1:3000/' }],
    }, 'http://127.0.0.1:3000').accepted,
    false,
  );
  assert.equal(
    classifyZapAlert({
      pluginid: '10055',
      alertRef: '10055-10',
      riskcode: '2',
      name: 'CSP: script-src unsafe-eval',
      instances: [{ uri: 'http://127.0.0.1:3000/' }],
    }, 'http://127.0.0.1:3000').accepted,
    false,
  );
  assert.equal(
    classifyZapAlert({
      pluginid: '10055',
      alertRef: '10055-9',
      riskcode: '2',
      name: 'CSP: Malformed Policy (Non-ASCII)',
      instances: [{ uri: 'http://127.0.0.1:3000/' }],
    }, 'http://127.0.0.1:3000').accepted,
    false,
  );
  assert.equal(
    classifyZapAlert({
      pluginid: '10017',
      alertRef: '10017',
      riskcode: '2',
      name: 'Cross-Domain JavaScript Source File Inclusion',
      instances: [
        { uri: 'http://127.0.0.1:3000/', param: 'https://js.stripe.com/v3/' },
        { uri: 'http://127.0.0.1:3000/', param: 'https://cdn.attacker.example/tracker.js' },
      ],
    }, 'http://127.0.0.1:3000').accepted,
    false,
  );
  assert.equal(
    classifyZapAlert({
      pluginid: '10017',
      alertRef: '10017',
      riskcode: '2',
      name: 'Cross-Domain JavaScript Source File Inclusion',
      instances: [
        { uri: 'http://127.0.0.1:3000/', param: 'https://js.stripe.com/v3/' },
        { uri: 'http://127.0.0.1:3000/', evidence: '<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>' },
      ],
    }, 'http://127.0.0.1:3000').accepted,
    true,
  );
  assert.equal(
    classifyZapAlert({
      pluginid: '10038',
      alertRef: '10038-1',
      riskcode: '2',
      name: 'Content Security Policy (CSP) Header Not Set',
      instances: [{ uri: 'http://127.0.0.1:3000/' }],
    }, 'http://127.0.0.1:3000').accepted,
    false,
  );
});
