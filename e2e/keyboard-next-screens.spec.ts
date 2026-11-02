import { test, expect, type Locator, type Page } from '@playwright/test';
import { mountJourney } from './support/journeyFixture';

// A-264: real screen modules and stores; mocked API/DB boundary, not live persistence.
const BANK = (workspaceId: string) => ({ id: 'bank-1000', uid: 'journey-user', workspaceId, code: '1000', name: 'Operating Bank', type: 'asset', subtype: 'bank', category: 'Cash' });

/** The product of the element's and every ancestor's opacity: 1 only when a sighted user sees it. */
function effectiveOpacity(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    let opacity = 1;
    let node: HTMLElement | null = el as HTMLElement;
    while (node) {
      opacity *= parseFloat(getComputedStyle(node).opacity || '1');
      node = node.parentElement;
    }
    return opacity;
  });
}

/**
 * Focus a row button the way Tab would land on it, open its dialog with Enter, Tab around inside,
 * close with Escape, and require focus back on the same button.
 */
async function keyboardRoundTrip(page: Page, opener: Locator, dialogName: string, options: { tabs?: number } = {}) {
  await opener.focus();
  await expect(opener, 'the row button takes keyboard focus').toBeFocused();
  const outline = await opener.evaluate((el) => getComputedStyle(el as HTMLElement).outlineStyle);
  expect(outline, 'the focused row button shows a focus ring').not.toBe('none');
  await expect.poll(() => effectiveOpacity(opener), { message: 'the focused row button is visible, not hover-hidden' }).toBe(1);

  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: dialogName });
  await expect(dialog, `Enter opened the “${dialogName}” dialog`).toBeVisible();
  await expect.poll(
    () => dialog.evaluate((d) => d === document.activeElement || d.contains(document.activeElement)),
    { message: 'focus moved into the dialog' },
  ).toBe(true);

  for (let i = 0; i < (options.tabs ?? 6); i++) {
    await page.keyboard.press('Tab');
    const inside = await dialog.evaluate((d) => d === document.activeElement || d.contains(document.activeElement));
    expect(inside, `Tab ${i + 1} keeps focus inside the dialog`).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog, 'Escape closed the dialog').toHaveCount(0);
  await expect(opener, 'focus returned to the row button that opened the dialog').toBeFocused();
}

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  // The discard-changes confirmations are covered elsewhere; here a native confirm, if one appears,
  // accepts so the Escape/focus contract is what is measured.
  page.on('dialog', (d) => { void d.accept(); });
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('A-264 Sales: invoice row → Edit invoice dialog → Escape → focus back on the row', async ({ page }) => {
  test.setTimeout(120_000);
  const workspaceId = 'kbd-sales';
  const { errors } = await mountJourney(page, {
    workspaceId,
    ledger: {
      accounts: [
        BANK(workspaceId),
        { id: 'ar-1100', uid: 'journey-user', workspaceId, code: '1100', name: 'Accounts receivable', type: 'asset', category: 'Receivables' },
        { id: 'rev-4000', uid: 'journey-user', workspaceId, code: '4000', name: 'Consulting revenue', type: 'income', category: 'Revenue' },
      ],
      customers: [{ id: 'cust-acme', uid: 'journey-user', workspaceId, name: 'Acme Corp', status: 'active', email: 'ap@acme.example.test' }],
      invoices: [{
        id: 'inv-1001', uid: 'journey-user', workspaceId, number: '1001', customerId: 'cust-acme', customerName: 'Acme Corp',
        status: 'sent', date: '2026-09-05', dueDate: '2026-10-05', amountCents: 118000, amountPaidCents: 0, currency: 'USD',
        items: [{ id: 'line-1', description: 'Consulting', quantity: 1, rateCents: 118000, amountCents: 118000 }],
      }],
    },
    mounts: [{ module: '/src/components/sales/Sales.tsx' }],
  });
  await expect(page.getByText('Acme Corp', { exact: true }).first()).toBeVisible();
  await keyboardRoundTrip(page, page.getByRole('button', { name: 'Edit invoice 1001', exact: true }), 'Edit invoice 1001');
  expect(errors).toEqual([]);
});

