/**
 * Notices by email (S-18): each person chooses no email (the default), an email for each notice, or
 * one summary a day of what they have not read. Emails are escaped; the daily summary groups by
 * workspace and covers only what came since the last one; the choice is kept by the server.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { digestEmail, emailMode, noticeEmail } from '../lib/notificationEmail';
import NotificationDrawer from '../components/layout/NotificationDrawer';
import { useNotificationStore } from '../stores/useNotificationStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';
import type { Firestore } from '../server/db/pgFirestore';

import { BRAND_NAME } from '../config/brand';
const url = process.env.LF_TEST_DATABASE_URL;

describe('The emails', () => {
  test('a notice email escapes what people typed; the summary groups by workspace and says how many', () => {
    const one = noticeEmail({ workspaceName: 'Acme <b>', title: 'Invoice <script>x</script> overdue', message: 'Pay "now" & then' }, 'https://app.example');
    assert.ok(!one.html.includes('<script>') && one.html.includes('&lt;script&gt;') && one.html.includes('&quot;now&quot; &amp; then'));
    assert.equal(one.subject, 'Acme <b>: Invoice <script>x</script> overdue', 'the subject is plain text');
    const digest = digestEmail([
      { workspaceName: 'Acme', title: 'A', message: 'a' }, { workspaceName: 'Beta', title: 'B', message: 'b' }, { workspaceName: 'Acme', title: 'C', message: 'c' },
    ], 'https://app.example')!;
    assert.equal(digest.subject, `${BRAND_NAME}: 3 notices you have not read`);
    assert.match(digest.text, /Acme\n- A: a\n- C: c\n\nBeta\n- B: b/);
    assert.equal(digestEmail([], 'x'), null);
    assert.equal(emailMode('weekly'), 'off');
  });
});

describe('Who gets which email (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_mail_${crypto.randomBytes(4).toString('hex')}`;
  const [now1, daily, off] = [`${ws}_now`, `${ws}_daily`, `${ws}_off`];
  let db: Firestore;
  let mailer: typeof import('../server/services/mailer');
  let svc: typeof import('../server/services/notificationEmailService');
  let notifications: typeof import('../server/services/notificationService');
  const outbox: Array<{ to: string; subject: string; text: string }> = [];
  let server: Server;
  let base = '';

  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../server/db/firestore')).getDb();
    mailer = await import('../server/services/mailer');
    svc = await import('../server/services/notificationEmailService');
    notifications = await import('../server/services/notificationService');
    mailer.setMailTransportForTests(async m => { outbox.push({ to: m.to, subject: m.subject, text: m.text }); return { delivered: true, provider: 'test' }; });
    await db.collection('workspaces').doc(ws).set({ uid: now1, name: 'Mail Co', members: [now1, daily, off], roles: { [daily]: 'accountant', [off]: 'bookkeeper' } });
    for (const [uid, mode] of [[now1, 'immediate'], [daily, 'daily'], [off, 'off']]) {
      await db.collection('users').doc(uid).set({ uid, email: `${uid}@example.com`, notificationEmail: mode });
    }
    const express = (await import('express')).default;
    const { accountRouter } = await import('../server/routes/accountRoutes');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: off }; next(); });
    app.use('/api/v1/account', accountRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    mailer.setMailTransportForTests(null);
    for (const table of ['notifications', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.pool.query('delete from public.users where id = any($1)', [[now1, daily, off]]);
    await db.terminate();
  });

  test('"each as it happens" is emailed at once, once; "one a day" waits for the summary; "off" never', async () => {
    const notice = { workspaceId: ws, kind: 'invoice.overdue' as const, title: 'Invoice INV-7 is overdue', message: 'It was due on 1 Oct.', eventKey: `overdue:${ws}:inv7` };
    assert.equal(await notifications.notify(db, notice), 3);
    assert.equal(await notifications.notify(db, notice), 0, 'the same event is not told twice');
    assert.deepEqual(outbox.map(m => [m.to, m.subject]), [[`${now1}@example.com`, 'Mail Co: Invoice INV-7 is overdue']]);

    outbox.length = 0;
    assert.equal(await svc.runNotificationDigest(db, new Date(Date.now() + 1000)), 1);
    assert.deepEqual(outbox.map(m => m.to), [`${daily}@example.com`]);
    assert.match(outbox[0].text, /Mail Co\n- Invoice INV-7 is overdue: It was due on 1 Oct\./);
    outbox.length = 0;
    assert.equal(await svc.runNotificationDigest(db, new Date(Date.now() + 2000)), 0, 'nothing new since the last summary');
  });

  test('the choice is read and saved by the server; an unknown one is refused', async () => {
    assert.equal(((await (await fetch(`${base}/api/v1/account/notification-email`)).json()) as { mode: string }).mode, 'off');
    const put = (mode: string) => fetch(`${base}/api/v1/account/notification-email`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
    assert.equal((await put('weekly')).status, 400);
    assert.equal((await put('daily')).status, 200);
    assert.equal(await svc.getNotificationEmail(db, off), 'daily');
  });
});

describe('The choice in the bell', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('"By email too" shows the saved choice and saves a new one through the server', async () => {
    setComponentWorkspace('owner');
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      calls.push({ url: u, method: init?.method || 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (u.includes('/api/v1/account/notification-email')) return new Response(JSON.stringify({ status: 'success', mode: 'off' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    useNotificationStore.setState({ notifications: [], isDrawerOpen: true } as never);
    render(<NotificationDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose notifications' }));
    const select = await screen.findByLabelText('By email too') as HTMLSelectElement;
    assert.equal(select.value, 'off');
    fireEvent.change(select, { target: { value: 'daily' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    await waitFor(() => assert.ok(calls.some(c => c.method === 'PUT' && c.url.endsWith('/api/v1/account/notification-email'))));
    assert.deepEqual(calls.find(c => c.method === 'PUT' && c.url.endsWith('/notification-email'))!.body, { mode: 'daily' });
  });
});
