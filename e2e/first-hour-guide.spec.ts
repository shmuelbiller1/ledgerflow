import { installSmallSample } from './helpers/sampleFixture';
import { test, expect } from '@playwright/test';

// G-02 navigation evidence only. Guest data + stubbed APIs cannot certify signup or posting.
for (const width of [390, 1280]) for (const dark of [false, true]) {
  test(`first-hour guide: ${width}px ${dark ? 'dark' : 'light'} destinations and keyboard`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(`${error.message} @ ${(error.stack || '').split('\n').slice(0, 6).join(' | ')} @ ${page.url()}`));
    const diagnostics: string[] = [];
    // the app's own scripts must load; guest-mode data calls to the unconfigured database fail in CI by design
    page.on('requestfailed', request => {
      if (request.resourceType() !== 'script' || new URL(request.url()).origin !== new URL(page.url() || 'http://x').origin) return;
      diagnostics.push(`request failed: ${request.method()} ${request.url()} — ${request.failure()?.errorText || 'unknown'}`);
    });
    page.on('response', response => {
      if (response.status() >= 400 && /\\.(js|mjs|ts|tsx)(?:\\?|$)/.test(response.url())) {
        diagnostics.push(`script HTTP ${response.status()}: ${response.url()}`);
      }
    });
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.addInitScript(dark => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
      localStorage.setItem('ledgerflow-cookie-consent', JSON.stringify({ essential: true, analytics: false }));
      localStorage.setItem('lf_theme', dark ? 'dark' : 'light');
    }, dark);
    await installSmallSample(page);
    await page.goto('/#dashboard');
    const main = page.locator('#main-content');
    const openGuide = async () => {
      await page.evaluate(async () => {
        const path = '/src/stores/useUIStore.ts';
        const { useUIStore } = await import(path);
        useUIStore.getState().goToPage({ tab: 'dashboard' });
      });
      const summary = main.locator('summary').filter({ hasText: 'First-hour bookkeeping guide' });
      await expect(summary).toBeVisible();
      await summary.focus();
      await summary.press('Enter');
      await expect(main.getByRole('region', { name: 'First-hour bookkeeping guide' })).toBeVisible();
    };
    await openGuide();
    const guide = main.getByRole('region', { name: 'First-hour bookkeeping guide' });
    await expect(guide.getByRole('listitem')).toHaveCount(8);
    await testInfo.attach('first-hour-guide', { body: await page.screenshot({ path: testInfo.outputPath(`guide-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true }), contentType: 'image/png' });
    for (const button of await guide.getByRole('button').all()) {
      await button.scrollIntoViewIfNeeded();
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

    // Every guide destination renders the real screen, not merely a changed store value.
    for (const [action, heading] of [
      ['Open customers', 'Sales'],
      ['Open invoices', 'Sales'],
      ['Open bills', 'Purchases & AP'],
      ['Open unpaid invoices', 'Sales'],
      ['Open bank import', 'Bank & Institution Connections'],
      ['Open reconciliation', 'Smart Matching & Bank Reconciliation'],
      ['Open profit and loss', 'Reports'],
    ]) {
      const button = guide.getByRole('button', { name: action, exact: true });
      await button.scrollIntoViewIfNeeded();
      await button.focus();
      await button.press('Enter');
      await expect(main.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      if (action === 'Open customers') {
        await main.getByRole('button', { name: 'Customers', exact: true }).click();
        await main.getByRole('button', { name: 'Add Customer', exact: true }).click();
        await expect(page.getByRole('dialog')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
      if (action === 'Open bank import') {
        await expect(main.getByRole('button', { name: 'Import statement', exact: true })).toBeDisabled();
        await expect(main.locator('#bank-import-permission')).toBeVisible();
        await expect(main.locator('#bank-import-permission')).toContainText('Guest and viewer sessions cannot import bank data');
      }
      if (action === 'Open profit and loss') {
        await expect(main.getByRole('button', { name: 'Generate', exact: true })).toBeVisible();
        expect(await page.evaluate(async () => {
          const path = '/src/stores/useUIStore.ts';
          return (await import(path)).useUIStore.getState().activeReportTab;
        })).toBe('pnl');
      }
      await openGuide();
    }
    await guide.getByRole('button', { name: 'Choose accounts', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect.poll(() => page.getByRole('dialog').evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Empty demo books use the same guide, rather than claiming a ready ledger.
    await page.evaluate(async () => {
      const { replaceGuestCompany } = await import('/src/lib/guestCompany.ts');
      replaceGuestCompany({ currency: 'USD', accounts: [], transactions: [], invoices: [], bills: [], customers: [], vendors: [] }, 'Empty sample');
    });
    await expect(main.getByRole('heading', { name: 'Start your books', exact: true })).toBeVisible();
    await expect(main.getByRole('listitem')).toHaveCount(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await testInfo.attach('empty-books', { body: await page.screenshot({ path: testInfo.outputPath(`empty-${width}-${dark ? 'dark' : 'light'}.png`) }), contentType: 'image/png' });
    await main.getByRole('button', { name: 'Open invoices', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Sales', exact: true })).toBeVisible();
    expect(errors, `Browser script diagnostics: ${diagnostics.join(' | ') || 'none'}`).toEqual([]);
  });
}
