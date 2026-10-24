/**
 * EG-7: the read-only Stock closing and checks panel on Inventory Valuation shows the closing's rows and each
 * check's plain-language message from GET /api/v1/inventory/stock-closing (stubbed here; the server is tested in
 * src/tests/eg7-stock-closing.test.ts).
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StockClosingPanel } from '../components/reporting/StockClosingPanel';
import { stubFetchWithBodies } from './helpers/dom';
import { getSupabase } from '../lib/db/client';

const realFetch = globalThis.fetch;
afterEach(async () => { cleanup(); globalThis.fetch = realFetch; getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('EG-7 panel: the closing of 2026-03-31 (15 widgets, 225.00, difference 0) and the three checks', async () => {
  const calls = stubFetchWithBodies(200, {
    asOf: '2026-03-31', closings: [{ asOf: '2026-03-31', builtAt: 'x' }],
    closing: { asOf: '2026-03-31', stockValueCents: 22_500, inventoryBalanceCents: 22_500, differenceCents: 0, moveCount: 3, fresh: false, freshness: 'The stock closing of 2026-03-31 is stale: its stock moves were changed since it was taken.', changedItems: ['Widget'],
      rows: [{ itemId: 'w', itemName: 'Widget', locationId: '', quantity: 15, valueCents: 22_500, moveCount: 3, checksum: 'c' }] },
    books: { ok: false, message: 'On 2026-03-31 the books have 10.00 more than the stock.' },
    negative: { ok: true, items: [], message: 'No item is below zero on any day.' },
  });
  render(<StockClosingPanel workspaceId="ws1" currency="USD" />);
  await waitFor(() => assert.ok(screen.getByText('Widget')));
  assert.match(calls[0].url, /\/api\/v1\/inventory\/stock-closing\?workspaceId=ws1/);
  assert.ok(screen.getByText('No location'));
  assert.ok(screen.getByText(/books have 10\.00 more/));
  assert.ok(screen.getByText(/below zero on any day/));
  assert.ok(screen.getByText(/is stale/));
});

test('EG-7 panel: no closing yet, and a refused read says why', async () => {
  stubFetchWithBodies(200, { asOf: '2026-03-31', closings: [], closing: null, books: { ok: true, message: 'Same.' }, negative: { ok: true, items: [], message: 'None.' } });
  render(<StockClosingPanel workspaceId="ws1" />);
  await waitFor(() => assert.ok(screen.getByText(/No stock closing yet/)));
  cleanup();
  stubFetchWithBodies(403, { error: 'Forbidden' });
  render(<StockClosingPanel workspaceId="ws2" />);
  await waitFor(() => assert.ok(screen.getByText(/Stock checks not available: Forbidden/)));
});
