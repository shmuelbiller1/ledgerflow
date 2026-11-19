import { expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { parseCsv } from '../../src/lib/csv';
import { mountJourney, settleStyles, type JourneyMount } from './journeyFixture';
import { tabTo } from './tabTo';

const workspaceId = 'monthly-books';
export const customer = 'Dana דנה', vendor = 'North צפון', item = 'Valve ברז';
export const trends = (kind: 'sales' | 'purchases', compared = true, endDate = '2026-02-28'): JourneyMount => ({
  module: '/src/components/reporting/DocumentTrendsView.tsx',
  exportName: kind === 'sales' ? 'SalesTrendsView' : 'PurchaseTrendsView',
  props: { endDate, compareEndDate: compared ? '2026-01-31' : '' },
});
const ledger = {
  customers: [{ id: 'dana', workspaceId, name: customer }],
  vendors: [{ id: 'north', workspaceId, name: vendor }],
  inventory: [{ id: 'valve', workspaceId, name: item, sku: 'V-7' }],
  invoices: [1875, 23456].map((amountCents, i) => ({
    id: `i${i}`, workspaceId, customerId: 'dana', number: `INV-${i}`, date: `2026-0${i + 1}-04`, status: 'paid', currency: 'USD', amountCents,
    items: [{ itemId: 'valve', description: item, quantity: 1, amountCents }],
  })),
  bills: [4200, 3850].map((amountCents, i) => ({
    id: `b${i}`, workspaceId, vendorId: 'north', vendorName: vendor, number: `B-${i + 1}`, date: `2026-0${i + 1}-07`, status: 'paid', currency: 'USD', amountCents,
    splits: [{ itemId: 'valve', description: item, quantity: 2, amountCents }],
  })),
};

export async function openComparison(page: Page, mount: JourneyMount, width: number, theme: 'light' | 'dark', role: 'bookkeeper' | 'viewer' = 'viewer') {
  const he = (width === 390) === (theme === 'light');
  await page.setViewportSize({ width, height: 850 });
  await page.clock.setFixedTime(new Date('2026-02-28T12:00:00Z'));
  const handle = await mountJourney(page, { workspaceId, role, ledger, mounts: [mount] });
  await page.evaluate(async ({ theme, he }) => {
    const { useUIStore } = await import('/src/stores/useUIStore.ts');
    useUIStore.setState({ language: he ? 'he' : 'en' });
    Object.assign(document.documentElement, { className: theme, lang: he ? 'he' : 'en', dir: he ? 'rtl' : 'ltr' });
  }, { theme, he });
  return { ...handle, he };
}

export async function pressAt(page: Page, target: Locator, key = 'Enter', backwards = false) {
  await tabTo(page, target, backwards, 48);
  await page.keyboard.press(key);
}

export async function downloadAt(page: Page, button: Locator, backwards = false) {
  await tabTo(page, button, backwards, 48);
  const pending = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const file = await pending;
  return { name: file.suggestedFilename(), rows: parseCsv(await readFile((await file.path())!, 'utf8')) };
}

export async function auditComparison(page: Page, name: string) {
  await settleStyles(page);
  const audit = await new AxeBuilder({ page }).include('#root').analyze();
  expect(audit.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`), name).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

export async function inspectComparison(page: Page, name: string) {
  await auditComparison(page, name);
  await expect(page.locator('#root')).toHaveScreenshot(`${name}.png`, {
    animations: 'disabled', caret: 'hide', scale: 'css', threshold: 0.1, maxDiffPixels: 100,
  });
}
