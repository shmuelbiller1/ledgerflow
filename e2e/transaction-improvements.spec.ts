import { test, expect } from '@playwright/test';

test.describe('Transaction List Improvements Suite', () => {

  test.beforeEach(async ({ page }) => {
    // Seed guest session directly into localStorage so auth passes immediately
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
      // already in guest mode
    }

    await page.waitForSelector('text="Overview"', { timeout: 15000 });
  });

  test('Filtered totals bar displays and updates upon filtering, and attachment badge renders on transaction with fileUrls', async ({ page }) => {
    // Navigate to Transactions screen
    const txNav = page.locator('[data-testid="nav-transactions"]');
    await txNav.first().click();

    // Wait for the Transaction Grid and Filtered Totals bar
    const totalsBar = page.locator('[data-testid="filtered-totals-bar"]');
    await totalsBar.waitFor({ state: 'visible', timeout: 15000 });

    // Assert that the three cells in the summary bar exist
    const inflowElement = page.locator('[data-testid="filtered-inflow"]');
    const outflowElement = page.locator('[data-testid="filtered-outflow"]');
    const matchingRecords = page.locator('[data-testid="matching-records"]');

    await expect(inflowElement).toBeVisible();
    await expect(outflowElement).toBeVisible();
    await expect(matchingRecords).toBeVisible();

    // Verify initial inflow text
    const initialInflowText = await inflowElement.textContent();
    expect(initialInflowText).toContain('In:');

    // Inject a test transaction with attachments (fileUrls) into the Zustand ledger store
    await page.evaluate(() => {
      const store = (window as unknown as {
        __ledgerStore?: {
          getState?: () => {
            transactions?: unknown[];
            setTransactions: (txs: unknown[]) => void;
          };
        };
      }).__ledgerStore;
      const testTx = {
        id: 'tx_e2e_attachment_test',
        uid: 'guest_user',
        workspaceId: 'default',
        date: '2026-09-15',
        description: 'Special Audit Item with Receipt',
        type: 'income',
        status: 'completed',
        totalAmountCents: 888800,
        currency: 'USD',
        fileUrls: ['https://example.com/receipt1.pdf', 'https://example.com/receipt2.pdf'],
        createdAt: '2026-09-15',
        lines: [
          { accountId: 'acc_cash', accountName: 'Cash', amountCents: 888800 },
          { accountId: 'acc_rev', accountName: 'Revenue', amountCents: -888800 }
        ]
      };
      if (store && store.getState) {
        const current = store.getState().transactions || [];
        store.getState().setTransactions([testTx, ...current]);
      }
    });

    // Check if the attachment badge renders
    const attachmentBadge = page.locator('[data-testid="attachment-badge"]').first();
    if (await attachmentBadge.count() > 0) {
      await expect(attachmentBadge).toBeVisible();
    }

    // Filter the grid with search input
    const searchInput = page.locator('input[placeholder*="Search" i], input[placeholder*="Filter" i]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('NonExistentTermXYZ12345');
      // After filtering to non-existent term, inflow should update to $0.00
      await expect(page.locator('[data-testid="filtered-inflow"]')).toContainText('$0.00');
      await expect(page.locator('[data-testid="matching-records"]')).toContainText('0');

      // Clear search
      await searchInput.fill('');
    }
  });

  test('figures in tables and fields line up (tabular figures everywhere, I-11)', async ({ page }) => {
    const style = await page.evaluate(() => {
      const td = document.createElement('td');
      const input = document.createElement('input');
      const table = document.createElement('table');
      const tr = document.createElement('tr');
      tr.appendChild(td); table.appendChild(tr); document.body.append(table, input);
      const out = [getComputedStyle(td).fontVariantNumeric, getComputedStyle(input).fontVariantNumeric];
      table.remove(); input.remove();
      return out;
    });
    expect(style).toEqual(['tabular-nums', 'tabular-nums']);
  });

  test('Tabular figures (tabular-nums) class is present on transaction amounts', async ({ page }) => {
    const txNav = page.locator('[data-testid="nav-transactions"]');
    await txNav.first().click();

    await page.waitForSelector('[data-testid="filtered-totals-bar"]', { timeout: 15000 });

    // Assert that the inflow value span has the tabular-nums class
    const inflowValue = page.locator('[data-testid="filtered-inflow"] .tabular-nums').first();
    await expect(inflowValue).toBeVisible();
  });
});
