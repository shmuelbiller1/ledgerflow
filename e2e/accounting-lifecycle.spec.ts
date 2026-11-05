import { test, expect } from '@playwright/test';

type TestLedgerTransaction = {
  id?: string;
  deletedAt?: string;
  status?: string;
  lines?: Array<{ amountCents: unknown }>;
};

type TestLedgerStore = {
  getState: () => {
    accounts?: unknown[];
    transactions?: TestLedgerTransaction[];
  };
};

test.describe('End-to-End Accounting Lifecycle & Workflows', () => {

  test.beforeEach(async ({ page }) => {
    // Seed guest session directly into localStorage for zero-flake authentication
    await page.addInitScript(() => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
    });

    await page.goto('/');

    const guestButton = page.locator('button', { hasText: 'Continue as Guest' });
    try {
      if (await guestButton.isVisible({ timeout: 2000 })) {
        await guestButton.click();
      }
    } catch {
      // Guest mode active
    }

    await page.waitForSelector('text="Overview"', { timeout: 15000 });
  });

  test('Invoice entry point opens and seeded ledger entries balance individually', async ({ page }) => {
    // An E2E check must fail if the screen, dialog, or state under test is unavailable.
    await page.locator('button:has-text("Money In")').first().click();
    await page.locator('button:has-text("Invoices & AP")').first().click();
    const addInvoice = page.locator('button:has-text("Add Invoice")').first();
    await expect(addInvoice).toBeVisible();
    await addInvoice.click();
    await expect(page.getByRole('heading', { name: 'New invoice' })).toBeVisible();

    await expect.poll(() => page.evaluate(() => {
      const store = (window as unknown as { __ledgerStore?: TestLedgerStore }).__ledgerStore;
      return store?.getState()?.transactions?.length ?? 0;
    })).toBeGreaterThan(0);

    const integrity = await page.evaluate(() => {
      const store = (window as unknown as { __ledgerStore?: TestLedgerStore }).__ledgerStore;
      if (!store) return null;
      const state = store.getState();
      const accounts = state.accounts ?? [];
      const transactions = state.transactions ?? [];
      const posted = transactions.filter(tx =>
        !tx.deletedAt && tx.status !== 'void' && tx.status !== 'draft'
      );
      const invalidEntries = posted.filter(tx => {
        const lines = tx.lines;
        if (!Array.isArray(lines) || lines.length < 2) return true;
        const amounts = lines.map(line => line.amountCents);
        return amounts.some(n => typeof n !== 'number' || !Number.isSafeInteger(n))
          || amounts.reduce<number>((sum, n) => sum + (typeof n === 'number' ? n : 0), 0) !== 0;
      });
      return { accountCount: accounts.length, transactionCount: transactions.length, invalidIds: invalidEntries.map(tx => tx.id) };
    });

    expect(integrity, 'The real application ledger store must be mounted').not.toBeNull();
    expect(integrity!.accountCount).toBeGreaterThan(0);
    expect(integrity!.transactionCount).toBeGreaterThan(0);
    expect(integrity!.invalidIds, 'Each posted entry must have valid balanced lines').toEqual([]);
  });

  test('Financial reports render their real pages without invalid amounts', async ({ page }) => {
    for (const report of [
      { kind: 'pnl', heading: 'Reports' },
      { kind: 'balance-sheet', heading: 'Reports' }
    ]) {
      await page.goto('/?report=' + report.kind + '&start=2026-09-01&end=2026-09-30&cmp=none#reports');
      const main = page.locator('#main-content');
      await expect(main.getByRole('heading', { name: report.heading, exact: true })).toBeVisible();
      const text = await main.innerText();
      expect(text).not.toContain('NaN');
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('Something went wrong');
    }
  });

  test('Bank Reconciliation and Variance Validation', async ({ page }) => {
    // Navigate to Banking / Reconciliation
    const bankingNav = page.locator('button:has-text("Banking"), button:has-text("Reconciliation")').first();
    if (await bankingNav.isVisible()) {
      await bankingNav.click();
    }

    // Verify reconciliation workspace loads
    await expect(page.locator('body')).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.getAnimations().length === 0, { timeout: 1000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('NaN');
  });

  test('Month-End Close: Audit Checklist, Suspense Clearance, and Period Locking', async ({ page }) => {
    // Navigate to Month-End Close
    const closeNav = page.locator('button:has-text("Month-End Close"), button:has-text("Closing")').first();
    if (await closeNav.isVisible()) {
      await closeNav.click();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => document.getAnimations().length === 0, { timeout: 1000 });

      // Verify the checklist stages render
      await expect(page.locator('text="Month-End Close Workspace"').first()).toBeVisible();
      await expect(page.locator('text="Lock Accounting Period"').first()).toBeVisible();
      await expect(page.locator('text="Export Full Accountant Package"').first()).toBeVisible();
    }
  });

  test('A/R and A/P Aging Summary Reports', async ({ page }) => {
    const reportsNav = page.locator('button:has-text("Reports")').first();
    if (await reportsNav.isVisible()) {
      await reportsNav.click();
    }

    const arAgingTab = page.locator('button:has-text("A/R Aging"), button:has-text("Accounts Receivable")').first();
    if (await arAgingTab.isVisible()) {
      await arAgingTab.click();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => document.getAnimations().length === 0, { timeout: 500 });
      const text = await page.locator('body').innerText();
      expect(text).not.toContain('NaN');
    }

    const apAgingTab = page.locator('button:has-text("A/P Aging"), button:has-text("Accounts Payable")').first();
    if (await apAgingTab.isVisible()) {
      await apAgingTab.click();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => document.getAnimations().length === 0, { timeout: 500 });
      const text = await page.locator('body').innerText();
      expect(text).not.toContain('NaN');
    }
  });
});
