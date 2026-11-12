import { test, expect } from '@playwright/test';
import { mountJourney } from './support/journeyFixture';

test('N-1 first-week checklist fits desktop and mobile and records the report visit', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const workspaceId = 'n1-e2e';
  const { errors } = await mountJourney(page, {
    workspaceId,
    ledger: { accounts: [], customers: [], invoices: [], payments: [] },
    mounts: [{ module: '/src/components/dashboard/FirstWeekChecklist.tsx' }],
  });

  const checklist = page.getByRole('region', { name: 'Your first week' });
  await expect(checklist).toBeVisible();
  await expect(checklist.getByRole('listitem')).toHaveCount(5);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const button of await checklist.getByRole('button').all()) {
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      expect(box, 'every checklist action has a visible box').not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }

  await checklist.getByRole('button', { name: 'Open profit and loss' }).click();
  expect(await page.evaluate(async () => (await import('/src/stores/useUIStore.ts')).useUIStore.getState().activeReportTab)).toBe('pnl');
  expect(await page.evaluate(() => localStorage.getItem('lf_first_week_v1:journey-user:n1-e2e:pnl'))).toBe('visited');

  await checklist.getByRole('button', { name: 'Hide first-week checklist' }).click();
  await expect(page.getByRole('region', { name: 'Your first week' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
