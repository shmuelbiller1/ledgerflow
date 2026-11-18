import { expect, type Locator, type Page } from '@playwright/test';

/** Traverse the real tab order instead of focusing a potentially untabbable control by script. */
export async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await target.evaluate(control => control === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target, 'reachable using Tab').toBeFocused();
}

/** Once on the list, every enabled button in the exercised row is reachable without a mouse. */
export async function tabThroughRowActions(page: Page, opener: Locator) {
  const row = opener.locator('xpath=ancestor::*[self::tr or @role="row"][1]');
  await expect(row).toHaveCount(1);
  for (const action of await row.getByRole('button').all()) {
    if (await action.isEnabled()) await tabTo(page, action);
  }
}

export async function keyboardRecordPageRoundTrip(page: Page, opener: Locator, backLabel: string) {
  await tabTo(page, opener);
  await page.keyboard.press('Enter');
  const back = page.getByRole('button', { name: backLabel, exact: true });
  await expect(back, 'Enter opens the record and moves focus inside').toBeFocused();
  await page.keyboard.press('Escape');
  await expect(back, 'Escape returns to the list').toHaveCount(0);
  await expect(opener, 'focus returns to the remounted row opener').toBeFocused();

  await page.keyboard.press('Enter');
  await expect(back).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(back, 'the ordinary Back button still works').toHaveCount(0);
  await expect(opener).toBeFocused();
}

/** The product of the element's and every ancestor's opacity: 1 only when a sighted user sees it. */
function effectiveOpacity(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    let opacity = 1;
    let node: HTMLElement | null = el as HTMLElement;
    while (node) {
      opacity *= Number.parseFloat(getComputedStyle(node).opacity || '1');
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

