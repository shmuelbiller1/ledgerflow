/**
 * GC-03 follow-ups (Codex/Gitar on PR #1013): the intercompany elimination is linked to each sale and
 * found buyer by buyer.
 *  - full resale: the parent resells all the goods it bought from the subsidiary ($150) to an outside
 *    customer for $200. The group sold goods costing it $100 for $200: income $200, COGS $100, no
 *    unrealized profit (the transfer-price COGS is eliminated, not the seller's real cost).
 *  - per buyer: the subsidiary holds $500 of its own stock bought outside the group. The parent still
 *    holds the $150 bought from the subsidiary, so the whole $50 profit is unrealized — the subsidiary's
 *    own stock does not dilute it, and a same-day external sale's cost by the seller is not taken as the
 *    intercompany cost.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = !!url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

describe('audit GC-03 follow-ups: linked, per-buyer intercompany eliminations', { skip: !valid && 'dedicated local audit database required' }, () => {
  const setup = async (tag: string, extra: (j: (ws: string, id: string, date: string, debit: string, credit: string, cents: number, metadata?: Record<string, unknown>) => Promise<void>, parent: string, sub: string) => Promise<void>, fx?: { parentCurrency: string; purchaseCents: number; query: string }) => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { getDb } = await import('../server/db/firestore');
    const { accountRouter } = await import('../server/routes/accountRoutes');
    const { reportRouter } = await import('../server/routes/reportRoutes');
    const db = getDb();
    const uid = `audit_group_gf_${tag}`, parent = `ws_group_gfp_${tag}`, sub = `ws_group_gfs_${tag}`;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: { uid: string } }).user = { uid }; next(); });
    app.use('/api/v1/account', accountRouter);
    app.use('/api/v1/reports', reportRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(r => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cleanup = async () => {
      await new Promise<void>(r => server.close(() => r()));
      await db.pool.query(`delete from public."workspaceGroups" where data->>'ownerUid'=$1`, [uid]);
      for (const ws of [parent, sub]) {
        for (const table of ['transactions', 'chartAccounts']) await db.pool.query(`delete from public."${table}" where workspace_id=$1`, [ws]);
        await db.pool.query('delete from public.workspaces where id=$1', [ws]);
      }
    };
    try {
      for (const ws of [parent, sub]) {
        await db.collection('workspaces').doc(ws).set({ uid, members: [uid], name: ws, currency: ws === parent && fx ? fx.parentCurrency : 'USD' });
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
      await j(parent, 'purchase', '2026-03-01', 'inventory', 'cash', fx ? fx.purchaseCents : 15000, { isIntercompany: true, sourceWorkspaceId: sub, sourceTxId: `${sub}_sale` });
      await extra(j, parent, sub);
      const call = async (path: string, body?: unknown) => {
        const res = await fetch(`${base}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
        const data = await res.json();
        assert.ok([200, 201].includes(res.status), JSON.stringify(data));
        return data;
      };
      const group = await call('/api/v1/account/groups', { name: 'Synthetic stock group', workspaceIds: [parent, sub], parentId: parent, ownership: { [sub]: 100 }, investments: { [sub]: `${parent}_investment` }, acquired: { [sub]: '2025-02-01' } });
      const report = await call(`/api/v1/reports/group-summary?groupId=${group.group.id}&startDate=2026-01-01&endDate=2026-12-31${fx ? fx.query : ''}`);
      return report.total;
    } finally {
      await cleanup();
    }
  };

  test('goods resold outside the group carry the group\'s original cost, not the transfer price', async () => {
    const t = await setup(crypto.randomBytes(5).toString('hex'), async (j, parent) => {
      await j(parent, 'resale', '2026-06-01', 'cash', 'sales', 20000);
      await j(parent, 'resale-cost', '2026-06-01', 'cogs', 'inventory', 15000, { invoiceId: 'inv-ext-1' });
    });
    console.log(JSON.stringify({ income: t.income, cogs: t.cogs, netIncome: t.netIncome, assets: t.totalAssets, eliminated: t.eliminated }));
    assert.deepEqual([t.income, t.cogs, t.grossProfit, t.netIncome], [20000, 10000, 10000, 10000], `the group sold $100 of goods for $200: ${JSON.stringify(t)}`);
    assert.equal(t.eliminated.unrealizedProfit ?? 0, 0, 'nothing is left unsold inside the group');
    assert.deepEqual([t.totalAssets, t.totalEquity], [35000, 35000], `cash $350, no inventory: ${JSON.stringify(t)}`);
  });

  test('another company\'s own stock does not dilute the buyer\'s unrealized profit', async () => {
    const t = await setup(crypto.randomBytes(5).toString('hex'), async (j, _parent, sub) => {
      // the subsidiary buys $500 of stock from outside and sells $80 of it outside on the same day as the
      // intercompany sale: that $60 cost belongs to its external invoice, not to the intercompany sale
      await j(sub, 'stock', '2026-02-01', 'inventory', 'capital', 50000);
      await j(sub, 'ext-sale', '2026-03-01', 'cash', 'sales', 8000);
      await j(sub, 'ext-cost', '2026-03-01', 'cogs', 'inventory', 6000, { invoiceId: 'inv-ext-2' });
    });
    console.log(JSON.stringify({ income: t.income, cogs: t.cogs, netIncome: t.netIncome, assets: t.totalAssets, eliminated: t.eliminated }));
    assert.equal(t.eliminated.unrealizedProfit, 5000, `the parent still holds all it bought: ${JSON.stringify(t.eliminated)}`);
    assert.deepEqual([t.income, t.cogs, t.netIncome], [8000, 6000, 2000], `only the external sale is the group's: ${JSON.stringify(t)}`);
  });

  test('a buyer keeping other books than the seller: the goods part is taken in one currency', async () => {
    // Codex on #1013: a USD 150 sale costing USD 100, booked by a EUR parent as EUR 135 of inventory
    // (0.9 EUR per USD). All the goods are unsold, so all $50 of the profit is unrealized — dividing
    // EUR 135 by USD 150 directly would call only 90% of the sale goods and leave $5 in the total.
    const rate = 1 / 0.9;
    const rates = encodeURIComponent(JSON.stringify({ EUR: { closing: rate, average: rate, historical: rate } }));
    const t = await setup(crypto.randomBytes(5).toString('hex'), async () => {}, { parentCurrency: 'EUR', purchaseCents: 13500, query: `&reportCurrency=USD&rates=${rates}` });
    console.log(JSON.stringify({ income: t.income, cogs: t.cogs, netIncome: t.netIncome, eliminated: t.eliminated }));
    assert.equal(t.eliminated.unrealizedProfit, 5000, `the whole $50 is unrealized: ${JSON.stringify(t.eliminated)}`);
    assert.equal(t.cogs, 0, `no negative cost of goods is left behind: ${JSON.stringify(t)}`);
  });
});
