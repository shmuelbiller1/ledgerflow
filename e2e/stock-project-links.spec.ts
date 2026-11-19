import { expect, test } from '@playwright/test';
import { installSmallSample } from './helpers/sampleFixture';
import { tabTo } from './support/tabTo';

test.use({ viewport: { width: 390, height: 850 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('isGuest', 'true'); localStorage.setItem('has_seen_onboarding', 'true'); });
});
// A fixture alone would also pass for a dead component. Open each real module from its deep link.
for (const [id, heading] of [
  ['time-by-project', 'Time by person and project'], ['sales-by-item', 'Sales by Item & Profit Margin'],
  ['gross-margin-by-item-group', 'Gross margin by item group'], ['inactive-items', /Inactive items as of/],
  ['backorders', 'Backorders'], ['inventory-details', 'Inventory item details'], ['stock-aging', 'Stock aging'],
  ['inventory-turnover', 'Inventory turnover'], ['stock-transfers', 'Stock transfers'],
] as const) test(`report link opens ${id}`, async ({ page }) => {
  await installSmallSample(page);
  await page.goto(`/?report=${id}&start=2026-02-01&end=2026-02-28#reports`);
  await expect(page.locator(`[data-report-view="${id}"]`).getByRole('heading', { name: heading })).toBeVisible();
});

test('Projects opens the transaction-line matrix, not the invoice profitability report', async ({ page }) => {
  await installSmallSample(page, false, { transactions: { pier: { id: 'pier', uid: 'owner-sample', workspaceId: 'guest', date: '2026-02-03', description: 'Pier fees', type: 'income', status: 'completed', totalAmountCents: 12500, currency: 'USD', lines: [
    { accountId: 'cash', accountName: 'Bank', amountCents: 12500, project: 'Pier רציף' },
    { accountId: 'fees', accountName: 'Revenue', amountCents: -12500, project: 'Pier רציף' },
  ] } } });
  await page.goto('/#projects');
  const tab = page.locator('#main-content').getByRole('button', { name: 'Profitability', exact: true });
  await tabTo(page, tab); await page.keyboard.press('Enter'); await expect(tab).toHaveAttribute('aria-pressed', 'true');
  const row = page.getByRole('table', { name: 'Results by project' }).getByRole('row', { name: /Pier רציף/ });
  await expect(row.getByRole('cell')).toHaveText(['1', '$125.00', '$0.00', '$125.00', '100.0%']);
  await expect(page.getByRole('button', { name: 'Export project rows' })).toBeDisabled();
});
