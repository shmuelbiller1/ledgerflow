import { test, expect } from '@playwright/test';
import { mountJourney } from './support/journeyFixture';
import { observeMainLayout, readMainLayout } from './support/mainLayoutShift';

const screens = [
  { name: 'Overview', module: '/src/components/Dashboard.tsx' },
  { name: 'Sales', module: '/src/components/sales/Sales.tsx' },
  { name: 'Purchases', module: '/src/components/purchases/Purchases.tsx' },
  { name: 'Banking', module: '/src/components/banking/Banking.tsx' },
  { name: 'Reconciliation', module: '/src/components/ledger/Reconciliation.tsx' },
  { name: 'Profit and loss', module: '/src/components/ledger/ProfitAndLossView.tsx' },
  { name: 'Balance sheet', module: '/src/components/ledger/BalanceSheetView.tsx', props: { transactions: [], accounts: [], formatCurrency: '__fn:formatCurrency' } },
  { name: 'Trial balance', module: '/src/components/ledger/TrialBalanceView.tsx', props: { accounts: [], formatCurrency: '__fn:formatCurrency', onDrillDown: '__fn:noop' } },
  { name: 'Tax', module: '/src/components/finance/TaxManager.tsx' },
  { name: 'Settings', module: '/src/components/platform/Settings.tsx' },
];

