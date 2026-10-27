import { test, expect, type Page } from '@playwright/test';

/**
 * #274 §2, in a real browser. The manager's overlay was `z-50` while the sidebar is `z-[100]`, so at
 * 1280 px the sidebar covered the dialog's title and Close button; and the panel painted with
 * `--surface-card` / `--surface-elevated` / `--text-muted` / `--line-strong`, none of which the theme
 * declares, so it painted nothing and the dark ledger showed through.
 *
 * The unit suite checks the classes and the token list; these two tests check what a person sees.
 */
async function openManager(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
  });
  await page.goto('/');
  await page.waitForSelector('text="Overview"', { timeout: 15000 });
  const cookies = page.getByRole('button', { name: 'Essential Only' });
  if (await cookies.isVisible()) await cookies.click();
  await page.getByRole('button', { name: /Manage All Views/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Saved Views & Default Lenses' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('the manager sits above the sidebar: the panel is the topmost thing where they overlap', async ({ page }) => {
  const dialog = await openManager(page);
  const panel = dialog.locator('> div').first();
  const panelBox = (await panel.boundingBox())!;
  const titleBox = (await dialog.getByRole('heading', { name: 'Saved Views & Default Lenses' }).boundingBox())!;
  // 1280 px: the 896 px panel starts at x≈192 and the sidebar is 240 px wide, so the panel's left
  // strip is exactly where the sidebar used to sit on top of the dialog (the reported "title and
  // Close button hard to see near the navigation").
  const topmost = await page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return { inDialog: Boolean(element?.closest('[role="dialog"]')), text: (element?.textContent || '').slice(0, 60) };
    },
    { x: panelBox.x + 6, y: titleBox.y + titleBox.height / 2 },
  );
  expect(topmost.inDialog, `the sidebar covers the dialog's left edge (hit: ${topmost.text})`).toBe(true);
});

test('the panel is painted, and `?` does not open the help behind it', async ({ page }) => {
  const dialog = await openManager(page);
  const painted = await dialog.evaluate(node => getComputedStyle(node.firstElementChild as Element).backgroundColor);
  expect(painted, 'the panel has a visible background, not "painted nothing"').not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

  // The help is a dialog too and sits at z-[100], under the manager: opening it here would trap the
  // keyboard in something the person cannot see.
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
