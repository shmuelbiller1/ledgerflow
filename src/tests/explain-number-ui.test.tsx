/**
 * Explain this number on screen (N-12): a report figure opens its explanation from the server with
 * the filter, every line (in the report's sign), the bank match and files, and a total; a total that
 * differs from the figure shown is said; each line opens its document.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DrillDownModal from '../components/layout/DrillDownModal';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { stubFetchWithBodies } from './helpers/dom';
import { useUIStore } from '../stores/useUIStore';
import { getSupabase } from '../lib/db/client';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const explanation = {
  totalCents: -12000, entries: 2, lines: [
    { key: 't1:1', transactionId: 't1', date: '2026-03-01', description: 'Consulting', accountName: 'Sales', amountCents: -10000, document: { type: 'invoice', id: 'inv1' }, bankMatched: false, attachments: 2 },
    { key: 't2:1', transactionId: 't2', date: '2026-03-05', description: 'Workshop', accountName: 'Sales', amountCents: -2000, document: { type: 'transaction', id: 't2' }, bankMatched: true, attachments: 0 },
  ],
};

describe('Explain this number', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('asks the server with the figure\'s filter and lists what adds up to it', async () => {
    setComponentWorkspace('owner');
    const calls = stubFetchWithBodies(200, explanation);
    render(<DrillDownModal isOpen onClose={() => {}} accountName="Sales" transactions={[]} formatCurrency={money} from="Profit & Loss"
      explain={{ accountIds: ['sales'], startDate: '2026-03-01', endDate: '2026-03-31', expectedCents: 12000, sign: -1 }} />);
    await waitFor(() => assert.ok(screen.getByText('Consulting')));
    assert.equal(calls[0].url, '/api/v1/reports/explain');
    assert.equal(calls[0].method, 'POST', 'the accounts go in the body, so a large chart of accounts fits');
    assert.deepEqual(calls[0].body, { workspaceId: 'component-workspace', accountIds: ['sales'], startDate: '2026-03-01', endDate: '2026-03-31' });
    assert.ok(screen.getByText('$100.00'), 'in the report\'s sign');
    assert.ok(screen.getByText('$120.00'), 'the total');
    assert.ok(screen.getByText('Matched'));
    assert.match(document.body.textContent || '', /Sales · 2 files/);
    assert.match(document.body.textContent || '', /2 entries, from the full history/);
    assert.equal(screen.queryByRole('alert'), null, 'it adds up to the figure');
  });

  test('a total that differs from the figure shown is said; a line opens its document', async () => {
    setComponentWorkspace('owner');
    stubFetchWithBodies(200, explanation);
    let closed = false;
    render(<DrillDownModal isOpen onClose={() => { closed = true; }} accountName="Sales" transactions={[]} formatCurrency={money}
      explain={{ accountIds: ['sales'], startDate: '2026-03-01', endDate: '2026-03-31', expectedCents: 9000, sign: -1 }} />);
    await waitFor(() => assert.match(screen.getByRole('alert').textContent || '', /add up to \$120\.00, not the \$90\.00 shown/));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Consulting/ })); });
    assert.equal(closed, true);
    assert.deepEqual(useUIStore.getState().focusRecord, { type: 'invoice', id: 'inv1' });
  });

  test('when the server cannot explain it, the list this screen loaded is shown and said to be partial', async () => {
    setComponentWorkspace('owner');
    stubFetchWithBodies(503, { message: 'down' });
    const loaded = [{ id: 't9', date: '2026-03-02', description: 'Loaded entry', status: 'completed', totalAmountCents: 500, lines: [{ accountId: 'sales', accountName: 'Sales', amountCents: -500 }] }] as never;
    render(<DrillDownModal isOpen onClose={() => {}} accountName="Sales" transactions={loaded} formatCurrency={money}
      explain={{ accountIds: ['sales'], startDate: '2026-03-01', endDate: '2026-03-31' }} />);
    await waitFor(() => assert.ok(screen.getByText('Loaded entry')));
    assert.match(document.body.textContent || '', /may be partial/);
  });
});
