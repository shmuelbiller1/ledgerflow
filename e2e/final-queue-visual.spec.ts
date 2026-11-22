import { expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test } from '@playwright/test';
import { installFinalQueueBooks } from './helpers/finalQueueBooks';
import { waitForFiniteAnimations } from './support/a11yGate';

/**
 * The final 42-file raw-table batch, verified in the real app: every screen this batch migrated is
 * opened on its production route against one deterministic book (the 12-month sample year plus the
 * journal/tax/rules rows `finalQueueBooks` adds), in both themes at desktop and phone widths, with
 * the worked figures the book guarantees. A Hebrew/RTL pass covers report screens and lists; names,
 * numbers and dates are data and stay readable in either language. The same spec runs against the
 * base commit for the before/after evidence — screenshots and the table/card text dump
 * (LF_FINAL_EVIDENCE) are compared, never the DOM shape.
 *
 * axe runs with `color-contrast` disabled: the emerald/rose money cells predate this batch and fail
 * the rule on the base commit too; the finding is recorded in the batch evidence instead of failing
 * every screen here. Every other WCAG rule that fails fails the test.
 */

const YEAR = { start: '2026-01-01', end: '2026-12-31' };
const reportUrl = (id: string) => `/?report=${id}&start=${YEAR.start}&end=${YEAR.end}&cmp=none#reports`;

interface FinalQueueScreen {
  id: string;
  url: string;
  /** A heading that means this screen, not the shell, is on the page (the report's own title). */
  ready: (main: Locator) => Locator;
  /** Figures that belong to this screen's rows on the deterministic book. */
  figures?: string[];
  /** Extra clicks/uploads before the assertions (settings sections, selects, imports). */
  setup?: (page: Page, main: Locator) => Promise<void>;
  /** Part of the Hebrew/RTL subset (run at 390 light and 1280 dark in Hebrew). */
  hebrew?: boolean;
  /** A virtualized list (the grid renders what the viewport shows): capture at a fixed taller
   *  viewport instead of growing until the inner scroll settles — it never settles. */
  grid?: boolean;
  /** A page that is genuinely signed-out (the customer portal): no guest sample, no guest flags. */
  signedOut?: boolean;
  /** Runs before navigation: a page that fetches on mount needs its route installed first. */
  beforeLoad?: (page: Page) => Promise<void>;
  /** Locators whose pixels are measured run times (never the same twice) and are masked. */
  mask?: (page: Page) => Locator[];
}

const settings = (section: string, label: RegExp): FinalQueueScreen => ({
  id: `settings-${section}`,
  url: '/#settings',
  ready: (main) => main.getByRole('heading', { name: /^Settings$|^הגדרות$/ }),
  setup: async (_page, main) => {
    await main.getByRole('button', { name: label }).click();
    await expect(main.locator(`[data-settings-section="${section}"]`)).toBeVisible({ timeout: 15_000 });
  },
});

