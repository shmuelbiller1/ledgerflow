import { test, expect } from '@playwright/test';
import { mountJourney, captured } from './support/journeyFixture';
for (const width of [390, 1280]) {
  test(`EU-B4 contact defaults ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mountJourney(page, { workspaceId: 'eu-defaults', ledger: { accounts: [{ id: 'sales', code: '4000', name: 'Sales', type: 'income' }] }, mounts: [{ module: '/src/components/common/PartyModal.tsx', props: { side: 'customer', isOpen: true, onSave: '__capture:save' } }] });
    await expect(page.getByRole('group', { name: 'Document defaults' })).toBeVisible();
    await page.getByLabel('Default account', { exact: true }).selectOption('sales');
    await page.getByLabel('Customer Name', { exact: true }).fill('Client');
    await page.getByRole('button', { name: 'Save Customer', exact: true }).click();
    await expect.poll(async () => captured(page, 'save')).toContainEqual([expect.objectContaining({ name: 'Client', metadata: { documentDefaults: { accountId: 'sales' } } })]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const width of [390, 1280]) {
  test(`EU-B4 vendor history suggestion is explicit and preserves draft ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const accounts = [{ id: 'exp', code: '5000', name: 'Supplies', type: 'expense' }, { id: 'other', code: '5001', name: 'Other', type: 'expense' }];
    const bills = [1, 2, 3].map(n => ({ id: `b${n}`, vendorId: 'v', date: `2026-01-0${n}`, status: 'paid', splits: [{ accountId: 'exp', amountCents: 999, dimensions: { project: 'Job A' } }] }));
    const handle = await mountJourney(page, { workspaceId: 'eu-history', ledger: { bills, accounts }, mounts: [{ module: '/src/components/purchases/BillModal.tsx', props: { isOpen: true, vendors: [{ id: 'v', name: 'Vendor' }], accounts, onSave: '__capture:bill' } }] });
    await page.getByLabel('Vendor', { exact: true }).selectOption('v');
    await expect(page.getByLabel('Expense Account', { exact: true })).toHaveValue('');
    await expect(page.getByText(/Three latest loaded bills agree/)).toBeVisible();
    await page.getByRole('button', { name: 'Use suggested account and labels' }).click();
    await expect(page.getByLabel('Expense Account', { exact: true })).toHaveValue('exp');
    await page.getByLabel('Expense Account', { exact: true }).selectOption('other');
    await page.getByLabel('Description', { exact: true }).fill('Typed expense');
    await page.getByLabel(/^Amount \(/).fill('12.34');
    await page.getByRole('button', { name: 'Use suggested account and labels' }).click();
    await expect(page.getByLabel('Expense Account', { exact: true })).toHaveValue('other');
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await expect.poll(async () => captured(page, 'bill')).toContainEqual([expect.objectContaining({ splits: [expect.objectContaining({ accountId: 'other', description: 'Typed expense', amountCents: 1234, dimensions: { project: 'Job A' } })] })]);
    expect(handle.errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
