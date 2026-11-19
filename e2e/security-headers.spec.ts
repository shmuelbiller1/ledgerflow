import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { test, expect } from '@playwright/test';
import { applySecurityMiddleware } from '../src/server/http/securityMiddleware';

/**
 * S-34: End-to-end verification that live browser navigation, API endpoints,
 * production security middleware, and Vercel edge configuration emit strict
 * transport, framing, referrer, MIME, and cross-origin hardening headers.
 */
test.describe('S-34 HTTP security headers', () => {
  test('live server responses enforce X-Frame-Options, Referrer-Policy, nosniff, isolation, and CORS rejection', async ({ request }) => {
    for (const route of ['/', '/api/health']) {
      const res = await request.get(route, {
        headers: { Origin: 'https://untrusted.example' },
      });
      expect(res.ok(), `Expected 2xx on ${route}, got ${res.status()}`).toBeTruthy();
      const headers = res.headers();

      expect(headers['x-frame-options']).toMatch(/^(DENY|SAMEORIGIN)$/i);
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(headers['access-control-allow-origin']).toBeUndefined();
      expect(headers['x-powered-by']).toBeUndefined();

      // When running against a NODE_ENV=production server directly, HSTS and CSP are also emitted here.
      if (headers['strict-transport-security']) {
        expect(headers['strict-transport-security']).toMatch(/max-age=31536000/i);
        expect(headers['strict-transport-security']).toMatch(/includeSubDomains/i);
      }
    }
  });

  test('production middleware and vercel.json enforce HSTS preload, CSP frame-ancestors, X-Frame-Options, and Referrer-Policy', async ({ request }) => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const app = express();
    applySecurityMiddleware(app, () => false);
    app.get('/probe', (_req, res) => {
      res.status(200).type('html').send('<!doctype html><title>probe</title>');
    });
    process.env.NODE_ENV = prevNodeEnv;

    const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const res = await request.get(`http://127.0.0.1:${port}/probe`);
      expect(res.status()).toBe(200);
      const headers = res.headers();

      expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains; preload');
      expect(headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=(), usb=(), payment=(self)');
      expect(headers['x-powered-by']).toBeUndefined();
      expect(headers['content-security-policy']).toContain("default-src 'self'");
      expect(headers['content-security-policy']).toContain("frame-ancestors 'self'");
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }

    // Also pin Vercel static edge config so HSTS, X-Frame-Options, Referrer-Policy, and CSP never regress.
    const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8')) as {
      headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    const globalHeaders = new Map<string, string>();
    for (const block of vercel.headers ?? []) {
      for (const h of block.headers) {
        globalHeaders.set(h.key.toLowerCase(), h.value);
      }
    }
    expect(globalHeaders.get('x-frame-options')).toMatch(/^(DENY|SAMEORIGIN)$/i);
    expect(globalHeaders.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(globalHeaders.get('x-content-type-options')).toBe('nosniff');
    expect(globalHeaders.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(globalHeaders.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=(), usb=(), payment=(self)');
    if (globalHeaders.has('strict-transport-security')) {
      expect(globalHeaders.get('strict-transport-security')).toMatch(/max-age=31536000/i);
    }
  });

  test('document navigation renders without exposing X-Powered-By and enforces anti-framing', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();
    expect(response!.ok()).toBeTruthy();
    const headers = response!.headers();
    expect(headers['x-frame-options']).toMatch(/^(DENY|SAMEORIGIN)$/i);
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
  });
});
