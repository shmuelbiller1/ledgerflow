import './helpers/dom';
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { computeBillRetentionReport } from '../lib/billRetention';
import BillRetentionReportView from '../components/reporting/BillRetentionReportView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';

describe('A-127 retention (holdback) tracking on milestone bills', () => {
  afterEach(() => {
    cleanup();
    useLedgerStore.setState({ bills: [], projects: [] });
  });

  test('computes past-due, upcoming and released holdbacks strictly per currency without modifying bill amounts', () => {
    const bills = [
      {
        id: 'b1', uid: 'u1', workspaceId: 'ws1', vendorId: 'v1', vendorName: 'BuildCo',
        number: 'B-101', date: '2026-08-01', dueDate: '2026-09-01', amountCents: 500_000, currency: 'USD',
        status: 'unpaid' as const, splits: [], createdAt: '2026-08-01',
        metadata: { retention: { heldCents: 50_000, releaseDate: '2026-10-01', project: 'Tower North' } },
      },
      {
        id: 'b2', uid: 'u1', workspaceId: 'ws1', vendorId: 'v2', vendorName: 'Electra Ltd',
        number: 'B-102', date: '2026-09-01', dueDate: '2026-10-01', amountCents: 200_000, currency: 'ILS',
        status: 'paid' as const, splits: [], createdAt: '2026-09-01',
        metadata: { retention: { heldCents: 20_000, releaseDate: '2026-12-01', project: 'Tel Aviv Campus' } },
      },
    ];

    const res = computeBillRetentionReport(bills, '2026-10-23', 'USD');
    assert.equal(res.rows.length, 2);
    assert.equal(res.rows[0].state, 'past-due');
    assert.equal(res.rows[0].netPayableBeforeReleaseCents, 450_000);
    assert.deepEqual(res.totalsByCurrency, [
      { currency: 'ILS', grossCents: 200_000, heldOpenCents: 20_000, pastDueCents: 0, releasedCents: 0 },
      { currency: 'USD', grossCents: 500_000, heldOpenCents: 50_000, pastDueCents: 50_000, releasedCents: 0 },
    ]);

    useAuthStore.setState({ isGuest: true, user: null, currentWorkspaceId: null } as never);
    useLedgerStore.setState({ bills, projects: [] });
    render(<BillRetentionReportView />);
    assert.ok(screen.getByText('Retention (Holdbacks) on Milestone Bills'));
    assert.ok(screen.getByText('Due for release'));
  });
});
