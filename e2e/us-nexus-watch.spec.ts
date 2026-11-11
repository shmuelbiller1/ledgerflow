import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { BRAND_NAME } from '../src/config/brand';
/**
 * CON-2 (W8): the US nexus watch in a real browser at phone width. The Reports view ('UsNexusWatchReportView') is
 * mounted against the app's own stores with the request boundary stubbed. Worked by hand, as of 2026-10-20: Texas
 * 2026 sales of $400,000.00 in 2 sales are 80% of its $500,000 threshold (flagged, not crossed); Illinois $27,000.00
 * is 27% and its table is not verified.
 */
const WORKSPACE = 'nexus-browser';
const USER = { uid: 'nexus-user', email: 'nexus@example.test', displayName: 'Nexus Owner' };

test('CON-2 browser: the nexus watch flags Texas at 80%, labels Illinois not verified, fits a phone and passes axe', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().method() === 'GET' ? [] : {} }));
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/nexus-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="en" class="light"><head><title>${BRAND_NAME} nexus watch</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="root"></div></body></html>`,
  }));
  await page.goto('/nexus-fixture');
  await page.evaluate(async ({ workspaceId, user }) => {
    const refresh = await import('/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
    const paths = [
      '/node_modules/.vite/deps/react.js', '/node_modules/.vite/deps/react-dom_client.js',
      '/src/stores/useAuthStore.ts', '/src/stores/useLedgerStore.ts', '/src/stores/useDataNeedsStore.ts',
      '/src/components/reporting/UsNexusWatchReportView.tsx',
    ];
    const [{ default: React }, { default: { createRoot } }, { useAuthStore }, { useLedgerStore }, { useDataNeedsStore }, { UsNexusWatchPanel }, { usNexusWatch }] =
      await Promise.all([...paths, '/src/lib/tax/usNexusWatch.ts'].map(path => import(path)));
    const signedIn = { ...user, isAnonymous: false, getIdToken: async () => 'browser-fixture-token' };
    const workspace = {
      id: workspaceId, uid: user.uid, name: 'Austin Goods LLC', currency: 'USD',
      taxProfiles: { books: { place: { country: 'US', state: 'TX' }, registrations: [{ kind: 'sales_tax', number: '320001', place: { country: 'US', state: 'TX' } }] } },
      roles: { [user.uid]: 'owner' },
    };
    useAuthStore.setState({ user: signedIn, isGuest: false, currentWorkspaceId: workspaceId, workspaces: [workspace] } as never);
    const customers = [
      { id: 'tx', workspaceId, name: 'Austin Buyer', metadata: { taxPlace: { country: 'US', state: 'TX', city: 'Austin' } } },
      { id: 'il', workspaceId, name: 'Chicago Buyer', metadata: { taxPlace: { country: 'US', state: 'IL' } } },
    ];
    const doc = (id: string, customerId: string, date: string, net: number) => ({ id, workspaceId, customerId, date, status: 'sent', taxVersion: 2, amountCents: net, taxAmountCents: 0 });
    const invoices = [doc('t1', 'tx', '2026-02-10', 30_000_000), doc('t2', 'tx', '2026-09-30', 10_000_000), doc('i1', 'il', '2026-05-05', 2_700_000)];
    useLedgerStore.setState({ invoices, creditNotes: [], customers, truncatedCollections: {} } as never);
    useDataNeedsStore.setState({ loaded: { invoices: true, creditNotes: true, customers: true }, loadedWorkspaceId: workspaceId, failed: {} } as never);
    // the panel with the as-of date pinned, so the figures do not depend on today's date
    const watch = usNexusWatch({ asOf: '2026-10-20', invoices, creditNotes: [], customers, profiles: workspace.taxProfiles });
    createRoot(document.getElementById('root')!).render(React.createElement(UsNexusWatchPanel, { watch, currency: 'USD', asOf: '2026-10-20', onAsOfChange: () => {} }));
  }, { workspaceId: WORKSPACE, user: USER });

  const view = page.getByRole('region', { name: 'US nexus watch' });
  await expect(view.getByRole('heading', { name: 'US nexus watch', exact: true })).toBeVisible();
  await expect(view.getByText(/2 state\(s\) with sales; 1 at 80% of a threshold or over: TX\./)).toBeVisible();
  const table = view.getByRole('table', { name: 'Sales by state against the economic-nexus thresholds' });
  await expect(table.getByRole('row', { name: /Texas/ })).toContainText('At 80% or over: watch');
  await expect(table.getByRole('row', { name: /Texas/ })).toContainText('$400,000.00, 2 sale(s) (80%)');
  await expect(table.getByRole('row', { name: /Illinois/ })).toContainText('Not verified');
  await expect(view.getByText(/a watch, not a conclusion that you must register/)).toBeVisible();

  const fits = await page.locator('section[aria-label="US nexus watch"]').evaluate(element => ({ width: (element as HTMLElement).clientWidth, scroll: (element as HTMLElement).scrollWidth }));
  expect(fits.scroll, 'the watch is wider than the phone').toBeLessThanOrEqual(fits.width);
  const axe = await new AxeBuilder({ page }).include('section[aria-label="US nexus watch"]').analyze();
  const serious = axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious.map(v => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
  expect(errors).toEqual([]);
});
