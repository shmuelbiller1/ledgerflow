/**
 * The tax return screen (H-07): boxes in the workspace's currency, only owners and accountants can
 * file, filing sends the period and reference, and a filed period shows what changed since.
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TaxLiabilityView from '../components/reporting/TaxLiabilityView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import type { Workspace } from '../types';
import { makeBill, makeInvoice } from './fixtures';

const period = { startDate: '2026-07-01', endDate: '2026-09-30' };

function setup(role: 'owner' | 'viewer') {
  useAuthStore.setState({
    user: { uid: 'u1' } as never,
    currentWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: 'W', currency: 'GBP', uid: role === 'owner' ? 'u1' : 'someone-else', roles: { u1: role } } as unknown as Workspace],
  });
  useDataNeedsStore.setState({
    loadedWorkspaceId: 'w1',
    loaded: { invoices: true, bills: true, creditNotes: true, vendorCredits: true },
    failed: {},
  });
  useLedgerStore.setState({
    invoices: [
      makeInvoice({ id: 'i1', amountCents: 12000, taxAmountCents: 2000, taxInclusive: true, taxVersion: 2, taxTreatment: 'standard', date: '2026-08-01', status: 'sent' }),
      makeInvoice({ id: 'i2', amountCents: 5000, taxInclusive: true, taxVersion: 2, taxTreatment: 'zero_rated', date: '2026-08-02', status: 'sent' }),
      makeInvoice({ id: 'i3', amountCents: 99900, taxAmountCents: 9990, taxVersion: 2, taxTreatment: 'standard', date: '2026-08-03', status: 'draft' }),
    ],
    bills: [makeBill({ id: 'b1', amountCents: 6000, taxAmountCents: 1000, taxInclusive: true, taxVersion: 2, taxTreatment: 'standard', date: '2026-08-05', status: 'approved' })],
    creditNotes: [],
    vendorCredits: [],
  });
}
const box = (key: string) => within(screen.getByRole('table', { name: 'Tax return boxes' })).getAllByRole('row').find(r => r.textContent?.startsWith(key))?.textContent || '';

describe('tax return screen', () => {
  beforeEach(() => { window.confirm = () => true; });
  afterEach(() => cleanup());

  test('an embedded tax return keeps the Reports page heading hierarchy', () => {
    stubFetchWithBodies(200, { returns: [] });
    setup('viewer');
    render(<TaxLiabilityView {...period} embedded />);
    assert.ok(screen.getByRole('heading', { name: 'Tax return', level: 2 }));
    assert.equal(screen.queryByRole('heading', { name: 'Tax return', level: 1 }), null);
  });

  test('boxes from issued documents, in the workspace currency (drafts left out)', async () => {
    stubFetchWithBodies(200, { returns: [] });
    setup('owner');
    render(<TaxLiabilityView {...period} />);
    assert.match(box('1'), /£20\.00/);       // tax on sales
    assert.match(box('4'), /£10\.00/);       // tax reclaimable on purchases
    assert.match(box('5'), /£10\.00/);       // net to pay
    assert.match(box('8'), /£50\.00/);       // zero-rated sales
  });

  test('an owner files the period with a reference', async () => {
    const calls = stubFetchWithBodies(200, { returns: [] });
    setup('owner');
    render(<TaxLiabilityView {...period} />);
    await waitFor(() => assert.equal((screen.getByRole('button', { name: 'File this return' }) as HTMLButtonElement).disabled, false));
    fireEvent.change(screen.getByLabelText('Reference (optional)'), { target: { value: 'Q3 2026' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'File this return' })); });
    await waitFor(() => assert.ok(calls.some(c => c.method === 'POST')));
    const post = calls.find(c => c.method === 'POST')!;
    assert.match(post.url, /\/api\/v1\/workspaces\/w1\/tax-returns$/);
    assert.deepEqual(post.body, { startDate: '2026-07-01', endDate: '2026-09-30', reference: 'Q3 2026' });
  });

  test('a viewer cannot file', async () => {
    stubFetchWithBodies(200, { returns: [] });
    setup('viewer');
    render(<TaxLiabilityView {...period} />);
    assert.equal(screen.queryByRole('button', { name: 'File this return' }), null);
  });

  test('a filed period shows what changed since it was filed', async () => {
    stubFetchWithBodies(200, { returns: [{ id: 'r1', ...period, filedAt: '2026-10-01', boxes: [{ key: '1', label: 'Tax on sales', cents: 1500 }] }] });
    setup('owner');
    render(<TaxLiabilityView {...period} />);
    await waitFor(() => assert.match(screen.getByRole('status').textContent || '', /Box 1 Tax on sales: filed £15\.00, now £20\.00 \(\+£5\.00\)/));
    assert.equal(screen.queryByRole('button', { name: 'File this return' }), null);
  });
});
