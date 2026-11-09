import './helpers/dom';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SupportView from '../components/support/SupportView';
import { useSupportStore } from '../stores/useSupportStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';

after(async () => {
  cleanup();
  await getSupabase().removeAllChannels();
  getSupabase().realtime.disconnect();
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

test('ticket and fallback message use distinct UUID identifiers and remain linked', async () => {
  setComponentWorkspace('owner');
  useSupportStore.setState({ tickets: [], messages: [], selectedTicketId: null });
  const writes: Array<{ p_table: string; p_id: string; p_data: { id: string; ticketId?: string } }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/rpc/lf_set')) {
      writes.push(JSON.parse(String(init?.body)));
      return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/v1/support/')) return new Response('{}', { status: 503 });
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    render(<SupportView />);
    fireEvent.click(screen.getByRole('button', { name: 'Create support ticket' }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Question' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));
    await waitFor(() => assert.equal(writes.length, 2));
    const [ticket, message] = writes;
    assert.equal(ticket.p_table, 'supportTickets');
    assert.equal(message.p_table, 'supportMessages');
    assert.match(ticket.p_id, /^ticket-[0-9a-f-]{36}$/);
    assert.match(message.p_id, /^msg-[0-9a-f-]{36}$/);
    assert.equal(ticket.p_id, ticket.p_data.id);
    assert.equal(message.p_id, message.p_data.id);
    assert.equal(message.p_data.ticketId, ticket.p_id);
    assert.notEqual(message.p_id.slice(4), ticket.p_id.slice(7));
  } finally {
    cleanup();
    globalThis.fetch = realFetch;
  }
});

test('no ticket is written if a fallback message ID cannot be generated', async () => {
  setComponentWorkspace('owner');
  useSupportStore.setState({ tickets: [], messages: [], selectedTicketId: null });
  let writes = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('/rpc/lf_set')) writes++;
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
    let calls = 0;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      getRandomValues: (bytes: Uint8Array) => { if (++calls === 2) throw new Error('unavailable'); return bytes.fill(1); },
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
