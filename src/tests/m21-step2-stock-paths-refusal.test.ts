/**
 * M-21 step 2, review fix: the stock-write paths that were not converted to the standard carrying basis
 * (inventory.adjust, inventory.count, inventory.revalue, and landed cost) refuse standard items while the
 * workspace posts at the standard. A revaluation changes the actual cost, not the standard, so following the
 * old advice would book a wrong-basis entry; the refusal message now points at selling the stock down.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import {
  inventoryAdjustCommand, inventoryCountCommand, inventoryRevalueCommand,
} from '../server/commands/inventoryStock';
import { inventoryItemSaveCommand } from '../server/commands/inventoryItems';
import { workspaceStandardCostingCommand } from '../server/commands/workspaceSettings';
import { commandHarness, owner, type CommandHarness } from './helpers/commandTestUtils';

const WS = 'ws-m21-stock-paths';
const OWNER = owner.uid;

type Res = { status: number; body: Record<string, unknown> };
const read = async (res: Response): Promise<Res> => ({ status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> });

describe('M-21 step 2: the stock-write paths refuse standard items while posting at the standard', () => {
  let harness: CommandHarness;

  before(async () => {
    harness = await commandHarness({
      commands: [inventoryAdjustCommand, inventoryCountCommand, inventoryRevalueCommand, inventoryItemSaveCommand, workspaceStandardCostingCommand],
      workspaceId: WS,
      seed(db) {
        db.seed(`workspaces/${WS}`, { uid: OWNER, members: [OWNER], currency: 'USD', roles: { [OWNER]: 'owner' } });
        db.seed('chartAccounts/inv', { workspaceId: WS, name: 'Inventory', type: 'asset', category: 'Inventory', code: '1300' });
        db.seed('chartAccounts/var', { workspaceId: WS, name: 'Stock variance', type: 'expense', category: 'COGS', code: '5000' });
        db.seed('chartAccounts/ppv', { workspaceId: WS, name: 'Purchase Price Variance', type: 'expense', category: 'Expense', code: '5200' });
        db.seed('inventory/chair', { workspaceId: WS, name: 'Chair', sku: 'CH', quantityAtHand: 10, unitCostCents: 4000, standardCostCents: 4000, unitPriceCents: 30000, reorderPoint: 0 });
      },
    });
    // the workspace turns standard-cost posting on, with the variance account
    const enabled = await read(await harness.run(OWNER, 'workspace.standardcosting', { enabled: true, varianceAccountId: 'ppv' }));
    assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  });

  after(async () => { await harness.close(); });

  test('inventory.adjust refuses a standard item', async () => {
    const res = await read(await harness.run(OWNER, 'inventory.adjust', {
      itemId: 'chair', quantityChange: -1, inventoryAccountId: 'inv', offsetAccountId: 'var', type: 'adjustment',
    }));
    assert.equal(res.status, 409);
    assert.match(String(res.body.message || ''), /standard cost/i);
  });

  test('inventory.count refuses a standard item', async () => {
    const res = await read(await harness.run(OWNER, 'inventory.count', {
      inventoryAccountId: 'inv', offsetAccountId: 'var', counts: [{ itemId: 'chair', counted: 8 }],
    }));
    assert.equal(res.status, 409);
    assert.match(String(res.body.message || ''), /standard cost/i);
  });

  test('inventory.revalue refuses a standard item', async () => {
    const res = await read(await harness.run(OWNER, 'inventory.revalue', {
      itemId: 'chair', newUnitCostCents: 4500, inventoryAccountId: 'inv', offsetAccountId: 'var', reason: 'Adjust', requestId: 'reval-op-1',
    }));
    assert.equal(res.status, 409);
    assert.match(String(res.body.message || ''), /standard cost/i);
  });

  test('the standard-cost edit refusal points at selling the stock down, not at a revaluation', async () => {
    // the item card cannot change the standard with stock on hand, and the message must not point at
    // inventory.revalue (which changes the actual cost, not the standard)
    const res = await read(await harness.run(OWNER, 'inventoryitem.save', { id: 'chair', standardCostCents: 6000 }));
    assert.equal(res.status, 409);
    const message = String(res.body.message || '');
    assert.match(message, /Sell the stock down|count it to zero/);
    assert.doesNotMatch(message, /inventory\.revalue/);
  });
});
