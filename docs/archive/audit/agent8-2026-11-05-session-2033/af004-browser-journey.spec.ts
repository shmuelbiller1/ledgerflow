/**
 * Agent #8 browser acceptance diagnostic, outside e2e's normal glob. Synthetic stores and
 * stubbed network are used: this is a real browser/component check, NOT a saved-DB or auth test.
 * The moved-customer contract is expected to fail at application pin 7896cbd (#519).
 */
import { test, expect, type Page } from '@playwright/test';

const WORKSPACE = 'agent8-af004-browser';

async function mountQuarter(page: Page, currentCustomerState: 'TX' | 'OK') {
  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().method() === 'GET' ? [] : {} }));
  await page.route('**/api/**', route => route.fulfill({ json: route.request().url().includes('/tax-returns') ? { returns: [] } : {} }));
  await page.route('**/agent8-af004-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="en"><head><title>Agent 8 tax fixture</title></head><body><div id="root"></div></body></html>',
  }));
  await page.goto('/agent8-af004-fixture');
  await page.evaluate(async ({ workspaceId, state }) => {
    const refresh = await import('/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
    const paths = [
      '/node_modules/.vite/deps/react.js', '/node_modules/.vite/deps/react-dom_client.js',
      '/src/stores/useAuthStore.ts', '/src/stores/useLedgerStore.ts', '/src/stores/useDataNeedsStore.ts',
      '/src/components/reporting/UsQuarterJourneyReportView.tsx',
    ];
    const [{ default: React }, { default: { createRoot } }, { useAuthStore }, { useLedgerStore }, { useDataNeedsStore }, { default: QuarterView }] =
      await Promise.all(paths.map(path => import(path)));
    const user = { uid: 'agent8-user', email: 'audit@example.test', isAnonymous: false, getIdToken: async () => 'synthetic-browser-token' };
    const workspace = {
      id: workspaceId, uid: user.uid, name: 'Audit Texas Books', currency: 'USD',
      taxProfiles: { books: {
        place: { country: 'US', state: 'TX' },
        registrations: [{ kind: 'sales_tax', number: '3200', place: { country: 'US', state: 'TX' } }],
      } },
      dimensions: [{ id: 'world', name: 'World', isWorld: true }], roles: { [user.uid]: 'owner' },
    };
    const customers = [{ id: 'buyer', workspaceId, metadata: { taxPlace: { country: 'US', state } } }];
    const invoices = [{
      id: 'sale', workspaceId, customerId: 'buyer', date: '2026-08-10', status: 'sent',
      amountCents: 10825, taxAmountCents: 825, currency: 'USD', taxVersion: 2, taxTreatment: 'standard',
      taxBreakdown: [{ name: 'Texas', rate: 6.25, taxCents: 625 }, { name: 'Austin', rate: 2, taxCents: 200 }],
      metadata: { taxPlace: { country: 'US', state: 'TX' } },
    }];
    useAuthStore.setState({ user, isGuest: false, currentWorkspaceId: workspaceId, workspaces: [workspace] } as never);
    useLedgerStore.setState({ invoices, customers, creditNotes: [], bills: [], vendors: [], payments: [], inventory: [], transactions: [], truncatedCollections: {}, baseCurrency: 'USD' } as never);
    useDataNeedsStore.setState({
      loaded: { invoices: true, creditNotes: true, bills: true, customers: true, vendors: true, payments: true, inventory: true },
      loadedWorkspaceId: workspaceId, failed: {},
    } as never);
    createRoot(document.getElementById('root')!).render(React.createElement(QuarterView));
  }, { workspaceId: WORKSPACE, state: currentCustomerState });
  await expect(page.getByRole('heading', { name: 'US quarter journey', exact: true })).toBeVisible();
  await page.getByLabel('Quarter', { exact: true }).fill('2026-Q3');
  return page.getByRole('row', { name: /TX 3200/ }).getByRole('cell');
}

test('browser control: a saved Texas sale appears while the buyer remains in Texas', async ({ page }) => {
  const cells = await mountQuarter(page, 'TX');
  await expect(cells.nth(0)).toHaveText('1');
  await expect(cells.nth(1)).toHaveText('$100.00');
  await expect(cells.nth(4)).toHaveText('$8.25');
});

test('browser contract: the saved Texas sale remains after the buyer moves to Oklahoma', async ({ page }) => {
  const cells = await mountQuarter(page, 'OK');
  const displayed = await Promise.all([cells.nth(0).textContent(), cells.nth(1).textContent(), cells.nth(4).textContent()]);
  expect(displayed).toEqual(['1', '$100.00', '$8.25']);
});
