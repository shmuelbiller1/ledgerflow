import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

import { BRAND_NAME } from '../src/config/brand';
// Authenticated component fixtures with the real DB request boundary stubbed. No live provider writes.
async function mount(page: Page, mode: 'maintenance' | 'labels' | 'purchases') {
  await page.route('**/agent3-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="en"><head><title>${BRAND_NAME} Agent 3 workflow</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="root"></div></body></html>`,
  }));
  await page.goto('/agent3-fixture');
  await page.evaluate(async mode => {
    const refresh = await import('/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
    const paths = [
      '/node_modules/.vite/deps/react.js', '/node_modules/.vite/deps/react-dom_client.js',
      '/src/stores/useAuthStore.ts', '/src/stores/useLedgerStore.ts', '/src/stores/useDataNeedsStore.ts',
      '/src/components/assets/MaintenanceLog.tsx', '/src/components/assets/AssetLabels.tsx', '/src/components/reporting/DocumentTrendsView.tsx',
    ];
    const [{ default: React }, { default: { createRoot } }, { useAuthStore }, { useLedgerStore }, { useDataNeedsStore }, { MaintenanceLog }, { default: AssetLabels }, { PurchaseTrendsView }] = await Promise.all(paths.map(path => import(path)));
    const workspaceId = 'agent3-browser';
    const user = { uid: 'agent3-user', email: 'agent3@example.test', isAnonymous: false, getIdToken: async () => 'browser-fixture-token' };
    useAuthStore.setState({ user, isGuest: false, currentWorkspaceId: workspaceId, workspaces: [{ id: workspaceId, uid: user.uid, name: 'Demo Co', currency: 'USD', roles: { [user.uid]: 'owner' } }] });
    const asset = { id: 'van', uid: user.uid, workspaceId, name: 'ציוד', assetTag: 'AT-0001', purchaseDate: '2026-01-01', purchasePriceCents: 1200000, salvageValueCents: 10000, usefulLifeYears: 5, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 20000, status: 'active', createdAt: '2026-01-01', maintenance: [] };
    const item = { id: 'chair', uid: user.uid, workspaceId, name: 'כיסא', sku: 'chair', unitPriceCents: 1000, unitCostCents: 500, quantityAtHand: 3, reorderPoint: 0, createdAt: '2026-01-01' };
    const bill = { id: 'b1', uid: user.uid, workspaceId, vendorId: 'vendor', vendorName: 'ספק', date: '2026-10-01', dueDate: '2026-10-01', status: 'approved', amountCents: 2468, splits: [{ accountId: 'stock', itemId: 'chair', quantity: 2, amountCents: 2468 }] };
    useLedgerStore.setState({ assets: [asset], inventory: [item], bills: [bill, { ...bill, id: 'eur', currency: 'EUR', exchangeRate: 2 }], vendors: [], invoices: [], customers: [], accounts: [], transactions: [], truncatedCollections: {} });
    useDataNeedsStore.setState({ loaded: { assets: true, inventory: true, bills: true, vendors: true, invoices: true, customers: true, accounts: true, transactions: true }, failed: {} });
    function Fixture() {
      const current = useLedgerStore((state: { assets: Array<typeof asset> }) => state.assets[0]);
      const [labels, setLabels] = React.useState(false);
      return React.createElement('div', { className: 'max-w-full p-4' },
        React.createElement('nav', null, 'Navigation sentinel'),
        React.createElement('h1', null, 'Agent 3 workflow fixture'),
        mode === 'maintenance' ? React.createElement(MaintenanceLog, { asset: current, currency: 'USD' }) :
        mode === 'purchases' ? React.createElement(PurchaseTrendsView, { endDate: '2026-10-11' }) :
        React.createElement('button', { type: 'button', onClick: () => setLabels(true) }, 'Open asset labels'),
        labels ? React.createElement(AssetLabels, { assets: [current], company: 'Demo Co', onClose: () => setLabels(false) }) : null);
    }
    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  }, mode);
}

