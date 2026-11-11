import './helpers/dom';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PasskeySettings } from '../components/platform/settings/PasskeySettings';
import { AuthError, getAuth, passkeyName, passkeysOff, signInWithPasskey, MAX_PASSKEY_NAME } from '../lib/db/auth';
import { getSupabase } from '../lib/db/client';
import { useAuthStore } from '../stores/useAuthStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { stubFetch } from './helpers/dom';

/** CC-12: passkeys in Security settings and the passkey sign-in. */
type Item = { id: string; friendly_name?: string; created_at: string; last_used_at?: string };
const auth = getSupabase().auth;
let items: Item[];
let calls: string[];
const win = window as unknown as Record<string, unknown>;
const saved = { secure: win.isSecureContext, pkc: win.PublicKeyCredential, creds: (navigator as unknown as Record<string, unknown>).credentials, confirm: window.confirm };

function supportPasskeys(on: boolean) {
  Object.defineProperty(window, 'isSecureContext', { value: on, configurable: true });
  Object.defineProperty(window, 'PublicKeyCredential', { value: on ? function PublicKeyCredential() {} : undefined, configurable: true, writable: true });
  Object.defineProperty(navigator, 'credentials', { value: on ? {} : undefined, configurable: true });
}

beforeEach(() => {
  setComponentWorkspace('viewer');
  stubFetch(); items = []; calls = [];
  supportPasskeys(true);
  window.confirm = () => true;
  mock.method(auth.passkey, 'list', async () => ({ data: items, error: null }));
  mock.method(auth, 'registerPasskey', async () => { calls.push('register'); items.push({ id: 'pk-new', created_at: '2026-11-07T10:00:00Z' }); return { data: { id: 'pk-new', created_at: '2026-11-07T10:00:00Z' }, error: null }; });
  mock.method(auth.passkey, 'update', async ({ passkeyId, friendlyName }: { passkeyId: string; friendlyName: string }) => {
    calls.push(`rename ${passkeyId} ${friendlyName}`);
    items = items.map(i => i.id === passkeyId ? { ...i, friendly_name: friendlyName } : i);
    return { data: items.find(i => i.id === passkeyId), error: null };
  });
  mock.method(auth.passkey, 'delete', async ({ passkeyId }: { passkeyId: string }) => { calls.push(`delete ${passkeyId}`); items = items.filter(i => i.id !== passkeyId); return { data: null, error: null }; });
});
afterEach(async () => {
  cleanup(); mock.restoreAll(); await auth.dispose();
  Object.defineProperty(window, 'isSecureContext', { value: saved.secure, configurable: true });
  Object.defineProperty(window, 'PublicKeyCredential', { value: saved.pkc, configurable: true, writable: true });
  Object.defineProperty(navigator, 'credentials', { value: saved.creds, configurable: true });
  window.confirm = saved.confirm;
});

test('passkey names are trimmed, capped and never empty', () => {
  assert.equal(passkeyName('  Work   laptop '), 'Work laptop');
  assert.equal(passkeyName(''), 'Passkey');
  assert.equal(passkeyName(undefined, 'Phone'), 'Phone');
  assert.equal(passkeyName('x'.repeat(200)).length, MAX_PASSKEY_NAME);
});

