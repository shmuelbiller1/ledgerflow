/**
 * Tests for S-23: Content-Security-Policy tightened (no unsafe-inline where possible); report-only first
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import {
  generateCspHeader,
  generateNonce,
  generateReportOnlySecurityHeaders,
  cspReportOnlyMiddleware,
  cspEnforcementMiddleware,
  createCspViolationEndpoint,
  validateCspConfiguration,
  generateCspMigrationReport,
  defaultCspReportOnlyConfig
} from '../server/middleware/cspReportOnly';

/**
 * Mock request/response objects. Response methods record their calls and
 * return `res` so they can be chained (the same shape the real Express
 * response exposes).
 */
interface MockResponse extends Response {
  calls: Array<{ method: string; args: unknown[] }>;
}

function createMockRequest(): Request {
  return {
    method: 'GET',
    path: '/',
    headers: { 'user-agent': 'Test' },
    ip: '192.168.1.1'
  } as unknown as Request;
}

function createMockResponse(): MockResponse {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const res: MockResponse = {
    calls,
    setHeader(key: string, value: string) {
      calls.push({ method: 'setHeader', args: [key, value] });
      return res;
    },
    status(code: number) {
      calls.push({ method: 'status', args: [code] });
      return res;
    },
    json(body: unknown) {
      calls.push({ method: 'json', args: [body] });
      return res;
    },
    end() {
      calls.push({ method: 'end', args: [] });
      return res;
    }
  } as unknown as MockResponse;
  return res;
}

function callsFor(res: MockResponse, method: string): unknown[][] {
  return res.calls.filter((c) => c.method === method).map((c) => c.args);
}