test('phone maintenance retains a refused draft, retries, removes a note and links its file without posting', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  let refused = true;
  const writes: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/rest/v1/**', async route => {
    const request = route.request();
    if (request.url().includes('/rpc/lf_update')) {
      const body = request.postDataJSON(); writes.push(body);
      expect(body.p_table).toBe('assets');
      if (refused) { refused = false; return await route.fulfill({ status: 403, json: { message: 'Asset note refused', code: '42501' } }); }
    }
    if (request.url().includes('/rpc/lf_set')) {
      const body = request.postDataJSON(); writes.push(body);
      expect(body.p_table).toBe('documents'); expect(body.p_data.linkedCollection).toBe('assets'); expect(body.p_data.linkedId).toBe('van');
    }
    await route.fulfill({ json: request.method() === 'GET' ? [] : null });
  });
  await mount(page, 'maintenance');
  await page.locator('summary').click();
  expect((await page.getByRole('region', { name: 'Files of Asset maintenance: ציוד' }).locator('label').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const what = page.getByLabel('What was done');
  await what.fill('בדיקת ציוד');
  await page.getByLabel('Day done').fill('2026-10-11');
  await page.getByLabel('Cost', { exact: true }).fill('25.80');
  const save = page.getByRole('button', { name: 'Note it', exact: true });
  expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await save.focus(); await save.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Asset note refused');
  await expect(what).toHaveValue('בדיקת ציוד');
  await save.press('Enter');
  await expect(what).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Remove בדיקת ציוד on 2026-10-11' })).toBeVisible();
  await page.getByLabel('Attach files to Asset maintenance: ציוד').setInputFiles({ name: 'receipt.txt', mimeType: 'text/plain', buffer: Buffer.from('service receipt') });
  await expect(page.getByRole('link', { name: 'Download receipt.txt' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove בדיקת ציוד on 2026-10-11' }).click();
  await expect(page.locator('summary')).toContainText('Maintenance log (0)');
  for (const write of writes.filter(write => write.p_table === 'assets')) expect(Object.keys(write.p_set as object).sort()).toEqual(['maintenance', 'updatedAt']);
  const money = await page.evaluate(async () => { const path = '/src/stores/useLedgerStore.ts'; const { useLedgerStore } = await import(path); return [useLedgerStore.getState().assets[0].purchasePriceCents, useLedgerStore.getState().assets[0].accumulatedDepreciationCents]; });
  expect(money).toEqual([1200000, 20000]);
  const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth).map(element => ({ tag: element.tagName, class: element.getAttribute('class'), x: element.getBoundingClientRect().x, width: element.getBoundingClientRect().width })) }));
  expect(layout.scrollWidth, JSON.stringify(layout.overflow)).toBeLessThanOrEqual(layout.width);
  expect(errors).toEqual([]);
});

test('asset labels trap keyboard focus, retain QR, print Code 128 and bought date only, and restore focus', async ({ page }, testInfo) => {
  await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
  await mount(page, 'labels');
  const opener = page.getByRole('button', { name: 'Open asset labels' });
  await opener.focus(); await opener.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Asset labels (1)' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'QR code of AT-0001' })).toBeVisible();
  const barcode = dialog.getByRole('img', { name: 'Code 128 barcode of AT-0001' });
  await expect(barcode).toHaveAttribute('viewBox', '0 0 132 44');
  await expect(dialog).toContainText('Bought 2026-01-01');
  await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeFocused();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('nav')).toBeHidden();
  await expect(opener).toBeHidden();
  expect(await page.locator('h1').evaluate(element => getComputedStyle(element).visibility)).toBe('hidden');
  expect(await page.locator('[data-print-root] svg[aria-label="Code 128 barcode of AT-0001"]').evaluate(element => getComputedStyle(element).visibility)).toBe('visible');
  const pdf = await page.pdf({ path: testInfo.outputPath('asset-labels.pdf'), format: 'A4', printBackground: true });
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  await page.emulateMedia({ media: 'screen' });
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
});

test('phone item trends switch from vendor, keep currencies apart, export Hebrew safely and remain accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
  await mount(page, 'purchases');
  await page.getByLabel('Group purchases by').selectOption('item');
  const report = page.getByRole('region', { name: 'Purchase trends by item', exact: true });
  await expect(report).toContainText('Provisional');
  await expect(report.getByRole('columnheader', { name: 'Currency' })).toBeVisible();
  await expect(report.getByRole('rowheader', { name: 'כיסא' })).toHaveCount(2);
  await expect(report.getByRole('cell', { name: 'EUR', exact: true })).toBeVisible();
  await expect(report.getByRole('cell', { name: 'USD', exact: true })).toBeVisible();
  const csv = report.getByRole('button', { name: 'Export item trends CSV' });
  expect((await csv.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const downloadPromise = page.waitForEvent('download');
  await csv.focus(); await csv.press('Enter');
  const download = await downloadPromise;
  const text = await readFile((await download.path())!, 'utf8');
  expect(text).toContain('כיסא'); expect(text).toContain('"EUR"'); expect(text).toContain('"USD"');
  expect(text).toContain(',2,2468,1'); expect(text).toContain('Line amount (minor units)');
  const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth).map(element => ({ tag: element.tagName, class: element.getAttribute('class'), x: element.getBoundingClientRect().x, width: element.getBoundingClientRect().width })) }));
  expect(layout.scrollWidth, JSON.stringify(layout.overflow)).toBeLessThanOrEqual(layout.width);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
});

test('long maintenance notes and maximum-length labels stay inside a 320px phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().method() === 'GET' ? [] : null }));
  await mount(page, 'maintenance');
  await page.locator('summary').click();
  await page.getByLabel('What was done').fill('A'.repeat(300));
  await page.getByLabel('By', { exact: true }).fill('B'.repeat(120));
  await page.getByRole('button', { name: 'Note it', exact: true }).click();
  await expect(page.getByLabel('What was done')).toHaveValue('');
  await expect(page.getByText('A'.repeat(300), { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mount(page, 'labels');
  await page.evaluate(async () => {
    const path = '/src/stores/useLedgerStore.ts';
    const { useLedgerStore } = await import(path);
    useLedgerStore.setState((state: { assets: Array<Record<string, unknown>> }) => ({ assets: state.assets.map(asset => ({ ...asset, assetTag: 'A'.repeat(32) })) }));
  });
  await page.getByRole('button', { name: 'Open asset labels' }).click();
  // 34 eleven-module symbols + 13-module stop + two ten-module quiet zones = 407.
  await expect(page.getByRole('img', { name: `Code 128 barcode of ${'A'.repeat(32)}` })).toHaveAttribute('viewBox', '0 0 407 44');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
