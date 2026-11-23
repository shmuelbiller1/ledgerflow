// PC-01 acceptance: a draft dated with a timestamp on the last day of the month is caught by the
// close guard (the guard compares day boundaries, like the posting lock's day truncation), and a
// date-only draft on that day still is.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

test('close refuses drafts dated with a timestamp on the last day of the month', { skip: !valid && 'dedicated local audit database required' }, async () => {
  process.env.DATABASE_URL = url;
  const express = (await import('express')).default;
  const { getDb } = await import('../../src/server/db/firestore');
  const { documentPostRouter } = await import('../../src/server/routes/documentPostRoutes');
  const { closePeriod } = await import('../../src/server/services/periodCloseService');
  const db = getDb();
  const ws = `ws_audit_close_${crypto.randomBytes(5).toString('hex')}`;
  const id = (s: string) => `${ws}_${s}`;
  let server: ReturnType<typeof import('http').createServer> | undefined;

  try {
    await db.collection('workspaces').doc(ws).set({ uid: 'audit-owner', members: ['audit-owner'], name: 'Synthetic close', currency: 'USD', timezone: 'UTC' });
    for (const [key, name, type, category, role] of [
      ['ar', 'Accounts Receivable', 'asset', 'Receivables', ''],
      ['sales', 'Sales', 'revenue', 'Revenue', ''],
      ['cash', 'Cash', 'asset', 'Cash', 'cash'],
    ]) {
      await db.collection('chartAccounts').doc(id(key)).set({ workspaceId: ws, name, type, category, ...(role ? { role } : {}) });
    }
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { (req as never as { user: { uid: string } }).user = { uid: 'audit-owner' }; next(); }); app.use('/api/v1/documents', documentPostRouter);
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server!.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const post = (docId: string, data: Record<string, unknown>, action: 'create' | 'update' = 'create') =>
      fetch(`${base}/api/v1/documents/invoices/${docId}/post`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws, action, data }) });

    // a draft saved with a timestamp on the last day of May
    const tsDraft = { id: id('inv_ts'), workspaceId: ws, customerId: 'synthetic', number: 'DRAFT-TS', date: '2026-05-31T12:00:00Z', dueDate: '2026-06-30', status: 'draft', currency: 'USD', amountCents: 10000, items: [{ id: 'l1', description: 'Service', quantity: 1, rateCents: 10000, amountCents: 10000 }] };
    const create = await post(id('inv_ts'), tsDraft);
    assert.equal(create.status, 200, JSON.stringify(await create.json()));

    // PC-01: the close must refuse while that draft is dated in the period
    const closeErr = await closePeriod(db, { workspaceId: ws, uid: 'audit-owner', month: '2026-05', mode: 'hard' }).then(() => null, e => e);
    assert.ok(closeErr, 'the close refused');
    assert.match(String(closeErr?.message || ''), /draft/i, JSON.stringify(closeErr));
    const saved = (await db.collection('invoices').doc(id('inv_ts')).get()).data()!;
    assert.equal(saved.status, 'draft', 'the draft is still there');
    assert.equal(saved.date, '2026-05-31T12:00:00Z');

    // and the posting lock refuses changing it once the period is closed (after the draft is gone)
    const del = await post(id('inv_ts'), { status: 'void' }, 'update');
    assert.equal(del.status, 200, JSON.stringify(await del.json()));
    const close2 = await closePeriod(db, { workspaceId: ws, uid: 'audit-owner', month: '2026-05', mode: 'hard' });
    assert.equal(close2.lockDate, '2026-05-31', JSON.stringify(close2));

    // a date-only draft on the last day is caught the same way
    const dateOnly = { id: id('inv_do'), workspaceId: ws, customerId: 'synthetic', number: 'DRAFT-DO', date: '2026-06-30', dueDate: '2026-07-30', status: 'draft', currency: 'USD', amountCents: 10000, items: [{ id: 'l1', description: 'Service', quantity: 1, rateCents: 10000, amountCents: 10000 }] };
    const create2 = await post(id('inv_do'), dateOnly);
    assert.equal(create2.status, 200, JSON.stringify(await create2.json()));
    const close3Err = await closePeriod(db, { workspaceId: ws, uid: 'audit-owner', month: '2026-06', mode: 'hard' }).then(() => null, e => e);
    assert.ok(close3Err, 'the June close refused');
    assert.match(String(close3Err?.message || ''), /draft/i, JSON.stringify(close3Err));

    console.log(JSON.stringify({ tsDraftCloseRefused: Boolean(closeErr), dateOnlyCloseRefused: Boolean(close3Err) }));
  } finally {
    if (server) { const srv = server; await new Promise<void>(r => srv.close(() => r())).catch(() => {}); }
    for (const table of ['invoices', 'periods', 'chartAccounts', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]).catch(() => {});
    }
    await db.terminate();
  }
});