const screens: FinalQueueScreen[] = [
  // Reports (titles are the screen's own h2, in the app's casing)
  {
    id: 'statement', url: reportUrl('statement'),
    ready: (main) => main.getByRole('heading', { name: /Account Statement/ }),
    figures: ['INV-2026-0001', '195.93'],
    setup: async (_page, main) => { await main.getByLabel('Select Customer').selectOption({ label: 'Beacon Market Group 1' }); },
    hebrew: true,
  },
  { id: 'trial-balance', url: reportUrl('trial-balance'), ready: (main) => main.getByRole('heading', { name: /Trial Balance/ }), figures: ['Operating Checking', 'Accounts Receivable'], hebrew: true },
  { id: 'customer-cohorts', url: reportUrl('customer-cohorts'), ready: (main) => main.getByRole('heading', { name: /Customer cohorts/ }), figures: ['2026-01'], hebrew: true },
  { id: 'group-summary', url: reportUrl('group-summary'), ready: (main) => main.getByRole('heading', { name: /Group summary/ }) },
  {
    id: 'import-acceptance', url: reportUrl('import-acceptance'),
    ready: (main) => main.getByRole('heading', { name: /Import acceptance/ }),
    // the guest sample rightly refuses the server read and says so; the populated acceptance
    // table is verified by au4-import-acceptance.test.tsx and the journey spec covers the rest
    figures: ['Source trial balance'],
  },
  { id: 'discount-mismatch', url: reportUrl('discount-mismatch'), ready: (main) => main.getByRole('heading', { name: /Discount mismatch review/ }) },
    // label reports read the full history from the server (src/server/reports/byLabel.ts); the guest
  // sample rightly refuses, so their populated tables are verified by by-label.test.tsx and
  // w5bs-balance-sheet-by-label.test.tsx while this pins the real guest boundary
  { id: 'label-profit', url: reportUrl('by-label'), ready: (main) => main.getByRole('heading', { name: /Profit by label/ }), figures: ['needs a signed-in workspace'] },
  { id: 'label-balance-sheet', url: reportUrl('balance-sheet-by-label'), ready: (main) => main.getByRole('heading', { name: /Balance sheet by label/ }), figures: ['needs a signed-in workspace'] },
  { id: 'profitability-by', url: reportUrl('profitability-by'), ready: (main) => main.getByRole('heading', { name: /^Profitability/ }), figures: ['Beacon Market Group 1'] },
  { id: 'stock-sources-uses', url: reportUrl('stock-sources-uses'), ready: (main) => main.getByRole('heading', { name: /Stock sources and uses/ }), figures: ['needs a signed-in workspace'] },
  { id: 'customer-period-summary', url: reportUrl('customer-period-summary'), ready: (main) => main.getByRole('heading', { name: /Customer period ledger summary/ }), figures: ['Beacon Market Group 1'] },
  { id: 'supplier-period-summary', url: reportUrl('supplier-period-summary'), ready: (main) => main.getByRole('heading', { name: /Supplier period ledger summary/ }), figures: ['Atlas Industrial Supply 1'] },
  { id: 'ar-aging', url: reportUrl('ar-aging'), ready: (main) => main.getByRole('heading', { name: /Accounts Receivable \(AR\) Aging/ }), figures: ['Beacon Market Group 11', '17,111.87'], hebrew: true },
  { id: 'ap-aging', url: reportUrl('ap-aging'), ready: (main) => main.getByRole('heading', { name: /Accounts Payable \(AP\) Aging/ }), figures: ['Atlas Industrial Supply 1'] },
  { id: 'vendor-balance-summary', url: reportUrl('vendor-balance-summary'), ready: (main) => main.getByRole('heading', { name: /Vendor Balance Summary/ }), figures: ['Atlas Industrial Supply 1'] },
  { id: 'inventory-valuation', url: reportUrl('inventory-valuation'), ready: (main) => main.getByRole('heading', { name: /Inventory Valuation/ }), figures: ['Precision Valve & Sensor 1'], grid: true },
  { id: 'sample-year-benchmark', url: reportUrl('sample-year-benchmark'), ready: (main) => main.getByRole('heading', { name: /12-month sample business/ }).first(), figures: ['Required Labels, Filings, Item Pricing'],
    // this screen IS a speed check: the two timing tables are ordered by the live measurement and
    // the intro sentence embeds the live max — their pixels are masked, headers and the static
    // monthly-counts table are still compared
    mask: (page) => [
      page.getByRole('region', { name: /Five heaviest reports measured/i }).locator('tbody'),
      page.getByRole('region', { name: /All measured reports ordered/i }).locator('tbody'),
      page.locator('#main-content p', { hasText: 'Top 5 heaviest' }),
    ] },
  { id: 'pnl-labels', url: reportUrl('pnl'), ready: (main) => main.getByRole('heading', { name: /Profit & Loss Statement/ }), figures: ['Product Sales Revenue', '92,267.40'] },
  { id: 'balance-sheet-columns', url: reportUrl('balance-sheet'), ready: (main) => main.getByRole('heading', { name: /^Assets$/ }), figures: ['Operating Checking'] },
  // Lists and registers
  // the practice register's rows come from a signed-in server command; the guest sample refuses,
  // so its populated grid is verified by the journey spec (final-queue-journey.spec.ts)
  { id: 'practice', url: '/#practice', ready: (main) => main.getByRole('heading', { name: /All my books/ }), figures: ['needs a signed-in workspace'], grid: true },
  { id: 'register', url: '/#register', ready: (main) => main.getByRole('heading', { name: /Account Register/ }), figures: ['Monthly payroll 2026-12'], grid: true,
    setup: async (_page, main) => { await main.getByLabel('Register account').selectOption({ label: '1000 — Operating Checking (asset)' }); } },
  { id: 'payments', url: '/#payments', ready: (main) => main.getByRole('heading', { name: /Payments Register/ }), figures: ['431.66'], hebrew: true, grid: true },
  { id: 'assets', url: '/#assets', ready: (main) => main.getByRole('heading', { name: /Fixed Asset Register/ }), figures: ['Electric Reach Forklift', 'FA-2026-001', '48,000.00'], hebrew: true },
  { id: 'recurring', url: '/#recurring', ready: (main) => main.getByRole('heading', { name: /Recurring Transactions/ }), figures: ['Monthly warehouse lease', '4,200.00'] },
  { id: 'credit-notes', url: '/#credit-notes', ready: (main) => main.getByRole('heading', { name: /Credit Notes & Vendor Credits/ }), figures: ['CN-2026-023', '126.23'], grid: true },
  { id: 'banking', url: '/#banking', ready: (main) => main.getByRole('heading', { name: /Bank & Institution Connections/ }), figures: ['Operating Checking'] },
  { id: 'ledger', url: '/#ledger', ready: (main) => main.getByRole('heading', { name: /Plain English Books/ }), figures: ['February depreciation', '700.00'],
    setup: async (_page, main) => { await main.getByRole('button', { name: /Accountant Lens/ }).click(); await main.getByRole('button', { name: /General Journal/ }).click(); } },
  { id: 'month-end-close', url: '/#month-end-close', ready: (main) => main.getByRole('heading', { name: /Month-End Close/ }) },
  { id: 'estimates', url: '/#estimates', ready: (main) => main.getByRole('heading', { name: /Estimates & Quotes/ }), figures: ['EST-2026-0060', '306.90'], grid: true },
  { id: 'taxes', url: '/#taxes', ready: (main) => main.getByRole('heading', { name: /Tax Reserve Estimator/ }), figures: ['Sales tax 8%'] },
  { id: 'api-hub', url: '/#api-hub', ready: (main) => main.getByRole('heading', { name: /API Platform/ }) },
  { id: 'admin-panel', url: '/#system-command-center', ready: (main) => main.getByRole('heading', { name: /Admin Panel/ }) },
  // Settings sections
  settings('import', /Import Data/),
  settings('rules', /Rules & Automation/),
  settings('dimensions', /^Labels$/),
  settings('custom-fields', /Custom fields/),
  // The customer portal (K-27): a customer's invoices, no sign-in
  {
    id: 'customer-portal', url: '/c/portal-token',
    ready: (main) => main.getByRole('heading', { name: /Invoices for|Your invoices/i }),
    figures: ['INV-2026-0001', 'Beacon Market Group 1'],
    signedOut: true,
    beforeLoad: async (page) => {
      await page.route('**/api/v1/invoices/public/portal/**', route => route.fulfill({ json: {
        business: 'Harbor & Olive Supply Co.',
        customer: 'Beacon Market Group 1',
        currency: 'USD',
        owedCents: 56036,
        invoices: [
          { number: 'INV-2026-0001', date: '2026-01-02', dueDate: '2026-02-01', totalCents: 19593, dueCents: 0, currency: 'USD', status: 'paid', payPath: '/pay/inv-1' },
          { number: 'INV-2026-0271', date: '2026-10-02', dueDate: '2026-11-01', totalCents: 70636, dueCents: 56036, currency: 'USD', status: 'overdue', payPath: '/pay/inv-271' },
        ],
      } }));
    },
  },
];

