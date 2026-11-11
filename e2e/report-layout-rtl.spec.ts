import { mountJourney } from './support/journeyFixture';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('phone report columns reorder by keyboard, export exactly the visible cells, and retain Hebrew money in print', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /same key/.test(message.text())) errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', route => route.fulfill({ status: 404, json: {} }));
  // This component/locale probe must not race the full app's sample workspace hydration.
  await mountJourney(page, { workspaceId: 'rtl-probe', ledger: {}, mounts: [] });
  await page.evaluate(async () => {
    const paths = ['/node_modules/.vite/deps/react.js', '/node_modules/.vite/deps/react-dom_client.js', '/src/components/reporting/ReportTableScroll.tsx', '/src/components/ui/Money.tsx', '/src/stores/useAuthStore.ts', '/src/stores/useLedgerStore.ts'];
    const [{ default: React }, { default: { createRoot } }, { default: Scroll }, { Money }, { useAuthStore }, { useLedgerStore }] = await Promise.all(paths.map(path => import(path)));
    useAuthStore.setState({ user: null, currentWorkspaceId: 'rtl-probe', workspaces: [{ id: 'rtl-probe', name: 'ספרים Books', currency: 'ILS', moneyDisplay: { locale: 'he-IL', negativeStyle: 'accounting' } }] });
    useLedgerStore.setState({ baseCurrency: 'ILS' });
    const host = document.createElement('div'); host.id = 'layout-rtl-probe'; host.dir = 'rtl';
    host.style.cssText = 'position:fixed;inset:0;z-index:999999;background:white;overflow:auto;padding:12px'; document.body.append(host);
    const h = React.createElement;
    createRoot(host).render(h(Scroll, null, h('table', { style: { width: '100%' } },
      h('caption', null, 'Hebrew document amounts'),
      h('thead', null, h('tr', null, h(React.Fragment, null, h('th', null, 'Document'), h('th', null, 'Count')), h(React.Fragment, null, h('th', null, 'Amount')))),
      h('tbody', null, h('tr', null, h(React.Fragment, null, h('td', null, 'חשבונית Sales-12'), h('td', null, '2')), h(React.Fragment, null, h('td', { style: { textAlign: 'right' } }, h(Money, { cents: -123456, currency: 'ILS' }))))),
      h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td', null, '2'), h('td', { style: { textAlign: 'right' } }, h(Money, { cents: -123456, currency: 'ILS' })))))));
  });
  const host = page.locator('#layout-rtl-probe');
  await host.getByRole('button', { name: 'Columns', exact: true }).click();
  const move = host.getByRole('button', { name: 'Move Amount earlier' });
  await move.focus(); await move.press('Enter');
  await expect(host.locator('thead th')).toHaveText(['Document', 'Amount', 'Count']);
  const count = host.getByRole('checkbox', { name: 'Count', exact: true });
  await count.focus(); await count.press('Space');
  await expect(host.locator('tbody td').nth(2)).toBeHidden();
  const money = host.locator('tbody td span[dir="auto"]');
  await expect(money).toContainText('1,234.56'); await expect(money).toContainText('₪');
  const text = await money.textContent(); expect(text!.startsWith('(') && text!.endsWith(')')).toBe(true);
  expect(await money.evaluate(el => getComputedStyle(el).unicodeBidi)).toBe('isolate');
  expect(await money.locator('..').evaluate(el => getComputedStyle(el).textAlign)).toBe('right');
  const bounds = await move.boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const downloading = page.waitForEvent('download');
  await host.getByRole('button', { name: 'Export displayed rows CSV' }).click();
  const download = await downloading; const path = await download.path();
  const csv = await readFile(path!, 'utf8');
  expect(csv).toContain('"Document","Amount"'); expect(csv).toContain('חשבונית Sales-12'); expect(csv).toContain(text!); expect(csv).not.toContain('"Count"');
  await page.emulateMedia({ media: 'print' });
  await expect(host.locator('tbody td').nth(2)).toBeHidden(); await expect(money).toHaveText(text!);
  expect(errors).toEqual([]);
});
