import { inlineEditName } from './helpers/inlineEditName';
import './helpers/dom';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TeamSettings from '../components/platform/settings/TeamSettings';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';

const member = 'חבר@example.test';
interface Call { url: string; method: string; body: unknown; signal?: AbortSignal | null }
let calls: Call[];
let status = 200;
let hold: ((response: Response) => void) | null = null;
let deferMutation = false;
beforeEach(() => {
  setComponentWorkspace('owner'); calls = []; status = 200; hold = null; deferMutation = false;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input), method = options.method || 'GET';
    calls.push({ url, method, body: options.body ? JSON.parse(String(options.body)) : undefined, signal: options.signal });
    if (method !== 'GET' && deferMutation) return new Promise<Response>(resolve => { hold = resolve; });
    const data = method !== 'GET' ? (status === 200 ? { status: 'success' } : { status: 'error', message: 'Server refused the change' })
      : url.endsWith('/members') ? { status: 'success', members: [member], ownerUid: 'test-user' }
      : url.endsWith('/roles') ? { status: 'success', roles: { [member]: 'viewer' } }
      : { status: 'success', invites: [] };
    return new Response(JSON.stringify(data), { status: method === 'GET' ? 200 : status });
  };
});
afterEach(() => cleanup());
const mutations = () => calls.filter(call => call.method !== 'GET');
async function openTeam() { render(<TeamSettings />); await waitFor(() => assert.ok(screen.getByRole('button', { name: inlineEditName(`Edit Role of ${member}`) }))); }

test('role changes save through the existing scoped PATCH; refusal keeps the typed selection', async () => {
  await openTeam();
  fireEvent.click(screen.getByRole('button', { name: inlineEditName(`Edit Role of ${member}`) }));
  const input = screen.getByRole('combobox', { name: `Role of ${member}` });
  status = 403;
  fireEvent.change(input, { target: { value: 'accountant' } });
  await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
  await waitFor(() => assert.ok(screen.getByRole('alert')));
  assert.equal((screen.getByRole('combobox', { name: `Role of ${member}` }) as HTMLSelectElement).value, 'accountant');
  assert.deepEqual(mutations()[0].body, { role: 'accountant' });
  assert.equal(mutations()[0].url, `/api/v1/workspaces/component-workspace/roles/${encodeURIComponent(member)}`);
  assert.equal(mutations()[0].method, 'PATCH');
  status = 200;
  await act(async () => fireEvent.keyDown(screen.getByRole('combobox', { name: `Role of ${member}` }), { key: 'Enter' }));
  await waitFor(() => assert.equal(screen.getByRole('button', { name: inlineEditName(`Edit Role of ${member}`) }).textContent, 'Accountant'));
});

test('invitation by typing and Enter validates email and retains draft on server refusal', async () => {
  await openTeam();
  let input = screen.getByRole('textbox', { name: 'Invite team member email' });
  fireEvent.change(input, { target: { value: 'bad-email' } });
  await act(async () => fireEvent.submit(input.closest('form')!));
  assert.equal(mutations().length, 0);
  assert.match(screen.getByRole('alert').textContent || '', /valid email/);
  for (const email of ['a@.test', 'a@test.', 'a@@test.com', `a@${'x'.repeat(100_000)}`]) {
    fireEvent.change(input, { target: { value: email } });
    await act(async () => fireEvent.submit(input.closest('form')!));
    assert.equal(mutations().length, 0);
    assert.match(screen.getByRole('alert').textContent || '', /valid email/);
  }
  status = 403;
  fireEvent.change(input, { target: { value: 'person@example.test' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send invite' })));
  await waitFor(() => assert.ok(screen.getByRole('alert')));
  input = screen.getByRole('textbox', { name: 'Invite team member email' });
  assert.equal((input as HTMLInputElement).value, 'person@example.test');
  status = 200;
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send invite' })));
  await waitFor(() => assert.equal((screen.getByRole('textbox', { name: 'Invite team member email' }) as HTMLInputElement).value, ''));
  assert.deepEqual(mutations().map(call => call.body), [{ email: 'person@example.test', role: 'viewer' }, { email: 'person@example.test', role: 'viewer' }]);
});

test('removal names the member, cancel writes nothing and refused removal remains retryable', async () => {
  await openTeam();
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
  assert.ok(screen.getByRole('dialog', { name: `Remove ${member}?` }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  assert.equal(mutations().length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
  status = 403;
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove member' })));
  await waitFor(() => assert.match(screen.getByRole('alert').textContent || '', /Server refused/));
  status = 200;
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove member' })));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.ok(mutations().every(call => call.method === 'DELETE' && call.url.endsWith(encodeURIComponent(member))));
  assert.equal(screen.queryByRole('button', { name: inlineEditName(`Edit Role of ${member}`) }), null);
});

test('viewer sees role text and no invite editor or mutation controls', async () => {
  setComponentWorkspace('viewer'); render(<TeamSettings />);
  await waitFor(() => assert.ok(screen.getByText(member)));
  assert.equal(screen.queryByRole('button', { name: inlineEditName(`Edit Role of ${member}`) }), null);
  assert.equal(screen.queryByRole('textbox', { name: 'Invite team member email' }), null);
  assert.equal(mutations().length, 0);
  assert.equal(calls.some(call => call.url.endsWith('/invites')), false);
});

test('pending mutation cannot be submitted twice and an old workspace response is discarded', async () => {
  await openTeam(); deferMutation = true;
  fireEvent.click(screen.getByRole('button', { name: inlineEditName(`Edit Role of ${member}`) }));
  const input = screen.getByRole('combobox', { name: `Role of ${member}` });
  fireEvent.change(input, { target: { value: 'accountant' } });
  fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => assert.equal(mutations().length, 1));
  const pending = mutations()[0];
  await act(async () => useAuthStore.setState({ currentWorkspaceId: 'other-workspace', workspaces: [] }));
  assert.equal(pending.signal?.aborted, true);
  await act(async () => hold!(new Response(JSON.stringify({ status: 'success' }), { status: 200 })));
  assert.equal(screen.queryByRole('button', { name: inlineEditName(`Edit Role of ${member}`) }), null);
  assert.equal(mutations().length, 1);
});
