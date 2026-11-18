/**
 * Agent 10 frontend regression suite covering:
 *  - #779: BackupExportSettings removes fabricated Firestore PITR / fake "Verify Backup Policy" / stale Q4 QBO claims.
 *  - #776 (screens half): offline fallback download uses `-partial-offline-` filename, skips `recordBackupCompleted()`,
 *    renders inline partial-export warning, rejects `metadata.serverAuthoritative === false` on upload, and requires
 *    explicit confirmation via an accessible dialog before POSTing `/restore`.
 *  - H-6: empty and failed-load retry states (`ScreenDataNotice` + actionable empty guidance) on IsraelVatReportView,
 *    TaxLiabilityView, Banking (with loaded accounts), and Dashboard (mid-session collection failures).
 *  - H-4: accessible names, associated form labels, keyboard-focusable wide report regions (`w10:trial-balance:390`
 *    ratcheted to `{}`), and zero critical/serious axe violations across LTR and Hebrew RTL (`dir="rtl"`).
 *  - H-1: CSS logical properties, icon/toggle RTL mirroring, and `<bdi>` currency isolation across the ten busiest
 *    screens and navigation shell while preserving right-aligned tabular numeric columns.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { toast } from 'sonner';

import BackupExportSettings from '../components/platform/settings/BackupExportSettings';
import IsraelVatReportView from '../components/reporting/IsraelVatReportView';
import TaxLiabilityView from '../components/reporting/TaxLiabilityView';
import TrialBalanceView from '../components/ledger/TrialBalanceView';
import Banking from '../components/banking/Banking';
import Dashboard from '../components/Dashboard';
import Header from '../components/layout/Header';
import EstimatesView from '../components/sales/EstimatesView';
import BrandingProfilesSettings from '../components/platform/settings/BrandingProfilesSettings';
import { useAuthStore } from '../stores/useAuthStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import { getBackupHealth } from '../lib/ledgerBackupHealth';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';

const ALL_COLLECTIONS = [
  'transactions', 'accounts', 'customers', 'vendors', 'invoices', 'creditNotes', 'payments',
  'bills', 'vendorCredits', 'recurring', 'bankLines', 'reconciliations', 'journalEntries',
  'taxRates', 'estimates', 'budgets', 'assets', 'loans', 'projects', 'inventory',
  'payRuns', 'autoRules', 'employees',
] as const;

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function makeSignedBackupText(overrides: {
  serverAuthoritative?: boolean;
  exportedAt?: string;
  transactions?: unknown[];
  accounts?: unknown[];
} = {}): Promise<string> {
  const payload: {
    schemaVersion: string;
    workspaceId: string;
    exportedAt: string;
    metadata: Record<string, unknown>;
    transactions: unknown[];
    accounts: unknown[];
  } = {
    schemaVersion: '2.0.0',
    workspaceId: 'ws-a10',
    exportedAt: overrides.exportedAt ?? '2026-11-18T01:30:00.000Z',
    metadata: {
      transactionCount: (overrides.transactions ?? [{ id: 'tx-1' }]).length,
      accountCount: (overrides.accounts ?? [{ id: 'acc-1' }]).length,
      ...(overrides.serverAuthoritative !== undefined ? { serverAuthoritative: overrides.serverAuthoritative } : { serverAuthoritative: true }),
    },
    transactions: overrides.transactions ?? [{ id: 'tx-1' }],
    accounts: overrides.accounts ?? [{ id: 'acc-1' }],
  };
  payload.metadata.checksum = await sha256Hex(JSON.stringify(payload));
  return JSON.stringify(payload);
}

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

describe('#779 & #776 (screens half): BackupExportSettings honesty and restore safety', () => {
  test('#779: removes fake Firestore PITR section, fake verify button, and stale Q4 QBO promise', async () => {
    const { container } = render(<BackupExportSettings />);
    const text = container.textContent || '';

    assert.ok(!/Firestore/i.test(text), 'must not mention Firestore');
    assert.ok(!/PITR/i.test(text), 'must not claim PITR');
    assert.ok(!/gcloud/i.test(text), 'must not print gcloud firestore command');
    assert.ok(!/RPO\s*</i.test(text), 'must not fabricate RPO/RTO SLA');
    assert.ok(!/coming in Q4/i.test(text), 'must not contain stale Q4 QBO promise');
    assert.equal(screen.queryByRole('button', { name: /Verify Backup Policy/i }), null);
    assert.ok(screen.getByText(/Backup verification & accountant copies/i));
    await assertNoSeriousAxeViolations(container, 'BackupExportSettings');
  });

  test('#776: offline fallback download uses partial-offline filename, never marks backup verified, and alerts inline', async () => {
    let downloadedName = '';
    let downloadedBlob: Blob | null = null;
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const origClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = obj => { downloadedBlob = obj as Blob; return 'blob:offline-backup'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { downloadedName = this.download; };

    try {
      render(<BackupExportSettings />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Export JSON Backup/i }));
      });
      await waitFor(() => assert.match(downloadedName, /^ledgerflow-partial-offline-backup-ws-a10-\d{4}-\d{2}-\d{2}\.json$/));
      assert.equal(getBackupHealth('ws-a10').lastBackupAt, null, 'partial offline export must not satisfy backup health');
      assert.equal(getBackupHealth('ws-a10').status, 'never');
      const alert = screen.getByRole('alert');
      assert.match(alert.textContent || '', /cannot restore a workspace/i);
      assert.ok(downloadedBlob);
      const parsed = JSON.parse(await (downloadedBlob as Blob).text());
      assert.equal(parsed.metadata.serverAuthoritative, false);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      HTMLAnchorElement.prototype.click = origClick;
    }
  });

  test('#776: full server export keeps canonical filename and records verified backup completion', async () => {
    let downloadedName = '';
    const serverPayload = JSON.parse(await makeSignedBackupText({ serverAuthoritative: true }));
    globalThis.fetch = (async input => {
      if (String(input).includes('/workspaces/ws-a10/export')) {
        return new Response(JSON.stringify(serverPayload), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const origClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = () => 'blob:server-backup';
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { downloadedName = this.download; };

    try {
      render(<BackupExportSettings />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Export JSON Backup/i }));
      });
      await waitFor(() => assert.match(downloadedName, /^ledgerflow-backup-ws-a10-\d{4}-\d{2}-\d{2}\.json$/));
      assert.ok(getBackupHealth('ws-a10').lastBackupAt, 'server-authoritative export records verified backup');
      assert.equal(getBackupHealth('ws-a10').status, 'fresh');
      assert.equal(screen.queryByRole('alert'), null);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      HTMLAnchorElement.prototype.click = origClick;
    }
  });

  test('#776: refuses partial offline backup on upload without opening confirm dialog or calling /restore', async () => {
    let restoreCalls = 0;
    const errors: string[] = [];
    const origToastError = toast.error;
    toast.error = ((msg: unknown) => { errors.push(String(msg)); return ''; }) as typeof toast.error;
    globalThis.fetch = (async input => {
      if (String(input).includes('/restore')) restoreCalls++;
      return new Response(JSON.stringify({ message: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    try {
      render(<BackupExportSettings />);
      const partialText = await makeSignedBackupText({ serverAuthoritative: false });
      const file = new File([partialText], 'ledgerflow-partial-offline-backup-ws-a10.json', { type: 'application/json' });
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Restore backup file'), { target: { files: [file] } });
      });
      await waitFor(() => assert.ok(errors.some(e => /Partial offline backups/i.test(e))));
      assert.equal(screen.queryByRole('dialog'), null);
      assert.equal(restoreCalls, 0);
    } finally {
      toast.error = origToastError;
    }
  });

  test('#776: stages valid backup behind accessible confirmation dialog; Cancel aborts and Confirm posts exact file', async () => {
    const restoreBodies: string[] = [];
    globalThis.fetch = (async (input, init) => {
      if (String(input).includes('/workspaces/ws-a10/restore') && init?.method === 'POST') {
        restoreBodies.push(String(init.body || ''));
        return new Response(JSON.stringify({ status: 'success', message: 'Restored' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    render(<BackupExportSettings />);
    const fullText = await makeSignedBackupText({
      serverAuthoritative: true,
      transactions: [{ id: 'tx-1' }, { id: 'tx-2' }],
      accounts: [{ id: 'acc-1' }, { id: 'acc-2' }, { id: 'acc-3' }],
    });
    const input = screen.getByLabelText('Restore backup file');

    // First upload -> cancel must not invoke /restore
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File([fullText], 'verified-snapshot.json', { type: 'application/json' })] } });
    });
    const dialog = await screen.findByRole('dialog', { name: /Replace workspace records from backup/i });
    assert.match(dialog.textContent || '', /verified-snapshot\.json/);
    assert.equal(restoreBodies.length, 0, 'uploading must wait for explicit confirmation');
    await assertNoSeriousAxeViolations(dialog, 'Restore confirmation dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    assert.equal(screen.queryByRole('dialog'), null);
    assert.equal(restoreBodies.length, 0);

    // Second upload -> confirm posts exact raw text to /restore
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File([fullText], 'verified-snapshot.json', { type: 'application/json' })] } });
    });
    const dialog2 = await screen.findByRole('dialog', { name: /Replace workspace records from backup/i });
    await act(async () => {
      fireEvent.click(within(dialog2).getByRole('button', { name: 'Confirm restore' }));
    });
    await waitFor(() => assert.equal(restoreBodies.length, 1));
    assert.equal(restoreBodies[0], fullText);
    assert.equal(screen.queryByRole('dialog'), null);
  });
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

  test('TaxLiabilityView offers Try again when loading previously filed returns fails', async () => {
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

    render(<TaxLiabilityView startDate="2026-09-01" endDate="2026-09-30" />);
    const failedMsg = await screen.findByText(/Couldn't load previously filed returns/i);
    const statusBox = failedMsg.closest('[role="status"]') as HTMLElement;
    fireEvent.click(within(statusBox).getByRole('button', { name: 'Try again' }));
    await waitFor(() => assert.equal(attempts, 2));
    await waitFor(() => assert.equal(screen.queryByText(/Couldn't load previously filed returns/i), null));
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

  test('Hebrew RTL axe audit passes on IsraelVatReportView, TaxLiabilityView, Banking, and BackupExportSettings', async () => {
    document.documentElement.setAttribute('dir', 'rtl');
    document.documentElement.setAttribute('lang', 'he');
    useUIStore.setState({ language: 'he' });

    for (const [name, element] of [
      ['IsraelVatReportView (RTL)', <IsraelVatReportView key="vat" startDate="2026-09-01" endDate="2026-09-30" />],
      ['TaxLiabilityView (RTL)', <TaxLiabilityView key="tax" startDate="2026-09-01" endDate="2026-09-30" />],
      ['Banking (RTL)', <Banking key="bank" />],
      ['BackupExportSettings (RTL)', <BackupExportSettings key="backup" />],
    ] as const) {
      const { container, unmount } = render(element);
      await assertNoSeriousAxeViolations(container, name);
      unmount();
    }
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
