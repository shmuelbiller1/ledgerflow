/**
 * Attachments on screen (K-07): the files panel lists a record's files, attaches new ones (saved one
 * by one, a too-big one refused with the reason and nothing written), and removes through the server
 * (writers any file, others their own). A new invoice keeps the picked files and hands them over on
 * save; the old box that said "2 file(s) attached" without saving anything is gone. A support ticket's
 * files (BO-05) are read from the ticket's own workspace.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AttachmentsPanel from '../components/common/AttachmentsPanel';
import { attachFiles } from '../services/attachmentActions';
import InvoiceModal from '../components/sales/InvoiceModal';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import { MAX_ATTACHMENT_BYTES } from '../lib/attachments';
import { makeChartAccount, makeCustomer } from './fixtures';
import type { Invoice } from '../types';

type Call = { url: string; method: string; body: unknown };
// the page's File (jsdom's), which its FileReader reads; Node has a File of its own
const PageFile = (window as unknown as { File: typeof File }).File;
const stored = (id: string, name: string, uid: string, createdAt: string) => ({
  id, updated_at: createdAt,
  data: { workspaceId: 'component-workspace', uid, name, fileUrl: 'data:text/plain;base64,aGk=', sizeBytes: 2, createdAt, linkedCollection: 'invoices', linkedId: 'inv1', linkedLabel: 'Invoice INV-1' },
});

describe('The files panel', () => {
  let calls: Call[] = [];
  let rows: ReturnType<typeof stored>[] = [];
  beforeEach(() => {
    calls = [];
    rows = [stored('f1', 'old.pdf', 'someone', '2026-10-01T00:00:00Z'), stored('f2', 'mine.pdf', 'test-user', '2026-10-05T00:00:00Z')];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method || 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      const body = url.includes('/rest/v1/documents') && (init?.method || 'GET') === 'GET' ? rows
        : url.endsWith('/commands/document.save') ? { ok: true, data: { id: `doc-${calls.length}` } }
          : url.includes('/attachments/') ? { status: 'success' } : null;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    window.confirm = () => true;
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });
  const target = { collection: 'invoices' as const, id: 'inv1', label: 'Invoice INV-1' };

  test('lists the record\'s files newest first; attaches a new one; refuses a too-big one with the reason', async () => {
    setComponentWorkspace('bookkeeper');
    render(<AttachmentsPanel target={target} />);
    await waitFor(() => assert.equal(screen.getAllByRole('listitem').length, 2));
    assert.deepEqual(screen.getAllByRole('listitem').map(li => li.querySelector('bdi')?.textContent), ['mine.pdf', 'old.pdf']);
    assert.match(calls.find(c => c.url.includes('/rest/v1/documents'))!.url, /linkedId=eq\.inv1/);

    const input = screen.getByLabelText('Attach files to Invoice INV-1') as HTMLInputElement;
    const big = new PageFile(['x'], 'huge.tif', { type: 'image/tiff' });
    Object.defineProperty(big, 'size', { value: MAX_ATTACHMENT_BYTES + 1 });
    await act(async () => { fireEvent.change(input, { target: { files: [new PageFile(['hello'], 'contract.pdf', { type: 'application/pdf' }), big] } }); });
    // reading the file and saving it can outlast waitFor's 1 s default on a loaded CI runner
    await waitFor(() => assert.equal(screen.getAllByRole('listitem').length, 3), { timeout: 5_000 });
    // the row is written by `document.save`: the command stamps the owner and the workspace from the session
    const writes = calls.filter(c => c.url.includes('/commands/document.save')).map(c => (c.body as { workspaceId: string; input: Record<string, unknown> }));
    assert.equal(writes.length, 1, 'only the file that fits is written');
    assert.deepEqual([writes[0].input.name, writes[0].input.linkedCollection, writes[0].input.linkedId], ['contract.pdf', 'invoices', 'inv1']);
    assert.equal(writes[0].workspaceId, 'component-workspace');
    assert.equal('uid' in writes[0].input, false, 'the owner is the session, never the payload');
    assert.match(String(writes[0].input.fileUrl), /^data:application\/pdf;base64,/);
  });

  test('dropped files use the same size check and durable attachment write as selected files', async () => {
    setComponentWorkspace('bookkeeper');
    render(<AttachmentsPanel target={target} />);
    await waitFor(() => assert.equal(screen.getAllByRole('listitem').length, 2));
    const file = new PageFile(['new file'], 'drop.pdf', { type: 'application/pdf' });
    await act(async () => { fireEvent.drop(screen.getByTestId('attachment-dropzone'), { dataTransfer: { files: [file] } }); });
    // reading the file and saving it can outlast waitFor's 1 s default on a loaded CI runner
    await waitFor(() => assert.equal(screen.getAllByRole('listitem').length, 3), { timeout: 5_000 });
    const writes = calls.filter(c => c.url.includes('/commands/document.save')).map(c => (c.body as { workspaceId: string; input: Record<string, unknown> }));
    assert.equal(writes.length, 1);
    assert.deepEqual([writes[0].input.name, writes[0].input.linkedCollection, writes[0].input.linkedId], ['drop.pdf', 'invoices', 'inv1']);
  });

  test('a record change while FileReader is pending cancels the file write', async () => {
    setComponentWorkspace('bookkeeper');
    let current = true;
    const pending = attachFiles('component-workspace', 'test-user', target, [new PageFile(['cancel me'], 'cancel.pdf', { type: 'application/pdf' })], () => current);
    current = false;
    const result = await pending;
    assert.equal(result.saved.length, 0);
    assert.deepEqual(result.refused.map(file => file.name), ['cancel.pdf']);
    assert.match(result.refused[0].reason, /workspace changed/);
    assert.equal(calls.filter(call => call.url.includes('/commands/document.save')).length, 0);
  });

  test('PDF/image preview stays inside a named dialog and Escape returns to its opener', async () => {
    setComponentWorkspace('viewer');
    const row = stored('image1', 'photo.png', 'someone', '2026-10-06T00:00:00Z');
    rows = [{ ...row, data: { ...row.data, fileUrl: 'data:image/png;base64,AA==', mimeType: 'image/png' } } as never];
    render(<AttachmentsPanel target={target} />);
    await waitFor(() => assert.equal(screen.getAllByRole('listitem').length, 1));
    const opener = screen.getByRole('button', { name: 'Preview photo.png' });
    fireEvent.click(opener);
    assert.ok(screen.getByRole('dialog', { name: 'photo.png' }));
    assert.ok(screen.getByRole('img', { name: 'photo.png' }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'photo.png' }), { key: 'Escape' });
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  });

  test('a support ticket\'s files are read from the ticket\'s own workspace (a platform admin reading feedback)', async () => {
    setComponentWorkspace('viewer');
    const row = stored('s1', 'screen.png', 'someone', '2026-10-06T00:00:00Z');
    rows = [{ ...row, data: { ...row.data, workspaceId: 'their-workspace', linkedCollection: 'supportTickets', linkedId: 't1', linkedLabel: 'Ticket "It broke"' } } as never];
    render(<AttachmentsPanel target={{ collection: 'supportTickets', id: 't1', label: 'Ticket "It broke"' }} workspaceId="their-workspace" />);
    await waitFor(() => assert.equal(screen.getAllByRole('listitem').length, 1));
    const query = calls.find(c => c.url.includes('/rest/v1/documents'))!.url;
    assert.match(query, /their-workspace/);
    assert.doesNotMatch(query, /component-workspace/);
  });

  test('removing goes through the server; a viewer only sees Remove on their own file and cannot attach', async () => {
    setComponentWorkspace('viewer');
    render(<AttachmentsPanel target={target} />);
    await waitFor(() => assert.equal(screen.getAllByRole('listitem').length, 2));
    assert.equal(screen.queryByLabelText('Attach files to Invoice INV-1'), null);
    assert.equal(screen.queryByRole('button', { name: 'Remove old.pdf' }), null);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove mine.pdf' })); });
    await waitFor(() => assert.equal(screen.getAllByRole('listitem').length, 1));
    const removal = calls.find(c => c.method === 'DELETE')!;
    assert.equal(removal.url, '/api/v1/workspaces/component-workspace/attachments/f2');
  });
});

describe('A new invoice', () => {
  beforeEach(() => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ inventory: [], taxRates: [] });
    globalThis.fetch = (async () => new Response('null', { status: 404 })) as typeof fetch;
  });
  afterEach(() => cleanup());

  test('the picked files are handed over on save; nothing claims they were attached before that', async () => {
    const saved: Array<Partial<Invoice> & { attachmentFiles?: File[] }> = [];
    render(<InvoiceModal isOpen onClose={() => {}} onSave={inv => { saved.push(inv); }} customers={[makeCustomer({ id: 'c1', name: 'Acme Ltd' })]}
      accounts={[makeChartAccount({ id: 'rev', name: 'Sales', type: 'income' })]} />);
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'Acme Ltd' } });
    fireEvent.change(screen.getByLabelText('Item / Description'), { target: { value: 'Design' } });
    fireEvent.change(screen.getByLabelText(/^Rate/), { target: { value: '100' } });
    const file = new PageFile(['pdf'], 'brief.pdf', { type: 'application/pdf' });
    fireEvent.change(document.getElementById('inv-attachments')!, { target: { files: [file] } });
    assert.ok(screen.getByRole('button', { name: "Don't attach brief.pdf" }));
    assert.match(document.body.textContent || '', /Kept with the invoice when you save it/);
    await act(async () => { fireEvent.click(screen.getByText('Save Draft')); });
    await waitFor(() => assert.equal(saved.length, 1));
    assert.deepEqual(saved[0].attachmentFiles?.map(f => f.name), ['brief.pdf']);
    assert.equal((saved[0].metadata as Record<string, unknown>).hasAttachments, undefined);
  });
});
