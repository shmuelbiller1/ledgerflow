/** Workspace setup/settings compatibility routes run through their named commands. */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;

describe('Workspace setup/settings command routes', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const workspaces = {
    modules: `ws_cmd_modules_${suffix}`,
    opening: `ws_cmd_opening_${suffix}`,
    setup: `ws_cmd_setup_${suffix}`,
    retention: `ws_cmd_retention_${suffix}`,
    numbering: `ws_cmd_numbering_${suffix}`,
    invites: `ws_cmd_invites_${suffix}`,
  };
  let db: Firestore;
  let server: Server;
  let base = '';

  async function send(
    method: 'POST' | 'PUT' | 'DELETE',
    workspaceId: string,
    path: string,
    uid: string,
    body: unknown,
    operationId?: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${base}/api/v1/workspaces/${workspaceId}/${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-test-uid': uid,
        ...(operationId ? { 'x-operation-id': operationId } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  before(async () => {
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    db = getDb();
    for (const [key, workspaceId] of Object.entries(workspaces)) {
      await db.collection('workspaces').doc(workspaceId).set({
        uid: 'owner-1', name: `Workspace ${key}`, currency: 'USD',
        members: ['owner-1', 'acct-1', 'book-1', 'viewer-1'],
        roles: { 'acct-1': 'accountant', 'book-1': 'bookkeeper', 'viewer-1': 'viewer' },
        ...(key === 'retention' ? { retention: { deletionGraceDays: 30, emailLogDays: 90, errorLogDays: 90, legalHold: false } } : {}),
      });
    }
    await db.collection('chartAccounts').doc(`${workspaces.opening}_cash`).set({
      id: `${workspaces.opening}_cash`, workspaceId: workspaces.opening, name: 'Checking', code: '1000', type: 'asset', category: 'Cash', isArchived: false,
    });
    await db.collection('chartAccounts').doc(`${workspaces.opening}_obe`).set({
      id: `${workspaces.opening}_obe`, workspaceId: workspaces.opening, name: 'Opening Balance Equity', code: '3000', type: 'equity', category: 'Equity', isArchived: false,
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const uid = String(req.header('x-test-uid'));
      (req as unknown as { user: { uid: string; email: string; aal: string } }).user = {
        uid, email: `${uid}@example.test`, aal: 'aal2',
      };
      next();
    });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    const ids = Object.values(workspaces);
    for (const table of ['transactions', 'chartAccounts', 'numberingSeries', 'invites', 'idempotencyKeys', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = any($1) or id = any($1)`, [ids]);
    }
    await db.terminate();
  });

  test('invite revocation keeps the legacy response, refuses accepted or foreign invites, and hashes the path target', async () => {
    const workspaceId = workspaces.invites;
    const pendingId = `${workspaceId}_pending`;
    const secondId = `${workspaceId}_second`;
    const acceptedId = `${workspaceId}_accepted`;
    await db.collection('invites').doc(pendingId).set({ id: pendingId, workspaceId, email: 'pending@example.test', role: 'viewer', status: 'pending' });
    await db.collection('invites').doc(secondId).set({ id: secondId, workspaceId, email: 'second@example.test', role: 'viewer', status: 'pending' });
    await db.collection('invites').doc(acceptedId).set({ id: acceptedId, workspaceId, email: 'accepted@example.test', role: 'viewer', status: 'accepted' });

    const denied = await send('DELETE', workspaceId, `invites/${pendingId}`, 'acct-1', {});
    assert.equal(denied.status, 403);
    const missing = await send('DELETE', workspaceId, 'invites/missing-invite', 'owner-1', {});
    assert.equal(missing.status, 404);
    const accepted = await send('DELETE', workspaceId, `invites/${acceptedId}`, 'owner-1', {});
    assert.equal(accepted.status, 409);

    const operationId = 'workspace-invite-revoke-route';
    const first = await send('DELETE', workspaceId, `invites/${pendingId}`, 'owner-1', {}, operationId);
    assert.deepEqual(first, { status: 200, body: { status: 'success', message: 'Invite revoked successfully' } });
    const retried = await send('DELETE', workspaceId, `invites/${pendingId}`, 'owner-1', {}, operationId);
    assert.deepEqual(retried, first);
    const changedTarget = await send('DELETE', workspaceId, `invites/${secondId}`, 'owner-1', {}, operationId);
    assert.equal(changedTarget.status, 409);
    assert.equal((await db.collection('invites').doc(secondId).get()).data()?.status, 'pending');

    const audits = await db.collection('auditLogs').where('workspaceId', '==', workspaceId).get();
    assert.equal(audits.docs.filter(doc => doc.data().action === 'INVITE_REVOKED').length, 1);
  });

  test('next-number keeps the legacy response, reserves atomically, and replays operation IDs once', async () => {
    const workspaceId = workspaces.numbering;
    const invalid = await send('POST', workspaceId, 'next-number', 'owner-1', { type: 'not-a-series' });
    assert.equal(invalid.status, 400);
    assert.match(String(invalid.body.message), /invoice.*bill.*estimate/);

    const operationId = 'workspace-next-number-route';
    const input = { type: 'invoice' };
    const first = await send('POST', workspaceId, 'next-number', 'book-1', input, operationId);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(Object.keys(first.body), ['number']);
    assert.match(String(first.body.number), /^INV-\d{4}-0001$/);
    const retried = await send('POST', workspaceId, 'next-number', 'book-1', input, operationId);
    assert.deepEqual(retried, first);
    const conflict = await send('POST', workspaceId, 'next-number', 'book-1', { type: 'bill' }, operationId);
    assert.equal(conflict.status, 409);

    const series = await db.collection('numberingSeries').doc(`${workspaceId}_invoice`).get();
    assert.equal(series.data()?.nextNumber, 2);
    const audits = await db.collection('auditLogs').where('workspaceId', '==', workspaceId).get();
    assert.equal(audits.docs.filter(doc => doc.data().action === 'DOCUMENT_NUMBER_ALLOCATED').length, 1);
  });

  test('modules keeps the old URL/response and refuses invalid, unauthorized, and conflicting retries', async () => {
    const workspaceId = workspaces.modules;
    const denied = await send('PUT', workspaceId, 'modules', 'book-1', { modules: { payroll: false } });
    assert.equal(denied.status, 403);
    const malformed = await send('PUT', workspaceId, 'modules', 'owner-1', { modules: { payroll: 'off' } });
    assert.equal(malformed.status, 400);
    const unsupported = await send('PUT', workspaceId, 'modules', 'owner-1', { modules: { rockets: true } });
    assert.equal(unsupported.status, 400);

    const operationId = 'workspace-modules-route';
    const input = { modules: { payroll: false } };
    const saved = await send('PUT', workspaceId, 'modules', 'owner-1', input, operationId);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body, { status: 'success', modules: { payroll: false } });
    const retried = await send('PUT', workspaceId, 'modules', 'owner-1', input, operationId);
    assert.equal(retried.status, 200);
    assert.deepEqual(retried.body, saved.body);
    const conflict = await send('PUT', workspaceId, 'modules', 'owner-1', { modules: { payroll: true } }, operationId);
    assert.equal(conflict.status, 409);
    assert.deepEqual((await db.collection('workspaces').doc(workspaceId).get()).data()?.modules, { payroll: false });
    const audits = await db.collection('auditLogs').where('workspaceId', '==', workspaceId).get();
    assert.equal(audits.docs.filter(doc => doc.data().action === 'MODULES_SET').length, 1);
  });

  test('opening balances keeps its old result shape, previews/posts once, and refuses duplicate setup', async () => {
    const workspaceId = workspaces.opening;
    const invalid = await send('POST', workspaceId, 'opening-balances', 'owner-1', { date: '2026-01-01', balances: [{ accountId: 'cash', amountCents: 1.5 }] });
    assert.equal(invalid.status, 400);
    const denied = await send('POST', workspaceId, 'opening-balances', 'book-1', { date: '2026-01-01', balances: [] });
    assert.equal(denied.status, 403);

    const input = { date: '2026-01-01', balances: [{ accountId: `${workspaceId}_cash`, amountCents: 125000 }] };
    const operationId = 'workspace-opening-route';
    const posted = await send('POST', workspaceId, 'opening-balances', 'owner-1', input, operationId);
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.deepEqual(Object.keys(posted.body).sort(), ['creditsCents', 'debitsCents', 'equityCents', 'lines', 'status', 'transactionId'].sort());
    assert.equal(posted.body.debitsCents, 125000);
    assert.equal(posted.body.creditsCents, 125000);
    assert.equal(posted.body.equityCents, 125000);
    assert.equal(typeof posted.body.transactionId, 'string');

    const retried = await send('POST', workspaceId, 'opening-balances', 'owner-1', input, operationId);
    assert.equal(retried.status, 200);
    assert.deepEqual(retried.body, posted.body);
    const duplicate = await send('POST', workspaceId, 'opening-balances', 'owner-1', input, 'workspace-opening-duplicate');
    assert.equal(duplicate.status, 409);
    const transactions = await db.collection('transactions').where('workspaceId', '==', workspaceId).get();
    assert.equal(transactions.size, 1);
    const audits = await db.collection('auditLogs').where('workspaceId', '==', workspaceId).get();
    assert.equal(audits.docs.filter(doc => doc.data().action === 'OPENING_BALANCES_RECORDED').length, 1);
  });

  test('setup-complete remains a success-only response and an idempotent no-op on retry', async () => {
    const workspaceId = workspaces.setup;
    const denied = await send('POST', workspaceId, 'setup-complete', 'viewer-1', {});
    assert.equal(denied.status, 403);
    const operationId = 'workspace-setup-route';
    const completed = await send('POST', workspaceId, 'setup-complete', 'owner-1', {}, operationId);
    assert.deepEqual(completed, { status: 200, body: { status: 'success' } });
    const retried = await send('POST', workspaceId, 'setup-complete', 'owner-1', {}, operationId);
    assert.deepEqual(retried, completed);
    assert.ok((await db.collection('workspaces').doc(workspaceId).get()).data()?.setupCompletedAt);
    const audits = await db.collection('auditLogs').where('workspaceId', '==', workspaceId).get();
    assert.equal(audits.docs.filter(doc => doc.data().action === 'WORKSPACE_SETUP_COMPLETED').length, 1);
  });

  test('retention keeps the old response and enforces owner, schema, and retry checks', async () => {
    const workspaceId = workspaces.retention;
    const settings = { deletionGraceDays: 60, emailLogDays: 365, errorLogDays: 30, legalHold: true };
    const malformed = await send('PUT', workspaceId, 'retention', 'owner-1', { ...settings, errorLogDays: 1 });
    assert.equal(malformed.status, 400);
    const denied = await send('PUT', workspaceId, 'retention', 'acct-1', settings);
    assert.equal(denied.status, 403);

    const operationId = 'workspace-retention-route';
    const saved = await send('PUT', workspaceId, 'retention', 'owner-1', settings, operationId);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body, { status: 'success', retention: settings });
    const retried = await send('PUT', workspaceId, 'retention', 'owner-1', settings, operationId);
    assert.deepEqual(retried, saved);
    const conflict = await send('PUT', workspaceId, 'retention', 'owner-1', { ...settings, deletionGraceDays: 90 }, operationId);
    assert.equal(conflict.status, 409);
    assert.deepEqual((await db.collection('workspaces').doc(workspaceId).get()).data()?.retention, settings);
    const audits = await db.collection('auditLogs').where('workspaceId', '==', workspaceId).get();
    assert.equal(audits.docs.filter(doc => doc.data().action === 'LEGAL_HOLD_ON').length, 1);
  });
});
