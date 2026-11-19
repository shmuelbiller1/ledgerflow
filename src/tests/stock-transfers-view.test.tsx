/**
 * A-114 screen: stock moved between locations. Hand-checked against moves passed as a prop: the
 * two halves show as one complete row with both location names, a half without its pair shows
 * alone with the reason, the filters narrow the rows, and with no moves the screen says where
 * stock is moved. Nothing is written.
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StockTransfersReportView from '../components/reporting/StockTransfersReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';

const stamp = '2026-10-05T10:00:00.000Z';
const moves = [
  { id: 'out1', workspaceId: 'w1', itemId: 'i1', itemName: 'Widget', date: '2026-10-05', kind: 'transfer-out', quantity: -2, quantityBefore: 10, quantityAfter: 8, seq: 'b1', locationId: 'loc-a', createdAt: stamp },
  { id: 'in1', workspaceId: 'w1', itemId: 'i1', itemName: 'Widget', date: '2026-10-05', kind: 'transfer-in', quantity: 2, quantityBefore: 8, quantityAfter: 10, seq: 'b2', locationId: 'loc-b', createdAt: stamp },
  { id: 'out2', workspaceId: 'w1', itemId: 'i2', itemName: 'Gadget', date: '2026-10-06', kind: 'transfer-out', quantity: -1, quantityBefore: 5, quantityAfter: 4, seq: 'b3', locationId: 'loc-b', createdAt: '2026-10-06T09:00:00.000Z' },
];
const nodes = [
  { id: 'loc-a', dimensionId: 'location', description: 'Shelf A', status: 'active' },
  { id: 'loc-b', dimensionId: 'location', description: 'Shelf B', status: 'active' },
];

describe('Stock transfers screen', () => {
  beforeEach(() => {
    stubFetch(404);
    useAuthStore.setState({
      isGuest: true, user: null, currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD' }] as never,
    });
    useLedgerStore.setState({ dimensionNodes: nodes as never });
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  const table = () => screen.getByRole('table', { name: 'Moves between locations, newest first' });

  test('halves pair into one complete row; a half without its pair shows alone with the reason', async () => {
    render(<StockTransfersReportView loadMoves={async () => moves as never} />);
    await waitFor(() => assert.ok(table()));
    assert.match(screen.getByText(/move\(s\) between locations/).textContent || '', /2 move\(s\) between locations/);
    const rows = within(table()).getAllByRole('row').slice(1);
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent || '', /Gadget/);
    assert.match(rows[0].textContent || '', /No/);
    assert.match(rows[0].textContent || '', /Its move-in half is not in the loaded history/);
    assert.match(rows[1].textContent || '', /Widget/);
    assert.match(rows[1].textContent || '', /Shelf A/);
    assert.match(rows[1].textContent || '', /Shelf B/);
    assert.match(rows[1].textContent || '', /Yes/);
  });

  test('the filters narrow the rows', async () => {
    render(<StockTransfersReportView loadMoves={async () => moves as never} />);
    await waitFor(() => assert.ok(table()));
    fireEvent.click(screen.getByLabelText('Only moves missing their pair'));
    assert.equal(within(table()).getAllByRole('row').slice(1).length, 1);
    fireEvent.click(screen.getByLabelText('Only moves missing their pair'));
    fireEvent.change(screen.getByLabelText('Find item or location'), { target: { value: 'shelf b' } });
    assert.equal(within(table()).getAllByRole('row').slice(1).length, 2);
    fireEvent.change(screen.getByLabelText('Find item or location'), { target: { value: 'nothing-like-this' } });
    await waitFor(() => assert.ok(screen.getByText('No moves match these filters.')));
  });

  test('a capped read is never a full-history empty claim or an export', async () => {
    const purchase = { ...moves[0], kind: 'purchase' };
    render(<StockTransfersReportView loadMoves={async () => Array.from({ length: 5000 }, () => purchase) as never} />);
    assert.match((await screen.findByRole('alert')).textContent!, /5000/);
    assert.ok(screen.getByText(/Older moves may be missing/)); assert.equal(screen.queryByText(/Nothing has been moved/), null);
    assert.ok(screen.getByRole<HTMLButtonElement>('button', { name: 'Download CSV' }).disabled);
  });

  test('retry after refusal shows only the current book and identifies a missing move-out', async () => {
    let calls = 0;
    render(<StockTransfersReportView loadMoves={async () => {
      if (++calls === 1) throw new Error('Read refused');
      return [{ ...moves[0], workspaceId: 'elsewhere' }, moves[1]] as never;
    }} />);
    assert.match((await screen.findByRole('alert')).textContent!, /Read refused/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('rowheader', { name: 'Widget' });
    assert.ok(within(table()).getByText('Its move-out half is not in the loaded history.'));
    assert.equal(within(table()).getAllByRole('rowheader').length, 1);
  });

  test('with no moves the screen says where stock is moved', async () => {
    render(<StockTransfersReportView loadMoves={async () => []} />);
    await waitFor(() => assert.ok(screen.getByText(/Nothing has been moved between locations yet/)));
    assert.equal(screen.getByRole('button', { name: 'Download CSV' }).matches(':disabled'), true);
  });
});
