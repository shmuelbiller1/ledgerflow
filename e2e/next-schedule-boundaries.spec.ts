import { test, expect } from '@playwright/test';
import { installSmallSample } from './helpers/sampleFixture';
import { nextScheduleIds } from './support/nextSchedules';
import { openNextSchedule } from './support/nextScheduleFixture';
import { downloadAt, pressAt } from './support/comparisonReportFixture';
import { setLedgerField } from './support/journeyFixture';

// A direct component fixture must not be the only route to the report. Start from the real shell.
for (const start of [0, 5, 10, 15, 20]) {
  const group = nextScheduleIds.slice(start, start + 5);
  test(`Reports opens ${group.join(', ')}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 850 });
    await page.addInitScript(() => { localStorage.setItem('isGuest', 'true'); localStorage.setItem('has_seen_onboarding', 'true'); });
    await installSmallSample(page);
    for (const id of group) {
      await page.goto(`/?report=${id}&start=2026-02-01&end=2026-02-28#reports`);
      await expect(page.locator(`[data-report-view="${id}"]`).getByRole('heading').first(), id).toBeVisible();
    }
  });
}

test('changing valuation day changes booked stock, not the separate lot receipt or sold reference', async ({ page }) => {
  const { errors } = await openNextSchedule(page, 'stock-value-by-location-lot', 1280, 'light');
  const location = page.getByRole('table', { name: 'Value by location' });
  const lots = page.getByRole('table', { name: 'Value by lot' });
  const date = page.getByLabel('As of', { exact: true });
  await date.fill('2026-02-03');
  await expect(location.locator('tfoot tr').first()).toContainText('$22.50');
  await expect(location.locator('tbody tr').first().getByRole('cell')).toHaveText(['No location', '3', '$22.50', '$7.50']);
  await expect(lots.locator('tbody tr').first().getByRole('cell')).toContainText(['Valve', '2027', '6', '$45.00', '$7.50', 'GR-12', '4']);
  const csv = page.getByRole('button', { name: 'Download CSV' });
  await date.fill(''); await expect(location).toHaveCount(0); await expect(csv.first()).toBeDisabled(); await expect(csv.last()).toBeEnabled();
  await date.fill('2026-02-28'); await expect(location.locator('tfoot tr').first()).toContainText('$37.50');
  await setLedgerField(page, 'isDataTruncated', true); await expect(csv.first()).toBeDisabled(); await expect(csv.last()).toBeDisabled();
  expect(errors).toEqual([]);
});

test('the credit limit is editable for the accountant, not the viewer; a displayed CSV cannot export a live edit', async ({page}) => {
  const { errors, requests } = await openNextSchedule(page, 'customer-credit-limits', 1280, 'light');
  const edit = page.getByRole('button', { name: /credit limit of/i });
  await expect(edit).toHaveCount(0);
  await pressAt(page, page.getByRole('button', { name: 'Columns', exact: true }));
  const displayed = page.getByRole('button', { name: /Export displayed rows/ });
  const csv = await downloadAt(page, displayed);
  expect(csv.rows[1]).toContain('$70.00');
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    useAuthStore.setState(s => ({ workspaces: s.workspaces.map(w => ({...w, roles: { ...w.roles, [s.user!.uid]: 'accountant' }})) }));
  });
  await expect(displayed).toHaveCount(0);
  await pressAt(page, edit); await page.keyboard.press('Escape');
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});