for (const screen of screens) {
  test(`A-266 ${screen.name}: asynchronous load keeps main-region layout shift below 0.1`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Warm Vite's real entry before the fixture asks for prebundled module URLs.
    await page.goto('/');
    await expect(page.locator('#root')).not.toBeEmpty();
    const { errors } = await mountJourney(page, { workspaceId: 'loading-books', ledger: {}, mounts: [] });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let pending = 0;
    let active = 0;
    await page.route('**/api/**', async route => {
      pending++;
      active++;
      await gate;
      const path = new URL(route.request().url()).pathname;
      const pl = { income: { total: 10000, accounts: { revenue: { name: 'Fixture revenue', balance: 10000 } } }, cogs: { total: 0, accounts: {} }, expense: { total: 0, accounts: {} }, grossProfit: 10000, netIncome: 10000 };
      const bs = { assets: { bank: 10000 }, liabilities: {}, equity: { capital: 10000 }, totalAssets: 10000, totalLiabilities: 0, totalEquity: 10000, netIncome: 0, totalClaims: 10000, isBalanced: true };
      const tb = { accounts: [{ id: 'bank', name: 'Fixture bank', code: '1000', type: 'asset', debit: 10000, credit: 0, netSigned: 10000 }, { id: 'capital', name: 'Fixture capital', code: '3000', type: 'equity', debit: 0, credit: 10000, netSigned: -10000 }], totalDebit: 10000, totalCredit: 10000, isBalanced: true };
      const data = path.endsWith('/profit-and-loss') ? pl : path.endsWith('/balance-sheet') ? bs : path.endsWith('/trial-balance') ? tb : null;
      try {
        await route.fulfill(data ? { json: { data } } : { status: 503, json: { error: 'Unrelated fixture endpoint unavailable' } });
      } finally { active--; }
    });
    if (screen.name === 'Settings') {
      await page.route('**/src/components/platform/settings/AppearanceSettings.tsx*', async route => { await gate; await route.continue(); });
    }
    await page.evaluate(async ({ module, props }) => {
      const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
      const { useDataNeedsStore } = await import('/src/stores/useDataNeedsStore.ts');
      useAuthStore.setState(state => ({ workspaces: state.workspaces.map(w => ({ ...w, setupCompletedAt: '2026-10-01T00:00:00Z' })) }));
      useDataNeedsStore.setState(state => ({ loaded: Object.fromEntries(Object.keys(state.loaded).map(key => [key, false])) }));
      await (window as unknown as { __journeyRender: (mounts: unknown[]) => Promise<void> }).__journeyRender([{ module, props }]);
    }, { module: screen.module, props: screen.props ?? {} });
    await expect(page.locator('#root')).not.toBeEmpty();
    // Observe after the pending screen is painted. Never filter hadRecentInput: these loads must
    // be stable even without the browser's input exemption. Count only shifts touching this screen.
    await observeMainLayout(page);
    // The data was not marked ready at mount. This assertion prevents an already-loaded smoke test.
    expect(await page.evaluate(async () => {
      const { useDataNeedsStore } = await import('/src/stores/useDataNeedsStore.ts');
      return useDataNeedsStore.getState().loaded.invoices;
    })).toBe(false);
    if (['Overview', 'Sales', 'Purchases', 'Banking'].includes(screen.name)) {
      await expect.poll(() => page.locator('[data-loading-state]').count()).toBeGreaterThan(0);
    }
    if (screen.name === 'Settings') await expect(page.getByRole('status')).toContainText('Loading settings');
    release();
    await page.evaluate(async () => {
      const { useLedgerStore } = await import('/src/stores/useLedgerStore.ts');
      const { useDataNeedsStore } = await import('/src/stores/useDataNeedsStore.ts');
      useLedgerStore.setState({
        accounts: [{ id: 'bank', name: 'Fixture bank', code: '1000', type: 'asset', category: 'Cash', subtype: 'bank' }],
        bankLines: [{ id: 'bl1', accountId: 'bank', status: 'pending', date: '2026-10-01', description: 'Arrived bank line', amountCents: 10000, currency: 'USD' }],
        customers: [{ id: 'c1', name: 'Arrived customer', status: 'active' }],
        vendors: [{ id: 'v1', name: 'Arrived vendor', status: 'active' }],
        invoices: [{ id: 'i1', number: 'LOAD-1', customerId: 'c1', customerName: 'Arrived customer', status: 'draft', date: '2026-10-01', dueDate: '2026-10-31', amountCents: 10000, amountPaidCents: 0, currency: 'USD', items: [] }],
        bills: [{ id: 'b1', number: 'B-LOAD-1', vendorId: 'v1', vendorName: 'Arrived vendor', status: 'draft', date: '2026-10-01', dueDate: '2026-10-31', amountCents: 10000, amountPaidCents: 0, currency: 'USD', items: [] }],
      } as never);
      useDataNeedsStore.setState(state => ({ loaded: Object.fromEntries(Object.keys(state.loaded).map(key => [key, true])) }));
      // Flush timers, server fallbacks and paint delivery, without a click that exempts the shift.
      await new Promise(resolve => setTimeout(resolve, 700));
    });
    if (screen.name === 'Sales') await expect(page.getByText('LOAD-1', { exact: true })).toBeVisible();
    if (screen.name === 'Purchases') await expect(page.getByText('B-LOAD-1', { exact: true })).toBeVisible();
    await expect(page.locator('[data-loading-state]')).toHaveCount(0);
    await expect.poll(() => active).toBe(0);
    if (['Profit and loss', 'Balance sheet', 'Trial balance'].includes(screen.name)) {
      await expect(page.getByRole('note', { name: 'Where these figures come from' })).toContainText('Worked out by the server');
    }
    if (screen.name === 'Reconciliation') await expect(page.getByText('Arrived bank line', { exact: true }).first()).toBeVisible();
    if (screen.name === 'Banking') await expect(page.getByText('Fixture bank', { exact: true })).toBeVisible();
    if (screen.name === 'Settings') await expect(page.locator('[data-report-skeleton]')).toHaveCount(0);
    const result = await readMainLayout(page);
    await test.info().attach('main-region-layout-shift', { body: JSON.stringify({ screen: screen.name, ...result, apiCalls: pending }), contentType: 'application/json' });
    expect(result.value, `${screen.name}: cumulative main-region shift after asynchronous load`).toBeLessThan(0.1);
    expect(errors).toEqual([]);
  });
}

// Positive control: a silently empty/unsupported observer must never make the ten checks green.
test('A-266 layout-shift measurement detects a deliberately displaced visible element', async ({ page }) => {
  await page.setContent('<div id="root"><div id="probe" style="position:absolute;top:0;left:0;width:300px;height:100px;background:black">Measurement control</div></div>');
  await observeMainLayout(page);
  await page.locator('#probe').evaluate(el => { el.style.top = '300px'; });
  await expect.poll(async () => (await readMainLayout(page, false)).value).toBeGreaterThan(0);
  await readMainLayout(page);
});
