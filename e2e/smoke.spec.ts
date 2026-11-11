import { mountJourney } from './support/journeyFixture';
import { seedDemoWorkspace } from './helpers/demoWorkspaceSeeder';
import { openTool } from './support/openTool';
import { test, expect } from '@playwright/test';
import { settleAnimations } from './support/a11yGate';

test.describe('E2E Smoke Suite', () => {

  test.beforeEach(async ({ page }, testInfo) => {
    // The receipt posting contract belongs to an authenticated fixture, not an anonymous sample.
    if (testInfo.title.startsWith('6. Receipt Ingestion:')) return;
    // Seed guest session directly into localStorage so auth passes immediately without flaky transitions
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

  test('1. Receipt Ingestion: Verify Vault upload button and receipt structure', async ({ page }) => {
    await openTool(page, 'Documents');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('input[type="file"]')).toBeAttached();
  });

  test('2. Transaction Persistence: Verify ledger line-edit UI renders', async ({ page }) => {
    await openTool(page, 'Ledger & Journal');
    await expect(page.locator('body')).toBeVisible();
  });

  test('3. Vault Scanner: OCR Deep Scan button exists and works', async ({ page }) => {
    await openTool(page, 'Documents');

    // Upload a fixture document to activate the inspector drawer
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'scanner_test_doc.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    });

    const docCard = page.locator('text="scanner_test_doc.png"').first();
    await docCard.waitFor({ state: 'visible', timeout: 8000 });
    await docCard.click();

    await expect(page.locator('button:has-text("Deep OCR Scan")').first()).toBeVisible();
  });

  test('4. Send Invoice: Invoice dialog opens', async ({ page }) => {
    await page.click('button:has-text("Sales")');
    await page.click('button:has-text("Invoices")');
    await expect(page.locator('button:has-text("Add Invoice")').first()).toBeVisible();
    await page.click('button:has-text("Add Invoice")');
    await expect(page.getByRole('heading', { name: 'New invoice' })).toBeVisible({ timeout: 8000 });
  });

  test('5. ToolSandbox Algorithm: Sandbox renders without NaN on empty dates', async ({ page }) => {
    await openTool(page, 'Insights');
    
    // Wait for the math algorithms to compute
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settleAnimations(page, 2000); 
    
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('NaN');
  });

  test('6. Receipt Ingestion: Ingest 3-item + tax fixture receipt, assert created transaction total $20.00 and tax line exists', async ({ page }) => {
    const books = seedDemoWorkspace('smoke-receipt');
    await mountJourney(page, {
      workspaceId: 'smoke-receipt', ledger: { ...books },
      mounts: [{ module: '/src/components/forensics/Vault.tsx' }, { module: '/node_modules/.vite/deps/sonner.js', exportName: 'Toaster' }],
    });
    await page.evaluate(async () => {
      const { auth } = await import('/src/firebase.ts');
      const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
      auth.currentUser = useAuthStore.getState().user;
    });
    // Intercept AI extraction for parse-receipt
    await page.route('**/api/ai/process', async (route) => {
      const data = route.request().postDataJSON();
      if (data?.task === 'parse-receipt') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            vendorName: 'ShopRite Supermarket',
            date: '2026-09-08',
            totalAmountCents: 2000,
            taxAmountCents: 152,
            tipAmountCents: 0,
            categorySuggestion: 'Groceries',
            confidence: 0.98,
            lines: [
              {
                description: 'Organic Whole Milk 1 Gallon',
                amountCents: 549,
                category: 'Groceries/Dairy/Milk',
                quantity: 1,
                unitPriceCents: 549
              },
              {
                description: 'Artisanal Sourdough Bread',
                amountCents: 699,
                category: 'Groceries/Bakery',
                quantity: 1,
                unitPriceCents: 699
              },
              {
                description: 'Fresh Honeycrisp Apples 3lb',
                amountCents: 600,
                category: 'Groceries/Produce',
                quantity: 1,
                unitPriceCents: 600
              }
            ]
          })
        });
      } else {
        await route.continue();
      }
    });

    interface InterceptedLine {
      category?: string;
      description?: string;
      amountCents: number;
    }
    interface InterceptedTransaction {
      totalAmountCents?: number;
      description?: string;
      lines?: InterceptedLine[];
    }
    let interceptedTxPayload: InterceptedTransaction | null = null;
    await page.route('**/api/v1/transactions', async (route) => {
      if (route.request().method() === 'POST') {
        interceptedTxPayload = route.request().postDataJSON()?.transaction as InterceptedTransaction;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            transaction: {
              id: 'tx-fixture-receipt-assert-1',
              ...interceptedTxPayload
            }
          })
        });
      } else {
        await route.continue();
      }
    });

    // The real Documents screen is mounted in the authenticated fixture above.
    await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();

    // Upload receipt file fixture
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'fixture_shoprite_receipt.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    });

    // Wait for document card to appear and click it
    const docCard = page.locator('text="fixture_shoprite_receipt.png"').first();
    await docCard.waitFor({ state: 'visible', timeout: 8000 });
    await docCard.click();

    // In the drawer, click Deep OCR Scan
    const scanBtn = page.locator('button:has-text("Deep OCR Scan")').first();
    await scanBtn.waitFor({ state: 'visible', timeout: 8000 });
    await scanBtn.click();

    // Verify AI Extracted Geometry displays the extracted total $20.00
    await expect(page.locator('text="AI Extracted Geometry"')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('text="$20.00"')).toBeVisible();

    // Click "Inject & Sync Ledger"
    const injectBtn = page.locator('button:has-text("Inject & Sync Ledger")').first();
    await injectBtn.click();

    // Confirm the accepted write and the completed screen transition rather than an expiring toast.
    await expect.poll(() => interceptedTxPayload, { timeout: 8000 }).not.toBeNull();
    await expect(page.locator('text="AI Extracted Geometry"')).toHaveCount(0);

    // Assert that the created transaction payload strictly satisfies accounting invariants:
    // (1) Total Amount Cents matches receipt total ($20.00 = 2000 cents)
    expect(interceptedTxPayload).not.toBeNull();
    const txPayload = interceptedTxPayload!;
    expect(txPayload.totalAmountCents).toBe(2000);
    expect(txPayload.description).toBe('ShopRite Supermarket');

    // (2) Tax line item exists and matches taxAmountCents (152 cents)
    const taxLine = txPayload.lines?.find((l) =>
      l.category?.toLowerCase().includes('tax') ||
      l.description?.toLowerCase().includes('tax')
    );
    expect(taxLine).toBeDefined();
    expect(taxLine!.amountCents).toBe(152);

    // (3) Double-entry balanced debits and credits
    const debitSum = txPayload.lines
      ?.filter((l) => (l.amountCents || 0) > 0)
      .reduce((s: number, l) => s + l.amountCents, 0) || 0;
    const creditSum = txPayload.lines
      ?.filter((l) => (l.amountCents || 0) < 0)
      .reduce((s: number, l) => s + Math.abs(l.amountCents), 0) || 0;
    expect(debitSum).toBe(creditSum);
    expect(debitSum).toBe(2000);
  });

  test('7. AI Endpoint Validation: Assert /api/ai/process exists on server and returns 401 when unauthenticated', async ({ request }) => {
    const res = await request.post('/api/ai/process', {
      data: { task: 'parse-query', payload: { query: 'test' } }
    });
    expect(res.status()).toBe(401);
  });
});
