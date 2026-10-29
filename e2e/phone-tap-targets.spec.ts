import { test, expect, type Locator } from '@playwright/test';
import { mountJourney } from './support/journeyFixture';

/**
 * A-257(3) (CodeRabbit follow-up on PR #436): on a phone (390 px), the customer and vendor row
 * buttons are real targets — the rendered box measures at least 44 × 44 px and sits whole inside
 * the viewport, not clipped by the table's scroll box. The jsdom companion
 * (src/tests/phone-tap-targets.test.tsx, A-233) can only check the min-h-11/min-w-11 classes;
 * this spec measures the pixels, with one customer and one vendor actually listed.
 */

const WIDTH = 390;

/** The A-233 contract on screen: a real 44 px box, fully visible after its scroll box is scrolled. */
async function expect44px(button: Locator, name: string) {
  await expect(button, `${name} is on the screen`).toHaveCount(1);
  await button.scrollIntoViewIfNeeded();
  await expect(button, `${name} is visible`).toBeVisible();
  const box = await button.boundingBox();
  expect(box, `${name} has a rendered box`).not.toBeNull();
  expect(box!.width, `${name} is at least 44 px wide`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${name} is at least 44 px tall`).toBeGreaterThanOrEqual(44);
  expect(box!.x, `${name} is not clipped on the left`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${name} is not clipped at the top`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${name} is not clipped on the right`).toBeLessThanOrEqual(WIDTH);
  expect(box!.y + box!.height, `${name} is not clipped at the bottom`).toBeLessThanOrEqual(844);
}

test.use({ reducedMotion: 'reduce' });

test('a customer row at 390 px: Enter Invoice, Archive and Delete measure 44 px and are not clipped', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: WIDTH, height: 844 });
  const { errors } = await mountJourney(page, {
    workspaceId: 'tap-targets-customers',
    ledger: {
      customers: [{ id: 'c1', uid: 'journey-user', workspaceId: 'tap-targets-customers', name: 'Acme Corp', status: 'active', email: 'acme@example.test', phone: '', balanceCents: 0 }],
    },
    mounts: [{ module: '/src/components/sales/Sales.tsx' }],
  });
  await page.getByRole('button', { name: 'Customers & Clients', exact: true }).click();
  await expect(page.getByText('Acme Corp', { exact: true }).first()).toBeVisible();
  await expect44px(page.locator('button[title="Enter Invoice"]'), 'Enter Invoice');
  await expect44px(page.getByRole('button', { name: 'Archive Acme Corp', exact: true }), 'Archive Acme Corp');
  await expect44px(page.getByRole('button', { name: 'Delete Acme Corp', exact: true }), 'Delete Acme Corp');
  // the list scrolls inside its own box; the page itself still fits the phone (A-233)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(WIDTH);
  expect(errors).toEqual([]);
});

test('a vendor row at 390 px: Archive and Delete measure 44 px and are not clipped', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: WIDTH, height: 844 });
  const { errors } = await mountJourney(page, {
    workspaceId: 'tap-targets-vendors',
    ledger: {
      vendors: [{ id: 'v1', uid: 'journey-user', workspaceId: 'tap-targets-vendors', name: 'Parts Ltd', status: 'active', category: 'Supplies', email: '', phone: '', balanceCents: 0 }],
    },
    mounts: [{ module: '/src/components/purchases/Purchases.tsx' }],
  });
  await page.getByRole('button', { name: /^Vendors/ }).click();
  await expect(page.getByText('Parts Ltd', { exact: true }).first()).toBeVisible();
  await expect44px(page.getByRole('button', { name: 'Archive Parts Ltd', exact: true }), 'Archive Parts Ltd');
  await expect44px(page.getByRole('button', { name: 'Delete Parts Ltd', exact: true }), 'Delete Parts Ltd');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(WIDTH);
  expect(errors).toEqual([]);
});
