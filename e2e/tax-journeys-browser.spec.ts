import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { BRAND_NAME } from '../src/config/brand';
/**
 * W7 and W8 (RELEASE_GATE): the two tax journeys AI #3 built, in a real browser.
 *
 * The Reports views are mounted against the app's own stores with their request boundary stubbed,
 * so this is a browser test of the screens the users reach — not of a live database or of the tax
 * authority. Every figure asserted below is the one the screen's own library computed:
 *  - Israel, September 2026: taxable sales 11,000.00, input VAT 360.00, to pay 1,620.00, with
 *    invoice 1001 above the allocation threshold and no number recorded
 *    (worked in docs/verification/ai3-a152-israeli-month.md);
 *  - US, Texas Q3 2026: one invoice of $1,082.50 including $82.50 tax (Texas state $62.50 and
 *    Austin $20.00), permit TX 3200, planning due date 2026-10-20
 *    (worked in docs/verification/ai3-a153-us-quarter-journey.md).
 */

type Route = { url: string; method: string };

const WORKSPACE = 'journey-browser';
const USER = { uid: 'journey-user', email: 'journey@example.test', displayName: 'Journey Owner' };

async function fixture(page: Page): Promise<{ errors: string[]; calls: Route[] }> {
  const errors: string[] = [];
  const calls: Route[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().method() === 'GET' ? [] : {} }));
  await page.route('**/api/**', route => {
    const request = route.request();
    calls.push({ url: request.url(), method: request.method() });
    // The journey reads the returns the server recorded; nothing has been recorded in this fixture.
    if (request.url().includes('/tax-returns')) return route.fulfill({ json: { returns: [] } });
    return route.fulfill({ json: {} });
  });
  await page.route('**/journey-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="en" class="light"><head><title>${BRAND_NAME} tax journey</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="root"></div></body></html>`,
  }));
  await page.goto('/journey-fixture');
  return { errors, calls };
}

