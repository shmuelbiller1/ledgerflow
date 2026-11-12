/**
 * Transaction links (M-10): writers link two entries of the workspace (once; never one to itself),
 * with a note; both entries show the link; viewers read but cannot link; removing it is audited; on
 * screen, the linked entry opens from the edit window.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { otherEnd, type EntryLink } from '../lib/entryLinks';
import EntryLinks from '../components/transactions/EntryLinks';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import { getSupabase } from '../lib/db/client';
import { makeTransaction } from './fixtures';

test('the other end of a link', () => {
  assert.equal(otherEnd({ a: 'x', b: 'y' }, 'x'), 'y');
  assert.equal(otherEnd({ a: 'x', b: 'y' }, 'y'), 'x');
  assert.equal(otherEnd({ a: 'x', b: 'y' }, 'z'), undefined);
});

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_links_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const call = async (uid: string, method: string, path = '', body?: unknown) => {
    const res = await fetch(`${base}/api/v1/workspaces/${ws}/entry-links${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-uid': uid }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Links', members: ['owner-1', 'book-1', 'view-1'], roles: { 'book-1': 'bookkeeper', 'view-1': 'viewer' } });
    const linkLines = [{ accountId: 'link-debit', amountCents: 1 }, { accountId: 'link-credit', amountCents: -1 }];
    for (const id of ['sale', 'refund']) await db.collection('transactions').doc(`${ws}_${id}`).set({ workspaceId: ws, date: '2026-10-01', description: id, status: 'posted', lines: linkLines });
    await db.collection('transactions').doc(`other_${ws}`).set({ workspaceId: 'someone-else', date: '2026-10-01', description: 'x', status: 'posted', lines: linkLines });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    server?.close();
    for (const table of ['documents', 'transactions', 'auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.pool.query(`delete from public.transactions where id = $1`, [`other_${ws}`]);
    await db.terminate();
  });

  test('link once, read from both ends, unlink; only writers; only this workspace\'s entries', async () => {
    const [sale, refund] = [`${ws}_sale`, `${ws}_refund`];
    assert.equal((await call('view-1', 'POST', '', { a: refund, b: sale })).status, 403);
    assert.equal((await call('book-1', 'POST', '', { a: refund, b: refund })).status, 400);
    assert.equal((await call('book-1', 'POST', '', { a: refund, b: `other_${ws}` })).status, 404);
    const made = await call('book-1', 'POST', '', { a: refund, b: sale, note: 'Refund of the sale' });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const id = (made.body.link as EntryLink).id;
    assert.equal(((await call('owner-1', 'POST', '', { a: sale, b: refund })).body.link as EntryLink).id, id, 'once, whichever way round');
    const fromSale = (await call('view-1', 'GET', `?transactionId=${sale}`)).body.links as EntryLink[];
    assert.deepEqual(fromSale.map(l => [l.note, otherEnd(l, sale)]), [['Refund of the sale', refund]]);
    assert.equal((await call('view-1', 'DELETE', `/${id}`)).status, 403);
    assert.equal((await call('book-1', 'DELETE', `/${id}`)).status, 200);
    assert.equal(((await call('book-1', 'GET', `?transactionId=${refund}`)).body.links as EntryLink[]).length, 0);
    const audit = await db.pool.query(`select data->>'action' as a from public."auditLogs" where workspace_id = $1 and data->>'action' like 'ENTRIES_%'`, [ws]);
    assert.deepEqual(audit.rows.map(r => r.a).sort(), ['ENTRIES_LINKED', 'ENTRIES_UNLINKED']);
  });
});

describe('On screen', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('the linked entry shows and opens; link another', async () => {
    setComponentWorkspace('bookkeeper');
    useLedgerStore.setState({ transactions: [
      makeTransaction({ id: 'refund', date: '2026-10-05', description: 'Refund Acme', totalAmountCents: 5000 }),
      makeTransaction({ id: 'sale', date: '2026-10-01', description: 'Sale Acme', totalAmountCents: 5000 }),
      makeTransaction({ id: 'fee', date: '2026-10-02', description: 'Card fee', totalAmountCents: 100 }),
    ] });
    const posts: unknown[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ status: 'success', link: { id: 'l2', kind: 'entryLink', a: 'refund', b: 'fee', createdBy: 'me', createdAt: 'x', workspaceId: 'w' } }), { status: 200 }); }
      return new Response(JSON.stringify({ status: 'success', links: [{ id: 'l1', kind: 'entryLink', a: 'sale', b: 'refund', note: 'Refund of the sale', createdBy: 'x', createdAt: 'x', workspaceId: 'w' }] }), { status: 200 });
    }) as typeof fetch;
    render(<EntryLinks transactionId="refund" />);
    const opener = await screen.findByRole('button', { name: /^2026-10-01 · Sale Acme/ });
    assert.ok(screen.getByText(/Refund of the sale/));
    fireEvent.click(opener);
    assert.deepEqual(useUIStore.getState().focusRecord, { type: 'transaction', id: 'sale' });
    fireEvent.click(screen.getByRole('button', { name: 'Link another entry' }));
    const options = [...(screen.getByLabelText('Entry') as HTMLSelectElement).options].map(o => o.value);
    assert.deepEqual(options, ['', 'fee'], 'neither itself nor what is already linked');
    fireEvent.change(screen.getByLabelText('Entry'), { target: { value: 'fee' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Link' })); });
    assert.deepEqual(posts, [{ a: 'refund', b: 'fee' }]);
    await waitFor(() => assert.ok(screen.getByText(/Linked entries \(2\)/)));
  });
});
