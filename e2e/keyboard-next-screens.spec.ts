import { test, expect } from '@playwright/test';
import { keyboardRoundTrip } from './support/keyboardRoundTrip';
import { mountJourney } from './support/journeyFixture';

// A-264: customer/vendor/item paths; invoice/bill round trips remain in keyboard-busy-screens.spec.ts.
// Real screen modules/stores with mocked API/DB boundaries, not live persistence.
test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  // The discard-changes confirmations are covered elsewhere; here a native confirm, if one appears,
  // accepts so the Escape/focus contract is what is measured.
  page.on('dialog', (d) => { void d.accept(); });
  await page.setViewportSize({ width: 1280, height: 900 });
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
