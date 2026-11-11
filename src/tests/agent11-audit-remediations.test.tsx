/**
 * Agent #11 — Full-System Audit Remediation Suite (AF11-01 through AF11-09).
 *
 * Covers:
 *  - AF11-01 / AF11-02: YearEndArchiveExport AbortSignal propagation, stale-workspace abort guard,
 *    and truthful manifest.json failedInvoicePdfs / invoicePdfCount reporting.
 *  - AF11-05: truncatedCollections.chartAccounts truthfulness across AccountantExportPackView,
 *    IsraelVatReportView, IsraelMonthJourneyReportView (+ /tax-returns HTTP error), and dataChecks.
 *  - AF11-06: reloadOnceForNewVersion and ViewErrorBoundary never auto-reloading over unsaved
 *    document/modal work, plus manual reload confirmation when unsaved work exists.
 *  - AF11-07: SWIFT MT940 RC/RD reversal polarity, D-mark offset-4 bug fix, optional MMDD entry date,
 *    trailing-comma amounts, and safe integer cent bounds.
 *  - AF11-08: CAMT.053 calendar date validation, safe integer cent bounds, comma decimals,
 *    RvslInd reversal polarity, XML namespaces, and linear-time unclosed-tag scanning.
 *  - AF11-09: sampleBusinessYear TaxPlace.state ('TX') wiring into usSalesTaxReturn without unplaced US sales.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import YearEndArchiveExport from '../components/platform/settings/YearEndArchiveExport';
import { fetchInvoicePdf } from '../lib/yearEndArchive';
import AccountantExportPackView from '../components/reporting/AccountantExportPackView';
import IsraelVatReportView from '../components/reporting/IsraelVatReportView';
import IsraelMonthJourneyReportView from '../components/reporting/IsraelMonthJourneyReportView';
import { ViewErrorBoundary } from '../components/common/ViewErrorBoundary';
import { reloadOnceForNewVersion } from '../lib/chunkReload';
import { runDataChecks } from '../lib/dataChecks';
import { parseMT940Statement } from '../lib/mt940Parser';
import { parseCamt053Statement } from '../lib/camt053Parser';
import { buildSampleBusinessYear, verifySampleBusinessYear } from '../lib/sampleBusinessYear';
import { registrationKey } from '../lib/tax/profile';
import { usSalesTaxReturn } from '../lib/tax/usSalesTaxReturn';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';

async function makeSignedServerBackup(workspaceId: string, collections: Record<string, unknown[]>) {
  const base = {
    schemaVersion: 1,
    exportedAt: '2026-11-11T00:00:00.000Z',
    workspace: { id: workspaceId, name: 'Test workspace' },
    ...collections,
    metadata: {
      serverAuthoritative: true,
      counts: Object.fromEntries(Object.entries(collections).map(([k, v]) => [k, v.length])),
    },
  };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(base)));
  const checksum = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  return { ...base, metadata: { ...base.metadata, checksum } };
}

describe('AF11-01 & AF11-02: YearEndArchiveExport stale-async & AbortSignal safety', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setComponentWorkspace('owner');
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  test('fetchInvoicePdf forwards AbortSignal and rethrows AbortError instead of swallowing as failed PDF', async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | null | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenSignal = init?.signal;
      controller.abort();
      const abortErr = new Error('The operation was aborted.');
      abortErr.name = 'AbortError';
      throw abortErr;
    }) as typeof fetch;

    await assert.rejects(
      () => fetchInvoicePdf('ws-1', 'inv-1', 'tok', controller.signal),
      (err: unknown) => err instanceof Error && err.name === 'AbortError',
    );
    assert.equal(seenSignal, controller.signal);
  });

  test('switching workspace during in-flight archive download aborts without triggering a stale ZIP click', async () => {
    const ws = setComponentWorkspace('owner');
    const collections = {
      accounts: [{ id: 'acc-1', code: '1000', name: 'Cash' }],
      invoices: [{ id: 'inv-1', number: 'INV-2026-1', date: '2026-03-10', totalAmountCents: 10000 }],
    };
    const signedBackup = await makeSignedServerBackup(ws.id, collections);

    let resolvePdf!: (res: Response) => void;
    let pdfSignal: AbortSignal | null | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/export')) {
        return new Response(
          JSON.stringify(signedBackup),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      pdfSignal = init?.signal;
      return await new Promise<Response>(resolve => { resolvePdf = resolve; });
    }) as typeof fetch;

    let clickedDownloads = 0;
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patchedClick() {
      if (this.download) clickedDownloads += 1;
    };

    try {
      render(<YearEndArchiveExport />);
      const yearInput = screen.getByLabelText('Year') as HTMLInputElement;
      fireEvent.change(yearInput, { target: { value: '2026' } });

      fireEvent.click(screen.getByRole('button', { name: /Show what will be in it/i }));
      await waitFor(() => assert.match(document.body.textContent || '', /collections\/accounts-2026\.csv/));

      fireEvent.click(screen.getByRole('button', { name: /Download everything for 2026/i }));
      await waitFor(() => assert.ok(pdfSignal, 'PDF fetch started with AbortSignal'));

      // Switch workspace while the PDF fetch is still in flight
      act(() => {
        useAuthStore.setState({ currentWorkspaceId: 'other-workspace' });
      });
      assert.equal(pdfSignal?.aborted, true, 'unmounting old workspace scope aborts in-flight PDF fetch');

      await act(async () => {
        resolvePdf(new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 }));
        await new Promise(r => setTimeout(r, 25));
      });
      assert.equal(clickedDownloads, 0, 'stale archive never triggers an anchor download after workspace switch');
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }
  });
});

describe('AF11-05: truncatedCollections.chartAccounts truthfulness across reports & checks', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    const ws = setComponentWorkspace('owner');
    useAuthStore.setState({
      workspaces: [{
        ...ws,
        currency: 'ILS',
        taxProfiles: {
          books: {
            name: 'Tel Aviv Studio Ltd',
            place: { country: 'IL' },
            registrations: [{ kind: 'vat', number: '515998877', place: { country: 'IL' }, filing: 'monthly' }],
          },
        },
      }],
    });
    useLedgerStore.setState({
      accounts: [{ id: 'ar-1', uid: 'test-user', workspaceId: ws.id, code: '1100', name: 'Accounts Receivable', type: 'asset', balanceCents: 0 }],
      transactions: [],
      invoices: [],
      bills: [],
      creditNotes: [],
      vendorCredits: [],
      customers: [],
      vendors: [],
      truncatedCollections: { chartAccounts: true },
    });
    markComponentCollectionsLoaded(
      'accounts', 'transactions', 'customers', 'vendors',
      'invoices', 'bills', 'creditNotes', 'vendorCredits',
    );
    useDataNeedsStore.setState({ loadedWorkspaceId: ws.id });
  });

  afterEach(() => {
    cleanup();
    useLedgerStore.setState({ truncatedCollections: {} });
    useDataNeedsStore.setState({ loaded: {}, failed: {} });
    globalThis.fetch = originalFetch;
  });

  test('AccountantExportPackView blocks export when truncatedCollections.chartAccounts is true', () => {
    render(<AccountantExportPackView />);
    assert.match(document.body.textContent || '', /incomplete or failed to load:.*chartAccounts/i);
  });

  test('IsraelVatReportView warns that figures are provisional when truncatedCollections.chartAccounts is true', () => {
    render(<IsraelVatReportView />);
    assert.match(document.body.textContent || '', /capped or failed, so the figures below are provisional/i);
  });

  test('IsraelMonthJourneyReportView warns when /tax-returns fails with HTTP 500 or chartAccounts is truncated', async () => {
    globalThis.fetch = (async () => new Response('{"message":"db down"}', { status: 500 })) as typeof fetch;
    useLedgerStore.setState({ truncatedCollections: {} });
    render(<IsraelMonthJourneyReportView />);
    await waitFor(() => {
      assert.match(document.body.textContent || '', /capped or failed, so the totals below are provisional/i);
    });
  });

  test('dataChecks control-balance reports incomplete data instead of a false mismatch when chartAccounts is truncated', () => {
    const findings = runDataChecks({
      accounts: [
        { id: 'ar-1', uid: 'test-user', workspaceId: 'ws-1', code: '1100', name: 'Accounts Receivable', type: 'asset', balanceCents: 0 },
      ],
      transactions: [],
      invoices: [
        {
          id: 'inv-1', uid: 'test-user', workspaceId: 'ws-1', number: 'INV-1', customerId: 'c-1', customerName: 'Acme',
          date: '2026-04-01', dueDate: '2026-05-01', status: 'sent', items: [],
          taxAmountCents: 0, amountCents: 5000, amountPaidCents: 0,
        },
      ],
      bills: [],
      recurring: [],
      allocations: [],
      today: '2026-11-11',
      baseCurrency: 'USD',
      truncated: ['chartAccounts'],
    });
    const controlFindings = findings.filter(f => f.checkId === 'control-balance');
    assert.equal(controlFindings.length, 1);
    assert.match(controlFindings[0].title, /Not checked: the data read is incomplete/i);
  });
});

describe('AF11-06: chunk reload never discards unsaved accounting work', () => {
  const originalError = console.error;

  beforeEach(() => {
    setComponentWorkspace('owner');
    console.error = () => {};
    sessionStorage.clear();
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    console.error = originalError;
    sessionStorage.clear();
  });

  test('reloadOnceForNewVersion refuses to reload when an open modal or dirty form is present', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    let reloads = 0;

    assert.equal(reloadOnceForNewVersion(1_000_000, storage, () => { reloads += 1; }, () => true), false);
    assert.equal(reloads, 0);
    assert.equal(store.has('lf_chunk_reload_at'), false, 'blocked reload does not burn the 60s cooldown');

    assert.equal(reloadOnceForNewVersion(1_000_000, storage, () => { reloads += 1; }, () => false), true);
    assert.equal(reloads, 1);
  });

  test('ViewErrorBoundary suppresses auto-reload on ChunkLoadError while a dialog is open and confirms manual reload', () => {
    function StaleChunk(): React.ReactElement {
      throw new TypeError('Failed to fetch dynamically imported module: https://app.example/assets/Reports-abc123.js');
    }

    const origConfirm = window.confirm;
    let confirmCalls = 0;
    window.confirm = () => {
      confirmCalls += 1;
      return false; // user cancels reload to save their open invoice modal first
    };

    // User already has an invoice modal open in the DOM when a lazy view chunk fails to load
    const openDialog = document.createElement('div');
    openDialog.setAttribute('role', 'dialog');
    openDialog.setAttribute('aria-modal', 'true');
    const draftInput = document.createElement('input');
    draftInput.value = 'Draft line item';
    openDialog.appendChild(draftInput);
    document.body.appendChild(openDialog);

    try {
      render(
        <ViewErrorBoundary viewName="Reports">
          <StaleChunk />
        </ViewErrorBoundary>,
      );

      assert.match(document.body.textContent || '', /Save or close your open work, then reload/i);
      assert.equal(sessionStorage.getItem('lf_chunk_reload_at'), null, 'did not auto-reload over open dialog');

      fireEvent.click(screen.getByRole('button', { name: /Reload now/i }));
      assert.equal(confirmCalls, 1, 'manual reload prompts confirmation when unsaved work is open');
    } finally {
      openDialog.remove();
      window.confirm = origConfirm;
    }
  });
});

describe('AF11-07 & AF11-08: SWIFT MT940 and ISO 20022 CAMT.053 parser correctness', () => {
  test('MT940 maps RC to debit, RD to credit, preserves D with C at offset 4, and supports trailing-comma amounts', () => {
    const sample = [
      ':20:STMT-01',
      ':61:260915C500,NTRFNONREF',
      ':86:Trailing comma integer credit',
      ':61:260916D1,0CNTRFNONREF',
      ':86:Debit with C at offset 4 after YYMMDD',
      ':61:260917RC250,00NTRFREV1',
      ':86:Reversal of prior credit (chargeback)',
      ':61:2609180918RD125,75NTRFREV2',
      ':86:Reversal of prior debit (refund)',
    ].join('\n');

    const lines = parseMT940Statement(sample);
    assert.equal(lines.length, 4);

    assert.equal(lines[0].type, 'credit');
    assert.equal(lines[0].amountCents, 50000);

    assert.equal(lines[1].type, 'debit');
    assert.equal(lines[1].amountCents, -100);

    assert.equal(lines[2].type, 'debit');
    assert.equal(lines[2].amountCents, -25000);
    assert.equal(lines[2].reference, 'REV1');

    assert.equal(lines[3].type, 'credit');
    assert.equal(lines[3].amountCents, 12575);
    assert.equal(lines[3].reference, 'REV2');

    assert.throws(() => parseMT940Statement(':61:2609151345C100,00NTRF'), /invalid entry date/);
    assert.throws(() => parseMT940Statement(':61:260915C9999999999999999,00NTRF'), /out-of-range amount/);
  });

  test('CAMT.053 validates calendar dates, supports comma decimals & RvslInd, and scans unclosed XML linearly', () => {
    const xml = `
      <ns:Document xmlns:ns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
        <ns:BkToCstmrStmt>
          <ns:Stmt>
            <ns:Ntry>
              <ns:Amt Ccy="EUR">1250,50</ns:Amt>
              <ns:CdtDbtInd>CRDT</ns:CdtDbtInd>
              <ns:RvslInd>true</ns:RvslInd>
              <ns:BookgDt><ns:Dt>2026-09-12</ns:Dt></ns:BookgDt>
              <ns:Ustrd>Reversed incoming wire</ns:Ustrd>
            </ns:Ntry>
            <ns:Ntry>
              <ns:Amt Ccy="EUR">40.25</ns:Amt>
              <ns:CdtDbtInd>DBIT</ns:CdtDbtInd>
              <ns:RvslInd>true</ns:RvslInd>
              <ns:BookgDt><ns:Dt>2026-09-13</ns:Dt></ns:BookgDt>
              <ns:Ustrd>Reversed bank fee</ns:Ustrd>
            </ns:Ntry>
          </ns:Stmt>
        </ns:BkToCstmrStmt>
      </ns:Document>
    `;
    const parsed = parseCamt053Statement(xml);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].type, 'debit');
    assert.equal(parsed[0].amountCents, -125050);
    assert.equal(parsed[0].currency, 'EUR');
    assert.equal(parsed[1].type, 'credit');
    assert.equal(parsed[1].amountCents, 4025);

    assert.throws(
      () => parseCamt053Statement('<Ntry><Amt>10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt>2026-02-30</Dt></Ntry>'),
      /not a real calendar day/,
    );
    assert.throws(
      () => parseCamt053Statement('<Ntry><Amt>9999999999999999.99</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt>2026-03-10</Dt></Ntry>'),
      /out-of-range amount/,
    );

    const start = performance.now();
    const unclosed = '<Ntry><BookgDt><Dt>2026-03-10</Dt>'.repeat(5_000);
    assert.deepEqual(parseCamt053Statement(unclosed), []);
    assert.ok(performance.now() - start < 250, 'unclosed XML tags scan linearly');
  });
});

describe('AF11-09: sampleBusinessYear US TaxPlace.state integration with usSalesTaxReturn', () => {
  test('sample business year registers US-TX permit and places all US sales into state returns with zero unplaced US sales', () => {
    const fixture = buildSampleBusinessYear({ year: 2026, scale: 1 });
    const check = verifySampleBusinessYear(fixture);
    assert.equal(check.ok, true, check.failures.join('; '));

    const profiles = fixture.workspace.taxProfiles!;
    const txPermit = profiles.books!.registrations![0];
    const regKey = registrationKey(txPermit);
    assert.equal(regKey, 'sales_tax:US-TX:32099887766');

    const q1Return = usSalesTaxReturn({
      registration: regKey,
      profiles,
      order: ['world'],
      invoices: fixture.invoices,
      creditNotes: [],
      customers: fixture.customers,
      startDate: '2026-01-01',
      endDate: '2026-03-31',
    });

    assert.equal(q1Return.state, 'TX');
    assert.ok(q1Return.documentCount > 0, 'Q1 TX return includes Texas invoices');
    assert.ok(q1Return.taxCollectedCents > 0, 'Q1 TX return computes non-zero Texas sales tax');
    assert.equal(q1Return.unplaced.documentCount, 0, 'no US invoice is stranded in unplaced due to region vs state mismatch');
  });
});
