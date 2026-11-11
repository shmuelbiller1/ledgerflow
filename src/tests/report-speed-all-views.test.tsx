/**
 * R-5 (Agent #13, 2026-11-11): the existing speed test (`report-speed-12m.test.tsx`) mounts a chosen
 * list of report views. This one covers every report screen module in src/components — reporting/,
 * ledger/ and finance/ report and register views — on the 12-month sample year, so a slow screen
 * cannot hide by not being on that list.
 *
 * What the measurement showed when this test was written (scale=1, 1,238 entries, jsdom):
 *   - 167 of 170 modules mount in well under 1,000 ms; the computation itself is not the cost
 *     (`computeJournalSheet` 5 ms, `computeGeneralLedger` 6 ms on the same fixture).
 *   - Three screens exceed the product's 1,000 ms target and are DOM-bound, not maths-bound:
 *     JournalSheetReportView (~1,700 ms — one card + table per entry), PaymentsView (~1,500 ms),
 *     GeneralLedgerView (~1,450 ms). At scale=4 (~4,880 entries) they take ~6,500 / ~5,600 / ~4,900 ms.
 *     See audit/agent13-2026-11-11/FINDINGS.md (AF13-004) and the probe that produced the numbers.
 *   - Five sampled modules need props this harness does not build (they are counted, not asserted).
 *
 * So this test is a ratchet, not a claim that R-5 is met: no screen may get slower than the
 * documented ceiling, and no fourth screen may cross the 1,000 ms product target.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { getSupabase } from '../lib/db/client';
import { buildSampleBusinessYear } from '../lib/sampleBusinessYear';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { formatCurrency } from '../lib/utils';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';

const PRODUCT_TARGET_MS = 1000;
/** On a shared CI runner every screen is slower; the target check follows the same multiplier as the ceiling. */
const TARGET_MS = Number(process.env.CI ? PRODUCT_TARGET_MS * 3 : PRODUCT_TARGET_MS);
/** jsdom is several times slower than a browser, and shared CI runners slower still. */
const CEILING_MS = Number(process.env.CI ? 2500 * 3 : 2500);
const KNOWN_OVER_TARGET = new Set(['JournalSheetReportView', 'PaymentsView', 'GeneralLedgerView']);

afterEach(async () => {
  cleanup();
  getSupabase().realtime.disconnect();
  await getSupabase().auth.dispose();
});

function reportModules(): string[] {
  const root = path.resolve('src/components');
  const files: string[] = [];
  for (const dir of ['reporting', 'ledger', 'finance']) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of fs.readdirSync(full)) {
      if (!file.endsWith('.tsx') || file.includes('.test.')) continue;
      if (!/(Report|View|Aging|Ledger|Cohort|Balances|Summary|Notes|Statement|Register)/.test(file)) continue;
      files.push(path.join(full, file));
    }
  }
  return files.sort();
}

describe('R-5: every report screen is measured, not just a chosen list', () => {
  test('no report view regresses past its ceiling, and no fourth screen crosses the 1,000 ms target', async () => {
    const fixture = buildSampleBusinessYear({ year: 2026, scale: 1 });
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

    const files = reportModules();
    assert.ok(files.length >= 150, `expected the whole report surface, found ${files.length} modules`);

    const measured: Array<{ id: string; ms: number }> = [];
    const needProps: string[] = [];
    for (const file of files) {
      const id = path.basename(file, '.tsx');
      const mod = await import(file) as Record<string, unknown> & { default?: React.ComponentType<Record<string, unknown>> };
      const Component = mod.default || (mod[Object.keys(mod).find(k => /^[A-Z]/.test(k)) as string] as React.ComponentType<Record<string, unknown>> | undefined);
      if (!Component) continue; // a helper that lives next to the views, not a screen
      const t0 = performance.now();
      try {
        await act(async () => { render(<Component {...stdProps} />); });
      } catch {
        // a view that needs props this harness does not build: recorded, not asserted
        needProps.push(id);
        cleanup();
        continue;
      }
      const ms = Number((performance.now() - t0).toFixed(2));
      measured.push({ id, ms });
      cleanup();
    }

    assert.ok(measured.length >= 150, `measured ${measured.length} of ${files.length} report views`);
    const overCeiling = measured.filter(v => v.ms >= CEILING_MS);
    assert.deepEqual(overCeiling, [], `these report views are past the ${CEILING_MS} ms ceiling: ${overCeiling.map(v => `${v.id} ${v.ms} ms`).join(', ')}`);

    const overTarget = measured.filter(v => v.ms >= TARGET_MS).map(v => v.id).sort();
    const unexpected = overTarget.filter(id => !KNOWN_OVER_TARGET.has(id));
    assert.deepEqual(unexpected, [], `new slow screens past the ${TARGET_MS} ms target: ${unexpected.join(', ')}`);
  });
});
