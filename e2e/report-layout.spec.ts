import { installSmallSample } from './helpers/sampleFixture';
import { test, expect } from '@playwright/test';

for (const width of [390, 1024, 1280]) for (const theme of ['light', 'dark']) {
  test(`aligned report filters and complete amounts ${width} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(selectedTheme => {
      localStorage.setItem('isGuest', 'true'); localStorage.setItem('has_seen_onboarding', 'true');
      localStorage.setItem('ledgerflow-cookie-consent', 'accepted'); localStorage.setItem('lf_theme', selectedTheme);
    }, theme);
    await installSmallSample(page);
    for (const report of ['pnl', 'balance-sheet']) {
      await page.goto(`/?report=${report}&start=2026-09-01&end=2026-09-30&cmp=none#reports`);
      const header = page.getByRole('region', { name: 'Report filters', exact: true });
      await expect(header).toBeVisible();
      const groups = header.locator('[data-filter-group]');
      const positions = await groups.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, bottom: r.bottom }; }));
      if (width >= 1024) expect(Math.max(...positions.map(p => p.y)) - Math.min(...positions.map(p => p.y))).toBeLessThanOrEqual(1);
      else for (let i = 1; i < positions.length; i++) expect(positions[i].y).toBeGreaterThanOrEqual(positions[i - 1].bottom);
      await expect(header.locator('[data-report-primary-action]')).toHaveCount(1);
      await expect(page.getByRole('region', { name: 'Report period', exact: true }).getByRole('button', { name: 'Generate', exact: true })).toHaveCSS('background-image', 'none');
      const date = report === 'pnl' ? header.getByLabel('Reporting period end date') : header.getByLabel('As Of Reporting Date', { exact: true });
      await header.getByRole('button', { name: 'Next month', exact: true }).click();
      await expect(date).toHaveValue('2026-10-31');
      await header.getByRole('button', { name: 'Previous month', exact: true }).click();
      await expect(date).toHaveValue('2026-09-30');
      const [download] = await Promise.all([page.waitForEvent('download'), header.getByRole('button', { name: 'Export to Excel', exact: true }).click()]);
      expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
      if (report === 'pnl') {
        await header.getByLabel('Label kind', { exact: true }).selectOption('project');
        await header.getByLabel('Label value', { exact: true }).fill('בית Mixed Case');
        await header.getByLabel('Basis', { exact: true }).focus();
        await expect(header.getByLabel('Label value', { exact: true })).toHaveValue('בית Mixed Case');
        await header.getByLabel('Basis', { exact: true }).selectOption('cash');
        await expect(header.getByLabel('Label kind', { exact: true })).toHaveCount(0);
        await expect(header.locator('input[type="checkbox"]')).toBeDisabled();
        if (width >= 1024) expect((await header.getByLabel('Basis', { exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(146);
        await header.getByLabel('Basis', { exact: true }).selectOption('accrual');
        await expect(header.getByLabel('Label value', { exact: true })).toHaveValue('בית Mixed Case');
      } else {
        const compare = header.locator('input[type="checkbox"]');
        await compare.focus(); await compare.press('Space'); await expect(compare).toBeChecked();
        await expect(header.getByLabel('Prior As Of Reference', { exact: true })).toBeVisible();
        await header.getByLabel('Prior As Of Reference', { exact: true }).fill('2026-08-31');
        await expect(header.getByLabel('Prior As Of Reference', { exact: true })).toHaveValue('2026-08-31');
        await compare.focus(); await compare.press('Space'); await expect(compare).not.toBeChecked();
        const longName = 'חשבון בנק Mixed Case ' + 'long account name '.repeat(12);
        await page.evaluate(async name => {
          const modulePath = '/src/stores/useLedgerStore.ts';
          const { useLedgerStore } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/stores/useLedgerStore');
          const { replaceGuestCompany } = await import('/src/lib/guestCompany.ts');
          const state = useLedgerStore.getState(), accountId = state.accounts.find(account => account.type === 'asset' && account.category === 'Cash')!.id;
          replaceGuestCompany({
            currency: 'USD', customers: state.customers, vendors: state.vendors, invoices: state.invoices, bills: state.bills,
            accounts: state.accounts.map(account => ({ ...account, name: account.id === accountId ? name : account.name })),
            transactions: state.transactions.map(transaction => ({ ...transaction, totalAmountCents: transaction.totalAmountCents * 1000000,
              lines: transaction.lines.map(line => ({ ...line, amountCents: Number(line.amountCents) * 1000000, accountName: line.accountId === accountId ? name : line.accountName })) })),
          }, 'Sample company');
        }, longName);
        const name = page.getByTitle(longName, { exact: true });
        await expect(name).toBeVisible();
        expect(await name.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
        const row = name.locator('xpath=ancestor::button[1]');
        await expect(row.locator('bdi').first()).toHaveText('$3,000,000,000.00');
        expect(await row.evaluate(el => {
          const money = el.querySelector('bdi')!, r = money.getBoundingClientRect(), frame = el.getBoundingClientRect();
          return r.left >= frame.left && r.right <= frame.right && money.scrollWidth <= money.clientWidth + 1;
        })).toBe(true);
      }
      expect(await header.evaluate(el => [...el.querySelectorAll('input:not([type="checkbox"]),select,button')].every(control => {
        const r = control.getBoundingClientRect(), frame = el.getBoundingClientRect(); return !r.width || (r.left >= frame.left && r.right <= frame.right + 1);
      }))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}
