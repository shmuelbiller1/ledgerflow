import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecordDetailsForm } from '../components/common/RecordDetailsForm';
import { recordDetailsAdapter } from '../lib/recordDetailsAdapter';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });
test('connected drawer saves only the vendor address through the database and reloads the confirmed value', async () => {
 setComponentWorkspace(); let address = 'Old'; const writes: Record<string, unknown>[] = [];
 const vendor = { id: 'vendor', uid: 'test-user', workspaceId: 'component-workspace', name: 'ספק Supply', category: 'Supplier', balanceCents: 4500 };
 useLedgerStore.setState({ vendors: [vendor] });
 globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  // the drawer's fields are a command: the field allowlist, the role and `updatedAt` are the server's
  if (String(input).includes('/commands/record.fields')) {
    const body = JSON.parse(String(init?.body)) as { input: { fields: { address?: string } } };
    writes.push(body as unknown as Record<string, unknown>); address = body.input.fields.address || address;
    return new Response(JSON.stringify({ ok: true, data: { collection: 'vendors', id: 'vendor', fields: ['address'], updatedAt: '2026-01-02T00:00:00Z' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ id: vendor.id, data: { ...vendor, address } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
 }) as typeof fetch;
 const target = { kind: 'vendors' as const, id: vendor.id };
 render(<RecordDetailsForm target={target} adapter={recordDetailsAdapter} />);
 await waitFor(() => assert.ok(screen.getByLabelText('Address')));
 fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'ירושלים\nStreet 7' } }); fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
 await waitFor(() => assert.match(screen.getByRole('status').textContent || '', /saved for future/));
 assert.equal(writes.length, 1);
 const sent = writes[0] as { workspaceId: string; input: { collection: string; id: string; fields: Record<string, unknown>; expected: Record<string, unknown> } };
 assert.deepEqual([sent.input.collection, sent.input.id], ['vendors', 'vendor']);
 // only what the person changed travels: the balance the tab showed is not a field this command can write
 assert.deepEqual(Object.keys(sent.input.fields), ['address']);
 assert.equal(sent.input.fields.address, address);
 assert.equal(sent.input.expected.address, 'Old', 'the value the drawer read rides with the write, so a save in between is a refusal');
 assert.equal(useLedgerStore.getState().vendors[0].balanceCents, 4500);
 cleanup(); render(<RecordDetailsForm target={target} adapter={recordDetailsAdapter} />); await waitFor(() => assert.equal((screen.getByLabelText('Address') as HTMLTextAreaElement).value, address));
});
