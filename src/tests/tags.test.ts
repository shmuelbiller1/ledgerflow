/**
 * Tags as one list (K-15): every tag in use across contacts, projects, documents and entries with its
 * counts; rename everywhere, merge by renaming to another tag's name, remove from every record;
 * tags match without regard to case; only the tags change (amounts and the rest stay); writers only;
 * another workspace is never touched. The database part runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';
import { retag } from '../server/services/tagService';

describe('Changing a record\'s tags', () => {
  test('rename, merge without doubles, remove; any case', () => {
    assert.deepEqual(retag(['VIP', 'retail'], 'vip', 'Key account'), ['Key account', 'retail']);
    assert.deepEqual(retag(['vip', 'Key account'], 'VIP', 'Key account'), ['Key account'], 'merging keeps one');
    assert.deepEqual(retag(['vip', 'retail'], 'Vip', null), ['retail']);
    assert.deepEqual(retag(undefined, 'vip', 'x'), []);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;
describe('Tags across the workspace (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_tag_${crypto.randomBytes(4).toString('hex')}`;
  const other = `${ws}_other`;
  const id = (name: string) => `${ws}_${name}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  const call = async (uid: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api/v1/workspaces/${ws}/tags${path}`, {
      method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-test-uid': uid }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() as { message?: string; data?: { tags?: Array<{ tag: string; total: number; byKind: Record<string, number> }>; changed?: number } } };
  };
  const data = async (coll: string, docId: string) => (await db.collection(coll).doc(docId).get()).data() || {};

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Tags', currency: 'USD', members: ['owner-1', 'view-1', 'book-1'], roles: { 'view-1': 'viewer', 'book-1': 'bookkeeper' } });
    await db.collection('customers').doc(id('c1')).set({ workspaceId: ws, name: 'Acme', tags: ['VIP', 'Retail'] });
    await db.collection('customers').doc(id('c2')).set({ workspaceId: ws, name: 'Beta', tags: ['vip'] });
    await db.collection('vendors').doc(id('v1')).set({ workspaceId: ws, name: 'Paper Co', tags: ['Key account'] });
    await db.collection('invoices').doc(id('inv')).set({ workspaceId: ws, number: 'INV-1', amountCents: 5000, status: 'sent', date: '2026-10-01', tags: ['VIP'] });
    await db.collection('transactions').doc(id('tx')).set({ workspaceId: ws, date: '2026-10-01', description: 'Sale', totalAmountCents: 5000, status: 'completed', lines: [{ accountId: 'tag-debit', amountCents: 5000 }, { accountId: 'tag-credit', amountCents: -5000 }], tags: ['vip'] });
    await db.collection('customers').doc(`${other}_c`).set({ workspaceId: other, name: 'Elsewhere', tags: ['VIP'] });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['customers', 'vendors', 'invoices', 'transactions', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = any($1) or id = any($1)`, [[ws, other]]);
    }
    await db.terminate();
  });

  test('every tag with its counts, any case counted together, most used first; a viewer may look', async () => {
    const res = await call('view-1', '');
    assert.equal(res.status, 200);
    const tags = res.body.data!.tags!;
    assert.deepEqual(tags.map(t => [t.tag, t.total]), [['vip', 4], ['Key account', 1], ['Retail', 1]]);
    assert.deepEqual(tags[0].byKind, { customers: 2, invoices: 1, transactions: 1 });
  });

  test('a viewer cannot change tags; renaming is everywhere and changes nothing else', async () => {
    assert.equal((await call('view-1', '/change', { from: 'VIP', to: 'Gold' })).status, 403);
    const res = await call('book-1', '/change', { from: 'VIP', to: 'Gold' });
    assert.deepEqual([res.status, res.body.data?.changed], [200, 4]);
    assert.deepEqual((await data('customers', id('c1'))).tags, ['Gold', 'Retail']);
    assert.deepEqual((await data('transactions', id('tx'))).tags, ['Gold']);
    assert.equal((await data('transactions', id('tx'))).totalAmountCents, 5000);
    assert.equal((await data('invoices', id('inv'))).amountCents, 5000);
    assert.deepEqual((await data('customers', `${other}_c`)).tags, ['VIP'], 'another workspace is not touched');
  });

  test('renaming to an existing tag merges them; removing takes it off every record; both are audited', async () => {
    assert.equal((await call('owner-1', '/change', { from: 'Key account', to: 'gold' })).body.data?.changed, 1);
    assert.deepEqual((await data('vendors', id('v1'))).tags, ['gold']);
    const tags = (await call('owner-1', '')).body.data!.tags!;
    assert.equal(tags.find(t => t.tag.toLowerCase() === 'gold')?.total, 5);
    assert.equal((await call('owner-1', '/change', { from: 'retail', to: null })).body.data?.changed, 1);
    assert.deepEqual((await data('customers', id('c1'))).tags, ['Gold']);
    const audit = (await db.collection('auditLogs').where('workspaceId', '==', ws).get()).docs.map(d => d.data().action).sort();
    assert.deepEqual(audit, ['tag.removed', 'tag.renamed', 'tag.renamed']);
  });

  test('a new name is needed and kept short', async () => {
    assert.deepEqual((await call('owner-1', '/change', { from: 'Gold', to: '  ' })).body.message, 'Type the new name');
    assert.equal((await call('owner-1', '/change', { from: 'Gold', to: 'x'.repeat(51) })).status, 400);
  });
});
