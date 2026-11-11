import { test, expect, type Page, type Route } from '@playwright/test';

import { BRAND_NAME } from '../src/config/brand';
/**
 * A-269: a passkey in a real browser, with Chromium's own virtual authenticator.
 *
 * The ceremony is the platform's: CDP `WebAuthn.addVirtualAuthenticator` makes a real CTAP2
 * authenticator inside the browser, so `navigator.credentials.create()` really runs and really
 * produces a credential whose relying party is this page's host. What is stubbed is only the
 * *auth server* — this sandbox has no Supabase project, so the three `/auth/v1/passkeys/**` calls
 * are answered by the test with a challenge and the rows a server would keep. That is stated here
 * and in the evidence note: this proves the browser half (the thing a unit test with a mocked
 * `navigator.credentials` cannot prove) and the screen's handling of the server's answer.
 *
 * The last case is the "passkeys off" answer: a server that refuses registrations must leave the
 * screen saying so in plain words, with nothing listed and nothing claimed.
 */

const SUPABASE_URL = 'https://ledgerflow-unconfigured.invalid';
const SESSION_KEY = 'sb-ledgerflow-unconfigured-auth-token';
const USER_ID = '3f0c1f1e-6a4b-4c1a-9e0e-2a1b0c9d8e7f';

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

interface PasskeyRow { id: string; friendly_name: string; created_at: string; last_used_at?: string; credential_id?: string }

/** The auth server's side of the contract, for a browser that has a real session. */
async function stubAuthServer(page: Page, options: { refuse?: boolean } = {}) {
  const rows: PasskeyRow[] = [];
  const preflight = async (route: Route) => route.fulfill({
    status: 204,
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' },
  });
  await page.route(`${SUPABASE_URL}/auth/v1/passkeys**`, async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return preflight(route);
    const url = new URL(request.url());
    const json = (status: number, body: unknown) => route.fulfill({
      status,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' },
      body: JSON.stringify(body),
    });

    if (options.refuse && url.pathname.endsWith('/registration/options')) {
      // the code Supabase Auth answers when the project has not switched passkeys on
      return json(422, { code: 'passkey_disabled', msg: 'Passkeys are not enabled for this project' });
    }
    if (url.pathname.endsWith('/registration/options')) {
      // the challenge a server would hand a real project: a fresh 32-byte nonce, this page as the
      // relying party, and the signed-in user as the credential's user handle
      return json(200, {
        challenge_id: 'challenge-browser-1',
        options: {
          rp: { id: 'localhost', name: `${BRAND_NAME}` },
          user: { id: b64url(Buffer.from(USER_ID)), name: 'passkey@example.test', displayName: 'Passkey Browser' },
          challenge: b64url(crypto.getRandomValues(new Uint8Array(32))),
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          timeout: 60_000,
          attestation: 'none',
          authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
        },
      });
    }
    if (url.pathname.endsWith('/registration/verify')) {
      const body = request.postDataJSON() as { challenge_id?: string; credential?: { id?: string } };
      if (body?.challenge_id !== 'challenge-browser-1' || !body?.credential?.id) {
        return json(400, { code: 'invalid_credential', msg: 'The credential did not answer this challenge' });
      }
      const row: PasskeyRow = { id: 'pk-browser-1', friendly_name: 'Passkey', credential_id: body.credential.id, created_at: new Date().toISOString() };
      rows.push(row);
      return json(200, row);
    }
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as { friendly_name?: string };
      const row = rows.find(r => url.pathname.endsWith(r.id));
      if (row && body.friendly_name) row.friendly_name = body.friendly_name;
      return json(200, row ?? {});
    }
    if (request.method() === 'DELETE') {
      const index = rows.findIndex(r => url.pathname.endsWith(r.id));
      if (index >= 0) rows.splice(index, 1);
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    return json(200, rows);
  });
  return rows;
}

/** A signed-in session the app will believe (the publishable key in a local dev build is inert). */
async function signInWithSession(page: Page) {
  await page.addInitScript(([key, userId]) => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem('isGuest', 'false');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
    localStorage.setItem(key, JSON.stringify({
      access_token: 'browser-test-access-token', token_type: 'bearer', refresh_token: 'browser-test-refresh-token',
      expires_in: 3600, expires_at: now + 3600,
      user: { id: userId, aud: 'authenticated', email: 'passkey@example.test', role: 'authenticated', created_at: '2026-01-01T00:00:00Z' },
    }));
  }, [SESSION_KEY, USER_ID] as const);
}

