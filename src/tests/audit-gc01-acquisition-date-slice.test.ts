/**
 * Audit GC-01 (group consolidation review, 22 Nov 2026), as acceptance tests: group totals include
 * a controlled subsidiary only from the date control was obtained. The audit worked case: parent
 * starts with $200 cash/capital; subsidiary starts with $100 cash/capital and earns $20 on
 * 2026-03-01; the parent acquires 100% for $120 on 2026-06-01; the subsidiary earns $30 on
 * 2026-08-01. The May 31 report (before control) must show the parent alone ($200 assets, $0
 * income), and the full year must show $30 of group income — the subsidiary's March profit is not
 * the group's, its August profit is. The real group routes run against synthetic isolated Postgres
 * with a test-injected identity.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getDb } from '../server/db/firestore';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = !!url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

describe('audit GC-01: a subsidiary joins the group from the acquisition date', { skip: !valid && 'dedicated local audit database required' }, () => {
  async function run(check: (ws: string, id: (s: string) => string) => Promise<void>) {
    process.env.DATABASE_URL = url;
    const db = getDb();
    const ws = `ws_audit_gc01_${crypto.randomBytes(5).toString('hex')}`;
    const id = (s: string) => `${ws}_${s}`;
    try {
      await db.collection('workspaces').doc(ws).set({ uid: 'audit-owner', members: ['audit-owner'], name: 'GC-01 group', currency: 'USD', timezone: 'UTC' });
      const parent = `${ws}_parent`;
      const sub = `${ws}_sub`;
      await db.collection('workspaces').doc(parent).set({ uid: 'audit-owner', members: ['audit-owner'], name: 'Parent', currency: 'USD', timezone: 'UTC' });
      await db.collection('workspaces').doc(sub).set({ uid: 'audit-owner', members: ['audit-owner'], name: 'Subsidiary', currency: 'USD', timezone: 'UTC' });
      const post = async (workspaceId: string, txId: string, date: string, description: string, lines: Array<{ accountId: string; amountCents: number }>) => {
        await db.collection('transactions').doc(txId).set({ id: txId, workspaceId, uid: 'audit-owner', date, status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 1, description, lines });
      };
      await db.collection('chartAccounts').doc(id('p_cash')).set({ workspaceId: parent, name: 'Cash', type: 'asset', category: 'Cash' });
      await db.collection('chartAccounts').doc(id('p_cap')).set({ workspaceId: parent, name: 'Capital', type: 'equity', category: 'Equity' });
      await db.collection('chartAccounts').doc(id('s_cash')).set({ workspaceId: sub, name: 'Cash', type: 'asset', category: 'Cash' });
      await db.collection('chartAccounts').doc(id('s_cap')).set({ workspaceId: sub, name: 'Capital', type: 'equity', category: 'Equity' });
      await db.collection('chartAccounts').doc(id('s_sales')).set({ workspaceId: sub, name: 'Sales', type: 'income', code: 'sales' });
      // parent: $200 cash/capital
      await post(parent, id('p_open'), '2026-01-01', 'Opening', [{ accountId: id('p_cash'), amountCents: 20000 }, { accountId: id('p_cap'), amountCents: -20000 }]);
      // subsidiary: $100 cash/capital, $20 March income
      await post(sub, id('s_open'), '2026-01-01', 'Opening', [{ accountId: id('s_cash'), amountCents: 10000 }, { accountId: id('s_cap'), amountCents: -10000 }]);
      await post(sub, id('s_mar'), '2026-03-01', 'March income', [{ accountId: id('s_cash'), amountCents: 2000 }, { accountId: id('s_sales'), amountCents: -2000 }]);
      await check(ws, id);
    } finally {
      for (const table of ['transactions', 'chartAccounts', 'auditLogs', 'workspaces', 'workspaceGroups']) {
        await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1 or data->>'workspaceId' = $1`, [ws]).catch(() => {});
      }
    }
  }

  test('the May report before control shows the parent alone; the full year shows post-acquisition profit only', async () => {
    await run(async (ws, id) => {
      const db = getDb();
      // the parent acquires the subsidiary for $120 on 2026-06-01 (investment in a new asset account),
      // and the subsidiary earns $30 on 2026-08-01
      const parent = `${ws}_parent`;
      const sub = `${ws}_sub`;
      await db.collection('chartAccounts').doc(id('p_inv')).set({ workspaceId: parent, name: 'Investment in Subsidiary', type: 'asset', category: 'Investments' });
      await db.collection('transactions').doc(id('p_buy')).set({
        id: id('p_buy'), workspaceId: parent, uid: 'audit-owner', date: '2026-06-01', status: 'completed', type: 'actual',
        currency: 'USD', exchangeRate: 1, description: 'Acquire subsidiary',
        lines: [{ accountId: id('p_inv'), amountCents: 12000 }, { accountId: id('p_cash'), amountCents: -12000 }],
      });
      await db.collection('transactions').doc(id('s_aug')).set({
        id: id('s_aug'), workspaceId: sub, uid: 'audit-owner', date: '2026-08-01', status: 'completed', type: 'actual',
        currency: 'USD', exchangeRate: 1, description: 'August income',
        lines: [{ accountId: id('s_cash'), amountCents: 3000 }, { accountId: id('s_sales'), amountCents: -3000 }],
      });
      const groupDoc = {
        id: `${ws}_grp`, ownerUid: 'audit-owner', name: 'GC-01 group',
        workspaceIds: [parent, sub], parentId: parent,
        ownership: { [sub]: 100 }, investments: { [sub]: id('p_inv') }, acquired: { [sub]: '2026-06-01' },
      };
      await db.collection('workspaceGroups').doc(groupDoc.id).set(groupDoc);

      const { groupSummary } = await import('../server/reports/groupReport');
      const may = await groupSummary(db, { uid: 'audit-owner', groupId: groupDoc.id, startDate: '2026-01-01', endDate: '2026-05-31' });
      assert.equal(may.total!.income, 0, `before control the group has no income (subsidiary's $20 March profit is not the group's): ${JSON.stringify(may.total)}`);
      assert.equal(may.total!.totalAssets, 20000, `before control the May balance sheet is the parent's alone: ${JSON.stringify(may.total)}`);

      const year = await groupSummary(db, { uid: 'audit-owner', groupId: groupDoc.id, startDate: '2026-01-01', endDate: '2026-12-31' });
      assert.equal(year.total!.income, 3000, `the full year counts the subsidiary's profit from 2026-06-01 on: ${JSON.stringify(year.total)}`);
      console.log(JSON.stringify({ mayAssets: may.total!.totalAssets, mayIncome: may.total!.income, yearIncome: year.total!.income, yearAssets: year.total!.totalAssets }));
    });
  });
});
