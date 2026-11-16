/** EU-I3: write an invoice with no account, then carry it into the sample company's invoice form. */
import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) {
  test(`EU-I3: free invoice maker → sample company (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem('ledgerflow-cookie-consent', 'accepted'));
    await page.goto('/make-invoice');
    await expect(page.getByRole('heading', { name: /Make an invoice/ })).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Bill to').fill('Acme Ltd');
    await page.getByLabel('Line 1 description').fill('Logo design');
    await page.getByLabel('Line 1 quantity').fill('2');
    await page.getByLabel('Line 1 price').fill('120.50');
    await page.getByLabel('Tax %').fill('17');
    await expect(page.getByTestId('free-invoice-total')).toContainText('281.97'); // 241.00 + 17% 40.97
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Save this and track who paid' }).click();
    await expect(page).toHaveURL(/#sales/);
    const form = page.getByRole('dialog');
    await expect(form).toBeVisible({ timeout: 20_000 });
    await expect(form.getByText('Logo design').or(form.locator('input[value="Logo design"]'))).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('ledgerflow_free_invoice_draft'))).toBeNull();
  });
}