test('lists passkeys, adds one with the chosen name and removes one after confirming', async () => {
  items = [{ id: 'pk-1', friendly_name: 'My phone', created_at: '2026-11-01T09:00:00Z', last_used_at: '2026-11-05T09:00:00Z' }];
  render(<PasskeySettings />);
  await waitFor(() => assert.ok(screen.getByText('1 passkey can sign in to this account.')));
  assert.ok(screen.getByText('— added 2026-11-01, last used 2026-11-05'));
  assert.ok(screen.getByRole('button', { name: 'Edit Passkey name: My phone' }));

  fireEvent.change(screen.getByLabelText('Name (optional)'), { target: { value: 'Work laptop' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' })); });
  await waitFor(() => assert.ok(screen.getByText('2 passkeys can sign in to this account.')));
  assert.deepEqual(calls, ['register', 'rename pk-new Work laptop']);
  assert.ok(screen.getByRole('button', { name: 'Edit Passkey name: Work laptop' }));

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove My phone' })); });
  await waitFor(() => assert.ok(screen.getByText('1 passkey can sign in to this account.')));
  assert.ok(calls.includes('delete pk-1'));
});

test('removing is not done without confirmation; a refused add shows the error and changes nothing', async () => {
  items = [{ id: 'pk-1', friendly_name: 'My phone', created_at: '2026-11-01T09:00:00Z' }];
  window.confirm = () => false;
  mock.method(auth, 'registerPasskey', async () => ({ data: null, error: Object.assign(new Error('The operation was cancelled'), { code: 'webauthn_cancelled' }) }));
  render(<PasskeySettings />);
  await waitFor(() => assert.ok(screen.getByText('1 passkey can sign in to this account.')));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove My phone' })); });
  assert.ok(!calls.some(c => c.startsWith('delete')));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' })); });
  await waitFor(() => assert.ok(screen.getByRole('alert').textContent?.includes('cancelled')));
  assert.ok(!calls.some(c => c.startsWith('rename')));
});

test('a passkey whose name fails to save is still listed, and can be renamed in place', async () => {
  mock.method(auth.passkey, 'update', async ({ passkeyId, friendlyName }: { passkeyId: string; friendlyName: string }) => {
    calls.push(`rename ${passkeyId} ${friendlyName}`);
    if (friendlyName === 'Work laptop') return { data: null, error: new Error('Rename refused') };
    items = items.map(i => i.id === passkeyId ? { ...i, friendly_name: friendlyName } : i);
    return { data: items.find(i => i.id === passkeyId), error: null };
  });
  render(<PasskeySettings />);
  await waitFor(() => assert.ok(screen.getByText('No passkeys yet.')));
  fireEvent.change(screen.getByLabelText('Name (optional)'), { target: { value: 'Work laptop' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' })); });
  await waitFor(() => assert.ok(screen.getByText('1 passkey can sign in to this account.')));
  assert.match(screen.getByRole('alert').textContent || '', /name was not saved/);

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit Passkey name: Passkey' })); });
  const box = screen.getByRole('textbox', { name: 'Passkey name' });
  fireEvent.change(box, { target: { value: 'Home desktop' } });
  await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Edit Passkey name: Home desktop' })));
  assert.ok(calls.includes('rename pk-new Home desktop'));
});

test('a failed list load can be retried; passkeys not turned on are named as such', async () => {
  let fail = true;
  mock.method(auth.passkey, 'list', async () => (fail ? { data: null, error: Object.assign(new Error('Network down'), { code: 'request_timeout' }) } : { data: items, error: null }));
  render(<PasskeySettings />);
  await waitFor(() => assert.ok(screen.getByText('Your passkeys could not be loaded.')));
  fail = false;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
  await waitFor(() => assert.ok(screen.getByText('No passkeys yet.')));
  mock.method(auth, 'registerPasskey', async () => ({ data: null, error: Object.assign(new Error('Passkeys are disabled'), { code: 'passkey_disabled' }) }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' })); });
  await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'Passkeys are not turned on for this site yet.'));
});

test('a browser without passkeys says so and offers nothing', async () => {
  supportPasskeys(false);
  render(<PasskeySettings />);
  assert.ok(screen.getByText('This browser cannot use passkeys.'));
  assert.equal(screen.queryByRole('button', { name: 'Add a passkey' }), null);
});

test('guests cannot manage passkeys', () => {
  useAuthStore.setState({ isGuest: true });
  render(<PasskeySettings />);
  assert.ok(screen.getByText('Sign in to manage your passkeys.'));
  assert.equal(screen.queryByRole('button', { name: 'Add a passkey' }), null);
});

const jwt = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
const sessionWith = (aal: string, factors: unknown[]) => ({ access_token: jwt({ aal }), user: { id: 'u-1', email: 'a@b.co', factors, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01' } });

test('a passkey sign-in still asks for the authenticator code when the account has one', async () => {
  mock.method(auth, 'signInWithPasskey', async () => ({ data: { session: sessionWith('aal1', [{ id: 'f-1', factor_type: 'totp', status: 'verified' }]), user: null }, error: null }));
  const cred = await signInWithPasskey(getAuth());
  assert.equal(cred.secondFactorRequired, true);
  mock.method(auth, 'signInWithPasskey', async () => ({ data: { session: sessionWith('aal1', []), user: null }, error: null }));
  assert.equal((await signInWithPasskey(getAuth())).secondFactorRequired, false);
});

test('a failed or cancelled passkey sign-in throws instead of signing in', async () => {
  mock.method(auth, 'signInWithPasskey', async () => ({ data: null, error: Object.assign(new Error('No passkey'), { code: 'webauthn_failed' }) }));
  await assert.rejects(signInWithPasskey(getAuth()), /No passkey/);
});

test('A-275: passkeysOff answers on the code and on the server words, and on nothing else', () => {
  // the code path (Supabase Auth setting off)
  assert.equal(passkeysOff(new AuthError('auth/passkey_disabled', 'Passkeys are disabled')), true);
  assert.equal(passkeysOff(new AuthError('auth/webauthn_not_enabled', 'WebAuthn is not enabled')), true);
  // the words path: the server answers "Passkeys are not enabled for this project" with no matching code
  assert.equal(passkeysOff(new Error('Passkeys are not enabled for this project')), true);
  assert.equal(passkeysOff(new AuthError('auth/passkey-register-failed', 'Passkeys are not enabled for this project')), true);
  // anything else is not "not turned on"
  assert.equal(passkeysOff(new AuthError('auth/webauthn_cancelled', 'The operation was cancelled')), false);
  assert.equal(passkeysOff(new Error('Network down')), false);
  assert.equal(passkeysOff(null), false);
  assert.equal(passkeysOff('Passkeys are not enabled for this project'), false);
});

test('A-275: the server words are shown as "not turned on", never as the raw server text', async () => {
  // no code at all: the old code-only check showed the raw "Passkeys are not enabled for this project"
  mock.method(auth, 'registerPasskey', async () => ({ data: null, error: new Error('Passkeys are not enabled for this project') }));
  render(<PasskeySettings />);
  await waitFor(() => assert.ok(screen.getByText('No passkeys yet.')));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' })); });
  await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'Passkeys are not turned on for this site yet.'));
  assert.ok(!screen.getByRole('alert').textContent?.includes('for this project'));
});
