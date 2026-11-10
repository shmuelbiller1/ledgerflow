import { test, expect } from "@playwright/test";
import { mountJourney, captured, settleStyles } from "./support/journeyFixture";

for (const width of [390, 1280])
  for (const dark of [false, true]) {
    test(`EU-B2 short invoice and bill ${width}px ${dark ? "dark" : "light"}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const side of ["invoice", "bill"] as const) {
        await mountJourney(page, {
          workspaceId: `eu-b2-${side}`,
          ledger: {},
          mounts: [
            {
              module:
                side === "invoice"
                  ? "/src/components/sales/InvoiceModal.tsx"
                  : "/src/components/purchases/BillModal.tsx",
              props: {
                isOpen: true,
                customers: [],
                vendors: [],
                accounts: [],
                onSave: "__capture:save",
              },
            },
          ],
        });
        await page.evaluate((dark) => {
          document.documentElement.classList.toggle("dark", dark);
          document.documentElement.classList.toggle("light", !dark);
        }, dark);
        const details = page
          .locator("details")
          .filter({
            has: page.locator("summary", { hasText: "More options" }),
          });
        await expect(details).toHaveCount(1);
        await expect(details).not.toHaveAttribute("open");
        const prefix = side === "invoice" ? "inv" : "bill";
        const mainField = side === "invoice" ? "customer" : "vendor";
        for (const id of [mainField, "date", "due-date", "tax-code"])
          await expect(page.locator(`#${prefix}-${id}`)).toBeVisible();
        await expect(page.locator(`#${prefix}-number`)).toBeHidden();
        const summary = details.locator("summary");
        await summary.focus();
        await summary.press("Enter");
        await expect(details).toHaveAttribute("open");
        await expect(page.locator(`#${prefix}-number`)).toBeVisible();
        await expect(page.locator(`#${prefix}-memo`)).toBeVisible();
        await settleStyles(page);
        const box = (await summary.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        await summary.press("Enter");
        await expect(details).not.toHaveAttribute("open");
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(await captured(page, "save")).toHaveLength(0);
      }
    });
  }

for (const side of ['invoice', 'bill'] as const) {
  test(`EU-B2 ${side} validation reveals options, remembers display choice and keeps payload`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const options = {
      workspaceId: `eu-b2-save-${side}`, ledger: {},
      mounts: [{ module: side === 'invoice' ? '/src/components/sales/InvoiceModal.tsx' : '/src/components/purchases/BillModal.tsx', props: {
        isOpen: true, customers: [{ id: 'c1', name: 'Client' }], vendors: [{ id: 'v1', name: 'Supplier' }],
        accounts: [{ id: 'exp', name: 'Supplies', type: 'expense' }], onSave: '__capture:save',
      } }],
    };
    await mountJourney(page, options);
    const details = page.locator('details');
    const summary = details.locator('summary');
    const prefix = side === 'invoice' ? 'inv' : 'bill';
    if (side === 'invoice') await page.locator('#inv-customer').fill('Client');
    else await page.locator('#bill-vendor').selectOption('v1');
    await summary.click();
    await page.locator(`#${prefix}-number`).fill('');
    await summary.click();
    const save = page.getByRole('button', { name: 'Save & Close', exact: true });
    await save.click();
    await expect(details).toHaveAttribute('open');
    await expect(page.locator(`#${prefix}-number`)).toBeFocused();
    expect(await captured(page, 'save')).toHaveLength(0);
    await page.locator(`#${prefix}-number`).fill('CUSTOM-17');
    await page.locator(`#${prefix}-memo`).fill('Keep this note');
    if (side === 'invoice') {
      await page.locator('#inv-item-desc-0').fill('Consulting');
      await page.locator('#inv-item-rate-0').fill('100');
      await page.locator('#inv-deposit').fill('120');
      await summary.click();
      await save.click();
      await expect(details).toHaveAttribute('open');
      await expect(page.locator('#inv-deposit')).toBeFocused();
      await expect(page.locator('#inv-deposit-error')).toHaveText("The deposit can't be more than the invoice total");
      expect(await captured(page, 'save')).toHaveLength(0);
      await page.locator('#inv-deposit').fill('20');
      await page.locator('#inv-retainage').fill('5');
      await page.locator('#inv-terms').fill('Keep these terms');
    } else {
      await page.locator('#bill-split-desc-0').fill('Supplies');
      await page.locator('#bill-split-acc-0').selectOption('exp');
      await page.locator('#bill-split-amount-0').fill('100');
    }
    await summary.click();
    await expect(details).not.toHaveAttribute('open');
    await save.click();
    await expect.poll(async () => (await captured(page, 'save')).length).toBe(1);
    const [saved] = (await captured(page, 'save'))[0] as [Record<string, unknown>];
    expect(saved).toMatchObject({ number: 'CUSTOM-17', amountCents: 10000, currency: 'USD', metadata: { memo: 'Keep this note' } });
    if (side === 'invoice') expect(saved).toMatchObject({ customerId: 'c1', depositCents: 2000, retainageCents: 500, metadata: { terms: 'Keep these terms' } });
    else expect(saved).toMatchObject({ vendorId: 'v1', splits: [{ amountCents: 10000, description: 'Supplies', accountId: 'exp' }] });
    await summary.click();
    await mountJourney(page, options);
    await expect(page.locator('details')).toHaveAttribute('open');
    await page.locator('summary').click();
    await mountJourney(page, options);
    await expect(page.locator('details')).not.toHaveAttribute('open');
  });
}
