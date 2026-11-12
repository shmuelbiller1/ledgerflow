/**
 * Applying a chart-of-accounts template on the server (src/server/services/templateService.ts via
 * POST /api/v1/workspaces/:id/apply-template). The database part runs with LF_TEST_DATABASE_URL.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { sanitizeTemplateAccount } from '../server/services/templateService';
import { BUSINESS_TEMPLATES } from '../lib/businessTemplates';
import type { Firestore } from '../server/db/pgFirestore';

describe('Template accounts', () => {
  test('only known account fields are kept; name and a real type are required', () => {
    assert.deepEqual(
      sanitizeTemplateAccount({ name: ' Rent ', type: 'Expense', code: '6000', hack: 'x', balanceCents: 999, workspaceId: 'other' }),
      { name: 'Rent', type: 'expense', code: '6000' },
    );
    assert.equal(sanitizeTemplateAccount({ name: 'X', type: 'magic' }), null);
    assert.equal(sanitizeTemplateAccount({ type: 'asset' }), null);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('Applying a template', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_tpl_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  const apply = async (uid: string, body: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/v1/workspaces/${ws}/apply-template`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const accounts = async () => (await db.collection('chartAccounts').where('workspaceId', '==', ws).get()).docs.map(d => d.data());

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Tpl', members: ['owner-1', 'book-1'], roles: { 'book-1': 'bookkeeper' } });
    await db.collection('chartAccounts').doc(`${ws}_old`).set({ workspaceId: ws, name: 'Old account', type: 'asset' });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['chartAccounts', 'transactions', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  test('a bookkeeper cannot change the chart of accounts; unknown templates are refused', async () => {
    assert.equal((await apply('book-1', { templateId: 'retail' })).status, 403);
    assert.equal((await apply('owner-1', { templateId: 'nope' })).status, 404);
    assert.equal((await apply('owner-1', { templateId: 'retail', accounts: [] })).status, 400);
  });

  test('a new workspace gets the template accounts (incl. the FX rounding role) and its dashboard', async () => {
    const res = await apply('owner-1', { templateId: 'retail' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const list = await accounts();
    assert.equal(list.length, BUSINESS_TEMPLATES.retail.accounts.length);
    assert.ok(!list.some(a => a.name === 'Old account'));
    assert.ok(list.some(a => a.role === 'fx_rounding'));
    const workspace = (await db.collection('workspaces').doc(ws).get()).data();
    assert.equal(workspace?.businessType, 'retail');
    assert.deepEqual(workspace?.analyticalTopology, BUSINESS_TEMPLATES.retail.topology);
  });

  test('with transactions, only missing accounts are added; AI charts never set the dashboard', async () => {
    await db.collection('transactions').doc(`${ws}_t`).set({ workspaceId: ws, date: '2026-01-01', status: 'draft', lines: [] });
    const before = (await accounts()).length;
    const res = await apply('owner-1', { accounts: [{ name: 'Rent', type: 'expense', code: '6001' }, { name: 'Sales Revenue', type: 'revenue' }, { name: 'Bad', type: 'magic' }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await accounts()).length, before + (BUSINESS_TEMPLATES.retail.accounts.some(a => a.name === 'Sales Revenue') ? 1 : 2));
    const workspace = (await db.collection('workspaces').doc(ws).get()).data();
    assert.equal(workspace?.businessType, 'ai_custom');
    assert.deepEqual(workspace?.analyticalTopology, BUSINESS_TEMPLATES.retail.topology);
  });
});
