import './helpers/dom';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SupportView from '../components/support/SupportView';
import { useSupportStore } from '../stores/useSupportStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';
import { setCookieConsent } from '../lib/cookieConsent';
import { reportClientError } from '../lib/errorTracker';

after(async () => {
  cleanup();
  await getSupabase().removeAllChannels();
  getSupabase().realtime.disconnect();
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

test('the ticket id the screen mints is the id the command writes, and the description rides with it', async () => {
  setComponentWorkspace('owner');
  useSupportStore.setState({ tickets: [], messages: [], selectedTicketId: null });
  const commands: Array<{ workspaceId: string; input: { id: string; subject: string; body: string } }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/commands/support.ticket')) {
      const body = JSON.parse(String(init?.body)) as { workspaceId: string; input: { id: string; subject: string; body: string } };
      commands.push(body);
      return new Response(JSON.stringify({ ok: true, data: { id: body.input.id, messageId: `${body.input.id}-message`, created: true } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    render(<SupportView />);
    fireEvent.click(screen.getByRole('button', { name: 'Create support ticket' }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Question' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));
    await waitFor(() => assert.equal(commands.length, 1));
    // ONE command carries the ticket and its first message: the two rows can no longer land apart, and the id the
    // screen chose is the id that was written, so a retry answers rather than opening a second ticket
    const [sent] = commands;
    assert.match(sent.input.id, /^ticket-[0-9a-f-]{36}$/);
    assert.equal(sent.input.subject, 'Question');
    assert.equal(sent.input.body, 'Please help');
    assert.ok(sent.workspaceId, 'the workspace rides with the command instead of being copied onto the row');
  } finally {
    cleanup();
    globalThis.fetch = realFetch;
  }
});

test('S-35: a support ticket includes only the diagnostic explicitly selected for it', async (t) => {
  for (const scenario of ['no attachment', 'explicit attachment', 'diagnostic replaced'] as const) {
    await t.test(scenario, async (subtest) => {
      setComponentWorkspace('owner');
      setCookieConsent('essential');
      useSupportStore.setState({ tickets: [], messages: [], selectedTicketId: null });
      const sent: Array<Record<string, unknown>> = [];
      const fetchMock = subtest.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        assert.ok(!url.includes('/telemetry/errors'), 'automatic delivery stays off');
        if (url.includes('/commands/support.ticket')) {
          const body = JSON.parse(String(init?.body));
          sent.push(body.input);
          return Response.json({ ok: true, data: { id: body.input.id, created: true } });
        }
        return Response.json([]);
      });
      try {
        const errorId = await reportClientError('Synthetic support diagnostic');
        render(<SupportView />);
        fireEvent.click(screen.getByRole('button', { name: 'Create support ticket' }));
        fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Question' } });
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please help' } });
        const checkbox = screen.getByRole('checkbox', { name: /attach error stack trace/i });
        assert.ok(checkbox instanceof window.HTMLInputElement);
        assert.equal(checkbox.checked, false);
        if (scenario !== 'no attachment') fireEvent.click(checkbox);
        if (scenario === 'diagnostic replaced') await reportClientError('Later synthetic error');
        fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));
        await waitFor(() => assert.equal(sent.length, 1));
        if (scenario === 'explicit attachment') {
          assert.equal(sent[0].errorLogId, errorId);
          assert.equal((sent[0].errorDiagnostics as { message: string }).message, 'Synthetic support diagnostic');
        } else {
          assert.ok(!('errorLogId' in sent[0]));
          assert.ok(!('errorDiagnostics' in sent[0]));
        }
      } finally {
        cleanup();
        fetchMock.mock.restore();
      }
    });
  }
});

test('no ticket is written when a secure identifier cannot be minted', async () => {
  setComponentWorkspace('owner');
  useSupportStore.setState({ tickets: [], messages: [], selectedTicketId: null });
  let writes = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('/commands/support.ticket')) writes++;
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  const originalAlert = globalThis.alert;
  let alerts = 0;
  globalThis.alert = () => { alerts++; };
  try {
    render(<SupportView />);
    fireEvent.click(screen.getByRole('button', { name: 'Create support ticket' }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Question' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please help' } });
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      getRandomValues: () => { throw new Error('unavailable'); },
    } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));
    await waitFor(() => assert.equal(alerts, 1));
    assert.equal(writes, 0);
    assert.equal((screen.getByLabelText('Message') as HTMLTextAreaElement).value, 'Please help');
  } finally {
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
    globalThis.alert = originalAlert;
    cleanup();
    globalThis.fetch = realFetch;
  }
});
