/**
 * A-61 screen: quote versions. Hand-checked from the loaded estimates: the estimate with an
 * unrecorded change is flagged, its history names who recorded version 1 and when, recording the
 * current version writes the metadata and adds the row (and a second press writes nothing), the
 * compare shows the amount move, and a guest reads but cannot record.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import QuoteVersionsReportView from '../components/reporting/QuoteVersionsReportView';
import { QUOTE_VERSIONS_METADATA_KEY } from '../lib/quoteVersions';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';

/** A version is recorded on the estimate's own metadata, through the record command; let those succeed. */
function stubDbWrites(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/commands/record.save')) {
      return new Response(JSON.stringify({ ok: true, data: { collection: 'estimates', id: 'e1', created: false, updatedAt: '' } }), { status: 200 });
    }
    return String(input).includes('/rpc/') ? new Response('{}', { status: 200 }) : new Response('{}', { status: 404 });
  }) as typeof fetch;
}

const juneLines = [
  { description: 'Design', quantity: 1, unitPriceCents: 60_000, amountCents: 60_000 },
  { description: 'Hosting', quantity: 4, unitPriceCents: 10_000, amountCents: 40_000 },
];

const estimates = [
  {
    id: 'e1', workspaceId: 'w1', customerId: 'c1', customerName: 'Acme Ltd', number: 'Q-1',
    amountCents: 125_000, date: '2026-06-01', expiryDate: '2026-11-01', status: 'sent',
    lines: [
      { description: 'Design', quantity: 1, unitPriceCents: 60_000, amountCents: 60_000 },
      { description: 'Hosting', quantity: 5, unitPriceCents: 10_000, amountCents: 50_000 },
      { description: 'Training', quantity: 1, unitPriceCents: 15_000, amountCents: 15_000 },
    ],
    metadata: {
      [QUOTE_VERSIONS_METADATA_KEY]: [
        { at: '2026-06-01T10:00:00Z', by: 'u2', byName: 'Dana', snapshot: { amountCents: 100_000, expiryDate: '2026-07-01', status: 'sent', lines: juneLines } },
      ],
    },
  },
  { id: 'e2', workspaceId: 'w1', customerId: 'c2', customerName: 'Beta GmbH', number: 'Q-2', amountCents: 5_000, date: '2026-09-01', status: 'draft', lines: [] },
];

describe('Quote versions screen', () => {
  beforeEach(() => {
    stubDbWrites();
    useAuthStore.setState({
      isGuest: false, user: { uid: 'u1', email: 'lee@shop.test' } as never,
      currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', uid: 'u1', name: 'W', currency: 'USD' }] as never,
    });
    useDataNeedsStore.setState({ failed: {} as never });
    useLedgerStore.setState({ estimates: estimates as never, truncatedCollections: {} as never });
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('the estimate with an unrecorded change is flagged and its history names version 1', () => {
    render(<QuoteVersionsReportView />);
    const nav = screen.getByRole('navigation', { name: 'Estimates' });
    const first = within(nav).getByRole('button', { name: /Q-1/ });
    assert.match(first.textContent || '', /1 version\(s\) recorded/);
    assert.match(first.textContent || '', /changed since the last version/);
    const second = within(nav).getByRole('button', { name: /Q-2/ });
    assert.match(second.textContent || '', /no version recorded/);
    assert.match(screen.getByTestId('pending-changes').textContent || '', /Changed since version 1, not yet recorded:/);
    assert.match(screen.getByTestId('pending-changes').textContent || '', /amount 1000\.00 → 1250\.00/);
    const history = screen.getByRole('table', { name: /Recorded versions of Q-1/ });
    const rows = within(history).getAllByRole('row').slice(1);
    assert.equal(rows.length, 1);
    assert.match(rows[0].textContent || '', /Dana/);
    assert.match(rows[0].textContent || '', /2026-06-01/);
    assert.match(rows[0].textContent || '', /first version/);
  });

  test('recording the current version writes the record and adds the row; the same content again writes nothing', async () => {
    render(<QuoteVersionsReportView />);
    const record = screen.getByRole('button', { name: /Record the current version/ });
    fireEvent.click(record);
    await waitFor(() => {
      const history = screen.getByRole('table', { name: /Recorded versions of Q-1/ });
      assert.equal(within(history).getAllByRole('row').slice(1).length, 2, 'version 2 is recorded');
    });
    assert.ok(!screen.queryByText(/Changed since version 1, not yet recorded:/), 'the new content is now recorded');
    fireEvent.click(screen.getByRole('button', { name: /Record the current version/ }));
    await new Promise(resolve => setTimeout(resolve, 10));
    const history = screen.getByRole('table', { name: /Recorded versions of Q-1/ });
    assert.equal(within(history).getAllByRole('row').slice(1).length, 2, 'the same content is never recorded twice');
  });

  test('compare names the amount move, and a guest reads but cannot record', () => {
    useAuthStore.setState({ isGuest: true, user: null, currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD' }] } as never);
    render(<QuoteVersionsReportView />);
    assert.ok((screen.getByRole('button', { name: /Record the current version/ }) as HTMLButtonElement).disabled);
    assert.ok(screen.getByText(/cannot record a version/));
    fireEvent.change(screen.getByLabelText('Compare from version'), { target: { value: '0' } });
    const compare = screen.getByTestId('quote-compare');
    assert.match(compare.textContent || '', /amount 1000\.00 → 1250\.00/);
    assert.match(compare.textContent || '', /Training/);
  });
});
