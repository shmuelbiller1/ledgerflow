import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { Firestore } from '../server/db/firestore';
import type { RequestUser } from '../server/auth/requestUser';
import { setMailTransportForTests } from '../server/services/mailer';

const url = process.env.LF_TEST_DATABASE_URL;

describe('Support thread compatibility on PostgreSQL', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `support-${randomUUID()}`;
  const ticketId = `${ws}-ticket`;
  const former = `${ws}-former`;
  const member = `${ws}-viewer`;
  const outsider = `${ws}-outsider`;
  const admin = `${ws}-admin`;
  const openerEmail = 'opener@example.test';
  let db: Firestore;
  let server: Server;
  let base: string;
  const deliveries: Array<{ to: string; subject: string; status: unknown; audits: number }> = [];
  let failDelivery = false;
  const audits = (action: string) => db.collection('auditLogs').where('workspaceId', '==', ws).where('action', '==', action).get();
  const ticket = () => db.collection('supportTickets').doc(ticketId);
  const replies = () => db.collection('supportMessages').where('ticketId', '==', ticketId).get();

  const request = async (method: string, path: string, uid: string, body: unknown, key = 'legacy-repeat') => {
    const res = await fetch(`${base}/api/v1/${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-test-uid': uid, 'idempotency-key': key }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const reply = (uid: string, body: unknown, id = ticketId) => request('POST', `support/tickets/${id}/messages`, uid, body);
  const move = (uid: string, body: unknown, id = ticketId) => request('PATCH', `support/tickets/${id}/status`, uid, body);

  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../server/db/firestore')).getDb();
    await db.collection('workspaces').doc(ws).set({ uid: `${ws}-owner`, members: [member], roles: { [member]: 'viewer' }, name: 'Support test' });
    await db.collection('users').doc(former).set({ uid: former, email: openerEmail });
    await ticket().set({ workspaceId: ws, uid: former, subject: 'An older ticket', status: 'open', unreadForUser: false, unreadForAdmin: false });
    setMailTransportForTests(async mail => {
      deliveries.push({ to: mail.to, subject: mail.subject, status: (await ticket().get()).data()?.status, audits: (await audits('SUPPORT_ADMIN_REPLY')).size });
      if (failDelivery) throw new Error('test delivery failure');
      return { delivered: true, provider: 'test' };
    });
    const express = (await import('express')).default;
    const { supportRouter } = await import('../server/routes/supportRoutes');
    const { commandRouter } = await import('../server/routes/commandRoutes');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const uid = String(req.header('x-test-uid'));
      const user: RequestUser = { uid, ...(uid === admin ? { admin: true } : {}), ...(uid === 'api-key' ? { usedApiKeyId: 'test-key' } : {}) };
      Object.assign(req, { user });
      next();
    });
    app.use('/api/v1/support', supportRouter);
    app.use('/api/v1/commands', commandRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    setMailTransportForTests(null);
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (!db) return;
    for (const table of ['supportMessages', 'supportTickets', 'auditLogs', 'idempotencyKeys']) {
      await db.pool.query(`delete from public."${table}" where workspace_id in ($1, $2)`, [ws, `person:${admin}`]);
    }
    await db.collection('users').doc(former).delete();
    await db.collection('workspaces').doc(ws).delete();
    await db.terminate();
  });

  test('refusals leave the thread unchanged; membership is not required of the opener', async () => {
    assert.deepEqual(await reply(outsider, { body: 'No', authorRole: 'user' }), { status: 403, body: { error: 'Forbidden: Access denied to this workspace' } });
    assert.deepEqual(await reply(member, { body: 'No', authorRole: 'admin' }), { status: 403, body: { error: 'Forbidden: Admin role required' } });
    assert.deepEqual(await move(member, { status: 'closed' }), { status: 403, body: { error: 'Forbidden' } });
    assert.deepEqual(await reply(member, { body: 'Missing', authorRole: 'user' }, `${ws}-missing`), { status: 400, body: { error: 'Ticket not found' } });
    const invalid = await reply(former, { body: '', authorRole: 'user' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'Validation failed');
    assert.equal(invalid.body.details[0].message, 'Message body is required');
    assert.equal((await replies()).size, 0);
    assert.equal(deliveries.length, 0);
    const first = await reply(former, { body: '  Please look again.  ', authorRole: 'user' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body.data, {
      id: first.body.data.id, ticketId, workspaceId: ws, authorUid: former, authorRole: 'user', body: '  Please look again.  ', createdAt: first.body.data.createdAt,
    });
    assert.equal((await reply(member, { body: 'Still waiting', authorRole: 'user' })).status, 200);
    assert.equal((await replies()).size, 2, 'the legacy address ignores a repeated operation header');
    const saved = (await ticket().get()).data();
    assert.deepEqual([saved?.lastMessageBy, saved?.status, saved?.unreadForUser, saved?.unreadForAdmin], [member, 'pending_support', false, true]);
  });

  test('the platform audit and unread flags commit before notification, and failed delivery is nonfatal', async () => {
    failDelivery = true;
    try {
      const sent = await reply(admin, { body: 'Please retry tomorrow.', authorRole: 'admin' });
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      assert.equal(sent.body.data.authorUid, admin);
      assert.deepEqual(deliveries, [{ to: openerEmail, subject: 'Support Update: An older ticket', status: 'pending_user', audits: 1 }]);
      const saved = (await ticket().get()).data();
      assert.deepEqual([saved?.lastMessageBy, saved?.unreadForUser, saved?.unreadForAdmin], [admin, true, false]);
      const log = (await audits('SUPPORT_ADMIN_REPLY')).docs[0]?.data();
      assert.equal(log?.entityType, 'supportTicket');
      assert.deepEqual(log?.details, { description: `Admin replied to support ticket ${ticketId}`, body: 'Please retry tomorrow.' });
      assert.deepEqual(await move(admin, { status: 'resolved' }), { status: 200, body: { status: 'ok' } });
      assert.deepEqual(await move(admin, { status: 'resolved' }), { status: 200, body: { status: 'ok' } });
      assert.equal((await audits('SUPPORT_TICKET_STATUS_CHANGE')).size, 2);
      const moved = (await ticket().get()).data();
      assert.deepEqual([moved?.status, moved?.unreadForUser, moved?.unreadForAdmin], ['resolved', true, false]);
    } finally { failDelivery = false; }
  });

  test('named commands preview without saving and recheck ticket authority before replay', async () => {
    const path = 'commands/support.reply';
    const input = { ticketId, authorRole: 'admin', body: 'Saved once.' };
    const before = await replies();
    const attempts = deliveries.length;
    const preview = await request('POST', `${path}/preview`, admin, { input }, 'named-reply');
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal((await replies()).size, before.size);
    assert.equal(deliveries.length, attempts);
    assert.equal((await request('POST', path, 'api-key', { input }, 'named-reply')).body.code, 'PERSON_ONLY');
    const first = await request('POST', path, admin, { input }, 'named-reply');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.replayed, false);
    const again = await request('POST', path, admin, { input }, 'named-reply');
    assert.deepEqual(again.body, { ...first.body, replayed: true });
    assert.equal((await request('POST', path, admin, { input: { ...input, body: 'Changed' } }, 'named-reply')).status, 409);
    assert.equal((await request('POST', path, member, { input }, 'named-reply')).body.code, 'ADMIN_REQUIRED');
    assert.equal((await replies()).size, before.size + 1);
    assert.equal(deliveries.length, attempts + 1);

    const statusPath = 'commands/support.platformstatus';
    const change = { input: { ticketId, status: 'closed' } };
    const statusAudits = (await audits('SUPPORT_TICKET_STATUS_CHANGE')).size;
    assert.equal((await request('POST', `${statusPath}/preview`, admin, change, 'named-move')).status, 200);
    assert.equal((await request('POST', statusPath, member, change, 'named-move')).body.code, 'ADMIN_REQUIRED');
    assert.equal((await request('POST', statusPath, admin, change, 'named-move')).body.replayed, false);
    assert.equal((await request('POST', statusPath, admin, change, 'named-move')).body.replayed, true);
    assert.equal((await audits('SUPPORT_TICKET_STATUS_CHANGE')).size, statusAudits + 1);
    assert.equal((await ticket().get()).data()?.unreadForUser, true);
  });
});
