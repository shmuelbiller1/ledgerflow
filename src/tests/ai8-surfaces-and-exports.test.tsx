import './helpers/dom';
import test, { after, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getSupabase } from '../lib/db/client';
import { buildGroupSummaryCsvRows, type GroupSummaryExportData } from '../lib/groupSummaryExport';
import {
  groupNotificationsByType,
  loadFeedbackTags,
  toggleFeedbackTag,
} from '../lib/feedbackTriage';
import ModulesSettings from '../components/platform/settings/ModulesSettings';
import ShortcutSettings from '../components/platform/settings/ShortcutSettings';
import ShortcutOverlay from '../components/layout/ShortcutOverlay';
import StatusPage from '../components/system/StatusPage';
import CustomerPortalPage from '../components/sales/CustomerPortalPage';
import NotificationDrawer from '../components/layout/NotificationDrawer';
import SupportView from '../components/support/SupportView';
import { useSupportStore } from '../stores/useSupportStore';
import { useNotificationStore } from '../stores/useNotificationStore';
import { setComponentWorkspace } from './helpers/componentFixtures';

afterEach(() => {
  cleanup();
  localStorage.clear();
  useNotificationStore.setState({ isDrawerOpen: false, notifications: [] });
});

after(async () => {
  await getSupabase().removeAllChannels();
  getSupabase().realtime.disconnect();
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

describe('F-47 / W12: Group Summary CSV export builder', () => {
  test('exports side-by-side member figures, translation difference, and intercompany eliminations matching screen currency formatting', () => {
    const sample: GroupSummaryExportData = {
      group: { id: 'grp-1', name: 'Holdings Group' },
      members: [
        {
          workspaceId: 'ws-parent',
          name: 'Parent USD',
          currency: 'USD',
          isBalanced: true,
          income: 250000,
          cogs: 50000,
          grossProfit: 200000,
          expense: 40000,
          netIncome: 160000,
          totalAssets: 500000,
          totalLiabilities: 100000,
          totalEquity: 400000,
        },
        {
          workspaceId: 'ws-sub',
          name: 'Sub ILS',
          currency: 'ILS',
          isBalanced: true,
          income: 400000,
          cogs: 0,
          grossProfit: 400000,
          expense: 100000,
          netIncome: 300000,
          totalAssets: 600000,
          totalLiabilities: 200000,
          totalEquity: 400000,
          translated: {
            income: 100000,
            cogs: 0,
            grossProfit: 100000,
            expense: 25000,
            netIncome: 75000,
            totalAssets: 160000,
            totalLiabilities: 55000,
            totalEquity: 105000,
            cta: 5000,
          },
        },
      ],
      total: {
        currency: 'USD',
        income: 330000,
        cogs: 50000,
        grossProfit: 280000,
        expense: 45000,
        netIncome: 235000,
        totalAssets: 630000,
        totalLiabilities: 125000,
        totalEquity: 505000,
        cta: 5000,
        eliminated: {
          assets: 30000,
          liabilities: 30000,
          difference: 0,
          income: 20000,
          cogs: 0,
          expense: 20000,
        },
      },
    };

    const { headers, rows } = buildGroupSummaryCsvRows(sample);
    assert.deepEqual(headers, ['Line', 'Parent USD', 'Sub ILS', 'Group total']);
    const incomeRow = rows.find(r => r[0] === 'Income')!;
    assert.deepEqual(incomeRow, ['Income', '$2,500.00', '$1,000.00', '$3,300.00']);
    assert.ok(rows.some(r => r[0] === 'of which translation difference' && r[3] === '$50.00'));
    assert.ok(rows.some(r => r[0] === 'Eliminated intercompany assets' && r[3] === '$300.00'));
    assert.ok(rows.some(r => r[0] === 'Eliminated intercompany income' && r[3] === '$200.00'));
  });
});

describe('G-5, G-12, G-14, G-15, G-16, G-20: Settings, shortcuts, status, customer portal, notifications, and owner triage', () => {
  test('groups notifications cleanly and persists per-workspace feedback tags', () => {
    const tags = toggleFeedbackTag('ws-1', 'tkt-1', 'UX');
    assert.deepEqual(tags['tkt-1'], ['UX']);
    assert.deepEqual(loadFeedbackTags('ws-1')['tkt-1'], ['UX']);

    const groups = groupNotificationsByType([
      { id: '1', workspaceId: 'ws-1', uid: 'u-1', kind: 'payment.received', title: 'Paid INV-1', message: 'Customer payment posted', read: false, createdAt: '2026-10-20T10:00:00Z' },
      { id: '2', workspaceId: 'ws-1', uid: 'u-1', kind: 'invoice.sent', title: 'Sent INV-2', message: 'Invoice emailed to customer', read: true, createdAt: '2026-10-20T09:00:00Z' },
      { id: '3', workspaceId: 'ws-1', uid: 'u-1', kind: 'payment.failed', title: 'Retry card', message: 'Card charge declined', read: false, createdAt: '2026-10-20T08:00:00Z' },
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].key, 'payment');
    assert.equal(groups[0].unreadCount, 2);
  });

  test('renders ModulesSettings, ShortcutSettings, StatusPage, CustomerPortalPage, ShortcutOverlay, and NotificationDrawer cleanly', async () => {
    setComponentWorkspace('owner');
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/public/status')) {
        return new Response(
          JSON.stringify({
            state: 'operational',
            checkedAt: '2026-10-20T10:00:00Z',
            components: [
              { id: 'db', name: 'Database', state: 'operational', detail: 'Answering queries' },
              { id: 'api', name: 'API server', state: 'operational', detail: 'Healthy' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/v1/invoices/public/portal/')) {
        return new Response(
          JSON.stringify({
            business: 'Studio Carmel',
            customer: 'Northwind Ltd',
            currency: 'USD',
            owedCents: 150000,
            invoices: [
              { number: 'INV-101', date: '2026-09-01', dueDate: '2026-10-01', totalCents: 250000, dueCents: 150000, currency: 'USD', status: 'open', payPath: '/i/tok101' },
              { number: 'INV-100', date: '2026-08-01', dueDate: '2026-09-01', totalCents: 100000, dueCents: 0, currency: 'USD', status: 'paid', payPath: '/i/tok100' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ notifications: [], records: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    render(
      <>
        <ModulesSettings />
        <ShortcutSettings />
        <StatusPage />
        <CustomerPortalPage />
      </>,
    );

    assert.ok(screen.getByRole('heading', { name: 'Modules' }));
    assert.ok(screen.getByText('12 of 12 active'));
    assert.ok(screen.getByText('Speed Dial Shortcuts'));
    await waitFor(() => assert.ok(screen.getByText('2/2 checks reporting operational')));
    await waitFor(() => assert.ok(screen.getByText('Total billed')));
    cleanup();

    render(<ShortcutOverlay isOpen onClose={() => {}} />);
    assert.ok(screen.getByLabelText('Screen keyboard shortcuts'));
    cleanup();

    useNotificationStore.setState({
      isDrawerOpen: true,
      notifications: [
        { id: 'n-1', workspaceId: 'component-workspace', uid: 'user-1', kind: 'payment.received', title: 'Payment received on INV-101', message: '$1,000 settled', read: false, createdAt: '2026-10-20T09:30:00Z' },
      ],
    });
    render(<NotificationDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Group by type' }));
    assert.ok(screen.getByText('Payments & settlements'));
    cleanup();
  });

  test('unlocks feedback triage tags and Mark done for workspace owners on SupportView', async () => {
    setComponentWorkspace('owner');
    const ticketRow = {
      id: 'ticket-owner-1',
      workspace_id: 'component-workspace',
      data: {
        id: 'ticket-owner-1',
        workspaceId: 'component-workspace',
        uid: 'user-1',
        subject: 'VAT box question on October return',
        status: 'open',
        priority: 'normal',
        createdAt: '2026-10-20T09:00:00Z',
        updatedAt: '2026-10-20T09:00:00Z',
        lastMessageAt: '2026-10-20T09:00:00Z',
        lastMessageBy: 'user-1',
        unreadForUser: false,
        unreadForAdmin: true,
      },
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/rest/v1/supportTickets')) {
        return new Response(JSON.stringify([ticketRow]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/rest/v1/')) {
        return new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    useSupportStore.setState({ selectedTicketId: 'ticket-owner-1' });
    render(<SupportView />);

    await waitFor(() => assert.ok(screen.getByRole('button', { name: /Mark done/i })));
    const taxTagBtn = screen.getByLabelText('Ticket triage tags').querySelector('button:nth-of-type(3)') as HTMLButtonElement;
    fireEvent.click(taxTagBtn);
    assert.equal(taxTagBtn.getAttribute('aria-pressed'), 'true');

    fireEvent.click(screen.getByRole('button', { name: /Mark done/i }));
    assert.equal(useSupportStore.getState().tickets[0].status, 'resolved');
    cleanup();
  });
});
