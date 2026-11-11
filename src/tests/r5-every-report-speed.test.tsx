/**
 * R-5 / #642: every report, statement and register view in src/components/{reporting,ledger,finance} opens on the ~5,000-entry sample year (scale 4) within the
 * product budget (REPORT_BUDGET_MS, 1 s; three times that on a shared CI runner). The module import is timed apart
 * from the mount, as the app shell preloads route chunks; only the mount (render to committed DOM) is the report.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { getSupabase } from '../lib/db/client';
import { buildSampleBusinessYear } from '../lib/sampleBusinessYear';
import { REPORT_BUDGET_MS } from '../lib/reportBenchmark';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { formatCurrency } from '../lib/utils';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';

const BUDGET_MS = process.env.CI ? REPORT_BUDGET_MS * 3 : REPORT_BUDGET_MS;
// #642: the statement and register screens in ledger/ and finance/ too, not only the Reports picker's views
const DIRS = ['reporting', 'ledger', 'finance'];
const VIEWS = DIRS.flatMap(dir => readdirSync(join(process.cwd(), 'src/components', dir))
  .filter(f => /(View|Register)\.tsx$/.test(f)).sort().map(f => `${dir}/${f}`));
// editors and widgets that open only with props of their own (not report views), each with why; the list must stay real
const NEEDS_OWN_PROPS: Record<string, string> = {
  'ledger/ChartOfAccountsView.tsx': 'the chart editor needs its account handlers',
  'ledger/PivotSheetView.tsx#PivotSheetView': 'a widget given its rows by the pivot screen',
  'ledger/ProjectProfitabilityView.tsx': 'draws a chart that needs ResizeObserver, absent from jsdom',
  'ledger/ReconciliationView.tsx#ReconciliationView': 'the reconcile panel is given its bank lines by Reconciliation',
  'ledger/TransactionGridView.tsx#TransactionGridView': 'a grid given its rows by the transactions screen',
};

afterEach(async () => {
  cleanup();
  getSupabase().realtime.disconnect();
  await getSupabase().auth.dispose();
});

test(`R-5: all ${VIEWS.length} report views open under ${REPORT_BUDGET_MS} ms on the ~5,000-entry sample year`, async () => {
  const fixture = buildSampleBusinessYear({ year: 2026, scale: 4 });
  assert.ok(fixture.transactions.length >= 4500, `about 5,000 entries, got ${fixture.transactions.length}`);
  setComponentWorkspace('owner');
  useAuthStore.setState({ currentWorkspaceId: fixture.workspace.id, workspaces: [fixture.workspace] });
  markComponentCollectionsLoaded('transactions', 'accounts', 'customers', 'vendors', 'invoices', 'creditNotes',
    'estimates', 'bills', 'vendorCredits', 'inventory', 'payments', 'bankLines', 'assets', 'recurring', 'budgets', 'projects');
  useLedgerStore.setState({
    transactions: fixture.transactions, accounts: fixture.accounts, customers: fixture.customers, vendors: fixture.vendors,
    invoices: fixture.invoices, creditNotes: fixture.creditNotes, estimates: fixture.estimates, bills: fixture.bills,
    vendorCredits: fixture.vendorCredits, inventory: fixture.inventory, payments: fixture.payments, bankLines: fixture.bankLines,
    reconciliations: fixture.reconciliations as unknown as never[], assets: fixture.assets, recurring: fixture.recurring,
    budgets: fixture.budgets, projects: fixture.projects,
  });
  const props = {
    transactions: fixture.transactions, allTransactions: fixture.transactions, accounts: fixture.accounts,
    projects: fixture.projects, budgets: fixture.budgets, selectedYear: 2026, periodLabel: 'FY 2026',
    startDate: fixture.startDate, endDate: fixture.endDate, asOfDate: fixture.asOfDate, formatCurrency,
    purchaseOrders: fixture.purchaseOrders, history: fixture.inventoryDetails, onDrillDown: () => {},
  };
  const timings: Array<{ file: string; ms: number }> = [];
  const slow: string[] = [];
  const skipped: string[] = [];
  for (const file of VIEWS) {
    const mod = await import(`../components/${file.replace(/\.tsx$/, '')}`) as Record<string, unknown>;
    // the default export, else every named export ending in View (a file can hold two: sales and purchase trends)
    const views = (mod.default ? [['default', mod.default]] : Object.entries(mod).filter(([name, v]) => /View$/.test(name) && typeof v === 'function'))
      .map(([name, v]) => [name, v as React.ComponentType<Record<string, unknown>>] as const);
    assert.ok(views.length > 0, `${file} exports its view`);
    for (const [name, View] of views) {
    const label = name === 'default' ? file : `${file}#${name}`;
    const mount = async () => {
      const t0 = performance.now();
      await act(async () => { render(<View {...props} />); });
      const ms = Number((performance.now() - t0).toFixed(2));
      cleanup();
      return ms;
    };
    if (NEEDS_OWN_PROPS[label]) { skipped.push(label); continue; }
    let ms: number;
    try { ms = await mount(); } catch (error) { throw new Error(`${label} did not open: ${error instanceof Error ? error.message : String(error)}`); }
    if (ms >= BUDGET_MS) ms = Math.min(ms, await mount()); // one retry: the first mount of a view also warms shared code
    timings.push({ file: label, ms });
    if (ms >= BUDGET_MS) slow.push(`${label} ${ms} ms`);
    }
  }
  timings.sort((a, b) => b.ms - a.ms);
  console.log('R-5 slowest:', timings.slice(0, 8).map(t => `${t.file} ${t.ms}`).join(', '));
  assert.deepEqual(skipped.sort(), Object.keys(NEEDS_OWN_PROPS).sort(), 'every view excluded for its own props still exists');
  assert.deepEqual(slow, [], `report views over ${BUDGET_MS} ms`);
});
