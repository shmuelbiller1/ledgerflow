import './helpers/dom';
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { buildAccountantQueue } from '../lib/accountantQueue';
import AccountantQueueView from '../components/ledger/AccountantQueueView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';

import { getSupabase } from '../lib/db/client';

describe('A-155 accountant queue screen', () => {
  afterEach(async () => {
    cleanup();
    useLedgerStore.setState({ invoices: [], bills: [], transactions: [] });
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
  });

  test('aggregates open questions, held invoice/PO/claim approvals, draft journals and lock exceptions cleanly', () => {
    const queries = [
      {
        id: 'q1', workspaceId: 'ws1', transactionId: 'tx-99',
        entry: { date: '2026-10-05', description: 'Mystery wire $850', amountCents: 85_000, currency: 'USD' },
        askedBy: 'u2', askedAt: '2026-10-06', status: 'open' as const,
        messages: [{ uid: 'u2', text: 'Which vendor was this wire to?', at: '2026-10-06' }],
        updatedAt: '2026-10-06',
      },
    ];
    const purchaseOrders = [
      {
        id: 'po1', uid: 'u1', workspaceId: 'ws1', poNumber: 'PO-777', vendorId: 'v1', vendorName: 'Dell',
        issueDate: '2026-10-12', status: 'pending_approval' as const, approvalStatus: 'pending' as const,
        items: [], totalAmountCents: 450_000, currency: 'USD', createdAt: '2026-10-12', updatedAt: '2026-10-12',
      },
    ];

    const queue = buildAccountantQueue({
      queries,
      invoices: [],
      purchaseOrders,
      bills: [],
      transactions: [{ id: 'tx-draft', uid: 'u1', workspaceId: 'ws1', date: '2026-10-15', description: 'Accrual entry', status: 'draft' as never, currency: 'USD', type: 'journal' as never, totalAmountCents: 120_000, lines: [] }],
      workspace: { id: 'ws1', currency: 'USD', lockException: { reason: 'Audit adjustment', until: '2026-10-30' } } as never,
    });
    assert.equal(queue.length, 4);
    assert.equal(queue[0].kind, 'locked-period');
    assert.equal(queue[1].kind, 'question');
    assert.equal(queue[2].kind, 'approval');
    assert.equal(queue[3].kind, 'adjustment');

    useAuthStore.setState({ isGuest: true, user: null, currentWorkspaceId: null } as never);
    useLedgerStore.setState({ invoices: [], bills: [], transactions: [] });
    render(<AccountantQueueView queries={queries} purchaseOrders={purchaseOrders} />);
    assert.ok(screen.getByText('Accountant Queue'));
    assert.ok(screen.getByText(/Mystery wire \$850/));
    assert.ok(screen.getByText(/PO-777/));
  });
});
