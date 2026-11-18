import { inlineEditName } from './helpers/inlineEditName';
/**
 * Asset tags (X-07): tags given in order after the highest in use, oldest assets first, disposed and
 * hand-typed ones left as they are; finding an asset by tag, name or place; on the register, giving
 * tags, finding by a scanned tag, and the printable labels with a QR code each.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { assetMatches, formatTag, missingTags, nextTagNumber } from '../lib/assetTags';
import FixedAssetsView from '../components/assets/FixedAssetsView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { FixedAsset } from '../types';

const realFetch = globalThis.fetch;
const asset = (id: string, name: string, purchaseDate: string, extra: Partial<FixedAsset> = {}) => ({
  id, uid: 'u', workspaceId: 'component-workspace', name, purchaseDate, purchasePriceCents: 100_000, salvageValueCents: 0, usefulLifeYears: 5,
  depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0, status: 'active', createdAt: purchaseDate, ...extra,
}) as FixedAsset;
const register = [
  asset('van', 'Delivery van', '2026-03-01'),
  asset('press', 'Press', '2025-01-01', { assetTag: 'AT-0007' }),
  asset('laptop', 'Laptop', '2025-06-01', { location: 'Office' }),
  asset('old', 'Old truck', '2020-01-01', { status: 'disposed' }),
  asset('desk', 'Desk', '2024-01-01', { assetTag: 'DESK-1' }),
];

describe('Asset tags', () => {
  afterEach(async () => { cleanup(); globalThis.fetch = realFetch; getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('given in order after the highest in use, oldest first; disposed and typed tags left alone', () => {
    assert.equal(nextTagNumber(['AT-0007', 'DESK-1', undefined, 'at-12']), 13);
    assert.equal(formatTag(8), 'AT-0008');
    assert.deepEqual(missingTags(register), [{ id: 'laptop', assetTag: 'AT-0008' }, { id: 'van', assetTag: 'AT-0009' }]);
    assert.equal(assetMatches(register[1], 'at-0007'), true);
    assert.equal(assetMatches(register[2], 'office'), true);
    assert.equal(assetMatches(register[0], 'AT-0007'), false);
  });

  test('on the register: give tags, find by a scanned tag, print labels with a QR code each', async () => {
    setComponentWorkspace('bookkeeper');
    useLedgerStore.setState({ assets: register, accounts: [] } as never);
    markComponentCollectionsLoaded('assets');
    // giving tags is two command calls now, one per asset; the tag rides in the record's fields
    const writes: Array<{ id?: string; collection?: string; data?: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/commands/record.save') && typeof init?.body === 'string') {
        const { input: sent } = JSON.parse(init.body) as { input: { collection: string; id: string; data: Record<string, unknown> } };
        writes.push({ id: sent.id, collection: sent.collection, data: sent.data });
        return new Response(JSON.stringify({ ok: true, data: { collection: sent.collection, id: sent.id, created: false, updatedAt: new Date().toISOString() } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    render(<FixedAssetsView />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Give tags (2)' })); });
    await waitFor(() => assert.equal(writes.length, 2));
    assert.deepEqual(writes.map(w => [w.id, w.data?.assetTag]), [['laptop', 'AT-0008'], ['van', 'AT-0009']]);
    assert.deepEqual(writes.map(w => w.collection), ['assets', 'assets']);
    fireEvent.change(screen.getByLabelText(/^Find/), { target: { value: 'AT-0007' } });
    assert.ok(screen.getByRole('button', { name: inlineEditName('Edit Name of Press') }));
    assert.equal(screen.queryByRole('button', { name: inlineEditName('Edit Name of Delivery van') }), null);
    fireEvent.change(screen.getByLabelText(/^Find/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Print labels' }));
    const dialog = screen.getByRole('dialog', { name: 'Asset labels (2)' });
    await waitFor(() => assert.equal(dialog.querySelectorAll('img').length, 2));
    assert.match(dialog.textContent || '', /AT-0007Press/);
    assert.match((dialog.querySelector('img') as HTMLImageElement).src, /^data:image\/png;base64,/);
  });
});
