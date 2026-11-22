import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test } from '@playwright/test';
import { openComparison } from './support/comparisonReportFixture';
import { settleStyles } from './support/journeyFixture';
import type { JourneyApiHandler, JourneyMount } from './support/journeyFixture';

/**
 * The final batch's interactive pieces the guest app cannot populate: the practice register (its
 * rows come from a signed-in server command), the bank-statement import preview (a dialog that
 * lives inside Banking), the drill-down a report figure opens, and the document line editor inside
 * the invoice/bill/journal forms. Each is mounted from its real production module on the shared
 * journey fixture — real stores, stubbed network — in both themes at desktop and phone widths; the
 * 390-light and 1280-dark combinations run in Hebrew, mirroring the operations batch.
 */

const workspaceId = 'monthly-books';

const accounts = [
  { id: 'sales', name: 'Product Sales Revenue', type: 'revenue', code: '4000', currency: 'USD', balanceCents: 0 },
  { id: 'inventory', name: 'Inventory Asset', type: 'asset', code: '1200', currency: 'USD', balanceCents: 0 },
  { id: 'checking', name: 'Operating Checking', type: 'asset', code: '1000', currency: 'USD', balanceCents: 0 },
];

const api: JourneyApiHandler = ({ url, method }) => {
  if (new URL(url).pathname === '/api/v1/account/practice' && method === 'GET')
    return {
      json: {
        rows: [
          {
            workspaceId: 'client-books', name: 'Beacon Retail Client Books', role: 'owner', currency: 'USD', groups: ['Retail clients'],
            bankLines: 5, bankLogins: 1, questions: 2, drafts: 3, billsWithoutFile: 4,
            lastMonth: '2026-01', lastMonthClosed: false, nextRecurring: { date: '2026-03-01', description: 'Monthly warehouse lease' },
            dataHealth: { serious: 1, checkedOn: '2026-02-27' },
          },
          {
            workspaceId, name: 'Harbor & Olive Supply Co.', role: 'owner', currency: 'USD', groups: [],
            bankLines: 0, bankLogins: 0, questions: 0, drafts: 0, billsWithoutFile: 0,
            lastMonth: '2026-01', lastMonthClosed: true, nextRecurring: null, dataHealth: { serious: 0, checkedOn: '2026-02-27' },
          },
        ],
      },
    };
  return null;
};

interface JourneyScreen {
  id: string;
  mount: JourneyMount;
  /** Figures the worked data guarantees on the mounted screen. */
  figures: string[];
  /** Extra interaction after mounting (the import preview needs its file). */
  setup?: (page: Page) => Promise<void>;
}

const screens: JourneyScreen[] = [
  {
    id: 'practice',
    mount: { module: '/src/components/dashboard/PracticeView.tsx' },
    figures: ['Beacon Retail Client Books', 'Monthly warehouse lease'],
  },
  {
    id: 'statement-importer',
    mount: {
      module: '/src/components/ledger/StatementImporter.tsx',
      props: {
        isOpen: true,
        onImport: '__capture:import',
        existingTransactions: [],
        businessContext: 'Harbor & Olive Supply Co.',
        accounts,
        autoRules: [],
      },
    },
    figures: ['2026-02-01', '431.66'],
    setup: async (page) => {
      await page.locator('input[type=file]').first().setInputFiles({
        name: 'statement.csv', mimeType: 'text/csv',
        buffer: Buffer.from('Date,Description,Amount\n2026-02-01,Warehouse rent,-4200.00\n2026-02-03,Deposit from Beacon Market Group 24,431.66\n'),
      });
    },
  },
  {
    id: 'drill-down',
    mount: {
      module: '/src/components/layout/DrillDownModal.tsx',
      props: {
        isOpen: true,
        accountName: 'Product Sales Revenue',
        transactions: [
          { id: 'tx-1', uid: 'usr-sample', workspaceId, date: '2026-02-03', description: 'Sales invoice INV-2026-0005', category: 'Sales', totalAmountCents: 19593, currency: 'USD', status: 'cleared' },
          { id: 'tx-2', uid: 'usr-sample', workspaceId, date: '2026-02-14', description: 'Sales invoice INV-2026-0011', category: 'Sales', totalAmountCents: 70636, currency: 'USD', status: 'cleared' },
        ],
        formatCurrency: '__fn:formatCurrency',
        from: 'Profit & Loss',
      },
    },
    figures: ['INV-2026-0005', '195.93'],
  },
  {
    id: 'document-lines',
    mount: {
      module: '/src/components/common/DocumentLineEditor.tsx',
      props: {
        side: 'invoice',
        lines: [
          { id: 'l1', description: 'Precision Valve & Sensor 1', itemId: 'item-1', quantity: 2, rateCents: 2970, amountCents: 5940, accountId: 'sales' },
          { id: 'l2', description: 'Installation labor', quantity: 3, rateCents: 6500, amountCents: 19500, accountId: 'sales' },
        ],
        onChange: '__capture:lines',
        createLine: '__capture:createLine',
        accounts,
        currency: 'USD',
        date: '2026-02-17',
        inventoryItems: [
          { id: 'item-1', name: 'Precision Valve & Sensor 1', unitPriceCents: 2970, unitCostCents: 1800, itemType: 'stock' },
        ],
      },
    },
    figures: ['Line Items', '$59.40', '$195.00'],
  },
];

test.describe.configure({ mode: 'parallel' });

async function checkJourneyScreen(page: Page, screen: JourneyScreen, width: number, theme: 'light' | 'dark') {
  test.setTimeout(90_000);
  const state = await openComparison(page, screen.mount, width, theme, 'accountant', { ledger: { accounts }, api });
  if (screen.setup) await screen.setup(page);
  const root = page.locator('#root');
  for (const figure of screen.figures) await expect(root.getByText(figure, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  expect(state.errors).toEqual([]);
  await settleStyles(page);
  // A cold dev server (each CI playwright invocation starts its own) compiles modules on demand;
  // let those fetches settle before pixels are taken, or an icon-sized gap flakes the comparison.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  const audit = await new AxeBuilder({ page }).include('#root').disableRules(['color-contrast']).analyze();
  expect(audit.violations.map(v => [v.id, v.nodes.map(n => n.target)])).toEqual([]);
  if (process.env.LF_FINAL_EVIDENCE) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const dir = process.env.LF_FINAL_EVIDENCE;
    await mkdir(dir, { recursive: true });
    const tables = await page.locator('table:visible').evaluateAll(ts =>
      ts.map(t => [t.caption?.textContent ?? '', ...Array.from(t.rows, r => Array.from(r.cells, c => c.textContent?.trim() ?? ''))]));
    await writeFile(`${dir}/journey-${screen.id}-${width}-${theme}${state.he ? '-he' : ''}.json`, JSON.stringify({ tables }));
  }
  await expect(page).toHaveScreenshot(`finalq-journey-${screen.id}-${width}-${theme}${state.he ? '-he' : ''}.png`, {
    fullPage: true, animations: 'disabled', caret: 'hide', scale: 'css', threshold: 0.1, maxDiffPixels: 100,
  });
}

for (const width of [1280, 390]) for (const theme of ['light', 'dark'] as const) {
  for (const screen of screens) {
    test(`final journey ${screen.id} ${width === 390 ? 'phone' : 'desktop'} ${theme}`, async ({ page }) => {
      await checkJourneyScreen(page, screen, width, theme);
    });
  }
}
