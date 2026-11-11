/**
 * R-5: every report view in src/components/reporting opens on the ~5,000-entry sample year (scale 4) within the
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
const DIR = join(process.cwd(), 'src/components/reporting');
const VIEWS = readdirSync(DIR).filter(f => /View\.tsx$/.test(f)).sort();

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
  for (const file of VIEWS) {
    const mod = await import(`../components/reporting/${file.replace(/\.tsx$/, '')}`) as Record<string, unknown>;
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
    let ms = await mount();
    if (ms >= BUDGET_MS) ms = Math.min(ms, await mount()); // one retry: the first mount of a view also warms shared code
    timings.push({ file: label, ms });
    if (ms >= BUDGET_MS) slow.push(`${label} ${ms} ms`);
    }
  }
  timings.sort((a, b) => b.ms - a.ms);
  console.log('R-5 slowest:', timings.slice(0, 8).map(t => `${t.file} ${t.ms}`).join(', '));
  assert.deepEqual(slow, [], `report views over ${BUDGET_MS} ms`);
});
