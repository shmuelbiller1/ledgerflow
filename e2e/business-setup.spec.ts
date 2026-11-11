import { test, expect } from '@playwright/test';
import { mountJourney, remountJourney } from './support/journeyFixture';

for (const width of [390, 1280]) {
  test(`EU-A2 business type comes first ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const journey = await mountJourney(page, { workspaceId: 'business-setup', ledger: {}, mounts: [{ module: '/src/components/onboarding/SetupWizard.tsx', props: { onStarted: '__fn:noop', onDone: '__fn:noop' } }] });
    await expect(page.getByRole('heading', { name: 'What kind of business?' })).toBeVisible();
    await page.getByLabel('Property', { exact: true }).check();
    await expect(page.getByText('Property and Unit', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Setup steps')).not.toContainText('Opening balances');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByLabel('Real Estate', { exact: false })).toBeChecked();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your books are set up' })).toBeVisible();
    expect(journey.requests.some(r => r.url.endsWith('/setup-complete'))).toBe(true);
    expect(journey.requests.some(r => r.url.endsWith('/opening-balances'))).toBe(false);
    await page.getByRole('button', { name: 'Go to Overview' }).click();
    await remountJourney(page, [{ module: '/src/components/Dashboard.tsx' }]);
    await expect(page.getByRole('heading', { name: "Bring in last year's numbers" })).toBeVisible();
    await page.getByRole('button', { name: 'Add opening balances' }).click();
    await expect(page.getByRole('heading', { name: 'Opening balances' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add opening balances' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
