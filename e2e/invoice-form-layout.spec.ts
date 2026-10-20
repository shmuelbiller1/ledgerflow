import { test, expect } from '@playwright/test';
import { mountJourney, captured, settleStyles } from './support/journeyFixture';

for (const width of [390, 1280]) {
  for (const dark of [false, true]) {
    test(`D-86 invoice: ${width}px ${dark ? 'dark' : 'light'} fields, errors and fixed save`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      // Warm the app entry so Vite has discovered React's client entry on a cold cache.
      await page.goto('/');
      await page.waitForFunction(() => Boolean(document.getElementById('root')?.childElementCount));
      const { errors } = await mountJourney(page, {
        workspaceId: 'd86-invoice', ledger: {},
        mounts: [{ module: '/src/components/sales/InvoiceModal.tsx', props: {
          isOpen: true, customers: [], accounts: [], onSave: '__capture:save',
        } }],
      });
      await page.evaluate(dark => {
        document.documentElement.classList.toggle('light', !dark);
        document.documentElement.classList.toggle('dark', dark);
      }, dark);
      const dialog = page.getByRole('dialog', { name: 'New invoice', exact: true });
      await expect(dialog).toBeVisible();
      await settleStyles(page);
      await testInfo.attach('invoice-form', { body: await page.screenshot({ path: testInfo.outputPath(`invoice-${width}-${dark ? 'dark' : 'light'}.png`) }), contentType: 'image/png' });
      const save = dialog.getByRole('button', { name: 'Save & Close', exact: true });
      await expect(save).toBeInViewport();
      const before = await save.boundingBox();
      await save.click();
      await expect(page.locator('#inv-customer')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#inv-customer-error')).toBeVisible();
      expect(await captured(page, 'save')).toHaveLength(0);
      await page.getByLabel('Customer', { exact: true }).fill('לקוח Example');
      await expect(page.locator('#inv-customer-error')).toHaveCount(0);
      await page.locator('#inv-deposit').fill('1');
      await save.click();
      await expect(page.locator('#inv-deposit-error')).toHaveText("The deposit can't be more than the invoice total");
      await expect(page.locator('#inv-deposit')).toBeFocused();
      expect(await captured(page, 'save')).toHaveLength(0);
      await page.locator('#inv-deposit').fill('0');
      await page.locator('#inv-item-qty-0').fill('-1');
      await save.click();
      await expect(page.locator('#inv-item-qty-0-error')).toBeVisible();
      expect(await captured(page, 'save')).toHaveLength(0);
      await page.locator('#inv-item-qty-0').fill('2');
      await page.locator('#inv-item-rate-0').fill('12.50');
      await page.locator('#inv-email-subject').scrollIntoViewIfNeeded();
      const after = await save.boundingBox();
      expect(after?.y).toBe(before?.y);
      await expect(save).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const selector of ['#inv-item-qty-0', '#inv-item-rate-0', 'button[aria-label="Remove line 1"]']) {
        const box = await page.locator(selector).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await save.click();
      await expect.poll(async () => (await captured(page, 'save')).length).toBe(1);
      expect((await captured(page, 'save'))[0][0]).toMatchObject({ amountCents: 2500, status: 'pending', customerName: 'לקוח Example' });
      expect(errors).toEqual([]);
    });
  }
}
