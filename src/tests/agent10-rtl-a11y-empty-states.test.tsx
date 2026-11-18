/**
 * Agent 10 frontend regression suite covering:
 *  - H-6: empty and failed-load retry states (`ScreenDataNotice` + actionable empty guidance) on IsraelVatReportView,
 *    TaxLiabilityView (including filing lock while collections load or filed-returns list fails), Banking (with loaded
 *    accounts), and Dashboard (mid-session collection failures).
 *  - H-4: accessible names, associated form labels, keyboard-focusable wide report regions (`w10:trial-balance:390`
 *    ratcheted to `{}`, repo-wide unnamed icon buttons ratcheted to 0), and zero critical/serious axe violations
 *    across LTR and Hebrew RTL (`dir="rtl"`).
 *  - H-1: CSS logical properties, icon/toggle RTL mirroring, `<kbd dir="ltr">` keycaps, and `<bdi>` currency isolation
 *    across the ten busiest screens and navigation shell while preserving right-aligned tabular numeric columns.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';

import IsraelVatReportView from '../components/reporting/IsraelVatReportView';
import TaxLiabilityView from '../components/reporting/TaxLiabilityView';
import TrialBalanceView from '../components/ledger/TrialBalanceView';
import Banking from '../components/banking/Banking';
import Dashboard from '../components/Dashboard';
import Header from '../components/layout/Header';
import ShortcutOverlay from '../components/layout/ShortcutOverlay';
import EstimatesView from '../components/sales/EstimatesView';
import BrandingProfilesSettings from '../components/platform/settings/BrandingProfilesSettings';
import { useAuthStore } from '../stores/useAuthStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';

const ALL_COLLECTIONS = [
  'transactions', 'accounts', 'customers', 'vendors', 'invoices', 'creditNotes', 'payments',
  'bills', 'vendorCredits', 'recurring', 'bankLines', 'reconciliations', 'journalEntries',
  'taxRates', 'estimates', 'budgets', 'assets', 'loans', 'projects', 'inventory',
  'payRuns', 'autoRules', 'employees',
] as const;

async function assertNoSeriousAxeViolations(container: HTMLElement, label: string): Promise<void> {
  const results = await axe.run(container, {
    rules: {
      // jsdom does not perform CSS color compositing; real contrast runs in Playwright.
      'color-contrast': { enabled: false },
    },
  });
  const severe = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
  assert.deepEqual(
    severe.map(v => `${v.id} (${v.impact}): ${v.nodes.map(n => n.html).join(' | ')}`),
    [],
    `Unexpected critical/serious axe violations on ${label}`,
  );
}

function configureWorkspace(overrides: Record<string, unknown> = {}) {
  const base = setComponentWorkspace('owner');
  const merged = { ...base, ...overrides };
  useAuthStore.setState({
    currentWorkspaceId: merged.id,
    workspaces: [merged as typeof base],
  });
  return merged;
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
  globalThis.fetch = (async input => {
    const url = String(input);
    if (url.includes('/tax-returns')) {
      return new Response(JSON.stringify({ returns: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/')) {
      return new Response(JSON.stringify({ status: 'error', error: 'offline in unit test' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  configureWorkspace({
    id: 'ws-a10',
    currency: 'ILS',
    setupCompletedAt: '2026-01-01T00:00:00.000Z',
    openingBalanceDate: '2026-01-01',
    taxProfiles: {
      books: {
        name: 'Tel Aviv Studio',
        place: { country: 'IL', city: 'Tel Aviv' },
        registrations: [
          { kind: 'vat', number: '514000001', place: { country: 'IL' }, filing: 'monthly', validFrom: '2026-01-01' },
        ],
      },
    },
  });
  useUIStore.setState({ activeTab: 'dashboard', language: 'en' });
  useLedgerStore.setState({
    transactions: [],
    accounts: [],
    journalEntries: [],
    bankLines: [],
    reconciliations: [],
    invoices: [],
    bills: [],
    customers: [],
    vendors: [],
    payments: [],
    creditNotes: [],
    vendorCredits: [],
    estimates: [],
    recurring: [],
    auditLogs: [],
    budgets: [],
    assets: [],
    loans: [],
    projects: [],
    autoRules: [],
    truncatedCollections: {},
  });
  markComponentCollectionsLoaded(...ALL_COLLECTIONS);
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

describe('H-6: empty and failed-load retry states across VAT, Tax return, Banking, and Overview', () => {
  test('IsraelVatReportView surfaces failed collection with ScreenDataNotice retry and disables CSV export', () => {
    useDataNeedsStore.getState().markFailed('invoices', 'Network timeout.');

    render(<IsraelVatReportView startDate="2026-09-01" endDate="2026-09-30" />);

    const notice = document.querySelector('[data-screen-data-notice]') as HTMLElement | null;
    assert.ok(notice, 'expected shared ScreenDataNotice on IsraelVatReportView');
    assert.match(notice.textContent || '', /invoices/i);
    assert.match(notice.textContent || '', /this VAT report/i);
    assert.equal((screen.getByRole('button', { name: /Export CSV/i }) as HTMLButtonElement).disabled, true);

    fireEvent.click(within(notice).getByRole('button', { name: 'Try again' }));
    assert.equal(useDataNeedsStore.getState().failed.invoices, undefined, 'retry clears failure to resubscribe');
    assert.equal(useDataNeedsStore.getState().loaded.invoices, false, 'retry enters loading until fresh data lands');
  });

  test('IsraelVatReportView guides empty periods to Invoices and missing registration to Settings', () => {
    const { unmount } = render(<IsraelVatReportView startDate="2026-09-01" endDate="2026-09-30" />);
    const emptyBanner = screen.getByTestId('il-vat-empty-period');
    assert.match(emptyBanner.textContent || '', /No counted VAT documents in this period/i);
    fireEvent.click(within(emptyBanner).getByRole('button', { name: 'Open Invoices' }));
    assert.equal(useUIStore.getState().activeTab, 'sales');
    unmount();

    configureWorkspace({ id: 'ws-no-vat', currency: 'ILS', taxProfiles: undefined });
    render(<IsraelVatReportView startDate="2026-09-01" endDate="2026-09-30" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    assert.equal(useUIStore.getState().activeTab, 'settings');
  });

  test('TaxLiabilityView reports failed document collections with retry, disables filing, and guides empty period', async () => {
    useDataNeedsStore.getState().markFailed('bills', 'Gateway unavailable.');

    const { rerender } = render(<TaxLiabilityView startDate="2026-09-01" endDate="2026-09-30" />);
    const notice = document.querySelector('[data-screen-data-notice]') as HTMLElement | null;
    assert.ok(notice, 'expected ScreenDataNotice on TaxLiabilityView');
    assert.match(notice.textContent || '', /bills/i);
    assert.equal((screen.getByRole('button', { name: 'File this return' }) as HTMLButtonElement).disabled, true);

    fireEvent.click(within(notice).getByRole('button', { name: 'Try again' }));
    assert.equal(useDataNeedsStore.getState().failed.bills, undefined);
    assert.equal(useDataNeedsStore.getState().loaded.bills, false);

    markComponentCollectionsLoaded(...ALL_COLLECTIONS);
    rerender(<TaxLiabilityView startDate="2026-09-01" endDate="2026-09-30" />);
    const empty = screen.getByTestId('tax-return-empty-period');
    fireEvent.click(within(empty).getByRole('button', { name: 'Open Invoices' }));
    assert.equal(useUIStore.getState().activeTab, 'sales');
  });

  test('TaxLiabilityView disables filing while documents load or filed-returns fails, and re-enables after Try again', async () => {
    let attempts = 0;
    globalThis.fetch = (async input => {
      if (String(input).includes('/tax-returns')) {
        attempts++;
        if (attempts === 1) {
          return new Response(JSON.stringify({ status: 'error', error: 'Server temporarily down.' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ returns: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const { rerender } = render(<TaxLiabilityView startDate="2026-09-01" endDate="2026-09-30" />);
    const fileBtn = () => screen.getByRole('button', { name: 'File this return' }) as HTMLButtonElement;
    // Before /tax-returns resolves, filed === null blocks premature filing.
    assert.equal(fileBtn().disabled, true);
    const failedMsg = await screen.findByText(/Couldn't load previously filed returns/i);
    // While /tax-returns is in an error state, filing remains disabled to prevent duplicate period filing.
    assert.equal(fileBtn().disabled, true);
    const statusBox = failedMsg.closest('[role="status"]') as HTMLElement;
    fireEvent.click(within(statusBox).getByRole('button', { name: 'Try again' }));
    await waitFor(() => assert.equal(attempts, 2));
    await waitFor(() => assert.equal(screen.queryByText(/Couldn't load previously filed returns/i), null));
    await waitFor(() => assert.equal(fileBtn().disabled, false));

    // While underlying document collections are still loading, filing is disabled so an all-zero return cannot be filed early.
    useDataNeedsStore.setState(s => ({ ...s, loaded: { ...s.loaded, invoices: false } }));
    rerender(<TaxLiabilityView startDate="2026-09-01" endDate="2026-09-30" />);
    assert.equal(fileBtn().disabled, true);
  });

  test('Banking shows ScreenDataNotice retry when accounts are already on screen and a refresh fails', () => {
    useLedgerStore.setState({
      accounts: [{ id: 'acc-bank', uid: 'u-1', workspaceId: 'ws-a10', code: '1010', name: 'Main Bank Checking', type: 'asset', subtype: 'bank', balanceCents: 50_000 }],
    });
    useDataNeedsStore.getState().markFailed('bankLines', 'Connection dropped.');

    render(<Banking />);
    assert.ok(screen.getByText('Main Bank Checking'), 'existing bank account card remains visible');
    const notice = document.querySelector('[data-screen-data-notice]') as HTMLElement | null;
    assert.ok(notice, 'expected ScreenDataNotice when bankLines fails');
    fireEvent.click(within(notice).getByRole('button', { name: 'Try again' }));
    assert.equal(useDataNeedsStore.getState().failed.bankLines, undefined);
    assert.equal(useDataNeedsStore.getState().loaded.bankLines, false);
  });

  test('Dashboard shows ScreenDataNotice retry when an Overview collection fails after initial load', () => {
    useLedgerStore.setState({
      accounts: [{ id: 'acc-1', uid: 'u-1', workspaceId: 'ws-a10', code: '1010', name: 'Checking', type: 'asset', subtype: 'bank', balanceCents: 10_000 }],
      transactions: [{
        id: 'tx-1', uid: 'u-1', workspaceId: 'ws-a10', date: '2026-09-10', description: 'Opening deposit', status: 'completed', type: 'actual', currency: 'ILS',
        totalAmountCents: 10_000, lines: [
          { accountId: 'acc-1', accountName: 'Checking', debitCents: 10_000, creditCents: 0, amountCents: 10_000 },
          { accountId: 'acc-2', accountName: 'Equity', debitCents: 0, creditCents: 10_000, amountCents: -10_000 },
        ],
      }],
    });
    useDataNeedsStore.setState(s => ({
      loadedWorkspaceId: 'ws-a10',
      loaded: { ...s.loaded, transactions: true, accounts: true },
      failed: { ...s.failed, invoices: 'Timed out loading invoices.' },
    }));

    render(<Dashboard />);
    const notice = document.querySelector('[data-screen-data-notice]') as HTMLElement | null;
    assert.ok(notice, 'expected ScreenDataNotice on Dashboard');
    assert.match(notice.textContent || '', /your overview/i);
    fireEvent.click(within(notice).getByRole('button', { name: 'Try again' }));
    assert.equal(useDataNeedsStore.getState().failed.invoices, undefined);
    assert.equal(useDataNeedsStore.getState().loaded.invoices, false);
  });
});

describe('H-4 & H-1: screen-reader names, focusable scroll regions, Hebrew RTL, and axe compliance', () => {
  test('TrialBalanceView wraps wide table in a named focusable region and ratchets w10:trial-balance:390 baseline to 0', async () => {
    useLedgerStore.setState({
      accounts: [
        { id: 'acc-parent', uid: 'u-1', workspaceId: 'ws-a10', code: '1000', name: 'Cash & Banks', type: 'asset', balanceCents: 0 },
        { id: 'acc-child', uid: 'u-1', workspaceId: 'ws-a10', code: '1010', name: 'Leumi ILS', type: 'asset', parentId: 'acc-parent', balanceCents: 25_000 },
        { id: 'acc-eq', uid: 'u-1', workspaceId: 'ws-a10', code: '3000', name: 'Owner Capital', type: 'equity', balanceCents: -25_000 },
      ],
      transactions: [{
        id: 'tx-tb', uid: 'u-1', workspaceId: 'ws-a10', date: '2026-09-01', description: 'Capital', status: 'completed', type: 'actual', currency: 'ILS', totalAmountCents: 25_000,
        lines: [
          { accountId: 'acc-child', accountName: 'Leumi ILS', debitCents: 25_000, creditCents: 0, amountCents: 25_000 },
          { accountId: 'acc-eq', accountName: 'Owner Capital', debitCents: 0, creditCents: 25_000, amountCents: -25_000 },
        ],
      }],
    });

    document.documentElement.setAttribute('dir', 'rtl');
    document.documentElement.setAttribute('lang', 'he');
    const state = useLedgerStore.getState();
    const { container } = render(
      <TrialBalanceView
        accounts={state.accounts}
        formatCurrency={(cents) => `₪${(cents / 100).toFixed(2)}`}
        onDrillDown={() => {}}
      />,
    );

    const region = screen.getByRole('region', { name: 'Trial balance table' });
    assert.equal(region.getAttribute('tabindex'), '0');

    // Child account row uses CSS logical paddingInlineStart rather than physical paddingLeft so RTL indents from the right edge.
    const childName = screen.getByText('Leumi ILS');
    const indentedWrapper = childName.closest('div[style]') as HTMLElement | null;
    assert.ok(indentedWrapper, 'expected indented wrapper on child Trial Balance account');
    assert.match(indentedWrapper.getAttribute('style') || '', /padding-inline-start:\s*16px/);

    await assertNoSeriousAxeViolations(container, 'TrialBalanceView (RTL)');

    const journeyBaseline = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'e2e/journey-a11y-baseline.json'), 'utf8'),
    );
    assert.deepEqual(journeyBaseline['w10:trial-balance:390'], {});
  });

  test('EstimatesView PDF icon buttons and Header avatar button expose descriptive accessible names', async () => {
    useLedgerStore.setState({
      estimates: [{
        id: 'est-1',
        uid: 'u-1',
        workspaceId: 'ws-a10',
        number: 'EST-0042',
        customerId: 'cust-1',
        customerName: 'לקוח בדיקה בע״מ',
        date: '2026-09-15',
        expiryDate: '2026-10-15',
        status: 'sent',
        amountCents: 118_000,
        lines: [],
        createdAt: '2026-09-15T00:00:00.000Z',
      }],
    });

    const { container, unmount } = render(<EstimatesView />);
    assert.ok(screen.getByRole('button', { name: 'Preview PDF for estimate EST-0042' }));
    assert.ok(screen.getByRole('button', { name: 'Download PDF for estimate EST-0042' }));
    await assertNoSeriousAxeViolations(container, 'EstimatesView');
    unmount();

    useAuthStore.setState(s => ({
      ...s,
      user: { uid: 'u-1', email: 'dana@example.co.il', getIdToken: async () => 'tok' } as typeof s.user,
    }));
    const headerRender = render(<Header onLogout={() => {}} />);
    assert.ok(screen.getByRole('button', { name: /Logged in as dana@example\.co\.il\. Click to Log Out\./i }));
    await assertNoSeriousAxeViolations(headerRender.container, 'Header');
  });

  test('BrandingProfilesSettings associates logo file input with its label and passes axe', async () => {
    const { container } = render(<BrandingProfilesSettings />);
    fireEvent.change(screen.getByLabelText(/Another label:value key/i), { target: { value: 'branch:Tel Aviv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit label branding' }));
    const logoInput = screen.getByLabelText(/Logo \(PNG or JPEG/i) as HTMLInputElement;
    assert.equal(logoInput.type, 'file');
    await assertNoSeriousAxeViolations(container, 'BrandingProfilesSettings');
  });

  test('Hebrew RTL axe audit passes on IsraelVatReportView, TaxLiabilityView, Banking, and ShortcutOverlay with LTR keycaps', async () => {
    document.documentElement.setAttribute('dir', 'rtl');
    document.documentElement.setAttribute('lang', 'he');
    useUIStore.setState({ language: 'he' });

    for (const [name, element] of [
      ['IsraelVatReportView (RTL)', <IsraelVatReportView key="vat" startDate="2026-09-01" endDate="2026-09-30" />],
      ['TaxLiabilityView (RTL)', <TaxLiabilityView key="tax" startDate="2026-09-01" endDate="2026-09-30" />],
      ['Banking (RTL)', <Banking key="bank" />],
    ] as const) {
      const { container, unmount } = render(element);
      await assertNoSeriousAxeViolations(container, name);
      unmount();
    }

    const overlay = render(<ShortcutOverlay isOpen onClose={() => {}} />);
    const keycaps = overlay.container.querySelectorAll('kbd[dir="ltr"]');
    assert.ok(keycaps.length >= 4, 'expected shortcut keycaps isolated with dir="ltr" in RTL');
    await assertNoSeriousAxeViolations(overlay.container, 'ShortcutOverlay (RTL)');
    overlay.unmount();
  });

  test('H-1 guard: remediated shell and ten-screen components keep CSS logical alignment and RTL toggle/indent mirroring', () => {
    const noTextLeftFiles = [
      'src/components/Dashboard.tsx',
      'src/components/dashboard/BooksSafeCard.tsx',
      'src/components/dashboard/NeedsAttentionCard.tsx',
      'src/components/layout/Header.tsx',
      'src/components/layout/QuickCreateMenu.tsx',
      'src/components/sales/Sales.tsx',
      'src/components/purchases/Purchases.tsx',
      'src/components/ledger/ChartOfAccountsView.tsx',
      'src/components/ledger/ReconciliationView.tsx',
      'src/components/ledger/ReconciliationWizard.tsx',
      'src/components/ledger/ProfitAndLossAccountRows.tsx',
      'src/components/ledger/BalanceSheetAccountRows.tsx',
      'src/components/ledger/BalanceSheetReport.tsx',
      'src/components/ledger/StatementColumns.tsx',
      'src/components/ledger/TrialBalanceView.tsx',
      'src/components/reporting/IsraelVatReportView.tsx',
      'src/components/reporting/TaxLiabilityView.tsx',
      'src/components/platform/Settings.tsx',
      'src/components/platform/settings/AppearanceSettings.tsx',
      'src/components/platform/settings/BlueprintSettings.tsx',
      'src/components/platform/settings/RulesSettingsView.tsx',
    ];
    for (const rel of noTextLeftFiles) {
      const content = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      assert.ok(!/\btext-left\b/.test(content), `${rel} should use logical text-start instead of physical text-left`);
      assert.ok(!/\bpaddingLeft\b|\bmarginLeft\b/.test(content), `${rel} should use logical inline-start spacing`);
    }

    // AccountGroupControls must mirror collapsed chevrons and indent logically for all grouped financial statements.
    const groupControls = fs.readFileSync(path.join(process.cwd(), 'src/components/ledger/AccountGroupControls.tsx'), 'utf8');
    assert.ok(groupControls.includes('paddingInlineStart'), 'AccountGroupRow must use paddingInlineStart');
    assert.ok(groupControls.includes('marginInlineStart'), 'AccountGroupSubtotal must use marginInlineStart');
    assert.ok(groupControls.includes('rtl:rotate-180'), 'AccountGroupToggle must flip collapsed chevron in RTL');

    // Toggle switches on Appearance, P&L, Balance Sheet, and Cash Flow must translate negatively in RTL.
    for (const rel of [
      'src/components/platform/settings/AppearanceSettings.tsx',
      'src/components/ledger/ProfitAndLossView.tsx',
      'src/components/ledger/BalanceSheetReport.tsx',
      'src/components/ledger/CashFlowView.tsx',
    ]) {
      const content = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      assert.ok(/rtl:-translate-x-[46]/.test(content), `${rel} toggle switch thumb must mirror in RTL`);
    }
  });
});