/** Opens Settings → Security in a workspace, where a reader manages their passkeys. */
async function openSecuritySettings(page: Page) {
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    const { useUIStore } = await import('/src/stores/useUIStore.ts');
    const user = { uid: 'passkey-browser-user', email: 'passkey@example.test', isAnonymous: false, getIdToken: async () => 'browser-test-access-token' };
    const workspace = { id: 'passkey-browser', uid: 'passkey-browser-user', name: 'Passkey test', currency: 'USD', businessType: 'custom', createdAt: '2026-01-01' };
    useAuthStore.setState({ user, isGuest: false, currentWorkspaceId: workspace.id, workspaces: [workspace] });
    useUIStore.setState({ activeTab: 'settings', activeSettingsTab: 'security' });
  });
  const panel = page.getByRole('region', { name: 'Passkeys' });
  await expect(panel).toBeVisible({ timeout: 60_000 });
  return panel;
}

test.describe('A-269: a passkey is added and listed in a real browser', () => {
  test('the platform ceremony runs on Chromium’s virtual authenticator and the passkey is listed', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium (CDP) capability');
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInWithSession(page);
    const rows = await stubAuthServer(page);
    await page.goto('/');
    const panel = await openSecuritySettings(page);

    // the browser can really do this: a secure page, WebAuthn and the credential API
    expect(await page.evaluate(() => Boolean(window.isSecureContext && typeof window.PublicKeyCredential === 'function' && navigator.credentials))).toBe(true);

    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });

    try {
      const listStatus = panel.getByRole('status').first();
      await expect(listStatus).toContainText(/No passkeys yet/i, { timeout: 30_000 });
      await panel.getByLabel('Name (optional)').fill('Work laptop');
      await panel.getByRole('button', { name: 'Add a passkey' }).click();

      // the authenticator really created the credential, for this page's relying party
      await expect.poll(async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials.length).toBe(1);
      const [credential] = (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
      expect(credential.rpId ?? 'localhost').toBe('localhost');
      expect(credential.isResidentCredential).toBe(true);

      // the server kept the row the credential's verify call described, and the screen lists it
      // (the verify POST can land a tick after the credential is created, so wait for it)
      await expect.poll(() => rows.length).toBe(1);
      expect(rows[0].credential_id).toBeTruthy();
      // the added-passkey sentence is the second polite status (the list status stays first)
      await expect(panel.getByRole('status').filter({ hasText: 'Passkey added' })).toBeVisible({ timeout: 30_000 });
      await expect(panel.getByText('1 passkey can sign in to this account.')).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Remove Work laptop' })).toBeVisible();

      // and the list is what the account holds: after a reload the screen reads the same row from
      // the stubbed account (the route and its rows survive the reload; the session is restored)
      await page.reload();
      await openSecuritySettings(page);
      await expect(page.getByRole('region', { name: 'Passkeys' }).getByRole('button', { name: 'Remove Work laptop' })).toBeVisible({ timeout: 30_000 });
    } finally {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await cdp.send('WebAuthn.disable').catch(() => {});
    }

    expect(errors).toEqual([]);
  });

  test('a server with passkeys switched off leaves the screen saying so, with nothing listed', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium (CDP) capability');
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInWithSession(page);
    await stubAuthServer(page, { refuse: true });
    await page.goto('/');
    const panel = await openSecuritySettings(page);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    try {
      await panel.getByRole('button', { name: 'Add a passkey' }).click();
      // the refusal is reported in an alert (never silently), with the server's own reason
      const alert = panel.getByRole('alert');
      await expect(alert).toBeVisible({ timeout: 30_000 });
      await expect(alert).toContainText(/passkeys/i);
      // nothing was invented: no credential, no row, nothing to remove
      expect((await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials).toHaveLength(0);
      await expect(panel.getByRole('button', { name: /^Remove / })).toHaveCount(0);
      await expect(panel.getByRole('status').first()).toContainText(/No passkeys yet/i);
    } finally {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await cdp.send('WebAuthn.disable').catch(() => {});
    }
    expect(errors).toEqual([]);
  });
});
