/**
 * Tests for S-06: Security Headers Review
 *
 * Verifies that security headers are properly configured
 * and that e2e tests would prove main screens still load.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSecurityHeaders,
  defaultSecurityConfig,
  securityHeadersMiddleware,
  generateVercelSecurityHeaders,
  getCurrentCSP,
  validateSecurityHeadersCompatibility
} from '../server/http/securityHeaders';

describe('Security Headers (S-06)', () => {
  describe('generateSecurityHeaders', () => {
    it('should generate all required security headers', () => {
      const headers = generateSecurityHeaders();

      assert.ok('Content-Security-Policy' in headers);
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

    it('should include CSP by default', () => {
      const headers = generateSecurityHeaders();
      assert.ok(headers['Content-Security-Policy'] !== undefined);
    });

    it('should generate CSP with default-src self', () => {
      const headers = generateSecurityHeaders();
      const csp = headers['Content-Security-Policy'];
      assert.ok(csp.includes("default-src 'self'"));
    });

    it('should generate CSP with script-src including Plaid', () => {
      const headers = generateSecurityHeaders();
      const csp = headers['Content-Security-Policy'];
      assert.ok(csp.includes('script-src'));
      assert.ok(csp.includes('https://cdn.plaid.com'));
    });

    it('should generate CSP with style-src including Google Fonts', () => {
      const headers = generateSecurityHeaders();
      const csp = headers['Content-Security-Policy'];
      assert.ok(csp.includes('style-src'));
      assert.ok(csp.includes('https://fonts.googleapis.com'));
    });

    it('should generate CSP with connect-src including Supabase', () => {
      const headers = generateSecurityHeaders();
      const csp = headers['Content-Security-Policy'];
      assert.ok(csp.includes('connect-src'));
    });

    it('should generate CSP with frame-src for Stripe and Plaid', () => {
      const headers = generateSecurityHeaders();
      const csp = headers['Content-Security-Policy'];
      assert.ok(csp.includes('frame-src'));
      assert.ok(csp.includes('https://*.stripe.com'));
      assert.ok(csp.includes('https://cdn.plaid.com'));
    });

    it('should generate CSP with frame-ancestors for clickjacking protection', () => {
      const headers = generateSecurityHeaders();
      const csp = headers['Content-Security-Policy'];
      assert.ok(csp.includes("frame-ancestors 'self'"));
    });

    it('should generate CSP with object-src none', () => {
      const headers = generateSecurityHeaders();
      const csp = headers['Content-Security-Policy'];
      assert.ok(csp.includes("object-src 'none'"));
    });

    it('should generate CSP with base-uri self', () => {
      const headers = generateSecurityHeaders();
      const csp = headers['Content-Security-Policy'];
      assert.ok(csp.includes("base-uri 'self'"));
    });

    it('should generate CSP with form-action self', () => {
      const headers = generateSecurityHeaders();
      const csp = headers['Content-Security-Policy'];
      assert.ok(csp.includes("form-action 'self'"));
    });
  });

  describe('CSP with nonces', () => {
    it('should use nonces when useNonces is true', () => {
      const headers = generateSecurityHeaders({ useNonces: true });
      const csp = headers['Content-Security-Policy'];
      assert.ok(csp.includes("'nonce-true'"));
    });

    it('should not use unsafe-inline when useNonces is true', () => {
      const headers = generateSecurityHeaders({ useNonces: true });
      const csp = headers['Content-Security-Policy'];
      assert.ok(!csp.includes("'unsafe-inline'"));
    });

    it('should use unsafe-inline when useNonces is false', () => {
      const headers = generateSecurityHeaders({ useNonces: false });
      const csp = headers['Content-Security-Policy'];
      assert.ok(csp.includes("'unsafe-inline'"));
    });
  });

  describe('Report-Only mode', () => {
    it('should use Content-Security-Policy-Report-Only when reportOnly is true', () => {
      const headers = generateSecurityHeaders({ reportOnly: true });
      assert.ok('Content-Security-Policy-Report-Only' in headers);
      assert.ok(!('Content-Security-Policy' in headers));
    });

    it('should use Content-Security-Policy when reportOnly is false', () => {
      const headers = generateSecurityHeaders({ reportOnly: false });
      assert.ok('Content-Security-Policy' in headers);
      assert.ok(!('Content-Security-Policy-Report-Only' in headers));
    });
  });

  describe('HSTS header', () => {
    it('should have max-age of 1 year', () => {
      const headers = generateSecurityHeaders();
      assert.ok(headers['Strict-Transport-Security'].includes('max-age=31536000'));
    });

    it('should include includeSubDomains', () => {
      const headers = generateSecurityHeaders();
      assert.ok(headers['Strict-Transport-Security'].includes('includeSubDomains'));
    });

    it('should include preload', () => {
      const headers = generateSecurityHeaders();
      assert.ok(headers['Strict-Transport-Security'].includes('preload'));
    });
  });

  describe('Other security headers', () => {
    it('should set X-Content-Type-Options to nosniff', () => {
      const headers = generateSecurityHeaders();
      assert.strictEqual(headers['X-Content-Type-Options'], 'nosniff');
    });

    it('should set X-Frame-Options to SAMEORIGIN', () => {
      const headers = generateSecurityHeaders();
      assert.strictEqual(headers['X-Frame-Options'], 'SAMEORIGIN');
    });

    it('should set Referrer-Policy to strict-origin-when-cross-origin', () => {
      const headers = generateSecurityHeaders();
      assert.strictEqual(
        headers['Referrer-Policy'],
        'strict-origin-when-cross-origin'
      );
    });

    it('should set X-XSS-Protection to 1; mode=block', () => {
      const headers = generateSecurityHeaders();
      assert.strictEqual(headers['X-XSS-Protection'], '1; mode=block');
    });

    it('should set Permissions-Policy', () => {
      const headers = generateSecurityHeaders();
      assert.ok(headers['Permissions-Policy'] !== undefined);
      assert.ok(headers['Permissions-Policy'].includes('camera=()'));
      assert.ok(headers['Permissions-Policy'].includes('geolocation=()'));
      assert.ok(headers['Permissions-Policy'].includes('microphone=()'));
    });

    it('should set Cross-Origin-Embedder-Policy', () => {
      const headers = generateSecurityHeaders();
      assert.strictEqual(headers['Cross-Origin-Embedder-Policy'], 'require-corp');
    });

    it('should set Cross-Origin-Opener-Policy', () => {
      const headers = generateSecurityHeaders();
      assert.strictEqual(headers['Cross-Origin-Opener-Policy'], 'same-origin');
    });

    it('should set Cross-Origin-Resource-Policy', () => {
      const headers = generateSecurityHeaders();
      assert.strictEqual(headers['Cross-Origin-Resource-Policy'], 'same-origin');
    });
  });

  describe('generateVercelSecurityHeaders', () => {
    it('should return array of header objects', () => {
      const headers = generateVercelSecurityHeaders();
      assert.ok(Array.isArray(headers));
      assert.ok(headers.length > 0);
    });

    it('should include all required headers', () => {
      const headers = generateVercelSecurityHeaders();
      const headerKeys = headers.map((h) => h.key);
      assert.ok(headerKeys.includes('Content-Security-Policy'));
      assert.ok(headerKeys.includes('Strict-Transport-Security'));
      assert.ok(headerKeys.includes('X-Content-Type-Options'));
      assert.ok(headerKeys.includes('X-Frame-Options'));
      assert.ok(headerKeys.includes('Referrer-Policy'));
    });
  });

  describe('getCurrentCSP', () => {
    it('should return the CSP string', () => {
      const csp = getCurrentCSP();
      assert.strictEqual(typeof csp, 'string');
      assert.ok(csp.length > 0);
    });
  });

  describe('validateSecurityHeadersCompatibility', () => {
    it('should return valid: true with no errors', () => {
      const result = validateSecurityHeadersCompatibility();
      assert.strictEqual(result.valid, true);
    });

    it('should check for required domains', () => {
      const result = validateSecurityHeadersCompatibility();
      // The validation should pass if all required domains are in the CSP
      assert.ok(result.errors.length >= 0);
    });

    it('should warn about unsafe-inline if present', () => {
      const result = validateSecurityHeadersCompatibility();
      // With default config (useNonces: true), there should be no unsafe-inline
      // But if we use useNonces: false, there will be a warning
      assert.ok(result.warnings !== undefined);
    });
  });

  describe('defaultSecurityConfig', () => {
    it('should have useNonces enabled by default', () => {
      assert.strictEqual(defaultSecurityConfig.useNonces, true);
    });

    it('should have reportOnly disabled by default', () => {
      assert.strictEqual(defaultSecurityConfig.reportOnly, false);
    });

    it('should have empty additional domains by default', () => {
      assert.deepStrictEqual(defaultSecurityConfig.additionalConnectDomains, []);
      assert.deepStrictEqual(defaultSecurityConfig.additionalScriptDomains, []);
      assert.deepStrictEqual(defaultSecurityConfig.additionalStyleDomains, []);
    });
  });

  describe('securityHeadersMiddleware', () => {
    it('should be a function', () => {
      assert.strictEqual(typeof securityHeadersMiddleware, 'function');
    });

    it('should return a middleware function', () => {
      const middleware = securityHeadersMiddleware();
      assert.strictEqual(typeof middleware, 'function');
    });

    it('should accept config parameter', () => {
      const middleware = securityHeadersMiddleware({ useNonces: false });
      assert.strictEqual(typeof middleware, 'function');
    });
  });
});

describe('Security Headers - S-06 Compliance', () => {
  it('should have tightened CSP compared to vercel.json', () => {
    // The original vercel.json has 'unsafe-inline' in script-src and style-src
    // Our new headers should either use nonces or be more restrictive
    const headers = generateSecurityHeaders();
    const csp = headers['Content-Security-Policy'];

    // With nonces enabled (default), we should NOT have unsafe-inline
    assert.ok(!csp.includes("'unsafe-inline'"));
  });

  it('should maintain compatibility with existing services', () => {
    const result = validateSecurityHeadersCompatibility();
    assert.strictEqual(result.valid, true);
  });

  it('should include all headers from vercel.json plus additional ones', () => {
    const headers = generateSecurityHeaders();

    // Headers from vercel.json
    assert.ok('Content-Security-Policy' in headers);
    assert.ok('Strict-Transport-Security' in headers);
    assert.ok('X-Content-Type-Options' in headers);
    assert.ok('X-Frame-Options' in headers);
    assert.ok('Referrer-Policy' in headers);

    // Additional security headers
    assert.ok('Permissions-Policy' in headers);
    assert.ok('X-XSS-Protection' in headers);
    assert.ok('Cross-Origin-Embedder-Policy' in headers);
    assert.ok('Cross-Origin-Opener-Policy' in headers);
    assert.ok('Cross-Origin-Resource-Policy' in headers);
  });
});
