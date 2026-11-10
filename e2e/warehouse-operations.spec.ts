import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

import { BRAND_NAME } from '../src/config/brand';
// Real screens and DB request contract; this is not a live Supabase/provider acceptance test.
async function mount(page: Page, { longLabels = false, direction = 'ltr' }: { longLabels?: boolean; direction?: 'ltr' | 'rtl' } = {}) {
  await page.route('**/warehouse-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="en"><head><title>${BRAND_NAME} warehouse audit</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><main><div id="main-content"><div id="root"></div></div></main></body></html>`,
  }));
  await page.goto('/warehouse-fixture');
  await page.evaluate(async ({ longLabels, direction }) => {
    const refresh = await import('/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
    const paths = [
      '/node_modules/.vite/deps/react.js', '/node_modules/.vite/deps/react-dom_client.js',
      '/src/stores/useAuthStore.ts', '/src/stores/useLedgerStore.ts', '/src/stores/useDataNeedsStore.ts',
      '/src/components/reporting/CycleCountReportView.tsx', '/src/lib/warehouseWorkflows.ts', '/src/lib/warehouseRecords.ts',
    ];
    const [{ default: React }, { default: { createRoot } }, { useAuthStore }, { useLedgerStore }, { useDataNeedsStore }, { default: CycleCount }, { binLocationKey }, { createReturnAuthorization, rmaFieldPath }] = await Promise.all(paths.map(path => import(path)));
    const workspaceId = 'warehouse-browser';
    const user = { uid: 'warehouse-user', email: 'warehouse@example.test', displayName: 'בודק Tester', isAnonymous: false, getIdToken: async () => 'fixture-token' };
    const workspace = { id: workspaceId, uid: user.uid, name: 'Warehouse books', currency: 'ILS', goodsLeaveWith: 'invoice', roles: { [user.uid]: 'owner' }, branding: { language: 'he' } };
    useAuthStore.setState({ user, isGuest: false, currentWorkspaceId: workspaceId, workspaces: [workspace] });
    const location = { id: 'location-1', dimensionId: 'location', description: `מחסן Warehouse${longLabels ? 'L'.repeat(100) : ''}`, status: 'active' };
    const customer = { id: 'customer-1', uid: user.uid, workspaceId, name: `לקוח Customer${longLabels ? 'C'.repeat(100) : ''}` };
    const item = { id: 'item-1', uid: user.uid, workspaceId, name: `ציוד Widget${longLabels ? 'W'.repeat(100) : ''}`, sku: 'SKU-אב-01', itemType: 'stock', unitPriceCents: 1000, unitCostCents: 400, quantityAtHand: 20, reorderPoint: 2, createdAt: '2026-01-01', binLocations: { [binLocationKey(location.id)]: { locationId: location.id, bin: 'A-03' } } };
    const order = { id: 'order-1', uid: user.uid, workspaceId, customerId: customer.id, customerName: customer.name, number: 'SO-2026-001', amountCents: 5000, date: '2026-10-10', status: 'accepted', orderedAt: '2026-10-11', createdAt: '2026-10-10', lines: [{ itemId: item.id, description: item.name, quantity: 5, unitPriceCents: 1000, amountCents: 5000 }] };
    const invoice = { id: 'invoice-1', uid: user.uid, workspaceId, customerId: customer.id, customerName: customer.name, number: 'INV-2026-001', amountCents: 2000, date: '2026-10-12', dueDate: '2026-11-11', status: 'sent', metadata: { convertedFromEstimateId: order.id }, items: [{ id: 'line-1', itemId: item.id, description: item.name, quantity: 2, rateCents: 1000, amountCents: 2000, accountId: 'income', metadata: { orderLine: 0 }, serialNumbers: ['SN-אב-01'] }] };
    if (longLabels) {
      const rma = createReturnAuthorization({
        id: 'rma_phone', number: 'RMA-2026-PHONE', workspaceId, customerId: customer.id, customerName: customer.name,
        invoiceId: invoice.id, invoiceNumber: invoice.number, reason: `תיאור ${'R'.repeat(180)}`,
        actor: { uid: 'another-requester', name: 'Requester', role: 'bookkeeper' }, at: '2026-10-15T10:00:00.000Z',
        lines: [{ invoiceLineId: 'line-1', itemId: item.id, description: item.name, quantity: 1, soldQuantity: 2 }],
      });
      Object.assign(customer, { metadata: { returnAuthorizationsById: { [rmaFieldPath(rma.id).split('.').pop()]: rma } } });
    }
    useLedgerStore.setState({ inventory: [item], customers: [customer], estimates: [order], invoices: [invoice], transactions: [], creditNotes: [], dimensionNodes: [location], truncatedCollections: {}, baseCurrency: 'ILS' });
    useDataNeedsStore.setState({ loaded: { inventory: true, estimates: true, invoices: true, transactions: true, customers: true, creditNotes: true }, failed: {} });
    document.documentElement.dir = direction;
    createRoot(document.getElementById('root')).render(React.createElement(CycleCount, { loadMoves: async () => [] }));
  }, { longLabels, direction });
  await expect(page.getByRole('tab', { name: 'Cycle count', exact: true })).toBeVisible();
}