test.describe.configure({ mode: 'parallel' });

async function checkFinalQueueScreen(page: Page, screen: FinalQueueScreen, width: number, theme: 'light' | 'dark', hebrew: boolean) {
  test.setTimeout(90_000);
  await page.setViewportSize({ width, height: 850 });
  await page.clock.setFixedTime(new Date('2026-12-31T12:00:00Z'));
  await page.addInitScript(({ theme, hebrew, signedOut }) => {
    if (!signedOut) localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('ledgerflow-cookie-consent', 'essential');
    localStorage.setItem('lf_theme', theme);
    if (hebrew) localStorage.setItem('lf_language', 'he'); else localStorage.removeItem('lf_language');
  }, { theme, hebrew, signedOut: screen.signedOut === true });
  if (!screen.signedOut) await installFinalQueueBooks(page);
  if (screen.beforeLoad) await screen.beforeLoad(page);
  await page.goto(screen.url, { waitUntil: 'domcontentloaded' });
  // the customer portal is a standalone page without the app shell's #main-content
  const main = page.locator(screen.signedOut ? 'main' : '#main-content');
  // In Hebrew the headings are translated; the screen's table or grid is the language-independent
  // sign that this screen, not the shell, is on the page.
  const ready = hebrew
    ? main.locator('table, [role=grid], [data-grid-row], [role=alert]').first()
    : screen.ready(main);
  await expect(ready).toBeVisible({ timeout: 30_000 });
  if (!hebrew && screen.setup) await screen.setup(page, main);
  for (const figure of screen.figures ?? []) await expect(main.getByText(figure, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(main).not.toContainText('Something went wrong');
  if (hebrew) {
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(main).toHaveCSS('direction', 'rtl');
  }
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b)/);
  await page.evaluate(() => document.fonts.ready);
  const audit = await new AxeBuilder({ page }).include(screen.signedOut ? 'main' : '#main-content').disableRules(['color-contrast']).analyze();
  expect(audit.violations.map(v => [v.id, v.nodes.map(n => n.target)])).toEqual([]);
  // No sideways scroll of the page itself at the real width. #main-content may scroll wide tables
  // internally — that is the app's own phone behaviour for report tables and is identical on the
  // base commit — so, like visual-regression.spec.ts, only the document is checked here. The
  // standalone customer portal is the one page whose document itself scrolls sideways at phone
  // width, identically on the base commit (the invoices table's min-content is wider than 390px);
  // that pre-existing state is recorded, not regressed.
  if (!(screen.signedOut && width === 390))
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.waitForLoadState('networkidle');
  if (screen.grid) {
    // a virtual grid renders what the viewport shows; the inner scroll never settles, so capture
    // at a fixed taller viewport (the app's own visual suite does the same for the entry grid)
    if (page.viewportSize()!.height < 1_600) await page.setViewportSize({ width, height: 1_600 });
  } else {
    for (let attempt = 0; attempt < 6; attempt++) {
      const overflow = await main.evaluate(element => element.scrollHeight - element.clientHeight);
      if (overflow <= 1 && attempt > 0) break;
      if (overflow <= 1) { await page.waitForTimeout(250); continue; }
      const height = page.viewportSize()!.height + overflow;
      expect(height).toBeLessThan(24_000);
      await page.setViewportSize({ width, height });
    }
    // a few screens keep a few pixels of inner scroll (sticky bars, viewport-relative bits);
    // the capture has already grown past the content, so record it and continue
    const left = await main.evaluate(element => element.scrollHeight - element.clientHeight);
    if (left > 1) test.info().annotations.push({ type: 'note', description: `${screen.id}: ${left}px of inner scroll remained after capture growth` });
  }
  await main.evaluate(element => { element.scrollTop = 0; });
  await page.mouse.move(0, 0);
  await waitForFiniteAnimations(page);
  if (process.env.LF_FINAL_EVIDENCE) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const dir = process.env.LF_FINAL_EVIDENCE;
    await mkdir(dir, { recursive: true });
    const stem = `${dir}/${screen.id}-${width}-${theme}${hebrew ? '-he' : ''}`;
    const tables = await page.locator('table:visible').evaluateAll(ts =>
      ts.map(t => [t.caption?.textContent ?? '', ...Array.from(t.rows, r => Array.from(r.cells, c => c.textContent?.trim() ?? ''))]));
    const cards = await page.locator('[data-grid-row][role=listitem]').evaluateAll(rs =>
      rs.map(r => Array.from(r.querySelectorAll('[data-grid-card-column]'), c => c.lastElementChild?.textContent?.trim() ?? '')));
    await writeFile(stem + '.json', JSON.stringify({ tables, cards }));
  }
  await expect(page).toHaveScreenshot(`finalq-${screen.id}-${width}-${theme}${hebrew ? '-he' : ''}.png`, {
    fullPage: true, animations: 'disabled', caret: 'hide', scale: 'css', threshold: 0.1, maxDiffPixels: 100,
    ...(screen.mask ? { mask: screen.mask(page) } : {}),
  });
}

for (const width of [1280, 390]) for (const theme of ['light', 'dark'] as const) {
  for (const screen of screens) {
    test(`final queue ${screen.id} ${width === 390 ? 'phone' : 'desktop'} ${theme}`, async ({ page }) => {
      await checkFinalQueueScreen(page, screen, width, theme, false);
    });
  }
  // Hebrew/RTL at 390 light and 1280 dark, mirroring the operations batch's language mix.
  if ((width === 390 && theme === 'light') || (width === 1280 && theme === 'dark')) {
    for (const screen of screens.filter(s => s.hebrew)) {
      test(`final queue ${screen.id} ${width === 390 ? 'phone' : 'desktop'} ${theme} hebrew`, async ({ page }) => {
        await checkFinalQueueScreen(page, screen, width, theme, true);
      });
    }
  }
}
