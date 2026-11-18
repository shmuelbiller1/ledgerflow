import './helpers/dom';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import CookieConsent from '../components/legal/CookieConsent';
import {
  COOKIE_CONSENT_KEY,
  getCookieConsent,
  isOptionalTelemetryAllowed,
  setCookieConsent,
} from '../lib/cookieConsent';
import { getLatestErrorDiagnostic, reportClientError } from '../lib/errorTracker';

beforeEach(() => localStorage.removeItem(COOKIE_CONSENT_KEY));
afterEach(cleanup);

test('cookie consent appears without stored consent and remembers essential-only choice', () => {
  const view = render(<CookieConsent />);
  fireEvent.click(view.getByRole('button', { name: /essential/i }));
  assert.equal(JSON.parse(localStorage.getItem(COOKIE_CONSENT_KEY)!).choice, 'essential');
  assert.equal(getCookieConsent(), 'essential');
  assert.equal(isOptionalTelemetryAllowed(), false);
  assert.equal(view.queryByRole('button', { name: /essential/i }), null);
  cleanup();
  const reopened = render(<CookieConsent />);
  assert.equal(reopened.queryByRole('button', { name: /essential/i }), null);
});

test('S-35: malformed stored consent re-displays banner and Accept All persists cleanly', () => {
  localStorage.setItem(COOKIE_CONSENT_KEY, '{"choice":"bogus"}');
  assert.equal(getCookieConsent(), null);
  const view = render(<CookieConsent />);
  fireEvent.click(view.getByRole('button', { name: /accept all/i }));
  assert.equal(getCookieConsent(), 'all');
  assert.equal(isOptionalTelemetryAllowed(), true);

  // Backward compatibility: legacy plain-string and `{ essential, analytics }` stored formats
  localStorage.setItem(COOKIE_CONSENT_KEY, 'accepted');
  assert.equal(getCookieConsent(), 'all');
  assert.equal(isOptionalTelemetryAllowed(), true);
  assert.equal(render(<CookieConsent />).container.firstChild, null);

  localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({ essential: true, analytics: false }));
  assert.equal(getCookieConsent(), 'essential');
  assert.equal(isOptionalTelemetryAllowed(), false);
  assert.equal(render(<CookieConsent />).container.firstChild, null);
});

test('S-35: Essential Only blocks automatic telemetry shipping while keeping local diagnostics and explicit support reports working', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ status: 'ok', errorId: 'err_test_1' }), { status: 200 });
  }) as typeof fetch;

  try {
    setCookieConsent('essential');
    await reportClientError(new Error('background fault under essential consent'));
    assert.equal(calls.length, 0, 'Automatic telemetry must not POST when user chose Essential Only');
    assert.match(getLatestErrorDiagnostic()?.diagnostics.message || '', /background fault/);

    // Explicit user-submitted support ticket diagnostics still send
    await reportClientError(new Error('user reported fault'), { ticketId: 'tkt_12345' });
    assert.equal(calls.filter(url => url.includes('/api/v1/telemetry/errors')).length, 1);

    // Switching to Accept All re-enables background telemetry
    setCookieConsent('all');
    await reportClientError(new Error('fault after accept all'));
    assert.equal(calls.filter(url => url.includes('/api/v1/telemetry/errors')).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('S-35: index.html embeds no third-party advertising or analytics trackers prior to consent', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  assert.doesNotMatch(
    html,
    /googletagmanager|google-analytics|gtag\(|connect\.facebook\.net|fbq\(|mixpanel|segment\.com|posthog|hotjar|clarity\.ms/i,
  );
  assert.equal(document.cookie, '');
});
