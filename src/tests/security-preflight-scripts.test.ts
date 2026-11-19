/**
 * S-24 & S-25: Unit and live HTTP verification for dependency-audit and
 * security-header preflight scripts (`scripts/check-dependency-audit.ts` and
 * `scripts/check-security-headers.ts`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { evaluateNpmAudit, parseAuditAllowlist } from '../../scripts/check-dependency-audit';
import {
  evaluateResponseHeaders,
  parseCspDirectives,
  validateTargetBaseUrl,
} from '../../scripts/check-security-headers';
import { applySecurityMiddleware } from '../server/http/securityMiddleware';

test('S-24: evaluateNpmAudit passes on zero high/critical production vulns and fails closed on high, critical, or corrupt input', () => {
  assert.throws(() => evaluateNpmAudit(''), /empty/i);
  assert.throws(() => evaluateNpmAudit('not-json'), /parse/i);
  assert.throws(() => evaluateNpmAudit(JSON.stringify({ error: { code: 'ENETUNREACH', summary: 'offline' } })), /ENETUNREACH/);

  const cleanProd = evaluateNpmAudit(JSON.stringify({
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } },
  }));
  assert.equal(cleanProd.passed, true);
  assert.equal(cleanProd.blocking.length, 0);

  const moderateOnly = evaluateNpmAudit(JSON.stringify({
    vulnerabilities: {
      qs: {
        severity: 'moderate',
        isDirect: false,
        fixAvailable: true,
        via: [{ title: 'arrayLimit bypass', url: 'https://github.com/advisories/GHSA-w7fw-mjwx-w883' }],
      },
    },
  }));
  assert.equal(moderateOnly.passed, true);
  assert.equal(moderateOnly.nonBlocking.length, 1);
  assert.match(moderateOnly.nonBlocking[0].advisories[0], /GHSA-w7fw-mjwx-w883/);

  const strictModerate = evaluateNpmAudit(
    JSON.stringify({
      vulnerabilities: {
        qs: { severity: 'moderate', isDirect: false, fixAvailable: true, via: ['body-parser'] },
      },
    }),
    { failOn: 'moderate' },
  );
  assert.equal(strictModerate.passed, false);
  assert.equal(strictModerate.blocking[0].name, 'qs');

  const highVuln = evaluateNpmAudit(JSON.stringify({
    vulnerabilities: {
      picomatch: {
        severity: 'high',
        isDirect: false,
        fixAvailable: true,
        via: [{ title: 'ReDoS in extglob', url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' }],
      },
    },
  }));
  assert.equal(highVuln.passed, false);
  assert.equal(highVuln.counts.high, 1);
  assert.equal(highVuln.blocking[0].name, 'picomatch');

  // S-25 allowlist: active matching entry waives only that exact package + GHSA; expired entries do not
  const activeAllow = parseAuditAllowlist(JSON.stringify({
    allow: [{
      package: 'picomatch',
      ghsa: 'GHSA-fc5q-39xc-vjpf',
      reason: 'Dev-only glob matcher; never reachable in production runtime.',
      expiresOn: '2026-12-31',
    }],
  }), '2026-11-18');
  const waived = evaluateNpmAudit(JSON.stringify({
    vulnerabilities: {
      picomatch: {
        severity: 'high',
        isDirect: false,
        fixAvailable: true,
        via: [{ title: 'ReDoS in extglob', url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' }],
      },
      // Transitive wrapper referencing `picomatch` by package-name string (npm 7+ format)
      readdirp: {
        severity: 'high',
        isDirect: false,
        fixAvailable: true,
        via: ['picomatch'],
      },
      chokidar: {
        severity: 'high',
        isDirect: true,
        fixAvailable: true,
        via: ['readdirp'],
      },
    },
  }), { allowlist: activeAllow });
  assert.equal(waived.passed, true);
  assert.equal(waived.allowlisted.length, 3);

  // Wrapper reaching BOTH an allowlisted advisory and an unallowlisted advisory MUST still block
  const partialTransitive = evaluateNpmAudit(JSON.stringify({
    vulnerabilities: {
      picomatch: {
        severity: 'high',
        isDirect: false,
        fixAvailable: true,
        via: [{ title: 'ReDoS in extglob', url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' }],
      },
      braces: {
        severity: 'high',
        isDirect: false,
        fixAvailable: true,
        via: [{ title: 'Unbounded expansion', url: 'https://github.com/advisories/GHSA-grv7-fg5c-xmjg' }],
      },
      micromatch: {
        severity: 'high',
        isDirect: true,
        fixAvailable: true,
        via: ['picomatch', 'braces'],
      },
    },
  }), { allowlist: activeAllow });
  assert.equal(partialTransitive.passed, false);
  assert.deepEqual(partialTransitive.blocking.map(v => v.name), ['braces', 'micromatch']);
  assert.deepEqual(partialTransitive.allowlisted.map(v => v.name), ['picomatch']);

  const expiredAllow = parseAuditAllowlist(JSON.stringify({
    allow: [{
      package: 'picomatch',
      ghsa: 'GHSA-fc5q-39xc-vjpf',
      reason: 'Expired temporary exception.',
      expiresOn: '2026-10-01',
    }],
  }), '2026-11-18');
  assert.equal(expiredAllow.length, 0);
  assert.throws(
    () => parseAuditAllowlist(JSON.stringify({ allow: [{ package: 'x', ghsa: 'bad', reason: 'short', expiresOn: 'nope' }] })),
    /Invalid allowlist entry/,
  );
});

test('S-25: validateTargetBaseUrl requires HTTPS outside loopback and forbids embedded credentials', () => {
  assert.equal(validateTargetBaseUrl('https://app.example.com/path', false).origin, 'https://app.example.com');
  assert.equal(validateTargetBaseUrl('http://127.0.0.1:3000', true).origin, 'http://127.0.0.1:3000');
  assert.throws(() => validateTargetBaseUrl('http://127.0.0.1:3000', false), /--allow-http/);
  assert.throws(() => validateTargetBaseUrl('http://app.example.com', true), /https:\/\//);
  assert.throws(() => validateTargetBaseUrl('https://user:secret@app.example.com', false), /credentials/i);
});

test('S-25: evaluateResponseHeaders detects missing/weak headers and passes LedgerFlow production middleware', async () => {
  const directives = parseCspDirectives("default-src 'self'; object-src 'none'; script-src 'self' 'sha256-abc='");
  assert.deepEqual(directives.get('object-src'), ["'none'"]);

  // Weak headers must fail across CSP, HSTS, XCTO, XFO, Referrer-Policy, and X-Powered-By
  const weak = evaluateResponseHeaders('/', {
    'content-security-policy': "default-src *; script-src 'self' 'unsafe-eval'",
    'strict-transport-security': 'max-age=60',
    'x-powered-by': 'Express',
  }, { isHttps: true, requirePermissionsPolicy: true });
  const failedHeaders = new Set(weak.filter(f => f.status === 'fail').map(f => f.header));
  for (const expected of [
    'Content-Security-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'X-Powered-By',
  ]) {
    assert.ok(failedHeaders.has(expected), `Expected weak header check to fail on ${expected}`);
  }

  // Real LedgerFlow securityMiddleware in production mode must have zero `fail` findings
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const app = express();
  app.disable('x-powered-by');
  applySecurityMiddleware(app, () => false);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const findings = evaluateResponseHeaders('/api/health', res.headers, { isHttps: true });
    const failures = findings.filter(f => f.status === 'fail');
    assert.deepEqual(failures, [], `Unexpected security header failures: ${JSON.stringify(failures)}`);
    const pp = findings.find(f => f.header === 'Permissions-Policy');
    assert.equal(pp?.status, 'pass');
  } finally {
    process.env.NODE_ENV = prevEnv;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
