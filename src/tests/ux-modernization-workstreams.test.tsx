import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { TanStackDataGrid } from '../components/ui/TanStackDataGrid';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingState } from '../components/ui/LoadingState';
import InvoiceRecordPage from '../components/sales/InvoiceRecordPage';
import Sales from '../components/sales/Sales';
import SetupWizard from '../components/onboarding/SetupWizard';
import CommandPalette from '../components/layout/CommandPalette';
import Header from '../components/layout/Header';
import { MODULES, modulesForBusiness } from '../lib/modules';
import { pageIndex, searchPages } from '../config/pageIndex';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import { getSupabase } from '../lib/db/client';
import { stubFetch, stubFetchWithBodies } from './helpers/dom';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { makePayment, makeTransaction } from './fixtures';

const realFetch = globalThis.fetch;
const realMatchMedia = window.matchMedia;

function setViewportCompact(compact: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: compact && query.includes('max-width: 639px'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

describe('Workstream 1: TanStackDataGrid U-3 suppression and mobile layout', () => {
  afterEach(() => {
    cleanup();
    window.matchMedia = realMatchMedia;
  });

  const cols: ColumnDef<{ id: string; name: string }, unknown>[] = [
    { id: 'name', accessorFn: r => r.name, header: 'Name', cell: info => String(info.getValue()) },
  ];

  test('loading and empty states hide table headers behind EmptyState / LoadingState', () => {
    const { rerender } = render(
      <TanStackDataGrid
        data={[]}
        columns={cols}
        caption="Sample grid"
        loading
        loadingState={<LoadingState what="items" />}
        emptyState={<EmptyState title="Nothing here" description="Add something" />}
      />,
    );
    assert.equal(screen.queryAllByRole('columnheader').length, 0);
    assert.ok(screen.getByText(/Loading items/i));

    rerender(
      <TanStackDataGrid
        data={[]}
        columns={cols}
        caption="Sample grid"
        loading={false}
        emptyState={<EmptyState title="Nothing here" description="Add something" />}
      />,
    );
    assert.equal(screen.queryAllByRole('columnheader').length, 0);
    assert.ok(screen.getByRole('heading', { name: 'Nothing here' }));
  });

  test('renders card list on compact viewports when mobileLayout="cards" and keeps table when "table"', () => {
    setViewportCompact(true);
    const { rerender } = render(
      <TanStackDataGrid
        data={[{ id: '1', name: 'Widget' }]}
        columns={cols}
        caption="Widgets"
        mobileLayout="cards"
        renderCard={row => <span>Card: {row.name}</span>}
      />,
    );
    assert.equal(screen.queryAllByRole('columnheader').length, 0);
    assert.ok(screen.getByRole('list', { name: 'Widgets' }));
    assert.ok(screen.getByText('Card: Widget'));

    rerender(
      <TanStackDataGrid
        data={[{ id: '1', name: 'Widget' }]}
        columns={cols}
        caption="Widgets"
        mobileLayout="table"
      />,
    );
    assert.ok(screen.getByRole('columnheader', { name: 'Name' }));
    assert.ok(screen.getByRole('region', { name: 'Widgets' }));
  });
});

describe('Workstream 2: InvoiceRecordPage & Sales record routing', () => {
  beforeEach(() => {
    useUIStore.setState({ language: 'en', focusRecord: null, activeTab: 'sales' });
    setComponentWorkspace();
    stubFetch(404);
    markComponentCollectionsLoaded('auditLogs', 'creditNotes', 'customers', 'invoices', 'payments', 'transactions');
  });
  afterEach(async () => {
    cleanup();
    globalThis.fetch = realFetch;
    await getSupabase().auth.dispose();
  });

  test('InvoiceRecordPage displays U-9 steps, KPIs, next action, links, and handles draft vs sent vs missing', () => {
    useLedgerStore.setState({
      customers: [{ id: 'c1', uid: 'test-user', workspaceId: 'component-workspace', name: 'Acme Corp', status: 'active', balanceCents: 15000 }],
      payments: [makePayment({
        id: 'pay-1', workspaceId: 'component-workspace', contactId: 'c1',
        date: '2026-10-05', amountCents: 5000, reference: 'ACH-99',
        allocations: [{ documentType: 'invoice', documentId: 'inv-1', amountCents: 5000 }],
      })],
      transactions: [makeTransaction({
        id: 'tx-1', workspaceId: 'component-workspace',
        date: '2026-10-01', description: 'AR Inv #1042', totalAmountCents: 15000,
        reference: '1042', metadata: { invoiceId: 'inv-1' },
        lines: [
          { accountId: 'acc-ar', debitCents: 15000, creditCents: 0, amountCents: 15000 },
          { accountId: 'acc-sales', debitCents: 0, creditCents: 15000, amountCents: 15000 },
        ],
      })],
      invoices: [
        {
          id: 'inv-1', uid: 'test-user', workspaceId: 'component-workspace', customerId: 'c1',
          customerName: 'Acme Corp', number: '1042', amountCents: 15000, amountPaidCents: 5000,
          date: '2026-10-01', dueDate: '2026-10-30', status: 'sent',
          items: [{ id: 'li-1', description: 'Consulting retainer', quantity: 3, rateCents: 5000, amountCents: 15000, accountId: 'acc-sales' }],
        },
        {
          id: 'inv-draft', uid: 'test-user', workspaceId: 'component-workspace', customerId: 'c1',
          customerName: 'Acme Corp', number: '1043', amountCents: 20000,
          date: '2026-10-02', dueDate: '2026-11-01', status: 'draft', items: [],
        },
      ],
    });

    let sent = 0;
    let paid = 0;
    let backed = 0;
    let openedCustomer = '';
    const { rerender } = render(
      <InvoiceRecordPage
        invoiceId="inv-1"
        onBack={() => { backed++; }}
        onEdit={() => {}}
        onSendEmail={() => { sent++; }}
        onReceivePayment={() => { paid++; }}
        onPreviewPdf={() => {}}
        onDownloadPdf={() => {}}
        onVoid={() => {}}
        onOpenCustomer={id => { openedCustomer = id; }}
      />,
    );

    assert.ok(screen.getByRole('heading', { name: 'Invoice 1042' }));
    assert.ok(screen.getByText('Draft'));
    assert.ok(screen.getByText('Sent'));
    assert.ok(screen.getAllByText('Paid').length >= 2);
    assert.ok(screen.getAllByText('$150.00').length >= 1);
    assert.ok(screen.getByText('$100.00'));
    assert.ok(screen.getByText('Consulting retainer'));
    assert.ok(screen.getByText('ACH-99'));
    assert.ok(screen.getByText('AR Inv #1042'));

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    assert.equal(paid, 1);

    fireEvent.click(screen.getByRole('button', { name: 'Acme Corp' }));
    assert.equal(openedCustomer, 'c1');

    fireEvent.click(screen.getByRole('button', { name: 'Back to invoices' }));
    assert.equal(backed, 1);

    rerender(
      <InvoiceRecordPage
        invoiceId="inv-draft"
        onBack={() => { backed++; }}
        onEdit={() => {}}
        onSendEmail={() => { sent++; }}
        onReceivePayment={() => { paid++; }}
        onPreviewPdf={() => {}}
        onDownloadPdf={() => {}}
        onVoid={() => {}}
        onOpenCustomer={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send invoice' }));
    assert.equal(sent, 1);

    rerender(
      <InvoiceRecordPage
        invoiceId="missing-inv"
        onBack={() => { backed++; }}
        onEdit={() => {}}
        onSendEmail={() => {}}
        onReceivePayment={() => {}}
        onPreviewPdf={() => {}}
        onDownloadPdf={() => {}}
        onVoid={() => {}}
        onOpenCustomer={() => {}}
      />,
    );
    assert.ok(screen.getByRole('heading', { name: 'Invoice not found' }));
  });

  test('Sales screen opens InvoiceRecordPage when an invoice link is clicked and returns to list', () => {
    useLedgerStore.setState({
      customers: [{ id: 'c1', uid: 'test-user', workspaceId: 'component-workspace', name: 'Acme Corp', status: 'active', balanceCents: 15000 }],
      invoices: [{
        id: 'inv-sales-1', uid: 'test-user', workspaceId: 'component-workspace', customerId: 'c1',
        customerName: 'Acme Corp', number: 'INV-777', amountCents: 15000,
        date: '2026-10-01', dueDate: '2026-10-30', status: 'sent', items: [],
      }],
    });
    render(<Sales />);
    fireEvent.click(screen.getByRole('button', { name: 'INV-777' }));
    assert.ok(screen.getByRole('heading', { name: 'Invoice INV-777' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to invoices' }));
    assert.ok(screen.getByRole('heading', { name: 'Sales' }));
  });
});

describe('Workstream 5: Business-type module presets and SetupWizard persistence', () => {
  beforeEach(() => {
    setComponentWorkspace();
  });
  afterEach(async () => {
    cleanup();
    globalThis.fetch = realFetch;
    await getSupabase().auth.dispose();
  });

  test('modulesForBusiness enables the right modules per business type and emits only known IDs', () => {
    const validIds = new Set(MODULES.map(m => m.id));
    for (const type of ['retail', 'construction', 'service', 'creative', 'software_agency', 'realestate', 'nonprofit', 'custom']) {
      const m = modulesForBusiness(type);
      for (const k of Object.keys(m)) {
        assert.ok(validIds.has(k), `Unknown module key "${k}" for "${type}"`);
      }
    }
    assert.equal(modulesForBusiness('retail').inventory, true);
    assert.equal(modulesForBusiness('retail')['purchase-orders'], true);
    assert.equal(modulesForBusiness('construction').projects, true);
    assert.equal(modulesForBusiness('construction').budgets, true);
    assert.equal(modulesForBusiness('realestate').loans, true);
    assert.equal(modulesForBusiness('realestate')['fixed-assets'], true);
    assert.equal(modulesForBusiness('service').projects, true);
    assert.equal(modulesForBusiness('nonprofit').budgets, true);
  });

  test('SetupWizard persists modules via PUT /api/v1/workspaces/:id/modules when business type changes', async () => {
    const calls = stubFetchWithBodies(200, { status: 'success', modules: modulesForBusiness('retail') });
    render(<SetupWizard onStarted={() => {}} onDone={() => {}} />);

    fireEvent.click(screen.getByLabelText('Shop'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    });

    await waitFor(() => {
      const modCall = calls.find(c => /\/api\/v1\/workspaces\/component-workspace\/modules$/.test(c.url));
      assert.ok(modCall, 'expected PUT /modules request');
      const payload = modCall.body as { modules: Record<string, boolean> };
      assert.equal(payload.modules.inventory, true);
      assert.equal(payload.modules['purchase-orders'], true);
    });
    const lfUpdate = calls.find(c => c.url.includes('/rest/v1/rpc/lf_update'));
    assert.equal((lfUpdate?.body as { p_set?: Record<string, unknown> } | undefined)?.p_set?.modules, undefined, 'lf_update must not send server-owned modules');
    assert.equal(useAuthStore.getState().workspaces[0].modules?.inventory, true);
  });
});

describe('Workstream 6: PageIndex disabled modules, CommandPalette inventory search, and Header prompt', () => {
  beforeEach(() => {
    setComponentWorkspace();
    useUIStore.setState({ language: 'en', activeTab: 'dashboard', activeSettingsTab: 'appearance' });
    useLedgerStore.setState({
      transactions: [],
      invoices: [],
      customers: [],
      payments: [],
      inventory: [
        { id: 'item-1', uid: 'test-user', workspaceId: 'component-workspace', sku: 'SKU-500', name: 'Blue Bolt', unitPriceCents: 450, unitCostCents: 200, quantityAtHand: 12, reorderPoint: 2, createdAt: '2026-01-01' },
      ],
    });
  });
  afterEach(() => cleanup());

  test('pageIndex excludes disabled module tabs and provides disabledModuleId fallback to Settings → Modules', () => {
    const index = pageIndex('en', { modules: { payroll: false } });
    assert.equal(index.some(p => p.page.tab === 'payroll'), false);
    const disabled = searchPages(index, 'payroll').find(p => p.disabledModuleId === 'payroll');
    assert.ok(disabled, 'expected disabled module search entry for payroll');
    assert.deepEqual(disabled.page, { tab: 'settings', sub: 'modules' });

    const activeIndex = pageIndex('en', { modules: { payroll: true } });
    assert.equal(activeIndex.some(p => p.disabledModuleId === 'payroll'), false);
  });

  test('CommandPalette finds inventory items and routes disabled modules to Settings → Modules', async () => {
    useAuthStore.setState({
      workspaces: [{
        id: 'component-workspace', uid: 'test-user', name: 'Acme', currency: 'USD',
        businessType: 'custom', createdAt: '2026-01-01', modules: { payroll: false },
      }],
      currentWorkspaceId: 'component-workspace',
    });

    render(<CommandPalette isOpen onClose={() => {}} />);
    const input = screen.getByLabelText('Search commands or enter a transaction');

    fireEvent.change(input, { target: { value: 'SKU-500' } });
    const invItem = screen.getByText('Blue Bolt (SKU-500)');
    await act(async () => { fireEvent.click(invItem); });
    assert.deepEqual(useUIStore.getState().focusRecord, { type: 'item', id: 'item-1' });
    assert.equal(useUIStore.getState().activeTab, 'inventory');

    fireEvent.change(input, { target: { value: 'payroll' } });
    const modEntry = screen.getByText(/turn on in Settings → Modules/);
    await act(async () => { fireEvent.click(modEntry); });
    assert.equal(useUIStore.getState().activeTab, 'settings');
    assert.equal(useUIStore.getState().activeSettingsTab, 'modules');
  });

  test('Header uses plain-language search prompt without coordinate jargon (U-12)', () => {
    stubFetch(200, []);
    render(<Header />);
    assert.ok(screen.getByText('Search, or type what you want to do'));
    assert.equal(screen.queryByText(/world:realestate/), null);
  });
});
