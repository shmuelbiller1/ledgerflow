import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import Us1099PreviewReportView from '../components/reporting/Us1099PreviewReportView';
import { build1099Preview, threshold1099Cents } from '../lib/tax/us1099Preview';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';

afterEach(() => cleanup());
beforeEach(() => {
  useAuthStore.setState({
    isGuest: false, user: { uid: 'u1' } as never, currentWorkspaceId: 'ws1',
    workspaces: [{ id: 'ws1', uid: 'u1', name: 'Test', currency: 'USD' } as never],
  });
  useLedgerStore.setState({ vendors: [], payments: [], truncatedCollections: {} as never } as never);
  useDataNeedsStore.setState({ loaded: { vendors: true, payments: true } as never, failed: {} as never, loadedWorkspaceId: 'ws1' } as never);
});

test('thresholds and preview grouping work as documented', () => {
  assert.equal(threshold1099Cents(2025, '1099-NEC', '1a'), 60000);
  assert.equal(threshold1099Cents(2026, '1099-NEC', '1a'), 200000);
  const p = build1099Preview([{ vendorId: 'v1', vendorName: 'A', form: '1099-NEC', box: '1a', paidCents: 70000 }], 2025);
  assert.equal(p.forms.length, 1);
  assert.equal(p.excluded, 0);
  assert.equal(p.filingReady, false);
  const p2 = build1099Preview([{ vendorId: 'v1', vendorName: 'A', form: '1099-NEC', box: '1a', paidCents: 50000 }], 2025);
  assert.equal(p2.forms.length, 0);
  assert.equal(p2.excluded, 1);
});

test('C-121 preview screen shows threshold, forms and NOT IRIS', () => {
  useLedgerStore.setState({
    vendors: [{ id: 'v1', name: 'Ada', metadata: { taxId: '12-3456789' } } as never],
    payments: [{ workspaceId: 'ws1', contactId: 'v1', date: '2026-03-04', amountCents: 250000, currency: 'USD', direction: 'made', status: 'posted' } as never],
    truncatedCollections: {} as never,
  } as never);
  render(<Us1099PreviewReportView/>);
  assert.ok(screen.getByRole('heading', { name: 'US 1099 Preview (review only)' }));
  assert.match(document.body.textContent || '', /NOT IRIS/);
  assert.match(document.body.textContent || '', /filingReady.*false/i);
  // Form should appear for 2026 with $2000 threshold (200000 cents)
  assert.match(document.body.textContent || '', /1 form\(s\) at or above/);
  const table = screen.getByRole('table');
  assert.match(table.textContent || '', /Ada/);
  assert.match(table.textContent || '', /\*\*\*\*6789/);
});

test('C-121 manual edit and invalid year handling', () => {
  render(<Us1099PreviewReportView/>);
  const year = screen.getByLabelText('Tax year');
  fireEvent.change(year, { target: { value: '2026' } });
  fireEvent.change(screen.getByLabelText('Box'), { target: { value: '1a' } });
  // Ensure at least preview exists with empty totals -> no forms but not error
  assert.match(document.body.textContent || '', /filingReady/);
  fireEvent.change(year, { target: { value: '1800' } });
  assert.match(document.body.textContent || '', /Preview error/);
});
