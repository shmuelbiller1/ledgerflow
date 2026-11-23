// DL-01 acceptance: deliverOrder labels both legs of its entry with the location, so Balance Sheet
// by Location stays balanced; undoDelivery refuses dates before the delivery it reverses; and the
// delivery accounts must be an asset (Inventory) and an expense (COGS).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { computeBalanceSheet } from '../../src/server/reports/computeReports';
import type { ChartAccount, Transaction } from '../../src/types';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

test('deliverOrder balances the location and undoDelivery refuses pre-delivery dates', { skip: !valid && 'dedicated local audit database required' }, async () => {
  process.env.DATABASE_URL = url;
  const { getDb } = await import('../../src/server/db/firestore');
  const { deliverOrder, undoDelivery } = await import('../../src/server/services/deliveryService');
  const db = getDb();
  const ws = `ws_audit_del_${crypto.randomBytes(5).toString('hex')}`;
  const id = (s: string) => `${ws}_${s}`;

  try {
    await db.collection('workspaces').doc(ws).set({
      uid: 'audit-owner', members: ['audit-owner'], name: 'Synthetic Multi-Warehouse Co',
      currency: 'USD', timezone: 'UTC', goodsLeaveWith: 'delivery',
    });
    for (const [key, name, type, category] of [
      ['inv', 'Inventory Asset', 'asset', 'Inventory'],
      ['cogs', 'Cost of Goods Sold', 'expense', 'Cost of Goods Sold'],
      ['eq', 'Owner Equity', 'equity', 'Equity'],
      ['liab', 'Payables', 'liability', 'Payables'],
    ]) {
      await db.collection('chartAccounts').doc(id(key)).set({ workspaceId: ws, name, type, category });
    }
    await db.collection('inventory').doc(id('item1')).set({
      workspaceId: ws, name: 'Industrial Pump', sku: 'IP-100', quantityAtHand: 10, unitCostCents: 25_000,
      quantityByLocation: { warehouse_east: 10 },
    });

    // Opening stock in warehouse_east (balanced within the location): +$2,500 Inventory / -$2,500 Equity
    await db.collection('transactions').doc(id('tx_open')).set({
      workspaceId: ws, uid: 'audit-owner', date: '2026-02-01', description: 'Opening warehouse_east stock',
      totalAmountCents: 250_000, currency: 'USD', exchangeRate: 1, status: 'completed', type: 'actual',
      lines: [
        { accountId: id('inv'), accountName: 'Inventory Asset', amountCents: 250_000, debitCents: 250_000, creditCents: 0, dimensions: { location: 'warehouse_east' } },
        { accountId: id('eq'), accountName: 'Owner Equity', amountCents: -250_000, debitCents: 0, creditCents: 250_000, dimensions: { location: 'warehouse_east' } },
      ],
    });

    await db.collection('estimates').doc(id('ord1')).set({
      workspaceId: ws, number: 'SO-101', status: 'accepted', orderedAt: '2026-03-10T12:00:00Z', customerId: id('c1'), customerName: 'Acme Corp',
      date: '2026-03-10', currency: 'USD', amountCents: 80_000,
      lines: [{ id: 'l1', itemId: id('item1'), description: 'Industrial Pump', quantity: 2, rateCents: 40_000, amountCents: 80_000 }],
    });

    // Deliver 2 units ($500 cost) from warehouse_east on 2026-03-20:
    await deliverOrder(db, {
      workspaceId: ws, uid: 'audit-owner', email: 'audit@example.test',
      orderId: id('ord1'), deliveryId: id('del1'), date: '2026-03-20',
      lines: [{ position: 0, quantity: 2 }], inventoryAccountId: id('inv'), cogsAccountId: id('cogs'),
      locationId: 'warehouse_east',
    });

    const accounts = (await db.collection('chartAccounts').where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id } as ChartAccount));
    const txs = (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id } as Transaction));
    const locTxs = txs.map(tx => ({
      ...tx,
      lines: (tx.lines || []).filter(l => (l.dimensions as Record<string, string> | undefined)?.location === 'warehouse_east'),
    })).filter(tx => tx.lines.length > 0);

    const locBs = computeBalanceSheet(accounts, locTxs, '2026-03-31');
    // warehouse_east: Inventory $2,000, Equity $2,500 less $500 COGS -> balanced
    assert.equal(locBs.totalAssets, 200_000, 'DL-01: the Inventory credit leg carries the location label');
    assert.equal(locBs.totalClaims, 200_000);
    assert.equal(locBs.isBalanced, true, 'DL-01: Balance Sheet by Location is balanced');

    // DL-01: a reversal cannot be dated before the delivery it reverses
    await assert.rejects(
      undoDelivery(db, {
        workspaceId: ws, uid: 'audit-owner', email: 'audit@example.test',
        orderId: id('ord1'), deliveryId: id('del1'), date: '2026-01-15',
      }),
      /cannot be dated before the delivery it reverses/,
    );

    // an undo on the delivery's own date or later still works
    const undone = await undoDelivery(db, {
      workspaceId: ws, uid: 'audit-owner', email: 'audit@example.test',
      orderId: id('ord1'), deliveryId: id('del1'), date: '2026-03-25',
    });
    assert.equal(undone.reversed.length, 1);

    // DL-01: the accounts must be the right kind: Inventory is an asset, COGS an expense
    await assert.rejects(
      deliverOrder(db, {
        workspaceId: ws, uid: 'audit-owner', email: 'audit@example.test',
        orderId: id('ord1'), deliveryId: id('del2'), date: '2026-03-22',
        lines: [{ position: 0, quantity: 2 }], inventoryAccountId: id('inv'), cogsAccountId: id('eq'),
      }),
      /Cost of Goods Sold account .* must be an expense (or cost_of_goods )?account/,
    );
    await assert.rejects(
      deliverOrder(db, {
        workspaceId: ws, uid: 'audit-owner', email: 'audit@example.test',
        orderId: id('ord1'), deliveryId: id('del3'), date: '2026-03-22',
        lines: [{ position: 0, quantity: 2 }], inventoryAccountId: id('liab'), cogsAccountId: id('cogs'),
      }),
      /Inventory account .* must be an asset account/,
    );

    console.log(JSON.stringify({
      warehouseEastAssetsCents: locBs.totalAssets,
      warehouseEastClaimsCents: locBs.totalClaims,
      locationBsBalanced: locBs.isBalanced,
    }));
  } finally {
    for (const table of ['stockMoves', 'repostQueue', 'transactions', 'estimates', 'inventory', 'chartAccounts', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]).catch(() => {});
    }
    await db.terminate();
  }
});