async function mountIsrael(page: Page) {
  await page.evaluate(async ({ workspaceId, user }) => {
    const refresh = await import('/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
    const paths = [
      '/node_modules/.vite/deps/react.js', '/node_modules/.vite/deps/react-dom_client.js',
      '/src/stores/useAuthStore.ts', '/src/stores/useLedgerStore.ts', '/src/stores/useDataNeedsStore.ts',
      '/src/components/reporting/IsraelMonthJourneyReportView.tsx',
    ];
    const [{ default: React }, { default: { createRoot } }, { useAuthStore }, { useLedgerStore }, { useDataNeedsStore }, { default: IsraelMonthJourney }] =
      await Promise.all(paths.map(path => import(path)));
    const signedIn = { ...user, isAnonymous: false, getIdToken: async () => 'browser-fixture-token' };
    const workspace = {
      id: workspaceId, uid: user.uid, name: 'תל אביב בע״מ', currency: 'ILS',
      taxProfiles: { books: { name: 'Tel Aviv Ltd', registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' }, filing: 'monthly' }] } },
      dimensions: [{ id: 'world', name: 'World', isWorld: true }],
      roles: { [user.uid]: 'owner' },
    };
    useAuthStore.setState({ user: signedIn, isGuest: false, currentWorkspaceId: workspaceId, workspaces: [workspace] } as never);
    const customers = [
      { id: 'c1', workspaceId, name: 'Buyer Ltd', metadata: { vatNumber: '512345678' } },
      { id: 'c2', workspaceId, name: 'Private customer' },
    ];
    const vendors = [{ id: 'v1', workspaceId, name: 'Supplier Ltd', metadata: { vatNumber: '513333333' } }];
    const invoices = [
      { id: 'i1', workspaceId, number: '1001', customerId: 'c1', date: '2026-09-10', status: 'sent', taxVersion: 2, amountCents: 1180000, taxAmountCents: 180000, currency: 'ILS' },
      { id: 'i2', workspaceId, number: '1002', customerId: 'c2', date: '2026-09-15', status: 'sent', taxVersion: 2, amountCents: 118000, taxAmountCents: 18000, currency: 'ILS' },
    ];
    const bills = [{ id: 'b1', workspaceId, number: '9001', vendorId: 'v1', date: '2026-09-20', status: 'pending', taxVersion: 2, amountCents: 236000, taxAmountCents: 36000, currency: 'ILS' }];
    useLedgerStore.setState({ invoices, bills, customers, vendors, creditNotes: [], vendorCredits: [], transactions: [], truncatedCollections: {}, baseCurrency: 'ILS' } as never);
    useDataNeedsStore.setState({
      loaded: { invoices: true, creditNotes: true, bills: true, vendorCredits: true, customers: true, vendors: true },
      loadedWorkspaceId: workspaceId, failed: {},
    } as never);
    createRoot(document.getElementById('root')!).render(React.createElement(IsraelMonthJourney));
  }, { workspaceId: WORKSPACE, user: USER });
  await expect(page.getByRole('heading', { name: 'Israel month journey', exact: true })).toBeVisible();
  await page.getByLabel('Month', { exact: true }).fill('2026-09');
}

async function mountUs(page: Page) {
  await page.evaluate(async ({ workspaceId, user }) => {
    const refresh = await import('/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
    const paths = [
      '/node_modules/.vite/deps/react.js', '/node_modules/.vite/deps/react-dom_client.js',
      '/src/stores/useAuthStore.ts', '/src/stores/useLedgerStore.ts', '/src/stores/useDataNeedsStore.ts',
      '/src/components/reporting/UsQuarterJourneyReportView.tsx',
    ];
    const [{ default: React }, { default: { createRoot } }, { useAuthStore }, { useLedgerStore }, { useDataNeedsStore }, { default: UsQuarterJourney }] =
      await Promise.all(paths.map(path => import(path)));
    const signedIn = { ...user, isAnonymous: false, getIdToken: async () => 'browser-fixture-token' };
    const workspace = {
      id: workspaceId, uid: user.uid, name: 'Austin Books LLC', currency: 'USD',
      taxProfiles: { labels: { 'world:tx': { place: { country: 'US', state: 'TX' }, registrations: [{ kind: 'sales_tax', number: '3200', place: { country: 'US', state: 'TX' } }] } } },
      dimensions: [{ id: 'world', name: 'World', isWorld: true }],
      roles: { [user.uid]: 'owner' },
    };
    useAuthStore.setState({ user: signedIn, isGuest: false, currentWorkspaceId: workspaceId, workspaces: [workspace] } as never);
    const customers = [{ id: 'austin', workspaceId, name: 'Austin Buyer', metadata: { taxPlace: { country: 'US', state: 'TX', city: 'Austin' } } }];
    const invoices = [{
      id: 'i1', workspaceId, number: 'INV-1', customerId: 'austin', date: '2026-08-10', status: 'sent',
      amountCents: 108250, taxAmountCents: 8250, currency: 'USD', dimensions: { world: 'tx' }, taxTreatment: 'standard',
      taxBreakdown: [{ name: 'Texas state sales tax', rate: 0, taxCents: 6250 }, { name: 'Austin', rate: 0, taxCents: 2000 }],
    }];
    useLedgerStore.setState({ invoices, creditNotes: [], bills: [], customers, vendors: [], payments: [], inventory: [], transactions: [], truncatedCollections: {}, baseCurrency: 'USD' } as never);
    useDataNeedsStore.setState({
      loaded: { invoices: true, creditNotes: true, bills: true, customers: true, vendors: true, payments: true, inventory: true },
      loadedWorkspaceId: workspaceId, failed: {},
    } as never);
    createRoot(document.getElementById('root')!).render(React.createElement(UsQuarterJourney));
  }, { workspaceId: WORKSPACE, user: USER });
  await expect(page.getByRole('heading', { name: 'US quarter journey', exact: true })).toBeVisible();
  await page.getByLabel('Quarter', { exact: true }).fill('2026-Q3');
}

async function expectJourneyFitsAndPassesAxe(page: Page, selector: string, label: string) {
  const fits = await page.locator(selector).evaluate(element => ({ width: (element as HTMLElement).clientWidth, scroll: (element as HTMLElement).scrollWidth }));
  expect(fits.scroll, `${label} is wider than the phone`).toBeLessThanOrEqual(fits.width);
  const axe = await new AxeBuilder({ page }).include(selector).analyze();
  const serious = axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious.map(v => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
}

test('W7 browser: the Israeli month journey shows the registration, allocation numbers, VAT report and PCN874 draft', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await fixture(page);
  await mountIsrael(page);
  const journey = page.locator('section[aria-label="Israel month journey"]');

  for (const title of [
    '1. Israeli VAT registration for the month',
    '2. Allocation numbers on business invoices',
    '3. Periodic VAT report (form 836 figures)',
    '4. PCN874 draft for the month',
    '5. Close the month',
  ]) await expect(journey.getByRole('heading', { name: title, exact: true })).toBeVisible();

  // The report's own figures and the registration shown by the return screen.
  await expect(journey.getByText('514000000', { exact: true }).first()).toBeVisible();
  await expect(journey.getByText(/11,000\.00/).first()).toBeVisible();
  await expect(journey.getByText(/1,620\.00/).first()).toBeVisible();
  await expect(journey.getByText(/need an allocation number: 1 without a usable one/)).toBeVisible();
  const allocation = journey.getByRole('table', { name: 'Invoices that need an allocation number' });
  await expect(allocation).toContainText('1001');
  await expect(allocation).toContainText('No allocation number is recorded');

  // The historical draft says plainly that it is not filing-ready and what cannot be written.
  await expect(journey.getByRole('heading', { name: 'PCN874 historical draft', exact: true })).toBeVisible();
  await expect(journey.getByText(/not filing-ready/)).toBeVisible();
  await expect(journey.getByText(/cannot be written/).first()).toBeVisible();
  await expect(journey.getByText(/nothing files, posts, pays or closes anything/)).toBeVisible();

  // The step opens the screen that does the work.
  await journey.getByRole('button', { name: 'Open Reports → Tax return', exact: true }).click();
  expect(await page.evaluate(async () => {
    const { useUIStore } = await import('/src/stores/useUIStore.ts');
    return { tab: useUIStore.getState().activeTab, report: useUIStore.getState().activeReportTab };
  })).toEqual({ tab: 'reports', report: 'tax-liability' });

  await expectJourneyFitsAndPassesAxe(page, 'section[aria-label="Israel month journey"]', 'Israel month journey');
  expect(errors).toEqual([]);
});

test('W8 browser: the US quarter journey shows the state return, due date, use tax and 1099 preview', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await fixture(page);
  await mountUs(page);
  const journey = page.locator('section[aria-label="US quarter journey"]');

  for (const title of [
    '1. Sales-tax permits for the quarter',
    '2. Sales tax by state',
    '3. Use tax on out-of-state purchases',
    '4. Exemption certificates',
    '5. 1099 preview for the tax year',
    '6. Close the quarter’s months',
  ]) await expect(journey.getByRole('heading', { name: title, exact: true })).toBeVisible();

  await expect(journey.getByText(/TX 3200/).first()).toBeVisible();
  await expect(journey.getByText(/2026-10-20/).first()).toBeVisible();
  await expect(journey.getByText(/Texas state sales tax \$62\.50/)).toBeVisible();
  await expect(journey.getByText(/nothing files, posts, pays or closes anything/)).toBeVisible();

  // Each step opens the screen that does the work.
  await journey.getByRole('button', { name: 'Open Month-end close', exact: true }).click();
  expect(await page.evaluate(async () => {
    const { useUIStore } = await import('/src/stores/useUIStore.ts');
    return { tab: useUIStore.getState().activeTab };
  })).toEqual({ tab: 'month-end-close' });

  await expectJourneyFitsAndPassesAxe(page, 'section[aria-label="US quarter journey"]', 'US quarter journey');
  expect(errors).toEqual([]);
});
