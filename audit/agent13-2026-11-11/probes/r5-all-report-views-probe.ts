/**
 * Agent #13 R-5 probe, 2026-11-11.
 *
 * R-5 asks: "every report on the 5,000-entry sample year opens in under one second on a normal
 * laptop; fix the slow ones without changing the figures; the existing speed test extended."
 *
 * The existing speed test (src/tests/report-speed-12m.test.tsx) mounts a chosen list of 39 report
 * views. This probe mounts EVERY report screen module in src/components (reporting/, ledger/ and
 * finance/ report views) on the scale=4 (~5,000-entry) sample year and prints the measured mount
 * time, so the coverage gap and the slow ones are visible instead of assumed.
 *
 * Run: NODE_ENV=test NODE_OPTIONS=--max-old-space-size=4096 npx tsx audit/agent13-2026-11-11/probes/r5-all-report-views-probe.ts
 */
import './helpers/dom-probe';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { buildSampleBusinessYear } from '../../../src/lib/sampleBusinessYear';
import { useLedgerStore } from '../../../src/stores/useLedgerStore';
import { useAuthStore } from '../../../src/stores/useAuthStore';
import { formatCurrency } from '../../../src/lib/utils';
import { markComponentCollectionsLoaded, setComponentWorkspace } from '../../../src/tests/helpers/componentFixtures';

const ROOT = path.resolve('src/components');
const DIRS = ['reporting', 'ledger', 'finance'];

async function main() {
  const fixture = buildSampleBusinessYear({ year: 2026, scale: Number(process.env.PROBE_SCALE || 4) });
  setComponentWorkspace('owner');
  useAuthStore.setState({ currentWorkspaceId: fixture.workspace.id, workspaces: [fixture.workspace] });
  markComponentCollectionsLoaded(
    'transactions', 'accounts', 'customers', 'vendors', 'invoices', 'creditNotes',
    'estimates', 'bills', 'vendorCredits', 'inventory', 'payments', 'bankLines',
    'assets', 'recurring', 'budgets', 'projects',
  );
  useLedgerStore.setState({
    transactions: fixture.transactions,
    accounts: fixture.accounts,
    customers: fixture.customers,
    vendors: fixture.vendors,
    invoices: fixture.invoices,
    creditNotes: fixture.creditNotes,
    estimates: fixture.estimates,
    bills: fixture.bills,
    vendorCredits: fixture.vendorCredits,
    inventory: fixture.inventory,
    payments: fixture.payments,
    bankLines: fixture.bankLines,
    reconciliations: fixture.reconciliations as unknown as never[],
    assets: fixture.assets,
    recurring: fixture.recurring,
    budgets: fixture.budgets,
    projects: fixture.projects,
  });

  const stdProps = {
    transactions: fixture.transactions,
    allTransactions: fixture.transactions,
    accounts: fixture.accounts,
    projects: fixture.projects,
    budgets: fixture.budgets,
    selectedYear: 2026,
    periodLabel: 'FY 2026',
    startDate: fixture.startDate,
    endDate: fixture.endDate,
    asOfDate: fixture.asOfDate,
    formatCurrency,
    purchaseOrders: fixture.purchaseOrders,
    history: fixture.inventoryDetails,
    onDrillDown: () => {},
  };

  const files: string[] = [];
  for (const dir of DIRS) {
    for (const file of fs.readdirSync(path.join(ROOT, dir))) {
      if (!file.endsWith('.tsx') || file.includes('.test.')) continue;
      // report-looking screens only: files whose name has Report/View/Aging/Ledger/Cohort/Notes
      if (!/(Report|View|Aging|Ledger|Cohort|Balances|Summary|Notes|Statement|Register)/.test(file)) continue;
      files.push(path.join(ROOT, dir, file));
    }
  }

  const results: Array<{ id: string; ms: number; status: string }> = [];
  for (const file of files.sort()) {
    const id = path.basename(file, '.tsx');
    let Component: React.ComponentType<Record<string, unknown>> | undefined;
    try {
      const mod = await import(file);
      Component = (mod.default || mod[Object.keys(mod).find(k => /^[A-Z]/.test(k)) as string]) as React.ComponentType<Record<string, unknown>>;
    } catch (err) {
      results.push({ id, ms: 0, status: `import failed: ${(err as Error).message.slice(0, 120)}` });
      continue;
    }
    if (!Component) { results.push({ id, ms: 0, status: 'no default export' }); continue; }
    const t0 = performance.now();
    try {
      await act(async () => { render(React.createElement(Component!, stdProps)); });
      const ms = Number((performance.now() - t0).toFixed(2));
      results.push({ id, ms, status: ms < 1000 ? 'ok' : 'SLOW' });
    } catch (err) {
      results.push({ id, ms: Number((performance.now() - t0).toFixed(2)), status: `threw: ${(err as Error).message.slice(0, 120)}` });
    } finally {
      cleanup();
    }
  }

  results.sort((a, b) => b.ms - a.ms);
  console.log(`\nFixture: ${fixture.transactions.length} transactions, ${files.length} report modules\n`);
  console.log('id'.padEnd(46), 'ms'.padStart(9), 'status');
  for (const r of results) console.log(r.id.padEnd(46), String(r.ms).padStart(9), r.status);
  const over = results.filter(r => r.ms >= 1000).length;
  console.log(`\nover 1,000 ms: ${over} of ${results.length}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
