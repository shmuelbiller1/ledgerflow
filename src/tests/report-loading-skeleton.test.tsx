/**
 * F-5: one loading state for reports — the shared skeleton (`ui/LoadingState` → `ReportSkeleton`),
 * not a bare "Loading…" paragraph that leaves the table's space empty and then pushes the page
 * down when the rows arrive (the layout shift C-94 and F-5 were filed for).
 *
 * The skeleton keeps `role="status"` and the same words, so it is announced exactly as before; what
 * changes is that the screen holds its shape while it waits.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, waitFor } from '@testing-library/react';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import GoodsNotBilledReportView from '../components/reporting/GoodsNotBilledReportView';
import { ProfitabilityByView } from '../components/reporting/ProfitabilityByView';
import StockAgingReportView from '../components/reporting/StockAgingReportView';

const skeleton = () => document.querySelector('[data-report-skeleton]');

describe('F-5: reports wait with the shared skeleton', () => {
  afterEach(() => cleanup());

  test('Goods not billed: the shared skeleton while its purchase orders are in flight', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ estimates: [], invoices: [], transactions: [], bills: [] } as never);
    globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
    render(<GoodsNotBilledReportView />);
    await waitFor(() => assert.ok(skeleton(), 'the report holds its shape while it waits'));
    assert.match(skeleton()!.textContent || '', /Loading/, 'the live region still says what is loading');
  });

  test('Profitability by customer: the shared skeleton until the collections have arrived', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ customers: [], invoices: [], inventory: [], transactions: [], accounts: [], projects: [] } as never);
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;
    render(<ProfitabilityByView />);
    await waitFor(() => assert.ok(skeleton(), 'the report holds its shape while it waits'));
  });

  test('Stock aging: the shared skeleton while the stock lists load', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ inventory: [], transactions: [] } as never);
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;
    render(<StockAgingReportView />);
    await waitFor(() => assert.ok(skeleton(), 'the report holds its shape while it waits'));
  });
});

describe('F-5: no report screen falls back to a bare loading paragraph', () => {
  // Converted in this batch (2026-11-19). Two screens use the word inside a button's busy label and
  // ReportProvenanceNote uses it inline; those are not page loading and keep their own wording.
  const CONVERTED = [
    'BackordersReportView.tsx', 'CommissionReportView.tsx', 'DepreciationLedgerReportView.tsx',
    'Form856ReportView.tsx', 'GoodsNotBilledReportView.tsx', 'ImportAcceptanceView.tsx',
    'InventoryDetailsReportView.tsx', 'ItemRegisterReportView.tsx', 'LabelBalanceSheetReportView.tsx',
    'LabelProfitReportView.tsx', 'ProfitabilityByView.tsx', 'StockAgingReportView.tsx',
    'StockSourcesUsesReportView.tsx',
  ];
  for (const file of CONVERTED) {
    test(`${file} uses LoadingState, not a <p>Loading…</p>`, () => {
      const source = readFileSync(join(process.cwd(), 'src/components/reporting', file), 'utf8');
      assert.match(source, /<LoadingState label=/);
      const bare = source.match(/<p[^>]*>\{reportText\('r\.loading', 'Loading…'\)\}<\/p>/g) ?? [];
      assert.deepEqual(bare, [], 'use the shared LoadingState');
    });
  }
});
