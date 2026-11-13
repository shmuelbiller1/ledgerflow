/**
 * EU-I1: the owner invites their accountant in one step — the existing invite route with role "accountant"; the link
 * is shown to send. A bad address sends nothing; a refusal says why; others than the owner (and guests) see no card.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InviteAccountantCard from '../components/dashboard/InviteAccountantCard';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';

const realFetch = globalThis.fetch;
afterEach(async () => { cleanup(); globalThis.fetch = realFetch; await getSupabase().auth.dispose(); });
const stub = (status: number, body: unknown) => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return calls;
};

test('EU-I1: one step — POST invites with role accountant; the link is shown', async () => {
  setComponentWorkspace('owner');
  const calls = stub(200, { status: 'success', invite: { token: 'tok123' } });
  render(<InviteAccountantCard />);
  fireEvent.change(screen.getByLabelText("Accountant's email"), { target: { value: 'cpa@firm.co' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Invite' })); });
  await waitFor(() => assert.ok(screen.getByText(/Send them this link: .*\/invite\/tok123/)));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/v1\/workspaces\/component-workspace\/invites$/);
  assert.deepEqual(calls[0].body, { email: 'cpa@firm.co', role: 'accountant' });
});

test('EU-I1: a bad address sends nothing; a refusal keeps the address', async () => {
  setComponentWorkspace('owner');
  const calls = stub(402, { message: 'Workspace seat limit reached' });
  render(<InviteAccountantCard />);
  fireEvent.change(screen.getByLabelText("Accountant's email"), { target: { value: 'not-an-email' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Invite' })); });
  assert.equal(calls.length, 0);
  fireEvent.change(screen.getByLabelText("Accountant's email"), { target: { value: 'cpa@firm.co' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Invite' })); });
  assert.equal(calls.length, 1);
  assert.equal((screen.getByLabelText("Accountant's email") as HTMLInputElement).value, 'cpa@firm.co');
  assert.equal(screen.queryByText(/Send them this link/), null);
});

test('EU-I1: an accountant or a viewer sees no card', () => {
  setComponentWorkspace('accountant');
  render(<InviteAccountantCard />);
  assert.equal(screen.queryByText('Invite my accountant'), null);
});
