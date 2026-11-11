/**
 * Client queries (BD-07): owners, accountants and bookkeepers ask about an entry of their own
 * workspace (viewers may not; another workspace's entry is refused); any member answers; the asker's
 * follow-up puts it back to waiting; the asker, an owner or an accountant closes it, and a closed one
 * takes no more answers. Each step notifies the other side once and is in the audit trail. The
 * database part runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';
import { filterQueries, MAX_OPEN_PER_ENTRY, questionProblem, replyProblem, sortQueries, type ClientQuery } from '../lib/clientQueries';

describe('Client query rules', () => {
  test('a question needs 3 to 1000 characters; an answer 1 to 2000', () => {
    assert.match(String(questionProblem('  ')), /at least 3/);
    assert.match(String(questionProblem('ab')), /at least 3/);
    assert.equal(questionProblem('What was this?'), null);
    assert.match(String(questionProblem('x'.repeat(1001))), /under 1000/);
    assert.match(String(replyProblem(' ')), /Write the answer/);
    assert.equal(replyProblem('Office chairs'), null);
    assert.match(String(replyProblem('x'.repeat(2001))), /under 2000/);
    assert.match(String(questionProblem(42)), /at least 3/);
  });

  test('waiting first, then answered, then closed; newest activity first within each', () => {
    const q = (id: string, status: ClientQuery['status'], updatedAt: string) => ({ id, status, updatedAt });
    const sorted = sortQueries([q('a', 'closed', '2026-10-05'), q('b', 'answered', '2026-10-01'), q('c', 'open', '2026-10-01'), q('d', 'open', '2026-10-04'), q('e', 'answered', '2026-10-03')]);
    assert.deepEqual(sorted.map(x => x.id), ['d', 'c', 'e', 'b', 'a']);
    assert.deepEqual(filterQueries(sorted, 'waiting').map(x => x.id), ['d', 'c']);
    assert.deepEqual(filterQueries(sorted, 'closed').map(x => x.id), ['a']);
    assert.equal(filterQueries(sorted, 'all').length, 5);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;
describe('Client queries (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_cq_${crypto.randomBytes(4).toString('hex')}`;
  const other = `${ws}_other`;
  const id = (name: string) => `${ws}_${name}`;
  let db: Firestore;
  let server: Server;
  let base = '';
  const post = async (uid: string, path: string, body: unknown = {}) => {
    const res = await fetch(`${base}/api/v1/workspaces/${ws}/queries${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as { message?: string; data?: { query: ClientQuery } } };
  };
  const notes = async (kind: string) => (await db.pool.query(
    `select data->>'uid' as uid, data->>'eventKey' as key from public.notifications where workspace_id = $1 and data->>'kind' = $2 order by data->>'uid'`, [ws, kind])).rows as Array<{ uid: string; key: string }>;
  const audit = async (action: string) => (await db.pool.query(
    `select count(*)::int as n from public."auditLogs" where workspace_id = $1 and data->>'action' = $2`, [ws, action])).rows[0].n as number;
  const stored = async (queryId: string) => (await db.collection('clientQueries').doc(queryId).get()).data() as Omit<ClientQuery, 'id'>;

  before(async () => {
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({
      uid: 'owner-1', name: 'Questions Co', currency: 'USD',
      members: ['owner-1', 'acct-1', 'book-1', 'book-2', 'view-1'],
      roles: { 'acct-1': 'accountant', 'book-1': 'bookkeeper', 'book-2': 'bookkeeper', 'view-1': 'viewer' },
    });
    await db.collection('workspaces').doc(other).set({ uid: 'owner-2', name: 'Other', members: ['owner-2'] });
    await db.collection('chartAccounts').doc(id('cash')).set({ id: id('cash'), workspaceId: ws, name: 'Bank', code: '1010', type: 'asset' });
    await db.collection('chartAccounts').doc(id('exp')).set({ id: id('exp'), workspaceId: ws, name: 'Supplies', code: '5010', type: 'expense' });
    await db.collection('chartAccounts').doc(`${other}_cash`).set({ id: `${other}_cash`, workspaceId: other, name: 'Bank', code: '1010', type: 'asset' });
    await db.collection('chartAccounts').doc(`${other}_exp`).set({ id: `${other}_exp`, workspaceId: other, name: 'Supplies', code: '5010', type: 'expense' });
    await db.collection('transactions').doc(id('amazon')).set({ workspaceId: ws, uid: 'book-1', date: '2026-09-14', description: 'Amazon', totalAmountCents: 34000, currency: 'USD', lines: [{ accountId: id('cash'), amountCents: -34000 }, { accountId: id('exp'), amountCents: 34000 }], status: 'posted' });
    await db.collection('transactions').doc(id('theirs')).set({ workspaceId: other, uid: 'owner-2', date: '2026-09-14', description: 'Not yours', totalAmountCents: 100, currency: 'USD', lines: [{ accountId: `${other}_cash`, amountCents: -100 }, { accountId: `${other}_exp`, amountCents: 100 }], status: 'posted' });
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: `${req.header('x-test-uid')}@example.test` }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const w of [ws, other]) {
      for (const table of ['clientQueries', 'notifications', 'transactions', 'chartAccounts', 'auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [w]);
    }
    await db.terminate();
  });

  let queryId = '';
  test('a viewer may not ask; another workspace\'s entry and an empty question are refused', async () => {
    assert.equal((await post('view-1', '', { transactionId: id('amazon'), question: 'What was this?' })).status, 403);
    assert.equal((await post('book-1', '', { transactionId: id('theirs'), question: 'What was this?' })).status, 404);
    assert.equal((await post('book-1', '', { transactionId: id('missing'), question: 'What was this?' })).status, 404);
    const empty = await post('book-1', '', { transactionId: id('amazon'), question: ' ' });
    assert.equal(empty.status, 400);
    assert.match(String(empty.body.message), /at least 3/);
    assert.equal((await post('outsider', '', { transactionId: id('amazon'), question: 'What was this?' })).status, 403);
    assert.equal((await db.pool.query(`select count(*)::int as n from public."clientQueries" where workspace_id = $1`, [ws])).rows[0].n, 0);
  });

  test('a bookkeeper asks: stored with the entry, waiting; the owner and the accountant are told', async () => {
    const res = await post('book-1', '', { transactionId: id('amazon'), question: '  What was this $340 at Amazon?  ' });
    assert.equal(res.status, 200);
    queryId = res.body.data!.query.id;
    const q = await stored(queryId);
    assert.equal(q.status, 'open');
    assert.deepEqual(q.entry, { date: '2026-09-14', description: 'Amazon', amountCents: 34000, currency: 'USD' });
    assert.equal(q.askedBy, 'book-1');
    assert.deepEqual(q.messages.map(m => [m.uid, m.text]), [['book-1', 'What was this $340 at Amazon?']]);
    assert.deepEqual((await notes('query.asked')).map(n => n.uid), ['acct-1', 'owner-1']);
    assert.equal(await audit('CLIENT_QUERY_ASKED'), 1);
  });

  test('the owner answers: answered, and the bookkeepers and accountant are told; the asker follows up: waiting again', async () => {
    const answer = await post('owner-1', `/${queryId}/reply`, { text: 'Office chairs for the new hire' });
    assert.equal(answer.status, 200);
    let q = await stored(queryId);
    assert.equal(q.status, 'answered');
    assert.deepEqual((await notes('query.answered')).map(n => n.uid), ['acct-1', 'book-1', 'book-2']);
    const follow = await post('book-1', `/${queryId}/reply`, { text: 'Which receipt goes with it?' });
    assert.equal(follow.status, 200);
    q = await stored(queryId);
    assert.equal(q.status, 'open');
    assert.equal(q.messages.length, 3);
    const asked = await notes('query.asked');
    assert.deepEqual(asked.filter(n => n.uid === 'owner-1').map(n => n.key).sort(), [`query:${queryId}:0`, `query:${queryId}:2`]);
    const viewer = await post('view-1', `/${queryId}/reply`, { text: 'The one from Sept 14 in the shared folder' });
    assert.equal(viewer.status, 200, 'any member may answer');
    assert.equal((await stored(queryId)).status, 'answered');
    assert.equal(await audit('CLIENT_QUERY_ANSWERED'), 2);
    assert.equal(await audit('CLIENT_QUERY_FOLLOW_UP'), 1);
  });

  test('only the asker, an owner or an accountant closes it; a closed question takes no more answers', async () => {
    assert.equal((await post('book-2', `/${queryId}/close`)).status, 403);
    assert.equal((await post('view-1', `/${queryId}/close`)).status, 403);
    assert.equal((await post('book-1', `/${queryId}/close`)).status, 200);
    const q = await stored(queryId);
    assert.equal(q.status, 'closed');
    assert.equal(q.closedBy, 'book-1');
    const late = await post('owner-1', `/${queryId}/reply`, { text: 'One more thing' });
    assert.equal(late.status, 409);
    assert.equal((await post('owner-1', `/${queryId}/close`)).status, 200, 'closing twice is harmless');
    assert.equal(await audit('CLIENT_QUERY_CLOSED'), 1);
  });

  test(`at most ${MAX_OPEN_PER_ENTRY} open questions on one entry; a question id from elsewhere is not found`, async () => {
    for (let i = 0; i < MAX_OPEN_PER_ENTRY; i++) assert.equal((await post('acct-1', '', { transactionId: id('amazon'), question: `Question ${i}` })).status, 200);
    const extra = await post('acct-1', '', { transactionId: id('amazon'), question: 'One too many' });
    assert.equal(extra.status, 409);
    assert.equal((await post('owner-1', '/cq_does_not_exist/reply', { text: 'hi' })).status, 404);
  });

  test('the browser cannot write questions; members read them', async () => {
    const policies = (await db.pool.query(`select cmd from pg_policies where tablename = 'clientQueries'`)).rows.map(r => r.cmd);
    assert.deepEqual(policies, ['SELECT']);
  });
});
