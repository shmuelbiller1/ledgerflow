import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForFiniteAnimations } from './support/a11yGate';

// Enter the actual screens, including Trial Balance within the Ledger’s Accountant Lens.
const screens = [
  ['/#dashboard', 'Overview', 'Overview', 'overview'],
  ['/#sales', 'Sales', 'Sales and invoices', 'sales'],
  ['/#purchases', 'Purchases', 'Purchases and bills', 'purchases'],
  ['/#banking', 'Bank Connections', 'Banking', 'banking'],
  ['/#reconciliation', 'Reconcile', 'Match bank lines', 'reconciliation'],
  ['/?report=pnl#reports', 'Profit & Loss', 'Profit and loss', 'pnl'],
  ['/?report=balance-sheet#reports', 'Balance Sheet', 'Balance sheet', 'balance-sheet'],
  ['/#ledger', 'Ledger & Journal', 'Trial balance', 'trial-balance'],
  ['/?report=israel-vat-report#reports', 'Israel VAT Report', 'Israel VAT report', 'israel-vat-report'],
  ['/#settings', 'Billing & Plan', 'Workspace settings', 'settings'],
] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
  });
});

for (const width of [1280, 390]) {
  test(`N-2: each busy screen opens its own illustrated guide in both languages at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    for (const [url, label, title, slug] of screens) {
      await test.step(title, async () => {
        await page.goto(url);
        const main = page.locator('#main-content');
        if (slug === 'trial-balance') {
          await main.getByRole('button', { name: 'Accountant Lens', exact: true }).click();
          await main.getByRole('button', { name: 'Trial Balance', exact: true }).click();
          await expect(main.getByRole('heading', { name: 'Trial Balance', exact: true })).toBeVisible();
        }
        // A Reports deep link can briefly mount the default report first. Wait for the named one.
        const trigger = main.getByRole('button', { name: `Help for ${label}`, exact: true });
        await trigger.press('Enter');
        const dialog = page.getByRole('dialog');
        const guide = dialog.locator('details').filter({ has: page.getByText(`Guide: ${title}`, { exact: true }) });
        await guide.locator('summary').press('Enter');
        await expect(guide.getByRole('listitem')).toHaveCount(3);
        const img = dialog.getByRole('img');
        await expect(img).toHaveAttribute('src', `/help/${slug}.webp`);
        await img.scrollIntoViewIfNeeded();
        await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        await dialog.getByRole('button', { name: 'עברית' }).click();
        // Switching the language of an open manual must not collapse it or switch reports.
        const translated = dialog.locator('details[open]');
        await expect(translated.locator('summary')).toContainText(/^מדריך:/);
        await expect(translated.getByRole('img')).toHaveAttribute('alt', /\p{Script=Hebrew}/u);
        await expect(translated.getByRole('listitem')).toHaveCount(3);
        for (const item of await translated.getByRole('listitem').all()) await expect(item).toContainText(/\p{Script=Hebrew}/u);
        expect(await translated.evaluate(el => getComputedStyle(el).direction)).toBe('rtl');
        const bounds = await translated.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
      });
    }
  });
}

test('#799: opening a named how-to reads that article without leaving Sales or changing its draft', async ({ page }) => {
  await page.goto('/#sales');
  const main = page.locator('#main-content');
  await main.getByRole('button', { name: /^Customers/ }).click();
  const draft = main.getByRole('textbox', { name: 'New customer name' });
  await draft.fill('Sample draft');
  await main.getByRole('button', { name: 'Help for Sales' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Create and send a customer invoice', { exact: true }).click();
  await expect(dialog.getByText('Open Sales, choose Invoices, then Add Invoice.')).toBeVisible();
  await dialog.getByText('Record full or partial customer payments', { exact: true }).click();
  await expect(dialog.getByText('In Sales → Invoices, choose Receive Payment on the unpaid invoice.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(draft).toHaveValue('Sample draft');
  await expect(page).toHaveURL(/#sales$/);
});

test('#800: Reconcile help starts in the UI language and describes matching, not closing a statement', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lf_language', 'he'));
  await page.goto('/#reconciliation');
  const main = page.locator('#main-content');
  await expect(main.getByRole('button', { name: /^To review \(/ })).toBeVisible();
  await expect(main.getByRole('button', { name: /^Matched \(/ })).toBeVisible();
  await main.getByRole('button', { name: 'Help for Reconcile' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName(/^עזרה:/);
  await dialog.getByText('מדריך: התאמת חשבון בנק', { exact: true }).click();
  await expect(dialog.locator('details[open]')).toContainText('התאמת שורה אינה סגירת תקופה');
  await dialog.getByRole('button', { name: 'English' }).click();
  await dialog.getByText('Match a bank statement line to a ledger entry', { exact: true }).click();
  await expect(dialog.getByText(/choose Confirm match, then find it under Matched/)).toBeVisible();
  await expect(dialog).not.toContainText(/enter statement ending date and balance/i);
});

test('#828: the label and Israeli month how-tos open the promised report', async ({ page }) => {
  const main = page.locator('#main-content');
  for (const [title, name] of [
    ['Tag lines with labels (property, project, location)', 'Profit by Label'],
    ['Review an Israeli VAT month and PCN874 draft', 'Israel Month Journey'],
  ]) {
    await page.goto('/#help');
    await main.getByRole('button', { name: /^How-to \(/ }).click();
    const article = main.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await article.getByRole('button', { name: 'Open screen', exact: true }).click();
    await expect(main.getByRole('button', { name: `Help for ${name}`, exact: true })).toBeVisible();
    await expect(page).toHaveURL(/#reports$/);
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`#832: the active language is readable in both Help pickers (${theme})`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(value => localStorage.setItem('lf_theme', value), theme);
    await page.goto('/#sales');
    await page.getByRole('button', { name: 'Help for Sales' }).click();
    for (const container of ['[role="dialog"]', '#main-content']) {
      if (container === '#main-content') {
        await page.getByRole('button', { name: 'פתיחת מרכז העזרה' }).click();
        await page.getByRole('button', { name: /^How-to \(/ }).click();
      }
      const selector = `${container} [role="group"] button[aria-pressed="true"][lang]`;
      for (const name of ['English', 'עברית']) {
        const button = page.locator(container).getByRole('button', { name, exact: true });
        await button.click();
        await expect(page.locator(selector)).toHaveAccessibleName(name);
        // Leave the hover tint and let colour transitions settle before measuring.
        await page.mouse.move(0, 0);
        await waitForFiniteAnimations(page);
        const result = await new AxeBuilder({ page }).include(selector).withRules(['color-contrast']).analyze();
        expect(result.violations).toEqual([]);
        // A skipped or indeterminate contrast calculation isn't a passing measurement.
        expect(result.passes.find(rule => rule.id === 'color-contrast')?.nodes,
          JSON.stringify(result.incomplete.map(rule => rule.nodes.map(node => node.failureSummary)))).toHaveLength(1);
      }
    }
  });
}
