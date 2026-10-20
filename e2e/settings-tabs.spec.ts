import { test, expect } from '@playwright/test';

// D-95: the Settings module strip on a phone keeps whole labels in one scrolling row (same as D-78).
// D-96: Billing & Plan follows the theme instead of staying white in dark mode.
for (const theme of ['light', 'dark']) {
  test(`settings module strip and billing panel follow the theme: ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 850 });
    await page.addInitScript(selectedTheme => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
      localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
      localStorage.setItem('lf_theme', selectedTheme);
    }, theme);
    await page.goto('/#settings');
    const modules = page.getByRole('navigation', { name: 'Module pages', exact: true });
    await expect(modules).toBeVisible();
    const buttons = modules.getByRole('button');
    expect(await buttons.count()).toBeGreaterThan(4);
    await expect(modules.getByRole('button', { name: 'Preferences' })).toHaveAttribute('aria-current', 'page');
    expect(await modules.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await modules.evaluate(el => {
      const items = [...el.querySelectorAll('button')];
      return items.every((button, index) => {
        const rect = button.getBoundingClientRect();
        const previous = items[index - 1]?.getBoundingClientRect();
        // whole label: the button is as wide as its text needs, on one row, after the previous one
        return rect.height >= 44 && button.scrollWidth <= button.clientWidth + 1
          && (!previous || (Math.abs(rect.y - previous.y) < 1 && rect.x >= previous.right));
      });
    })).toBe(true);
    // choosing the last page reveals it in the strip without scrolling the page sideways
    const last = buttons.last();
    await last.focus();
    await page.keyboard.press('Enter');
    await expect(last).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => modules.evaluate(el => {
      const item = el.querySelector('[aria-current="page"]')!.getBoundingClientRect();
      const frame = el.getBoundingClientRect();
      return item.left >= frame.left - 1 && item.right <= frame.right + 1;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.goto('/#settings');
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Billing & Plan' }).click();
    const heading = page.getByRole('heading', { name: 'Subscription & Plan Tiers' });
    await expect(heading).toBeVisible();
    const colours = await heading.evaluate(el => {
      const panel = el.closest('.ledger-card')!;
      const plan = panel.querySelector('h3')!;
      const card = plan.closest('div.relative')!;
      const styles = (node: Element) => getComputedStyle(node);
      const vars = getComputedStyle(document.documentElement);
      return {
        panel: styles(panel).backgroundColor, card: styles(card).backgroundColor,
        heading: styles(el).color, plan: styles(plan).color,
        expectedPanel: vars.getPropertyValue('--panel').trim(), expectedText: vars.getPropertyValue('--text').trim(),
      };
    });
    const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    expect(colours.panel).toBe(rgb(colours.expectedPanel));
    expect(colours.heading).toBe(rgb(colours.expectedText));
    expect(colours.plan).toBe(rgb(colours.expectedText));
    if (theme === 'dark') expect(colours.card).not.toBe('rgb(255, 255, 255)');
  });
}
