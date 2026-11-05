import { test, expect } from '@playwright/test';
import { mountJourney } from './support/journeyFixture';

const screens = [
  { tab: 'inventory', heading: 'Inventory', control: { role: 'button', name: 'Enlist Asset' } },
  { tab: 'payroll', heading: 'Payroll & Compensation Engine', control: { role: 'button', name: 'Add Employee' } },
  { tab: 'taxes', heading: 'Tax Reserve Estimator', control: { role: 'combobox', name: 'Tax reserve fiscal year' } },
  { tab: 'assets', heading: 'Fixed Asset Register', control: { role: 'button', name: 'Add asset' } },
  { tab: 'transactions', heading: 'Journal Entries', control: { role: 'button', name: 'Create new entry' } },
  { tab: 'recurring', heading: 'Recurring Transactions', control: { role: 'textbox', name: 'Search recurring templates' } },
  { tab: 'vault', heading: 'Documents', control: { role: 'textbox', name: 'Search documents by name, tag, or checksum' } },
] as const;

for (const screen of screens) {
  test(`A-263 ${screen.tab}: 390 px page, bounded scroll boxes and reachable 44 px controls`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.addInitScript(() => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
      localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
    });
    // These two screens correctly refuse writes for guests. Use the authenticated owner fixture
    // to measure their actual write controls, without weakening the product's role checks.
    const ownerModule = screen.tab === 'payroll' ? '/src/components/hr/PayrollView.tsx'
      : screen.tab === 'assets' ? '/src/components/assets/FixedAssetsView.tsx' : null;
    const journey = ownerModule ? await mountJourney(page, {
      workspaceId: `phone-${screen.tab}`, ledger: {}, mounts: [{ module: ownerModule }],
    }) : null;
    if (!ownerModule) await page.goto(`/#${screen.tab}`);
    const main = page.locator(ownerModule ? '#root' : '#main-content');
    await expect(main.getByRole('heading', { name: screen.heading, exact: true })).toBeVisible();
    const control = main.getByRole(screen.control.role, { name: screen.control.name, exact: true });
    await expect(control).toBeEnabled();
    await control.scrollIntoViewIfNeeded();
    await control.focus();
    await expect(control).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

    // The shell clips overflow. A width-only check would miss unreachable controls and tables.
    const geometry = await main.evaluate(root => {
      const width = innerWidth;
      const boxes = Array.from(root.querySelectorAll<HTMLElement>('*')).filter(el => {
        const style = getComputedStyle(el);
        return ['auto', 'scroll'].includes(style.overflowX) && el.getBoundingClientRect().width > 0;
      });
      const problems: string[] = [];
      for (const el of boxes) {
        const rect = el.getBoundingClientRect();
        if (rect.left < -1 || rect.right > width + 1) {
          // A virtual list's own vertical scroll box can be wider than the phone inside the
          // table's fitting horizontal scroller. Its columns remain reachable there.
          const containingScroller = boxes.find(parent => parent !== el && parent.contains(el)
            && parent.scrollWidth > parent.clientWidth && parent.getBoundingClientRect().left >= -1
            && parent.getBoundingClientRect().right <= width + 1);
          if (!containingScroller) problems.push(`scroll box ${el.className}: ${rect.left}…${rect.right}`);
        }
      }
      for (const el of root.querySelectorAll<HTMLElement>('button, select, input:not([type="hidden"]), textarea, summary')) {
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const label = el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName;
        if (rect.width < 43.5 || rect.height < 43.5) problems.push(`${label}: target ${rect.width}×${rect.height}`);
        // Offscreen columns are allowed only when a fitting local scroller makes them reachable.
        if (rect.left < -1 || rect.right > width + 1) {
          const scroller = boxes.find(box => box.contains(el) && box.scrollWidth > box.clientWidth);
          if (!scroller) problems.push(`${label}: clipped without a local scroller`);
        }
      }
      return problems;
    });
    expect(geometry).toEqual([]);
    const box = await control.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(391);
    expect(errors).toEqual([]);
    if (journey) expect(journey.errors).toEqual([]);
  });
}

for (const width of [640, 767, 1024]) {
  test(`A-263 Documents: many tags leave usable search space at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const { errors } = await mountJourney(page, { workspaceId: 'vault-tags', ledger: {}, mounts: [] });
    await page.route('**/rest/v1/documents**', route => route.fulfill({ json: [{
      id: 'tagged-document', workspace_id: 'vault-tags', data: {
        workspaceId: 'vault-tags', uid: 'journey-user', name: 'Example receipt',
        createdAt: '2026-10-01T12:00:00Z', sizeBytes: 1024, type: 'application/pdf',
        tags: Array.from({ length: 12 }, (_, i) => `Long document category ${i + 1}`),
      },
    }] }));
    await page.evaluate(async () => {
      await (window as unknown as { __journeyRender: (mounts: unknown[]) => Promise<void> }).__journeyRender([
        { module: '/src/components/forensics/Vault.tsx' },
      ]);
    });
    const lastTag = page.getByRole('button', { name: 'Long document category 12', exact: true });
    await expect(lastTag).toHaveCount(1);
    const search = page.getByRole('textbox', { name: 'Search documents by name, tag, or checksum' });
    const box = await search.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(200);
    await search.fill('receipt');
    await expect(search).toHaveValue('receipt');
    await lastTag.scrollIntoViewIfNeeded();
    const tagBox = await lastTag.boundingBox();
    expect(tagBox!.x).toBeGreaterThanOrEqual(0);
    expect(tagBox!.x + tagBox!.width).toBeLessThanOrEqual(width + 1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
