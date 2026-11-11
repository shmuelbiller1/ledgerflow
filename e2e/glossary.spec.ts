import { test, expect } from '@playwright/test';

/** C-97: the registered glossary screen is reachable and useful in a guest browser. */
test('accounting glossary: bilingual search and recovery from no matches', async ({ page }) => {
  const tab = 'glossary';
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
  });
  await page.goto(`/#${tab}`);
  await expect(page.getByRole('heading', { name: 'Accounting glossary' })).toBeVisible();
  const termCount = page.getByText(/36 of 36 terms shown/);
  await expect(termCount).toBeVisible();

  const search = page.getByLabel('Search English or Hebrew');
  await search.fill('מלאי');
  await expect(page.getByRole('main', { name: 'Accounting glossary', exact: true }).getByText('Inventory', { exact: true })).toBeVisible();
  await search.fill('not-a-term');
  await expect(page.getByText('No glossary terms match your search')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByText(/36 of 36 terms shown/)).toBeVisible();
});
