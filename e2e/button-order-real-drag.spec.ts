import { test, expect } from '@playwright/test';

/** EU-X1: exercise the actual pointer handlers and browser geometry, not synthetic rectangles. */
test('real pointer drag reorders All tools and persists after reload', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
    localStorage.setItem('has_seen_onboarding', 'true');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest', exact: true }).click();
  await page.getByText('Show all tools', { exact: true }).click();
  const list = page.getByRole('navigation', { name: 'All tools' });
  const items = list.locator('[data-reorder-item]');
  await expect(items.first()).toBeVisible();
  const before = await items.allTextContents();
  expect(before.length).toBeGreaterThan(2);
  const source = items.nth(0);
  const target = items.nth(2);
  const a = await source.boundingBox();
  const b = await target.boundingBox();
  if (!a || !b) throw new Error('All-tools buttons must have rendered geometry');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 14, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => items.allTextContents()).not.toEqual(before);
  const moved = await items.allTextContents();
  await page.reload();
  await page.getByRole('button', { name: 'Continue as Guest', exact: true }).click();
  await page.getByText('Show all tools', { exact: true }).click();
  await expect.poll(async () => items.allTextContents()).toEqual(moved);
  expect(await page.locator('[data-reorder-item]').count()).toBeGreaterThan(2);
});

test('Escape cancels an active drag and releasing does not activate the tool', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => { localStorage.setItem('ledgerflow-cookie-consent', 'accepted'); localStorage.setItem('has_seen_onboarding', 'true'); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest', exact: true }).click();
  await page.getByText('Show all tools', { exact: true }).click();
  const items = page.getByRole('navigation', { name: 'All tools' }).locator('[data-reorder-item]');
  const original = await items.allTextContents();
  const first = items.first();
  const box = await first.boundingBox();
  if (!box) throw new Error('First tool must have rendered geometry');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 16);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await items.allTextContents()).toEqual(original);
  await expect(page.getByRole('heading', { name: original[0]!, exact: true })).toHaveCount(0);
});