async function enterWarehouse(page: Page) {
  await page.getByRole('tab', { name: 'Warehouse operations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Warehouse operations', exact: true })).toBeVisible();
}

async function expectBounded(page: Page) {
  const layout = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  expect(layout.width).toBeLessThanOrEqual(layout.viewport);
}

for (const direction of ['ltr', 'rtl'] as const) {
  test(`nested inventory tabs support keyboard activation, wrapping and focus in ${direction}`, async ({ page }) => {
    await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
    await mount(page, { direction });
    const cycle = page.getByRole('tab', { name: 'Cycle count', exact: true });
    await cycle.focus();
    await page.keyboard.press(direction === 'ltr' ? 'ArrowRight' : 'ArrowLeft');
    const warehouse = page.getByRole('tab', { name: 'Warehouse operations', exact: true });
    await expect(warehouse).toBeFocused();
    await expect(warehouse).toHaveAttribute('aria-selected', 'true');
    const bins = page.getByRole('tab', { name: 'Bin locations', exact: true });
    await page.keyboard.press('Tab');
    await expect(bins).toBeFocused();
    await page.keyboard.press('End');
    const warranty = page.getByRole('tab', { name: 'Warranty register', exact: true });
    await expect(warranty).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Warranty register', exact: true })).toBeVisible();
    await page.keyboard.press(direction === 'ltr' ? 'ArrowRight' : 'ArrowLeft');
    await expect(bins).toBeFocused();
    await page.keyboard.press('Home');
    await expect(bins).toBeFocused();
    const controlsExist = await page.getByRole('tab').evaluateAll(tabs => tabs.every(tab => document.getElementById(tab.getAttribute('aria-controls') || '')));
    expect(controlsExist).toBe(true);
    await warehouse.focus();
    await page.keyboard.press('Home');
    await expect(cycle).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Inventory cycle count', exact: true })).toBeVisible();
  });
}

