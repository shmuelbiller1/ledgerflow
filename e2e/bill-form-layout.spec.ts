import { test, expect } from '@playwright/test';
import { mountJourney, captured, settleStyles } from './support/journeyFixture';

/**
 * D-87, the bill form, the same rules as the invoice form (D-86):
 * labels above their fields, a refusal under the field that caused it, Save in the same place
 * whatever the scroll position, and a phone layout that never scrolls sideways.
 */
for (const width of [390, 1280]) {
  for (const dark of [false, true]) {
    test(`D-87 bill: ${width}px ${dark ? 'dark' : 'light'} fields, errors and fixed save`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      // Warm the app entry so Vite has discovered React's client entry on a cold cache.
      await page.goto('/');
      await page.waitForFunction(() => Boolean(document.getElementById('root')?.childElementCount));
      const { errors } = await mountJourney(page, {
        workspaceId: 'd87-bill', ledger: {
          vendors: [{ id: 'v1', name: 'Paper Co', workspaceId: 'd87-bill' }],
          accounts: [{ id: 'exp', name: 'Office supplies', type: 'expense', category: 'Expenses', workspaceId: 'd87-bill' }],
          inventory: [{ id: 'chair', name: 'Chair', itemType: 'product', quantityAtHand: 2, unitCostCents: 1000, workspaceId: 'd87-bill' }],
        },
        mounts: [{ module: '/src/components/purchases/BillModal.tsx', props: {
          isOpen: true, vendors: [{ id: 'v1', name: 'Paper Co' }], accounts: [{ id: 'exp', name: 'Office supplies', type: 'expense' }], onSave: '__capture:save',
        } }],
      });
      await page.evaluate(dark => {
        document.documentElement.classList.toggle('light', !dark);
        document.documentElement.classList.toggle('dark', dark);
      }, dark);
      const dialog = page.getByRole('dialog', { name: 'Record New Bill', exact: true });
      await expect(dialog).toBeVisible();
      await settleStyles(page);
      await testInfo.attach('bill-form', { body: await page.screenshot({ path: testInfo.outputPath(`bill-${width}-${dark ? 'dark' : 'light'}.png`) }), contentType: 'image/png' });

      // labels sit above their controls, not beside them
      const labelAbove = async (label: string, id: string) => {
        const box = await page.locator(`label[for="${id}"]`).filter({ hasText: label }).boundingBox();
        const field = await page.locator(`#${id}`).boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(field!.y + 1);
      };
      await page.locator('summary').filter({ hasText: 'More options' }).click();
      for (const [label, id] of [['Vendor', 'bill-vendor'], ['Bill Number', 'bill-number'], ['Bill Date', 'bill-date'], ['Due Date', 'bill-due-date']]) {
        await labelAbove(label, id);
      }

      // Save stays where it is while the form scrolls
      const save = dialog.getByRole('button', { name: 'Save & Close', exact: true });
      await expect(save).toBeInViewport();
      const before = await save.boundingBox();
      await page.locator('form').evaluate(form => { form.scrollTop = form.scrollHeight; });
      const after = await save.boundingBox();
      expect(after?.y).toBe(before?.y);
      await expect(save).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      // a bill without its vendor is refused under the vendor field, and nothing is saved
      await save.click();
      await expect(page.locator('#bill-vendor')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#bill-vendor-error')).toBeVisible();
      expect(await captured(page, 'save')).toHaveLength(0);
      await page.getByLabel('Vendor', { exact: true }).selectOption('v1');
      await expect(page.locator('#bill-vendor-error')).toHaveCount(0);

      // a stock line without its units is refused under the units field and focuses it
      await page.locator('#bill-split-desc-0').fill('Chairs');
      await page.locator('#bill-split-acc-0').selectOption('exp');
      await page.locator('#bill-split-amount-0').fill('12.50');
      await page.getByLabel('Stock item on line 1').selectOption('chair');
      await save.click();
      await expect(page.locator('#bill-split-units-0-error')).toHaveText('Enter how many units came in');
      await expect(page.locator('#bill-split-units-0')).toBeFocused();
      expect(await captured(page, 'save')).toHaveLength(0);

      // the phone controls are big enough to hit
      for (const selector of ['button[aria-label="Close"]', 'button[aria-label="Remove split line 1"]', '#bill-split-units-0', '#bill-split-amount-0']) {
        const box = await page.locator(selector).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }

      // the units come in with the bill, at the worked amount
      await page.locator('#bill-split-units-0').fill('2');
      await expect(page.locator('#bill-split-units-0-error')).toHaveCount(0);
      await save.click();
      await expect.poll(async () => (await captured(page, 'save')).length).toBe(1);
      const [saved] = (await captured(page, 'save'))[0] as [Record<string, unknown>];
      expect(saved).toMatchObject({ vendorId: 'v1', status: 'pending', amountCents: 1250, lineSumCents: 1250 });
      expect((saved.splits as Array<Record<string, unknown>>)[0]).toMatchObject({ itemId: 'chair', quantity: 2, amountCents: 1250 });
      expect(errors).toEqual([]);
    });
  }
}
