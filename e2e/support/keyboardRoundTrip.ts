import { expect, type Locator, type Page } from '@playwright/test';

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
export async function keyboardRoundTrip(page: Page, opener: Locator, dialogName: string, options: { tabs?: number } = {}) {
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