test('all four warehouse panels contain long mixed-language data on a phone and pass serious axe checks', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page, { longLabels: true, direction: 'rtl' });
  await enterWarehouse(page);
  for (const name of ['Bin locations', 'Pick, pack and ship', 'Return authorizations', 'Warranty register']) {
    await page.getByRole('tab', { name, exact: true }).click();
    if (name === 'Warranty register') await page.getByLabel('Warranty status filter').selectOption('all');
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    if (name === 'Return authorizations') {
      const quantity = page.getByRole('spinbutton', { name: /Return quantity for/ });
      await quantity.scrollIntoViewIfNeeded();
      await quantity.fill('1');
      const box = (await quantity.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      await expect(quantity).toHaveValue('1');
    }
    if (name === 'Warranty register') {
      const serial = page.locator('bdi').filter({ hasText: 'SN-אב-01' });
      await serial.scrollIntoViewIfNeeded();
      await expect(serial).toHaveText('SN-אב-01');
      expect(await serial.evaluate(element => getComputedStyle(element).unicodeBidi)).toBe('isolate');
    }
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expectBounded(page);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const control of await page.locator('button, input, select, textarea, summary').all()) {
      if (await control.isVisible()) expect((await control.boundingBox())!.height, await control.evaluate(element => element.outerHTML)).toBeGreaterThanOrEqual(44);
    }
    const scan = await new AxeBuilder({ page }).analyze();
    // Include every inline editor in the full scan, including label-content-name-mismatch.
    const serious = (violations: Array<{ impact?: string | null }>) => violations.filter(violation => ['serious', 'critical'].includes(violation.impact || ''));
    expect(serious(scan.violations)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`${name.toLowerCase().replaceAll(' ', '-')}-390-rtl.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('phone warehouse edits retain refused drafts, retry, export Hebrew CSV and never call a financial write', async ({ page }) => {
  test.setTimeout(60000);
  const writes: Array<{ p_table: string; p_id: string; p_set: Record<string, unknown> }> = [];
  let refuseNext = true;
  await page.route('**/rest/v1/**', async route => {
    const request = route.request();
    if (request.url().includes('/rpc/lf_update')) {
      const body = request.postDataJSON();
      writes.push(body);
      if (refuseNext) {
        refuseNext = false;
        return await route.fulfill({ status: 403, json: { message: 'Warehouse save refused', code: '42501' } });
      }
      await page.evaluate(async body => {
        const path = '/src/stores/useLedgerStore.ts';
        const { useLedgerStore } = await import(path);
        const rows = useLedgerStore.getState()[body.p_table];
        useLedgerStore.setState({ [body.p_table]: rows.map((row: { id: string }) => {
          if (row.id !== body.p_id) return row;
          const next = structuredClone(row);
          for (const [path, value] of Object.entries(body.p_set)) {
            const keys = path.split('.');
            let target = next;
            for (const key of keys.slice(0, -1)) target = target[key] ??= {};
            target[keys[keys.length - 1]] = value;
          }
          return next;
        }) });
      }, body);
    } else {
      expect(request.method()).toBe('GET');
    }
    await route.fulfill({ json: request.method() === 'GET' ? [] : null });
  });
  // ISS-143: an RMA is requested through the server, which answers with the record it saved
  const rmaRequests: Array<Record<string, unknown>> = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (request.method() === 'POST' && /\/return-authorizations$/.test(new URL(request.url()).pathname)) {
      const body = request.postDataJSON();
      rmaRequests.push(body);
      const record = await page.evaluate(async body => {
        const path = '/src/lib/warehouseRecords.ts';
        const { createReturnAuthorization } = await import(path);
        return createReturnAuthorization({
          id: 'rma_browser1', number: 'RMA-2026-BROWSERTEST1', workspaceId: 'warehouse-browser', customerId: body.customerId, customerName: 'לקוח Customer',
          invoiceId: body.invoiceId, invoiceNumber: 'INV-2026-001', reason: body.reason, at: new Date().toISOString(),
          actor: { uid: 'warehouse-user', name: 'בודק Tester', role: 'owner' },
          lines: body.lines.map((l: { invoiceLineId: string; quantity: number }) => ({ ...l, itemId: 'item-1', description: 'ציוד Widget', soldQuantity: 2 })),
        });
      }, body);
      return route.fulfill({ json: { status: 'success', record, replayed: false } });
    }
    expect(request.method()).toBe('GET');
    return route.fulfill({ json: {} });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page);
  await enterWarehouse(page);
  await page.getByRole('button', { name: /Edit Bin for/ }).click();
  const bin = page.getByLabel(/Bin for ציוד Widget at/);
  await bin.fill('B-08'); await bin.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Warehouse save refused');
  await expect(bin).toHaveValue('B-08');
  await bin.press('Enter');
  await expect(page.getByRole('button', { name: /Edit Bin for/ })).toContainText('B-08');

  await page.getByRole('tab', { name: 'Pick, pack and ship', exact: true }).click();
  await page.getByLabel('Shipment carrier').fill('שליח Parcel');
  await page.getByLabel('Shipment tracking number').fill('TRACK-אב-01');
  await page.getByRole('button', { name: 'Mark shipped', exact: true }).click();
  await expect(page.getByRole('table', { name: /Shipment tracking history/ })).toContainText('TRACK-אב-01');

  await page.getByRole('tab', { name: 'Return authorizations', exact: true }).click();
  await page.getByLabel('Return quantity for ציוד Widget').fill('1');
  await page.getByLabel('RMA reason').fill('מידה שגויה Wrong size');
  await page.getByRole('button', { name: 'Submit RMA request' }).click();
  await expect(page.getByRole('article', { name: /Return authorization RMA-/ })).toContainText('מידה שגויה Wrong size');
  await expect(page.getByText('You requested this RMA and cannot decide it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve RMA' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Warranty register', exact: true }).click();
  await page.getByLabel('Warranty status filter').selectOption('all');
  await page.getByRole('button', { name: /Edit Warranty end date for SN-/ }).click();
  const endDate = page.getByLabel(/Warranty end date for SN-/);
  await endDate.fill('2027-10-15'); await endDate.press('Enter');
  await expect(page.getByRole('button', { name: /Edit Warranty end date for SN-/ })).toContainText('2027-10-15');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export warranty CSV' }).click();
  const csv = await readFile((await (await downloadPromise).path())!, 'utf8');
  expect(csv).toContain('לקוח Customer'); expect(csv).toContain('SN-אב-01'); expect(csv).toContain('2027-10-15');
  // the bin twice (refused, then saved), the shipment and the warranty; the RMA went to the server (ISS-143)
  expect(writes).toHaveLength(4);
  for (const write of writes) {
    expect(['inventory', 'estimates', 'customers']).toContain(write.p_table);
    expect(Object.keys(write.p_set).every(key => key === 'updatedAt' || key.startsWith('binLocations.') || key.startsWith('metadata.warehouseShipmentsBySource.') || key.startsWith('metadata.warrantiesById.'))).toBe(true);
  }
  expect(rmaRequests).toHaveLength(1);
  expect(rmaRequests[0]).toMatchObject({ customerId: 'customer-1', invoiceId: 'invoice-1', reason: 'מידה שגויה Wrong size', lines: [{ invoiceLineId: 'line-1', quantity: 1 }] });
  await expectBounded(page);
});

test('packing slips print twice, isolate the goods-only content and restore screen controls', async ({ page }, testInfo) => {
  await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
  await mount(page);
  await enterWarehouse(page);
  await page.getByRole('tab', { name: 'Pick, pack and ship', exact: true }).click();
  await page.evaluate(() => {
    Object.assign(window, { warehousePrints: 0 });
    window.print = () => { (window as unknown as { warehousePrints: number }).warehousePrints += 1; };
  });
  const print = page.getByRole('button', { name: 'Print packing slip', exact: true });
  await print.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { warehousePrints: number }).warehousePrints)).toBe(1);
  const slip = page.getByRole('article', { name: 'Warehouse packing slip' });
  await expect(slip).toContainText('ציוד Widget');
  await expect(slip).toContainText('Goods only — prices omitted.');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('tab', { name: 'Cycle count', exact: true })).toBeHidden();
  await expect(slip).toBeVisible();
  const pdf = await page.pdf({ path: testInfo.outputPath('packing-slip.pdf'), format: 'A4', printBackground: true });
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('body')).not.toHaveClass(/warehouse-packing-print/);
  await print.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { warehousePrints: number }).warehousePrints)).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(print).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/warehouse-packing-print/);
});
