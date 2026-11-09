import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
  test(`dashboard first screen and searchable settings ${width} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
    await page.addInitScript(selectedTheme => {
      localStorage.setItem('isGuest', 'true'); localStorage.setItem('has_seen_onboarding', 'true');
      localStorage.setItem('ledgerflow-cookie-consent', 'accepted'); localStorage.setItem('lf_theme', selectedTheme);
    }, theme);
    await page.goto('/#dashboard');
    const overview = page.getByRole('region', { name: 'Dashboard at a glance', exact: true });
    await expect(overview.getByRole('link', { name: /^Cash .* report$/ })).toContainText('$3,000.00');
    await expect(overview.getByRole('link', { name: /^Profit this month .* report$/ })).toContainText('$3,000.00');
    // The real, unfinished setup checklist must not push the first-screen actions away.
    await expect(page.getByRole('heading', { name: 'Workspace Setup Checklist' })).toBeVisible();
    const controls = overview.getByRole('link');
    await expect(controls).toHaveCount(5);
    for (const control of await controls.all()) {
      const box = (await control.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(850); expect(Number(box.height.toFixed(3))).toBeGreaterThanOrEqual(44);
    }
    const scan = await new AxeBuilder({ page }).analyze();
    expect(scan.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
    await page.evaluate(async () => {
      const authPath = '/src/stores/useAuthStore.ts';
      const { useAuthStore } = await import(/* @vite-ignore */ authPath) as typeof import('../src/stores/useAuthStore');
      const workspaceId = useAuthStore.getState().currentWorkspaceId || '';
      const storePath = '/src/stores/useLedgerStore.ts', fixturesPath = '/src/tests/fixtures.ts';
      const { useLedgerStore } = await import(/* @vite-ignore */ storePath) as typeof import('../src/stores/useLedgerStore');
      const { makeInvoice, makeBill } = await import(/* @vite-ignore */ fixturesPath) as typeof import('../src/tests/fixtures');
      useLedgerStore.setState({ invoices: [
        makeInvoice({ workspaceId, date: '2026-09-01', amountCents: 50000, amountPaidCents: 15000 }),
        makeInvoice({ workspaceId, id: 'future', date: '2026-10-01', amountCents: 90000 }),
        makeInvoice({ workspaceId, id: 'draft', date: '2026-09-01', status: 'draft', amountCents: 90000 }),
      ], bills: [makeBill({ workspaceId, date: '2026-09-01', amountCents: 24000, amountPaidCents: 4000 })] });
    });
    await expect(overview.getByRole('link', { name: /^Owed to you .* report$/ })).toContainText('$350.00');
    await expect(overview.getByRole('link', { name: /^Owed to you .* report$/ })).toHaveAccessibleName('Owed to you $350.00 report');
    await expect(overview.getByRole('link', { name: /^You owe .* report$/ })).toContainText('$200.00');
    await page.evaluate(async () => {
      const modulePath = '/src/stores/useLedgerStore.ts';
      const { useLedgerStore } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/stores/useLedgerStore');
      useLedgerStore.setState({ truncatedCollections: { invoices: true } });
    });
    await expect(overview.getByText('Unavailable', { exact: true })).toHaveCount(4);
    await expect(page.getByRole('alert').filter({ hasText: 'Incomplete data:' })).toContainText('invoices');
    const range = page.getByLabel('Dashboard date range');
    await range.selectOption('custom');
    await page.getByLabel('Dashboard from').fill('2026-10-01');
    await expect(overview.getByText('Choose dates', { exact: true })).toHaveCount(4);
    await expect(overview.locator('[data-summary-report="balance-sheet"]')).toHaveAttribute('aria-disabled', 'true');
    const invalidScan = await new AxeBuilder({ page }).analyze();
    expect(invalidScan.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
    await overview.getByRole('link', { name: 'Open tasks', exact: true }).click();
    await expect(page).toHaveURL(/#tasks$/); await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
    await page.goto('/#settings');
    const nav = page.getByRole('navigation', { name: 'Settings sections', exact: true });
    await expect(nav.getByRole('region')).toHaveCount(5);
    await expect(nav.getByRole('button')).toHaveCount(32);
    for (const button of await nav.getByRole('button').all()) expect(Number((await button.boundingBox())!.height.toFixed(3))).toBeGreaterThanOrEqual(44);
    const appearance = nav.getByRole('button', { name: 'Appearance & Display', exact: true });
    await appearance.focus(); await appearance.press('Enter');
    await expect(appearance).toHaveAttribute('aria-current', 'page');
    const heading = page.getByRole('heading', { name: 'Text Sizing & Font Scale', exact: true });
    await expect(heading).toBeVisible();
    await heading.evaluate(element => { element.setAttribute('data-preserved-draft', 'same-mounted-page'); });
    const search = page.getByLabel('Search settings', { exact: true });
    await search.fill('tax');
    await expect(nav.getByRole('button', { name: 'Tax profiles', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Appearance & Display', exact: true })).toHaveCount(0);
    await expect(heading).toHaveAttribute('data-preserved-draft', 'same-mounted-page');
    await search.fill('אין התאמה xyz'); await expect(nav.getByRole('status')).toContainText('No settings match');
    await expect(heading).toHaveAttribute('data-preserved-draft', 'same-mounted-page');
    await nav.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(search).toHaveValue(''); await expect(nav.getByRole('button')).toHaveCount(32);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
