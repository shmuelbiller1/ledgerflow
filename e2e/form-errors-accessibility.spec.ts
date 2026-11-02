import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mountJourney, captured, type JourneyMount } from './support/journeyFixture';

const accounts = [
  { id: 'cash', code: '1000', name: 'Cash', type: 'asset', category: 'Cash' },
  { id: 'expense', code: '5000', name: 'Expense', type: 'expense', category: 'Expenses' },
];
const forms: Array<{ name: string; mount: JourneyMount; field: string; save: string; value: string }> = [
  { name: 'invoice', mount: { module: '/src/components/sales/InvoiceModal.tsx', props: { isOpen: true, accounts, customers: [], onSave: '__capture:save' } }, field: '#inv-customer', save: 'Save & Close', value: 'Customer Example' },
  { name: 'bill', mount: { module: '/src/components/purchases/BillModal.tsx', props: { isOpen: true, accounts, vendors: [{ id: 'vendor', name: 'Vendor Example' }], initialBill: { number: 'B-TEST' }, onSave: '__capture:save' } }, field: '#bill-vendor', save: 'Save & Close', value: 'vendor' },
  { name: 'contact', mount: { module: '/src/components/common/PartyModal.tsx', props: { isOpen: true, side: 'customer', onSave: '__capture:save' } }, field: '[name="partyName"]', save: 'Save Customer', value: 'Contact Example' },
  { name: 'item', mount: { module: '/src/components/inventory/InventoryItemDialog.tsx', props: { open: true, editingItem: null, categories: [], canChangeStock: false, onSubmit: '__capture:save', onAdjust: '__fn:noop' } }, field: '#inv-item-name', save: 'Add to Inventory', value: 'Item Example' },
  { name: 'journal', mount: { module: '/src/components/ledger/JournalEntryModal.tsx', props: { isOpen: true, workspaceId: 'a267-forms', accounts, user: { uid: 'journey-user' }, initialEntry: { description: 'Journal Example', lines: [{ accountId: 'cash', debit: 100, credit: 0 }, { accountId: 'expense', debit: 0, credit: 100 }] } } }, field: '#je-fx-rate', save: 'COMMIT TO LEDGER', value: '1.25' },
];

test.use({ reducedMotion: 'reduce' });
test.setTimeout(60_000);
for (const width of [390, 1280]) for (const form of forms) {
  test(`A-267 ${form.name}: keyboard submit, linked error and correction at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => Boolean(document.getElementById('root')?.childElementCount));
    const { errors, requests } = await mountJourney(page, { workspaceId: 'a267-forms', ledger: { accounts }, mounts: [form.mount] });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Exercise the journal's existing rejection, without changing which drafts can be posted.
    if (form.name === 'journal') {
      await dialog.locator('#je-currency').selectOption('EUR');
      await expect(dialog.locator('#je-fx-rate')).toHaveValue('');
    }
    const save = dialog.getByRole('button', { name: form.save, exact: true });
    const field = dialog.locator(form.field);
    await save.focus(); await page.keyboard.press('Enter');
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    const described = (await field.getAttribute('aria-describedby'))!.split(/\s+/);
    const linked = await field.evaluate(el => (el.getAttribute('aria-describedby') || '').split(/\s+/).map(id => {
      const node = document.getElementById(id);
      return { exists: Boolean(node), role: node?.getAttribute('role'), text: node?.textContent };
    }));
    expect(linked.length).toBeGreaterThan(0);
    expect(linked.every(node => node.exists)).toBe(true);
    const errorText = linked.find(node => node.role === 'alert')?.text;
    expect(errorText?.trim()).toBeTruthy();
    expect(await captured(page, 'save')).toHaveLength(0);
    expect(requests.filter(request => /\/transactions(?:\/bulk)?$/.test(new URL(request.url).pathname))).toHaveLength(0);
    await expect(field).toHaveAccessibleDescription(new RegExp(errorText!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    // Focused axe gate: field naming and ARIA relationships, not a whole-product WCAG claim.
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withRules([
      'aria-valid-attr', 'aria-valid-attr-value', 'aria-allowed-attr', 'aria-input-field-name', 'label', 'duplicate-id-aria',
    ]).analyze();
    await testInfo.attach('field-error-axe', { body: JSON.stringify(axe, null, 2), contentType: 'application/json' });
    expect(axe.violations).toEqual([]);
    await page.keyboard.press('Tab');
    expect(await field.evaluate(el => el.closest('[role="dialog"]')?.contains(document.activeElement))).toBe(true);
    if (form.name === 'bill') await field.selectOption(form.value);
    else await field.fill(form.value);
    await expect(field).not.toHaveAttribute('aria-invalid', 'true');
    for (const id of described) expect(await page.evaluate(id => document.getElementById(id)?.getAttribute('role') === 'alert', id)).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('A-267 contact: whitespace and malformed email errors are corrected and saved', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.childElementCount));
  await mountJourney(page, { workspaceId: 'a267-contact', ledger: {}, mounts: [forms[2].mount] });
  const dialog = page.getByRole('dialog');
  const name = dialog.locator('[name="partyName"]');
  const save = dialog.getByRole('button', { name: 'Save Customer', exact: true });
  await name.fill('   ');
  await save.focus(); await page.keyboard.press('Enter');
  await expect(name).toBeFocused();
  await expect(name).toHaveAccessibleDescription('Enter a name, not just spaces.');
  expect(await captured(page, 'save')).toHaveLength(0);
  await name.fill(' Contact Example ');
  const email = dialog.getByLabel('Email Address', { exact: true });
  await email.fill('not-an-email');
  await save.focus(); await page.keyboard.press('Enter');
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await email.fill('contact@example.test');
  await save.focus(); await page.keyboard.press('Enter');
  await expect.poll(async () => (await captured(page, 'save')).length).toBe(1);
  expect((await captured(page, 'save'))[0][0]).toMatchObject({ name: 'Contact Example', email: 'contact@example.test' });
});

test('A-267 journal: an unassigned second line focuses that account, not the valid first one', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.childElementCount));
  const journal = forms[4].mount;
  await mountJourney(page, { workspaceId: 'a267-forms', ledger: { accounts }, mounts: [{ ...journal, props: {
    ...journal.props, initialEntry: { description: 'Unassigned line', lines: [{ accountId: 'cash', debit: 100, credit: 0 }, { accountId: '', debit: 0, credit: 100 }] },
  } }] });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'COMMIT TO LEDGER', exact: true }).focus();
  await page.keyboard.press('Enter');
  const missing = dialog.locator('#je-line-acc-1');
  await expect(missing).toBeFocused();
  await expect(missing).toHaveAccessibleDescription('At least two lines with account assignments are required for double-entry.');
  await expect(dialog.locator('#je-line-acc-0')).not.toHaveAttribute('aria-invalid', 'true');
  await missing.fill('5000 - Expense');
  await expect(missing).not.toHaveAttribute('aria-invalid', 'true');
});
