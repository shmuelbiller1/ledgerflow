import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Copilot from '../components/intelligence/Copilot';
import AISettings from '../components/platform/settings/AISettings';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useUIStore } from '../stores/useUIStore';
import { DAILY_TOOL_IDS, DAILY_TOOL_LABELS } from '../config/businessNavigation';
import { getSupabase } from '../lib/db/client';

const draft = { id: 'draft-1', createdAt: '2026-11-23T00:00:00Z', expiresAt: '2026-11-24T00:00:00Z', pendingSteps: 0 };
afterEach(async () => { cleanup(); sessionStorage.clear(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('assistant is a visible daily tool; settings no longer pretend to select a model or request a key', () => {
  setComponentWorkspace('owner');
  assert.ok(DAILY_TOOL_IDS.includes('copilot'));
  assert.equal(DAILY_TOOL_LABELS.copilot.en, 'Ask Flo');
  render(<AISettings />);
  assert.ok(screen.getByRole('button', { name: 'Open AI assistant' }));
  assert.equal(screen.queryByText(/Gemini 3\.[18]/), null);
  assert.equal(screen.queryByRole('link', { name: /AI Studio/i }), null);
  assert.equal(screen.queryByLabelText(/API key/i), null);
  fireEvent.click(screen.getByRole('button', { name: 'Open AI assistant' }));
  assert.equal(useUIStore.getState().activeTab, 'copilot');
});

test('chat opens a sandbox, sends a turn to the real endpoint and links its draft for review', async () => {
  setComponentWorkspace('owner');
  let opened = false;
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  globalThis.fetch = (async (input, init) => {
    const path = String(input), method = init?.method || 'GET';
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path.endsWith('/sandboxes') && method === 'GET') return Response.json({ sandboxes: opened ? [draft] : [] });
    if (path.endsWith('/sandboxes') && method === 'POST') { opened = true; return Response.json({ sandbox: draft }); }
    if (path.endsWith('/assistant/turn')) return Response.json({ status: 'success', answer: 'Check **Bank** or **Cash**.', model: 'gpt-6-luna' });
    return Response.json({ message: 'missing' }, { status: 404 });
  }) as typeof fetch;
  render(<Copilot />);
  assert.match(screen.getByText(/Each question is handled independently/).textContent || '', /does not remember/);
  fireEvent.click(await screen.findByRole('button', { name: 'Start assistant' }));
  await waitFor(() => assert.ok(screen.getByLabelText('Draft workspace')));
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Record a payment of 500 from Acme Ltd for INV-1001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  await screen.findByText(/Check/);
  const turn = calls.find(c => c.path.endsWith('/assistant/turn'));
  assert.equal(turn?.path, '/api/v1/workspaces/component-workspace/sandboxes/draft-1/assistant/turn');
  assert.deepEqual(turn?.body, { question: 'Record a payment of 500 from Acme Ltd for INV-1001' });
  assert.equal(calls.some(c => c.path === '/api/ai/process'), false);
  assert.ok(screen.getByText(/gpt-6-luna/));
  assert.ok(screen.getAllByText(/AI answer/).length > 0);
  fireEvent.click(screen.getByRole('button', { name: 'Assistant drafts' }));
  assert.equal(useUIStore.getState().activeTab, 'sandbox-review');
  assert.equal(sessionStorage.getItem('lf_assistant_review_component-workspace'), 'draft-1');
});

test('a failed answer stays visible and warns to check the draft before retrying', async () => {
  setComponentWorkspace('owner');
  globalThis.fetch = (async (input) => String(input).endsWith('/sandboxes')
    ? Response.json({ sandboxes: [draft] }) : Response.json({ status: 'error', code: 'ASSISTANT_MODEL_UNAVAILABLE', message: 'The assistant model is not configured.' }, { status: 503 })) as typeof fetch;
  render(<Copilot />);
  await screen.findByLabelText('Draft workspace');
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Make a bill' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  assert.match((await screen.findByRole('alert')).textContent || '', /model is not configured.*check Assistant drafts/i);
  assert.equal((screen.getByLabelText('Your question') as HTMLTextAreaElement).value, 'Make a bill');
});

test('switching workspaces clears messages even if an old turn completes later', async () => {
  const workspace = setComponentWorkspace('owner');
  let finish: ((response: Response) => void) | undefined;
  globalThis.fetch = (async (input) => String(input).endsWith('/sandboxes')
    ? Response.json({ sandboxes: [draft] }) : new Promise<Response>(resolve => { finish = resolve; })) as typeof fetch;
  render(<Copilot />);
  await screen.findByLabelText('Draft workspace');
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Private question' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  await waitFor(() => assert.ok(finish));
  act(() => useAuthStore.setState({ currentWorkspaceId: 'other', workspaces: [{ ...workspace, id: 'other' }] }));
  await screen.findByLabelText('Draft workspace');
  await act(async () => { finish!(Response.json({ status: 'success', answer: 'Old workspace answer' })); });
  await waitFor(() => assert.equal(screen.queryByText('Private question'), null));
  assert.equal(screen.queryByText('Old workspace answer'), null);
});

test('a failed sandbox list can be retried and guest sessions cannot make assistant calls', async () => {
  setComponentWorkspace('owner');
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return calls === 1
    ? Response.json({ message: 'Connection refused' }, { status: 503 }) : Response.json({ sandboxes: [] }); }) as typeof fetch;
  render(<Copilot />);
  assert.match((await screen.findByRole('alert')).textContent || '', /Connection refused/);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading assistant' }));
  await screen.findByRole('button', { name: 'Start assistant' });
  act(() => useAuthStore.setState({ isGuest: true }));
  assert.ok(screen.getByText(/Sign in and select a workspace/));
  assert.equal(screen.queryByRole('button', { name: 'Start assistant' }), null);
  assert.equal(calls, 2);
});

test('matching settings still send workspace-scoped commands without a model selection', async () => {
  setComponentWorkspace('owner');
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json({ status: 'success', data: {} });
  }) as typeof fetch;
  render(<AISettings />);
  fireEvent.change(screen.getByLabelText(/Matching confidence/), { target: { value: '0.91' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save matching threshold' }));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.match(calls[0].url, /workspace.settings$/);
  assert.deepEqual(calls[0].body, { workspaceId: 'component-workspace', input: { matchingThreshold: 0.91 } });
  fireEvent.click(screen.getByRole('button', { name: 'Clear learned patterns' }));
  await waitFor(() => assert.equal(calls.length, 2));
  assert.match(calls[1].url, /autorule.reset$/);
  assert.deepEqual(calls[1].body, { workspaceId: 'component-workspace', input: {} });
});

test('a viewer asks read-only questions without opening a sandbox', async () => {
  setComponentWorkspace('viewer');
  const calls: Array<{ path: string; body: unknown }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ path: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json({ status: 'success', answer: 'Live books answer', path: 'code' });
  }) as typeof fetch;
  render(<Copilot />);
  assert.ok(screen.getByText(/Employee records are unavailable/));
  assert.equal(screen.queryByRole('button', { name: 'Start assistant' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Assistant drafts' }), null);
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Find customer Acme' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  await screen.findByText('Live books answer');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/v1/workspaces/component-workspace/sandboxes/assistant/turn');
  assert.deepEqual(calls[0].body, { question: 'Find customer Acme' });
});
