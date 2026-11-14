/**
 * #654: a journal at a foreign rate posts (its total is the settled home-currency debits, which the ledger
 * door accepts) and "Reverse" puts every account back to exactly zero (stored home amounts turn round).
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;

describe('#654 foreign-rate journals (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_fx654_${crypto.randomBytes(4).toString('hex')}`;
  const docId = `${ws}_doc`;
  const handId = `${ws}_hand`;
  const reconciledId = `${ws}_reconciled`;
  const twoStepId = `${ws}_two_step`;
  let db: Firestore;
  let server: Server;
  let base = '';

  const send = (method: string, path: string, body: unknown) => fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../server/db/firestore')).getDb();
    await db.collection('workspaces').doc(ws).set({
      uid: 'owner-1', name: 'Guard Co', currency: 'ILS', members: ['owner-1'],
      accounts: [{ id: 'a', name: 'Cash', type: 'asset', category: 'Cash' }, { id: 'b', name: 'Sales', type: 'income', category: 'Revenue' }],
    });
    const entry = (id: string, metadata: Record<string, unknown>) => ({
      id, workspaceId: ws, uid: 'owner-1', date: '2026-10-01', description: 'Entry', status: 'completed',
      type: 'actual', totalAmountCents: 500, currency: 'USD', exchangeRate: 1,
      lines: [{ accountId: 'a', amountCents: 500 }, { accountId: 'b', amountCents: -500 }],
      ...(Object.keys(metadata).length ? { metadata } : {}),
    });
    await db.collection('transactions').doc(docId).set(entry(docId, { invoiceId: `${ws}_inv`, type: 'invoice-accrual' }));
    await db.collection('transactions').doc(handId).set(entry(handId, {}));
    await db.collection('transactions').doc(reconciledId).set({ ...entry(reconciledId, {}), status: 'reconciled' });
    await db.collection('transactions').doc(twoStepId).set(entry(twoStepId, {}));
    for (const [id, name, type, category] of [['a', 'Bank', 'asset', 'Cash'], ['b', 'Sales', 'income', 'Revenue']]) {
      await db.collection('chartAccounts').doc(`${ws}_${id}`).set({ id: `${ws}_${id}`, workspaceId: ws, uid: 'owner-1', name, type, category, code: id === 'a' ? '1000' : '4000' });
    }
    const express = (await import('express')).default;
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: 'owner-1' }; next(); });
    app.use('/api/v1/transactions', transactionRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'auditLogs', 'chartAccounts', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  const read = async (id: string) => (await db.collection('transactions').doc(id).get()).data() as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  const lines = (r: number, a: number[]) => [{ accountId: `${ws}_a`, amountCents: a[0], exchangeRate: r }, { accountId: `${ws}_b`, amountCents: a[1], exchangeRate: r }, { accountId: `${ws}_b`, amountCents: a[2], exchangeRate: r }];
  const homeOf = (t: Record<string, any> | undefined, account: string) => (t?.lines || []).filter((l: any) => l.accountId === account) // eslint-disable-line @typescript-eslint/no-explicit-any
    .reduce((sum: number, l: any) => sum + (Number.isInteger(l.baseAmountCents) ? l.baseAmountCents : Math.round(l.amountCents * (l.exchangeRate ?? t?.exchangeRate ?? 1))), 0); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const [name, amounts, home] of [['24.70 / 12.35 / 12.35 (one agora to settle)', [2470, -1235, -1235], 9138], ['10.00 / 5.00 / 5.00', [1000, -500, -500], 3700]] as const) {
    test(`a USD journal at 3.7 in ILS books, ${name}: posts at ${home} and reverses back to zero`, async () => {
      const id = `${ws}_${amounts[0]}`;
      const created = await send('POST', '/api/v1/transactions', { transaction: { id, workspaceId: ws, date: '2026-10-01', description: 'FX journal', status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 3.7, lines: lines(3.7, [...amounts]) } });
      assert.equal(created.status, 200, await created.text());
      const entry = await read(id);
      assert.equal(entry?.totalAmountCents, home, 'the total is the settled home-currency debits');
      assert.equal(homeOf(entry, `${ws}_a`) + homeOf(entry, `${ws}_b`), 0, 'balanced in ILS');
      const rev = await send('POST', `/api/v1/transactions/${id}/reverse`, { workspaceId: ws, reason: 'test', reversalDate: '2026-10-02' });
      const revText = await rev.text();
      assert.equal(rev.status, 200, revText);
      const reversal = await read(String((JSON.parse(revText) as { reversal: { id: string } }).reversal.id));
      for (const account of [`${ws}_a`, `${ws}_b`]) assert.equal(homeOf(entry, account) + homeOf(reversal, account), 0, `${account} back to 0.00`);
    });
  }
});
