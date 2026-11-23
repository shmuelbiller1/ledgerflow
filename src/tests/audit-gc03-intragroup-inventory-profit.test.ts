/**
 * Audit GC-03 (P1): intragroup inventory profit must be eliminated. The audit's worked case: an
 * established 100%-owned subsidiary with $100 inventory/capital; the parent buys the shares for
 * $100 at book value. During the year the subsidiary sells the whole inventory to the parent for
 * $150 cash (the sale and purchase are marked and paired as intercompany; the separate $100 COGS
 * journal is unmarked). The parent holds the entire inventory at year-end; there are no external
 * sales. The group's total must be $250 assets/equity and $0 net income: cash $150 plus inventory
 * at the group's original $100 cost, with the $50 unrealized profit removed (IFRS 10 B86(c)).
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = !!url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

describe('audit GC-03: the profit on inventory still inside the group is eliminated', { skip: !valid && 'dedicated local audit database required' }, () => {
  test('the unrealized intragroup inventory profit leaves the group total', async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { getDb } = await import('../server/db/firestore');
    const { accountRouter } = await import('../server/routes/accountRoutes');
    const { reportRouter } = await import('../server/routes/reportRoutes');
    const db = getDb();
    const tag = crypto.randomBytes(5).toString('hex');
    const uid = `audit_group_inv_${tag}`, parent = `ws_group_ip_${tag}`, sub = `ws_group_is_${tag}`;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: { uid: string } }).user = { uid }; next(); });
    app.use('/api/v1/account', accountRouter);
    app.use('/api/v1/reports', reportRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(r => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for (const ws of [parent, sub]) {
        await db.collection('workspaces').doc(ws).set({ uid, members: [uid], name: ws, currency: 'USD' });
        for (const [name, type] of [['cash', 'asset'], ['inventory', 'asset'], ['capital', 'equity'], ['sales', 'income'], ['cogs', 'cost_of_goods'], ['investment', 'asset']]) {
          await db.collection('chartAccounts').doc(`${ws}_${name}`).set({ workspaceId: ws, name, type, code: name, ...(name === 'cash' ? { category: 'Cash' } : {}) });
        }
      }
      const j = async (ws: string, id: string, date: string, debit: string, credit: string, cents: number, metadata: Record<string, unknown> = {}) => {
        await db.collection('transactions').doc(`${ws}_${id}`).set({ workspaceId: ws, date, description: id, status: 'completed', type: 'actual', currency: 'USD', totalAmountCents: cents, metadata, lines: [{ accountId: `${ws}_${debit}`, amountCents: cents }, { accountId: `${ws}_${credit}`, amountCents: -cents }] });
      };
      await j(parent, 'capital', '2025-01-01', 'cash', 'capital', 25000);
      await j(sub, 'capital', '2025-01-01', 'inventory', 'capital', 10000);
      await j(parent, 'buy', '2025-02-01', 'investment', 'cash', 10000);
      await j(sub, 'sale', '2026-03-01', 'cash', 'sales', 15000, { isIntercompany: true, targetWorkspaceId: parent, targetTxId: `${parent}_purchase` });
      await j(sub, 'cost', '2026-03-01', 'cogs', 'inventory', 10000);
      await j(parent, 'purchase', '2026-03-01', 'inventory', 'cash', 15000, { isIntercompany: true, sourceWorkspaceId: sub, sourceTxId: `${sub}_sale` });
      const call = async (path: string, body?: unknown) => {
        const res = await fetch(`${base}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
        const data = await res.json();
        assert.ok([200, 201].includes(res.status), JSON.stringify(data));
        return data;
      };
      const group = await call('/api/v1/account/groups', { name: 'Synthetic stock group', workspaceIds: [parent, sub], parentId: parent, ownership: { [sub]: 100 }, investments: { [sub]: `${parent}_investment` }, acquired: { [sub]: '2025-02-01' } });
      const report = await call(`/api/v1/reports/group-summary?groupId=${group.group.id}&startDate=2026-01-01&endDate=2026-12-31`);
      const t = report.total;
      console.log(JSON.stringify({ income: t.income, cogs: t.cogs, grossProfit: t.grossProfit, expense: t.expense, netIncome: t.netIncome, assets: t.totalAssets, equity: t.totalEquity, eliminated: t.eliminated }));
      // the sale and its cost are eliminated; the $50 profit still in the parent's inventory is not the group's
      assert.deepEqual([t.income, t.cogs, t.grossProfit, t.expense, t.netIncome], [0, 0, 0, 0, 0], `the P&L is the group's own, with no unrealized inventory profit: ${JSON.stringify(t)}`);
      assert.deepEqual([t.totalAssets, t.totalEquity], [25000, 25000], `assets are cash $150 plus inventory at the group's original $100 cost: ${JSON.stringify(t)}`);
      assert.equal(t.eliminated.unrealizedProfit, 5000, `the unrealized profit is said: ${JSON.stringify(t.eliminated)}`);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
      await db.pool.query(`delete from public."workspaceGroups" where data->>'ownerUid'=$1`, [uid]);
      for (const ws of [parent, sub]) {
        for (const table of ['transactions', 'chartAccounts']) await db.pool.query(`delete from public."${table}" where workspace_id=$1`, [ws]);
        await db.pool.query('delete from public.workspaces where id=$1', [ws]);
      }
    }
  });
});