describe('CSP Report-Only Mode (S-23)', () => {
  describe('generateNonce', () => {
    it('should generate a base64-encoded nonce', () => {
      const nonce = generateNonce();
      assert.strictEqual(typeof nonce, 'string');
      assert.ok(nonce.length > 0);
    });

    it('should generate unique nonces each time', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      assert.notStrictEqual(nonce1, nonce2);
    });

    it('should generate nonces of consistent length', () => {
      const nonces = Array.from({ length: 10 }, () => generateNonce());
      const lengths = nonces.map(n => n.length);
      assert.strictEqual(new Set(lengths).size, 1); // All same length
    });
  });

  describe('generateCspHeader', () => {
    it('should generate a valid CSP string', () => {
      const csp = generateCspHeader({});
      assert.strictEqual(typeof csp, 'string');
      assert.ok(csp.length > 0);
    });

    it('should include default-src self', () => {
      const csp = generateCspHeader({});
      assert.ok(csp.includes("default-src 'self'"));
    });

    it('should include script-src with nonce when useNonces is true', () => {
      const csp = generateCspHeader({ useNonces: true });
      assert.ok(csp.includes("script-src 'self' 'nonce-"));
    });

    it('should include script-src with unsafe-inline when useNonces is false', () => {
      const csp = generateCspHeader({ useNonces: false });
      assert.ok(csp.includes("script-src 'self' 'unsafe-inline'"));
    });

    it('should include style-src with nonce when useNonces is true', () => {
      const csp = generateCspHeader({ useNonces: true });
      assert.ok(csp.includes("style-src 'self' 'nonce-"));
    });

    it('should include style-src with unsafe-inline when useNonces is false', () => {
      const csp = generateCspHeader({ useNonces: false });
      assert.ok(csp.includes("style-src 'self' 'unsafe-inline'"));
    });

    it('should include Plaid domain in script-src', () => {
      const csp = generateCspHeader({});
      assert.ok(csp.includes('https://cdn.plaid.com'));
    });

    it('should include Google Fonts in style-src', () => {
      const csp = generateCspHeader({});
      assert.ok(csp.includes('https://fonts.googleapis.com'));
    });

    it('should include Google Fonts static in font-src', () => {
      const csp = generateCspHeader({});
      assert.ok(csp.includes('https://fonts.gstatic.com'));
    });

    it('should include Stripe in frame-src', () => {
      const csp = generateCspHeader({});
      assert.ok(csp.includes('https://*.stripe.com'));
    });

    it('should include Plaid in frame-src', () => {
      const csp = generateCspHeader({});
      assert.ok(csp.includes('https://cdn.plaid.com'));
    });

    it('should include object-src none', () => {
      const csp = generateCspHeader({});
      assert.ok(csp.includes("object-src 'none'"));
    });

    it('should include base-uri self', () => {
      const csp = generateCspHeader({});
      assert.ok(csp.includes("base-uri 'self'"));
    });

    it('should include form-action self', () => {
      const csp = generateCspHeader({});
      assert.ok(csp.includes("form-action 'self'"));
    });

    it('should add report-uri when specified', () => {
      const csp = generateCspHeader({ reportUri: 'https://example.com/csp-report' });
      assert.ok(csp.includes('report-uri https://example.com/csp-report'));
    });

    it('should add additional script domains', () => {
      const csp = generateCspHeader({
        additionalDomains: {
          script: ['https://example.com']
        }
      });
      assert.ok(csp.includes('https://example.com'));
    });

    it('should add additional style domains', () => {
      const csp = generateCspHeader({
        additionalDomains: {
          style: ['https://example.com']
        }
      });
      assert.ok(csp.includes('https://example.com'));
    });

    it('should add additional connect domains', () => {
      const csp = generateCspHeader({
        additionalDomains: {
          connect: ['https://api.example.com']
        }
      });
      assert.ok(csp.includes('https://api.example.com'));
    });
  });

  describe('generateReportOnlySecurityHeaders', () => {
    it('should return all security headers', () => {
      const headers = generateReportOnlySecurityHeaders();
      assert.ok('Content-Security-Policy-Report-Only' in headers);
      assert.ok('Strict-Transport-Security' in headers);
      assert.ok('X-Content-Type-Options' in headers);
      assert.ok('X-Frame-Options' in headers);
      assert.ok('Referrer-Policy' in headers);
      assert.ok('Permissions-Policy' in headers);
      assert.ok('X-XSS-Protection' in headers);
      assert.ok('Cross-Origin-Embedder-Policy' in headers);
      assert.ok('Cross-Origin-Opener-Policy' in headers);
      assert.ok('Cross-Origin-Resource-Policy' in headers);
    });

    it('should use Content-Security-Policy-Report-Only by default', () => {
      const headers = generateReportOnlySecurityHeaders();
      assert.ok('Content-Security-Policy-Report-Only' in headers);
      assert.ok(!('Content-Security-Policy' in headers));
    });

    it('should use Content-Security-Policy when reportOnly is false', () => {
      const headers = generateReportOnlySecurityHeaders({ reportOnly: false });
      assert.ok('Content-Security-Policy' in headers);
      assert.ok(!('Content-Security-Policy-Report-Only' in headers));
    });

    it('should include HSTS header', () => {
      const headers = generateReportOnlySecurityHeaders();
      assert.ok(headers['Strict-Transport-Security'].includes('max-age=31536000'));
    });

    it('should include X-Content-Type-Options header', () => {
      const headers = generateReportOnlySecurityHeaders();
      assert.strictEqual(headers['X-Content-Type-Options'], 'nosniff');
    });

    it('should include X-Frame-Options header', () => {
      const headers = generateReportOnlySecurityHeaders();
      assert.strictEqual(headers['X-Frame-Options'], 'SAMEORIGIN');
    });

    it('should include Referrer-Policy header', () => {
      const headers = generateReportOnlySecurityHeaders();
      assert.strictEqual(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
    });

    it('should include Permissions-Policy header', () => {
      const headers = generateReportOnlySecurityHeaders();
      assert.ok(headers['Permissions-Policy'].includes('camera=()'));
    });

    it('should include X-XSS-Protection header', () => {
      const headers = generateReportOnlySecurityHeaders();
      assert.strictEqual(headers['X-XSS-Protection'], '1; mode=block');
    });

    it('should include COEP header', () => {
      const headers = generateReportOnlySecurityHeaders();
      assert.strictEqual(headers['Cross-Origin-Embedder-Policy'], 'require-corp');
    });

    it('should include COOP header', () => {
      const headers = generateReportOnlySecurityHeaders();
      assert.strictEqual(headers['Cross-Origin-Opener-Policy'], 'same-origin');
    });

    it('should include CORP header', () => {
      const headers = generateReportOnlySecurityHeaders();
      assert.strictEqual(headers['Cross-Origin-Resource-Policy'], 'same-origin');
    });
  });

  describe('cspReportOnlyMiddleware', () => {
    it('should be a function', () => {
      assert.strictEqual(typeof cspReportOnlyMiddleware, 'function');
    });

    it('should return a middleware function', () => {
      const middleware = cspReportOnlyMiddleware();
      assert.strictEqual(typeof middleware, 'function');
    });

    it('should apply security headers to response', async () => {
      const middleware = cspReportOnlyMiddleware();
      const req = createMockRequest();
      const res = createMockResponse();

      await middleware(req, res, () => {});

      assert.ok(res.calls.some((c) => c.method === 'setHeader'));
      const headerKeys = callsFor(res, 'setHeader').map(([key]) => key);
      assert.ok(headerKeys.includes('Content-Security-Policy-Report-Only'));
    });

    it('should add nonce to request when useNonces is true', async () => {
      const middleware = cspReportOnlyMiddleware({ useNonces: true });
      const req = createMockRequest();
      const res = createMockResponse();

      await middleware(req, res, () => {});

      assert.ok(req.cspNonce !== undefined);
      assert.strictEqual(typeof req.cspNonce, 'string');
    });

    it('should not add nonce to request when useNonces is false', async () => {
      const middleware = cspReportOnlyMiddleware({ useNonces: false });
      const req = createMockRequest();
      const res = createMockResponse();

      await middleware(req, res, () => {});

      assert.strictEqual(req.cspNonce, undefined);
    });
  });

  describe('cspEnforcementMiddleware', () => {
    it('should use Content-Security-Policy header', async () => {
      const middleware = cspEnforcementMiddleware();
      const req = createMockRequest();
      const res = createMockResponse();

      await middleware(req, res, () => {});

      const headerKeys = callsFor(res, 'setHeader').map(([key]) => key);
      assert.ok(headerKeys.includes('Content-Security-Policy'));
      assert.ok(!headerKeys.includes('Content-Security-Policy-Report-Only'));
    });

    it('should add nonce to request', async () => {
      const middleware = cspEnforcementMiddleware();
      const req = createMockRequest();
      const res = createMockResponse();

      await middleware(req, res, () => {});

      assert.ok(req.cspNonce !== undefined);
    });
  });

  describe('validateCspConfiguration', () => {
    it('should return valid: true for a valid CSP', () => {
      const csp = generateCspHeader({ useNonces: false });
      const result = validateCspConfiguration(csp);
      assert.strictEqual(result.valid, true);
    });

    it('should warn about unsafe-inline', () => {
      const csp = "default-src 'self'; script-src 'self' 'unsafe-inline';";
      const result = validateCspConfiguration(csp);
      assert.ok(result.warnings.includes("CSP contains 'unsafe-inline'"));
    });

    it('should error when required domain is missing', () => {
      const csp = "default-src 'self'; script-src 'self';";
      const result = validateCspConfiguration(csp);
      assert.ok(result.errors.length > 0);
      assert.strictEqual(result.valid, false);
    });

    it('should error when required directive is missing', () => {
      const csp = "default-src 'self';";
      const result = validateCspConfiguration(csp);
      assert.ok(result.errors.length > 0);
      assert.strictEqual(result.valid, false);
    });

    it('should pass when all required domains and directives are present', () => {
      const csp = generateCspHeader({ useNonces: false });
      const result = validateCspConfiguration(csp);
      assert.strictEqual(result.valid, true);
    });
  });

  describe('generateCspMigrationReport', () => {
    it('should generate a report with no violations', () => {
      const report = generateCspMigrationReport([]);
      assert.ok(report.includes('# CSP Migration Report'));
      assert.ok(report.includes('✅ No CSP violations detected'));
    });

    it('should generate a report with violations', () => {
      const violations = [
        {
          report: {
            'blocked-uri': 'https://example.com',
            'violated-directive': 'script-src',
            'source-file': 'https://app.com',
            'line-number': 42
          }
        }
      ];
      const report = generateCspMigrationReport(violations);
      assert.ok(report.includes('# CSP Migration Report'));
      assert.ok(report.includes('⚠️ CSP violations detected'));
      assert.ok(report.includes('https://example.com'));
    });

    it('should include recommendations', () => {
      const report = generateCspMigrationReport([]);
      assert.ok(report.includes('## Recommendations'));
    });
  });

  describe('defaultCspReportOnlyConfig', () => {
    it('should have reportOnly enabled by default', () => {
      assert.strictEqual(defaultCspReportOnlyConfig.reportOnly, true);
    });

    it('should have useNonces enabled by default', () => {
      assert.strictEqual(defaultCspReportOnlyConfig.useNonces, true);
    });

    it('should have reportUri undefined by default', () => {
      assert.strictEqual(defaultCspReportOnlyConfig.reportUri, undefined);
    });

    it('should have empty additionalDomains by default', () => {
      assert.deepStrictEqual(defaultCspReportOnlyConfig.additionalDomains, {});
    });
  });

  describe('createCspViolationEndpoint', () => {
    it('should be a function', () => {
      assert.strictEqual(typeof createCspViolationEndpoint, 'function');
    });

    it('should return an endpoint handler', () => {
      const endpoint = createCspViolationEndpoint();
      assert.strictEqual(typeof endpoint, 'function');
    });

    it('should reject non-POST requests', async () => {
      const endpoint = createCspViolationEndpoint();
      const req = createMockRequest();
      req.method = 'GET';
      const res = createMockResponse();

      await endpoint(req, res);

      assert.deepStrictEqual(callsFor(res, 'status'), [[405]]);
    });

    it('should reject invalid reports', async () => {
      const endpoint = createCspViolationEndpoint();
      const req = createMockRequest();
      req.method = 'POST';
      req.body = {}; // No csp-report
      const res = createMockResponse();

      await endpoint(req, res);

      assert.deepStrictEqual(callsFor(res, 'status'), [[400]]);
    });

    it('should accept valid reports', async () => {
      const endpoint = createCspViolationEndpoint();
      const req = createMockRequest();
      req.method = 'POST';
      req.body = {
        'csp-report': {
          'blocked-uri': 'https://example.com',
          'violated-directive': 'script-src'
        }
      };
      const res = createMockResponse();

      await endpoint(req, res);

      assert.deepStrictEqual(callsFor(res, 'status'), [[204]]);
      assert.ok(res.calls.some((c) => c.method === 'end'));
    });
  });
});

describe('CSP Report-Only - S-23 Compliance', () => {
  it('should generate CSP without unsafe-inline when useNonces is true', () => {
    const csp = generateCspHeader({ useNonces: true });
    assert.ok(!csp.includes("'unsafe-inline'"));
  });

  it('should maintain all required functionality', () => {
    const csp = generateCspHeader({ useNonces: false });
    const result = validateCspConfiguration(csp);
    assert.strictEqual(result.valid, true);
  });

  it('should be configurable for report-only or enforcement mode', () => {
    const reportOnlyHeaders = generateReportOnlySecurityHeaders({ reportOnly: true });
    const enforcementHeaders = generateReportOnlySecurityHeaders({ reportOnly: false });

    assert.ok('Content-Security-Policy-Report-Only' in reportOnlyHeaders);
    assert.ok('Content-Security-Policy' in enforcementHeaders);
  });

  it('should include all modern security headers', () => {
    const headers = generateReportOnlySecurityHeaders();
    const requiredHeaders = [
      'Content-Security-Policy-Report-Only',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'X-XSS-Protection',
      'Cross-Origin-Embedder-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy'
    ];

    for (const header of requiredHeaders) {
      assert.ok(header in headers);
    }
  });
});
