import { expect, type Page } from '@playwright/test';

/** Follow the user-facing discovery route for non-daily screens; no private store/URL shortcut. */
export async function openTool(page: Page, name: string) {
  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  const summary = nav.locator('summary').filter({ hasText: 'Show all tools' });
  if (!await summary.isVisible()) {
    const expand = nav.getByRole('button', { name: 'Show all tools', exact: true });
    if (await expand.isVisible()) await expand.click();
    else await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
  }
  const input = nav.getByLabel('Find a tool');
  if (!await input.isVisible()) await summary.click();
  await input.fill(name);
  const target = nav.getByRole('navigation', { name: 'All tools', exact: true }).getByRole('button', { name, exact: true });
  await expect(target).toBeVisible();
  await target.click();
}
