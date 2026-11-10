import { test, expect, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mountJourney, remountJourney } from './support/journeyFixture';
import { stockJourneyServer } from './support/stockJourneyServer';

// Same independently worked scenario as W13-GOLD; no fabricated postings or stock after setup.
// 10 × $40 + 10 × $46 = $860 / 20 = $43 average. Sell 12 × $90:
// revenue $1,080, COGS $516, gross profit $564; 8 chairs remain worth $344.
test.use({ reducedMotion: 'reduce' });
for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
  test(`W13 real posting: purchase two lots, sell, reload and value stock at ${width}px ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const databaseUrl = process.env.LF_TEST_DATABASE_URL;
    if (process.env.CI) expect(databaseUrl, 'CI must run the real stock journey against test Postgres').toBeTruthy();
    test.skip(!databaseUrl, 'Requires isolated test Postgres; set LF_TEST_DATABASE_URL and run db:test-setup.');
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date('2026-04-30T12:00:00Z'));
    const workspaceId = `w13-ui-${randomUUID()}`;
    const server = await stockJourneyServer(workspaceId);
    const postings: Array<{ path: string; body: Record<string, unknown>; status: number; response: unknown }> = [];
    try {
      const initialLedger = await server.ledger();
      expect(initialLedger.vendors).toHaveLength(2); expect(initialLedger.accounts).toHaveLength(7);
      expect(initialLedger.inventory[0].quantityAtHand).toBe(0);
      const { errors } = await mountJourney(page, {
        workspaceId, ledger: initialLedger, mounts: [{ module: '/src/components/purchases/Purchases.tsx' }],
      });
      // Override the harness's API stub: financial writes/reports run the production routers and database.
      const forwardApi = async (route: Route) => {
        const request = route.request(), url = new URL(request.url());
        const response = await page.request.fetch(`${server.base}${url.pathname}${url.search}`, {
          method: request.method(), headers: request.headers(), data: request.postDataBuffer() ?? undefined,
        });
        if (/\/documents\/(bills|invoices)\/.+\/post$/.test(url.pathname)) postings.push({ path: url.pathname, body: request.postDataJSON(), status: response.status(), response: await response.json() });
        await route.fulfill({ response });
      };
      await page.route('**/api/**', forwardApi);
      await page.evaluate(selected => { document.documentElement.className = selected; }, theme);
      await expect(page.getByRole('button', { name: 'Vendors (2)', exact: true })).toBeVisible();
      const accounts = (await server.ledger()).accounts;
      const inventoryAccount = accounts.find(account => account.code === '1300')!;
      const incomeAccount = accounts.find(account => account.code === '4000')!;
      for (const [index, vendor, date, amount, quantity, cost] of [
        [1, 'oak', '2026-04-01', '400.00', 10, 4000],
        [2, 'elm', '2026-04-10', '460.00', 20, 4300],
      ] as const) {
        const numbering = page.waitForResponse(response => response.url().endsWith('/next-number') && response.request().method() === 'POST', { timeout: 15000 });
        await page.getByRole('button', { name: 'Record Bill', exact: true }).click();
        const allocated = await numbering; expect(allocated.status()).toBe(200);
        const dialog = page.getByRole('dialog');
        await dialog.locator('#bill-vendor').selectOption(`${workspaceId}-${vendor}`);
        await expect(dialog.locator('#bill-number')).toHaveValue((await allocated.json()).number);
        if (!await dialog.locator('details').evaluate(el => (el as HTMLDetailsElement).open)) await dialog.locator('summary').click();
        await dialog.locator('#bill-number').fill(`B-${index}`);
        await dialog.locator('#bill-date').fill(date); await dialog.locator('#bill-due-date').fill(date);
        await dialog.locator('#bill-split-desc-0').fill('Chair');
        await dialog.locator('#bill-split-acc-0').selectOption(inventoryAccount.id);
        await dialog.locator('#bill-split-amount-0').fill(amount);
        await dialog.getByLabel('Stock item on line 1', { exact: true }).selectOption(server.itemId);
        await dialog.getByLabel('Units on line 1', { exact: true }).fill('10');
        await dialog.getByRole('button', { name: 'Save & Close', exact: true }).click();
        await expect.poll(() => postings.length).toBe(index);
        expect(postings[index - 1], JSON.stringify(postings[index - 1])).toMatchObject({ status: 200 });
        await expect.poll(async () => (await server.all('bills')).length).toBe(index);
        const item = (await server.all('inventory'))[0];
        expect([item.quantityAtHand, item.unitCostCents]).toEqual([quantity, cost]);
        await expect(dialog).toHaveCount(0);
        await server.refresh(page);
      }
      expect(postings).toHaveLength(2);
      expect(postings.map(post => post.status)).toEqual([200, 200]);
      await remountJourney(page, [{ module: '/src/components/sales/Sales.tsx' }]);
      const invoiceNumbering = page.waitForResponse(response => response.url().endsWith('/next-number') && response.request().method() === 'POST', { timeout: 15000 });
      await page.getByRole('button', { name: 'Add Invoice', exact: true }).click();
      const allocatedInvoice = await invoiceNumbering; expect(allocatedInvoice.status()).toBe(200);
      const invoice = page.getByRole('dialog');
      await expect(invoice.locator('#inv-number')).toHaveValue((await allocatedInvoice.json()).number);
      await invoice.locator('#inv-customer').fill('Acme');
      await invoice.locator('summary').click();
      await invoice.locator('#inv-number').fill('INV-1');
      await invoice.locator('#inv-date').fill('2026-04-15'); await invoice.locator('#inv-due-date').fill('2026-05-15');
      await invoice.locator('#inv-item-desc-0').fill('Chair');
      await invoice.locator('#inv-item-qty-0').fill('12');
      await invoice.locator('#inv-item-rate-0').fill('90.00');
      await invoice.locator('#inv-item-acc-0').fill(incomeAccount.name);
      await invoice.getByRole('button', { name: 'Save & Close', exact: true }).click();
      await expect.poll(() => postings.length).toBe(3);
      expect(postings[2], JSON.stringify(postings[2])).toMatchObject({ status: 200 });
      await expect.poll(async () => (await server.all('invoices')).length).toBe(1);
      await expect(invoice).toHaveCount(0);
      expect(postings).toHaveLength(3);
      expect(postings[2].status).toBe(200);
      for (const post of postings) {
        expect(post.body.action).toBe('create'); expect(post.body.workspaceId).toBe(workspaceId);
        expect(post.body).not.toHaveProperty('entries'); expect(post.body).not.toHaveProperty('transactions');
      }
      const savedInvoice = (await server.all('invoices'))[0];
      expect(savedInvoice.amountCents).toBe(108000);
      const stock = (await server.all('inventory'))[0];
      expect([stock.quantityAtHand, stock.unitCostCents]).toEqual([8, 4300]);
      const transactions = await server.all('transactions');
      expect(transactions.filter(tx => tx.metadata?.type === 'invoice-cogs-auto').map(tx => tx.totalAmountCents)).toEqual([51600]);
      // Independently read the authoritative report, not values computed by the fixture.
      const plReply = await fetch(`${server.base}/api/v1/reports/profit-and-loss?workspaceId=${workspaceId}&startDate=2026-04-01&endDate=2026-04-30`);
      expect(plReply.status).toBe(200);
      const pl = await plReply.json(); expect(pl.income.total).toBe(108000); expect(pl.netIncome).toBe(56400);
      // Destroy the browser page/store and restore only the persisted database snapshot.
      const reloaded = await mountJourney(page, { workspaceId, ledger: await server.ledger(), mounts: [{ module: '/src/components/purchases/Purchases.tsx' }] });
      await page.route('**/api/**', forwardApi);
      await page.evaluate(selected => { document.documentElement.className = selected; }, theme);
      await expect(page.getByRole('row', { name: /B-1/ })).toContainText('$400.00');
      await expect(page.getByRole('row', { name: /B-2/ })).toContainText('$460.00');
      await remountJourney(page, [{ module: '/src/components/sales/Sales.tsx' }]);
      await expect(page.getByRole('row', { name: /INV-1/ })).toContainText('$1,080.00');
      expect(reloaded.errors).toEqual([]);
      await remountJourney(page, [{ module: '/src/components/reporting/InventoryValuationReportView.tsx', exportName: 'InventoryValuationReportView' }]);
      const row = page.getByRole('row', { name: /Chair/ }).first();
      await expect(row).toContainText('$43.00'); await expect(row).toContainText('$344.00');
      await expect(page.getByText('The stock list and the Inventory account agree.', { exact: true })).toBeVisible();
      expect(errors).toEqual([]);
      await expect(page.getByRole('region', { name: 'Stock closing and checks' })).toContainText('No stock closing yet');
      await expect(page.getByRole('region', { name: 'Stock closing and checks' })).not.toContainText('Stock checks not available');
      await page.screenshot({ path: testInfo.outputPath(`w13-stock-${width}-${theme}.png`), fullPage: true });
      await expect.poll(() => row.evaluate(element => { for (let node: Element | null = element; node; node = node.parentElement) if (Number(getComputedStyle(node).opacity) < 0.99) return false; return true; })).toBe(true);
      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations.filter(v => ['critical', 'serious'].includes(v.impact || ''))).toEqual([]);
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export.*CSV/i }).click()]);
      const csv = await readFile((await download.path())!, 'utf8');
      expect(csv).toContain('Chair'); expect(csv).toContain('43.00'); expect(csv).toContain('344.00');
      await page.getByLabel('As of Date', { exact: true }).fill('2026-04-12');
      await expect(row).toContainText('$860.00'); await expect(row).toContainText('$43.00');
      await expect(page.getByText('The stock list and the Inventory account agree.', { exact: true })).toBeVisible();
      expect(errors).toEqual([]); expect(reloaded.errors).toEqual([]);
    } finally { await testInfo.attach('real-posting-requests', { body: JSON.stringify(postings, null, 2), contentType: 'application/json' }); await server.close(); }
  });
}
