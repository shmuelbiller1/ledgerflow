/**
 * Item categories (K-12 BA-05): counts, and renaming, merging or removing a category on all its
 * items in one database write.
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CategoryManagerDialog from '../components/inventory/CategoryManagerDialog';
import { categoryCounts, renameCategoryPlan } from '../lib/itemCategories';
import { getSupabase } from '../lib/db/client';
import type { InventoryItem } from '../types';
import { setComponentWorkspace } from './helpers/componentFixtures';

const item = (id: string, category?: string): InventoryItem => ({
  id, uid: 'u', workspaceId: 'component-workspace', name: id, sku: id, unitPriceCents: 0, unitCostCents: 0, quantityAtHand: 0, reorderPoint: 0, createdAt: '2026-01-01', category,
});
const items = [item('a', 'Parts'), item('b', ' Parts '), item('c', 'Tools'), item('d'), item('e', '')];

describe('Item categories', () => {
  test('counts by category, spaces ignored, blank left out, by name', () => {
    assert.deepEqual(categoryCounts(items), [{ name: 'Parts', count: 2 }, { name: 'Tools', count: 1 }]);
  });

  test('rename, merge into an existing one, remove; nothing for the same name or an unknown one', () => {
    assert.deepEqual(renameCategoryPlan(items, 'Parts', 'Spare parts'), { ids: ['a', 'b'], to: 'Spare parts', merges: false });
    assert.deepEqual(renameCategoryPlan(items, 'Tools', ' Parts'), { ids: ['c'], to: 'Parts', merges: true });
    assert.deepEqual(renameCategoryPlan(items, 'Tools', '  '), { ids: ['c'], to: '', merges: false });
    assert.deepEqual(renameCategoryPlan(items, 'Parts', 'Parts ').ids, []);
    assert.deepEqual(renameCategoryPlan(items, 'Nope', 'X').ids, []);
  });
});

describe('Category manager', () => {
  beforeEach(() => setComponentWorkspace());
  afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });

  test('merging Tools into Parts asks the command once, and the command renames every item the workspace holds', async () => {
    const calls = stubFetchWithBodies(200, null);
    render(<CategoryManagerDialog items={items} onClose={() => {}} />);
    assert.ok(screen.getByText('2 items'));
    fireEvent.change(screen.getByLabelText('New name for Tools'), { target: { value: 'Parts' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Merge into Parts' })); });
    await waitFor(() => assert.ok(calls.some(c => c.url.includes('/commands/inventory.categoryrename'))));
    // one call, not one per item: the server reads the cards and renames the ones that carry the name, including
    // items this page never loaded
    const body = calls.find(c => c.url.includes('/commands/inventory.categoryrename'))!.body as { workspaceId: string; input: { from: string; to: string } };
    assert.deepEqual([body.input.from, body.input.to], ['Tools', 'Parts']);
    assert.equal(body.workspaceId, 'component-workspace');
  });

  test('clearing the name removes the category; unchanged names cannot be saved', async () => {
    const calls = stubFetchWithBodies(200, null);
    render(<CategoryManagerDialog items={items} onClose={() => {}} />);
    assert.equal((screen.getAllByRole('button', { name: 'Rename' })[0] as HTMLButtonElement).disabled, true);
    fireEvent.change(screen.getByLabelText('New name for Parts'), { target: { value: '' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove' })); });
    await waitFor(() => assert.ok(calls.some(c => c.url.includes('/commands/inventory.categoryrename'))));
    const body = calls.find(c => c.url.includes('/commands/inventory.categoryrename'))!.body as { input: { from: string; to?: string } };
    assert.deepEqual([body.input.from, body.input.to], ['Parts', ''], 'an empty name removes the category');
  });
});
