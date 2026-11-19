import './helpers/dom';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import CookieConsent from '../components/legal/CookieConsent';
import CrashReportPreference from '../components/legal/CrashReportPreference';
import {
  COOKIE_CONSENT_KEY,
  getCookieConsent,
  isOptionalTelemetryAllowed,
  setCookieConsent,
} from '../lib/cookieConsent';
import { getLatestErrorDiagnostic, reportClientError } from '../lib/errorTracker';
import { useAuthStore } from '../stores/useAuthStore';

beforeEach(() => localStorage.removeItem(COOKIE_CONSENT_KEY));
afterEach(cleanup);

function crashReportControl(view: ReturnType<typeof render>): HTMLInputElement {
  const control = view.getByRole('checkbox', { name: 'Send automatic crash reports' });
  assert.ok(control instanceof window.HTMLInputElement);
  return control;
}

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

  // Legacy acceptance only dismisses the banner; it is not a crash-report opt-in.
  localStorage.setItem(COOKIE_CONSENT_KEY, 'accepted');
  assert.equal(getCookieConsent(), 'essential');
  assert.equal(isOptionalTelemetryAllowed(), false);
  assert.equal(render(<CookieConsent />).container.firstChild, null);

  localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({ essential: true, analytics: false }));
  assert.equal(getCookieConsent(), 'essential');
  assert.equal(isOptionalTelemetryAllowed(), false);
  assert.equal(render(<CookieConsent />).container.firstChild, null);
});

test('S-35: Settings reflects the banner choice and can withdraw it', () => {
  const view = render(<><CookieConsent /><CrashReportPreference /></>);
  const control = crashReportControl(view);
  assert.equal(control.checked, false);
  assert.ok(view.getByText(/send automatic crash reports to help fix errors/i));
  fireEvent.click(view.getByRole('button', { name: /accept all/i }));
  assert.equal(control.checked, true);
  fireEvent.click(control);
  assert.equal(control.checked, false);
  assert.equal(isOptionalTelemetryAllowed(), false);
  cleanup();
  assert.equal(crashReportControl(render(<CrashReportPreference />)).checked, false);
});

test('S-35: a failed preference write disables reporting without claiming the choice was saved', (t) => {
  setCookieConsent('all');
  const view = render(<CrashReportPreference />);
  const control = crashReportControl(view);
  assert.equal(control.checked, true);
  const storage = t.mock.method(window.Storage.prototype, 'setItem', () => { throw new Error('read-only storage'); });
  try {
    fireEvent.click(control);
    assert.equal(control.checked, false);
    assert.equal(isOptionalTelemetryAllowed(), false);
    assert.match(view.getByRole('alert').textContent || '', /couldn't save/i);
  } finally {
    storage.mock.restore();
    cleanup();
    setCookieConsent('essential');
  }
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

test('S-35: automatic reports require a recorded opt-in, including when storage is unavailable', async (t) => {
  const send = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }));

  await reportClientError('first visit without a choice');
  localStorage.setItem(COOKIE_CONSENT_KEY, '{broken');
  await reportClientError('unreadable preference');
  localStorage.setItem(COOKIE_CONSENT_KEY, '{"choice":"all"}');
  await reportClientError('legacy choice lacking crash-report disclosure');
  localStorage.setItem(COOKIE_CONSENT_KEY, '{"choice":"all","version":2}');
  await reportClientError('incomplete current preference');
  assert.equal(send.mock.callCount(), 0);
  assert.equal(getLatestErrorDiagnostic()?.diagnostics.message, 'incomplete current preference');

  setCookieConsent('all');
  const storage = t.mock.getter(window, 'localStorage', () => { throw new Error('storage unavailable'); });
  await reportClientError('storage denied');
  assert.equal(send.mock.callCount(), 0);
  storage.mock.restore();

  await reportClientError('recorded opt-in');
  assert.equal(send.mock.callCount(), 1);
});

test('S-35: withdrawing consent while a token lookup is pending prevents delivery', async (t) => {
  const send = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }));
  const previousUser = useAuthStore.getState().user;
  let tokenReady!: (token: string) => void;
  const tokenLookup = new Promise<string>(resolve => { tokenReady = resolve; });
  useAuthStore.setState({ user: { uid: 'consent-user', getIdToken: () => tokenLookup } as typeof previousUser });
  try {
    setCookieConsent('all');
    const report = reportClientError('pending diagnostic');
    setCookieConsent('essential');
    tokenReady('fixture-token');
    await report;
    assert.equal(send.mock.callCount(), 0);
  } finally {
    useAuthStore.setState({ user: previousUser });
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
