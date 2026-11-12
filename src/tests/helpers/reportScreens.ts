/**
 * Mounting every report screen on the 12-month sample year, in one place: the speed test in
 * `src/tests` and the Agent #13 audit probe must measure the same modules with the same stores and
 * the same props, otherwise a figure from one cannot be checked against the other.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { formatCurrency } from '../../lib/utils';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import type { SampleBusinessYearFixture } from '../../lib/sampleBusinessYear';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './componentFixtures';

/** Folders whose `*ReportView`/`*View`/register files are report screens. */
export const REPORT_DIRS = ['reporting', 'ledger', 'finance'] as const;
const REPORT_SCREEN = /(Report|View|Aging|Ledger|Cohort|Balances|Summary|Notes|Statement|Register)/;
/** Collections every report screen reads, seeded from the fixture. */
export const REPORT_COLLECTIONS = [
  'transactions', 'accounts', 'customers', 'vendors', 'invoices', 'creditNotes',
  'estimates', 'bills', 'vendorCredits', 'inventory', 'payments', 'bankLines',
  'assets', 'recurring', 'budgets', 'projects',
] as const;

/** Put the sample year into the stores and mark the collections loaded, as the app does after a fetch. */
export function seedSampleYear(fixture: SampleBusinessYearFixture): void {
  setComponentWorkspace('owner');
  useAuthStore.setState({ currentWorkspaceId: fixture.workspace.id, workspaces: [fixture.workspace] });
  markComponentCollectionsLoaded(...REPORT_COLLECTIONS);
  const seeded: Record<string, unknown> = { reconciliations: fixture.reconciliations };
  for (const key of REPORT_COLLECTIONS) seeded[key] = fixture[key];
  useLedgerStore.setState(seeded as never);
}

/** Absolute paths of the report screen modules, sorted so two runs measure the same order. */
export function reportScreenPaths(root = path.resolve('src/components')): string[] {
  const found: string[] = [];
  for (const dir of REPORT_DIRS) {
    const folder = path.join(root, dir);
    if (!fs.existsSync(folder)) continue;
    for (const file of fs.readdirSync(folder)) {
      if (!file.endsWith('.tsx') || file.includes('.test.')) continue;
      if (!REPORT_SCREEN.test(file)) continue;
      found.push(path.join(folder, file));
    }
  }
  return found.sort((a, b) => a.localeCompare(b));
}

/** The props the report screens share; anything extra a screen needs is what makes it "needs props". */
export function sampleYearReportProps(fixture: SampleBusinessYearFixture): Record<string, unknown> {
  return {
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
}

export interface ScreenMeasurement {
  id: string;
  ms: number;
  /** Set when the screen could not be measured: no component export, an import error, or props it needs. */
  error?: string;
}

const round = (ms: number) => Number(ms.toFixed(2));
const firstComponent = (mod: Record<string, unknown>) =>
  (mod.default || mod[Object.keys(mod).find(key => /^[A-Z]/.test(key)) as string]) as
    React.ComponentType<Record<string, unknown>> | undefined;

/** Import one screen, render it once, time the render, and always clean up. */
export async function mountReportScreen(file: string, props: Record<string, unknown>): Promise<ScreenMeasurement> {
  const id = path.basename(file, '.tsx');
  let Component: React.ComponentType<Record<string, unknown>> | undefined;
  try {
    Component = firstComponent(await import(file) as Record<string, unknown>);
  } catch (err) {
    return { id, ms: 0, error: `import failed: ${(err as Error).message.slice(0, 120)}` };
  }
  if (!Component) return { id, ms: 0, error: 'no component export' };
  const started = performance.now();
  try {
    await act(async () => { render(React.createElement(Component as React.ComponentType<Record<string, unknown>>, props)); });
    return { id, ms: round(performance.now() - started) };
  } catch (err) {
    return { id, ms: round(performance.now() - started), error: `threw: ${(err as Error).message.slice(0, 120)}` };
  } finally {
    cleanup();
  }
}