test('A-264 Purchases: bill row → Edit bill dialog → Escape → focus back on the row', async ({ page }) => {
  test.setTimeout(120_000);
  const workspaceId = 'kbd-purchases';
  const { errors } = await mountJourney(page, {
    workspaceId,
    ledger: {
      accounts: [
        BANK(workspaceId),
        { id: 'ap-2000', uid: 'journey-user', workspaceId, code: '2000', name: 'Accounts payable', type: 'liability', category: 'Payables' },
        { id: 'exp-5000', uid: 'journey-user', workspaceId, code: '5000', name: 'Office costs', type: 'expense', category: 'Expenses' },
      ],
      vendors: [{ id: 'vendor-parts', uid: 'journey-user', workspaceId, name: 'Parts Ltd', status: 'active', category: 'Supplies', email: '' }],
      bills: [{
        id: 'bill-2001', uid: 'journey-user', workspaceId, number: '2001', vendorId: 'vendor-parts', vendorName: 'Parts Ltd',
        status: 'pending', date: '2026-09-08', dueDate: '2026-09-20', amountCents: 42000, amountPaidCents: 0, currency: 'USD',
        items: [{ id: 'line-1', description: 'Widgets', quantity: 1, rateCents: 42000, amountCents: 42000, accountId: 'exp-5000' }],
      }],
    },
    mounts: [{ module: '/src/components/purchases/Purchases.tsx' }],
  });
  await expect(page.getByText('Parts Ltd', { exact: true }).first()).toBeVisible();
  await keyboardRoundTrip(page, page.getByRole('button', { name: 'Edit bill 2001', exact: true }), 'Edit bill 2001');
  expect(errors).toEqual([]);
});


for (const side of ['customer', 'vendor'] as const) {
  test(`A-264 ${side}: row details → edit dialog → Escape → Back returns to remounted row`, async ({ page }) => {
    test.setTimeout(120_000);
    const customer = side === 'customer';
    const plural = customer ? 'Customers' : 'Vendors';
    const { errors } = await mountJourney(page, {
      workspaceId: `kbd-${side}`, ledger: {
        [customer ? 'customers' : 'vendors']: [{ id: 'contact-1', name: 'Acme אבג', email: 'acme@example.test', status: 'active', balanceCents: 0 }],
      },
      mounts: [{ module: customer ? '/src/components/sales/Sales.tsx' : '/src/components/purchases/Purchases.tsx' }],
    });
    const tab = customer ? page.getByRole('button', { name: 'Customers & Clients', exact: true })
      : page.getByRole('button', { name: /^Vendors/ });
    await tab.focus();
    await tab.press('Enter');
    const opener = page.getByRole('button', { name: `View ${side} Acme אבג`, exact: true });
    await opener.focus();
    await expect(opener).toBeFocused();
    await opener.press('Enter');
    const back = page.getByRole('button', { name: `Back to ${plural}`, exact: true });
    await expect(back).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Acme אבג', exact: true })).toBeVisible();
    await keyboardRoundTrip(page, page.getByRole('button', { name: `Edit ${side}`, exact: true }), customer ? 'Edit Customer' : 'Edit Vendor', { tabs: 8 });
    await back.focus();
    await back.press('Enter');
    await expect(opener).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test('A-264 Items: row → Edit item → keyboard inside → Escape → row focus restored', async ({ page }) => {
  test.setTimeout(120_000);
  const { errors } = await mountJourney(page, { workspaceId: 'kbd-items', ledger: {}, mounts: [] });
  // Inventory owns a live collection rather than reading the store's inventory cache.
  await page.route('**/rest/v1/inventory**', route => route.fulfill({ json: [{
    id: 'item-1', workspace_id: 'kbd-items', data: {
      workspaceId: 'kbd-items', uid: 'journey-user', name: 'Blue widget', sku: 'W-1', category: 'General',
      quantityAtHand: 0, unitCostCents: 100, unitPriceCents: 200,
    },
  }] }));
  await page.evaluate(async () => {
    await (window as unknown as { __journeyRender: (mounts: unknown[]) => Promise<void> }).__journeyRender([
      { module: '/src/components/inventory/Inventory.tsx' },
    ]);
  });
  await keyboardRoundTrip(page, page.getByRole('button', { name: 'Edit item Blue widget', exact: true }), 'Edit Inventory Item', { tabs: 8 });
  expect(errors).toEqual([]);
});
