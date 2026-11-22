/**
 * Notifications (src/lib/notifications.ts, src/server/services/notificationService.ts): who gets
 * which type, the person who did it and people who turned a type off are skipped, one event
 * notifies once, invoices that just became overdue (daily), payments received, old ones removed.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { notificationRecipients, typesForRole, workspaceMemberIds } from '../lib/notifications';
import type { Firestore } from '../server/db/pgFirestore';

const workspace = {
  uid: 'owner', members: ['owner', 'acct', 'book', 'view'],
  roles: { acct: 'accountant', book: 'bookkeeper', view: 'viewer', late: 'accountant' },
};

describe('Who is notified', () => {
  test('everyone in the workspace, once', () => {
    assert.deepEqual(workspaceMemberIds(workspace).sort(), ['acct', 'book', 'late', 'owner', 'view']);
  });

  test('by role; never the person who did it; not those who turned the type off', () => {
    assert.deepEqual(notificationRecipients(workspace, 'payment.received', new Map()).sort(), ['acct', 'book', 'late', 'owner']);
    assert.deepEqual(notificationRecipients(workspace, 'payment.received', new Map(), 'book').sort(), ['acct', 'late', 'owner']);
    assert.deepEqual(notificationRecipients(workspace, 'member.invited', new Map()), ['owner']);
    const prefs = new Map([['acct', { 'payment.received': false }], ['owner', { 'payment.received': true }]]);
    assert.deepEqual(notificationRecipients(workspace, 'payment.received', prefs).sort(), ['book', 'late', 'owner']);
  });

  test('viewers only hear that their own role changed (S-15), that they were given a task (BG-02) or mentioned (BG-01), or a new-network sign-in to their own account (S-13)', () => {
    assert.deepEqual(typesForRole('viewer'), ['member.role_changed', 'task.assigned', 'mention.query', 'time.decided', 'record.changed', 'mention.task', 'security.new_sign_in']);
    assert.ok(typesForRole('owner').includes('member.invited'));
    assert.ok(!typesForRole('bookkeeper').includes('member.invited'));
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('Creating notifications', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_ntf_${crypto.randomBytes(4).toString('hex')}`;
  let db: Firestore;
  let svc: typeof import('../server/services/notificationService');
  const u = (name: string) => `${ws}-${name}`;
  const mine = async (name: string) => (await db.collection('notifications').where('workspaceId', '==', ws).where('uid', '==', u(name)).get()).docs.map(d => d.data());

  before(async () => {
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    svc = await import('../server/services/notificationService');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({
      uid: u('owner'), members: [u('owner'), u('acct'), u('book'), u('view')],
      roles: { [u('acct')]: 'accountant', [u('book')]: 'bookkeeper', [u('view')]: 'viewer', [u('late')]: 'accountant' },
      name: 'Notify Co', currency: 'EUR', timezone: 'Pacific/Auckland',
    });
  });

  after(async () => {
    for (const table of ['notifications', 'invoices', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.pool.query(`delete from public.users where id like $1`, [`${ws}-%`]);
    await db.terminate();
  });

  test('one row per person; the same event twice notifies once; choices are respected', async () => {
    await db.collection('users').doc(u('acct')).set({ notificationPrefs: { 'member.joined': false } });
    const input = { workspaceId: ws, kind: 'member.joined' as const, title: 'Dana joined', message: 'As bookkeeper', eventKey: 'member.joined:i1' };
    assert.equal(await svc.notify(db, input), 2, 'owner and the second accountant');
    assert.equal(await svc.notify(db, input), 0, 'same event again');
    assert.equal((await mine('owner')).length, 1);
    assert.equal((await mine('acct')).length, 0, 'accountant turned it off');
    const [row] = await mine('owner');
    assert.equal(row.read, false);
    assert.equal(row.linkTab, 'settings');
  });

  test('a customer payment notifies the team except the person who recorded it; payments made do not', async () => {
    const base = { workspaceId: ws, amountCents: 125000, currency: 'EUR', contactName: 'Acme', date: '2026-09-28' };
    assert.equal(await svc.notifyPaymentReceived(db, { ...base, id: 'p1', direction: 'received' }, u('book')), 3);
    assert.equal(await svc.notifyPaymentReceived(db, { ...base, id: 'p2', direction: 'made' }, u('book')), 0);
    const [row] = await mine('owner').then(r => r.filter(n => n.kind === 'payment.received'));
    assert.match(String(row.title), /1,250\.00/);
    assert.equal((await mine('book')).filter(n => n.kind === 'payment.received').length, 0);
  });

  test('invoices that became overdue in the last week notify once, by the workspace\'s date', async () => {
    const inv = (id: string, fields: Record<string, unknown>) => db.collection('invoices').doc(`${ws}_${id}`).set({ workspaceId: ws, number: id, customerName: 'Acme', amountCents: 5000, status: 'sent', ...fields });
    await inv('late', { dueDate: '2026-09-25' });
    await inv('paid', { dueDate: '2026-09-25', status: 'paid', amountPaidCents: 5000 });
    await inv('draft', { dueDate: '2026-09-25', status: 'draft' });
    await inv('today', { dueDate: '2026-09-28' }); // due today in Auckland: not late yet
    await inv('old', { dueDate: '2026-08-01' });
    const now = new Date('2026-09-27T20:00:00Z'); // 28 Sept 08:00 in Auckland
    const sent = await svc.notifyNewlyOverdue(db, now);
    const overdue = (await mine('owner')).filter(n => n.kind === 'invoice.overdue');
    assert.deepEqual(overdue.map(n => n.title), ['Invoice late is overdue']);
    assert.ok(sent >= 4, 'owner, accountant x2 and bookkeeper');
    await svc.notifyNewlyOverdue(db, now);
    assert.equal((await mine('owner')).filter(n => n.kind === 'invoice.overdue').length, 1, 'not again the next run');
  });

  test('read notifications go after 60 days, all after 180', async () => {
    const put = (id: string, createdAt: string, read: boolean) => db.collection('notifications').doc(`${ws}_${id}`).set({ workspaceId: ws, uid: u('view'), kind: 'invoice.sent', title: id, message: '', read, createdAt });
    await put('old-read', '2026-06-01T00:00:00Z', true);
    await put('old-unread', '2026-06-01T00:00:00Z', false);
    await put('ancient', '2026-01-01T00:00:00Z', false);
    await svc.pruneNotifications(db, new Date('2026-09-28T00:00:00Z'));
    assert.deepEqual((await mine('view')).map(n => n.title).sort(), ['old-unread']);
  });
});
