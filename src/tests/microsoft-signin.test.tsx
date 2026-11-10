/**
 * "Continue with Microsoft" (K-40): hidden until the owner turns it on (VITE_MICROSOFT_SIGNIN=true, after the
 * Azure app and the Supabase provider exist); when shown it starts Supabase's Azure sign-in with the email scope.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AuthScreen } from '../core/auth/AuthScreen';
import { microsoftSignInEnabled, signInWithMicrosoft } from '../lib/db/auth';
import { getSupabase } from '../lib/db/client';

afterEach(() => cleanup());

const authScreen = (props: { microsoftSignIn?: boolean } = {}) => (
  <AuthScreen onLogin={() => {}} onEmailLogin={async () => {}} onEmailSignup={async () => {}} onPasswordReset={async () => {}} onGuest={() => {}} language="en" {...props} />
);

test('off by default: the setting is not on in a normal build, and the sign-in screen shows no Microsoft button', () => {
  assert.equal(microsoftSignInEnabled(), false);
  render(authScreen());
  assert.ok(screen.getByRole('button', { name: 'Continue with Google Authentication' }));
  assert.equal(screen.queryByRole('button', { name: 'Continue with Microsoft' }), null);
});

test('turned on: the button is there and starts the Azure sign-in with the email scope, coming back to this site', async () => {
  const auth = getSupabase().auth as unknown as { signInWithOAuth: (input: unknown) => Promise<{ error: null }> };
  const original = auth.signInWithOAuth;
  const calls: Array<{ provider?: string; options?: { scopes?: string; redirectTo?: string } }> = [];
  auth.signInWithOAuth = async (input: unknown) => { calls.push(input as never); return { error: null }; };
  try {
    render(authScreen({ microsoftSignIn: true }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue with Microsoft' })); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].provider, 'azure');
    assert.equal(calls[0].options?.scopes, 'email');
    assert.equal(calls[0].options?.redirectTo, window.location.origin);
  } finally {
    auth.signInWithOAuth = original;
  }
});

test('a refusal from the sign-in service is reported, not swallowed', async () => {
  const auth = getSupabase().auth as unknown as { signInWithOAuth: (input: unknown) => Promise<{ error: { message: string } | null }> };
  const original = auth.signInWithOAuth;
  auth.signInWithOAuth = async () => ({ error: { message: 'Unsupported provider: provider is not enabled' } });
  try {
    await assert.rejects(signInWithMicrosoft(), /not enabled|provider/i);
  } finally {
    auth.signInWithOAuth = original;
  }
});
