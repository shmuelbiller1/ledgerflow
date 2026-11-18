import { expect, test, type Locator } from '@playwright/test';
import { REPORT_TABS_REGISTRY } from '../src/config/registry';
import { waitForFiniteAnimations } from './support/a11yGate';

const WIDTH = 390;

test.use({ locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });

/** Inspect the actual hit boxes and text fragments, not Tailwind classes. Local table scroll is allowed. */
async function measureReport(root: Locator) {
  return root.evaluate((surface) => {
    const problems = new Set<string>();
    const title = (element: Element) => (element.getAttribute('aria-label') || element.getAttribute('title') ||
      element.textContent?.trim() || element.getAttribute('id') || element.tagName).replace(/\s+/g, ' ').slice(0, 110);
    const tolerance = 1;
    const pageWidth = document.documentElement.clientWidth;
    const scroller = (element: Element) => /^(auto|scroll)$/.test(getComputedStyle(element).overflowX);
    const visible = (element: Element) => element.getClientRects().length > 0 &&
      !element.closest('[aria-hidden="true"], .sr-only, [hidden]') && getComputedStyle(element).visibility !== 'hidden';
    if (document.documentElement.scrollWidth > pageWidth + tolerance) problems.add(`document overflows (${document.documentElement.scrollWidth}px)`);

    for (const element of surface.querySelectorAll<HTMLElement>('*')) {
      if (!visible(element)) continue;
      const box = element.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      if ((box.left < -tolerance || box.right > pageWidth + tolerance) && !element.closest('svg')) {
        // A wide table may go past the viewport, but its closest scrolling container must fit.
        let ancestor = element.parentElement;
        while (ancestor && ancestor !== surface && !scroller(ancestor)) ancestor = ancestor.parentElement;
        if (!ancestor || ancestor === surface) problems.add(`outside the viewport: ${title(element)}`);
      }
      if (!element.matches('button, summary, select, textarea, input:not([type="hidden"]), [role="button"], [role="tab"], [role="switch"], a[href]')) continue;
      // Inline prose links belong to the paragraph; all standalone controls have a 44px target.
      if (element.matches('p a[href]') && getComputedStyle(element).display === 'inline') continue;
      const labels = element instanceof HTMLInputElement && ['radio', 'checkbox'].includes(element.type) ? [...element.labels ?? []] : [];
      const hit = [element, ...labels].filter(visible).map(node => node.getBoundingClientRect());
      if (!hit.some(target => target.height >= 43.5 && target.width >= 43.5)) {
        problems.add(`target <44px: ${title(labels[0] ?? element)} (${Math.round(box.width)}×${Math.round(box.height)})`);
      }
    }

    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walker.nextNode()) {
      const text = walker.currentNode;
      const parent = text.parentElement;
      if (!text.textContent?.trim() || !parent || parent.closest('option, svg, script, style') || !visible(parent)) continue;
      range.selectNodeContents(text);
      const fragments = [...range.getClientRects()];
      for (let node: HTMLElement | null = parent; node && node !== surface; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (scroller(node)) break;
        const clipsX = /^(hidden|clip)$/.test(style.overflowX);
        const clipsY = /^(hidden|clip)$/.test(style.overflowY);
        if (!clipsX && !clipsY) continue;
        const rect = node.getBoundingClientRect();
        if (fragments.some(fragment =>
          (clipsX && (fragment.left < rect.left - tolerance || fragment.right > rect.right + tolerance)) ||
          (clipsY && (fragment.top < rect.top - tolerance || fragment.bottom > rect.bottom + tolerance)))) {
          problems.add(`clipped text: ${text.textContent.trim().slice(0, 110)} in ${node.tagName.toLowerCase()}.${[...node.classList].slice(0, 8).join('.')}`);
          break;
        }
      }
    }
    return [...problems].sort();
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (let offset = 0; offset < REPORT_TABS_REGISTRY.length; offset += 10) {
    const reports = REPORT_TABS_REGISTRY.slice(offset, offset + 10);
    test(`A-278 phone reports (${theme}): ${reports[0].id} through ${reports.at(-1)!.id}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: WIDTH, height: 844 });
      // The built-in sample is dated 2026. Keep the default report period in that year.
      await page.clock.setFixedTime(new Date('2026-11-17T12:00:00Z'));
      await page.addInitScript(selectedTheme => {
        localStorage.setItem('isGuest', 'true');
        localStorage.setItem('has_seen_onboarding', 'true');
        localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
        localStorage.setItem('lf_theme', selectedTheme);
      }, theme);
      const crashes: string[] = [];
      page.on('pageerror', error => crashes.push(error.message));
      await page.goto('/#reports');
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      // This status is present but visually hidden on a phone. Require real loaded books,
      // not a successful geometry check on placeholders or an empty sample after a failed read.
      const seededBooks = page.getByRole('contentinfo', { name: 'Status bar', includeHidden: true })
        .getByText(/^[1-9]\d* Accounts · [1-9]\d* Transactions$/);
      await expect(seededBooks).toHaveCount(1);
      const root = page.locator('#main-content > *').filter({ has: page.getByTestId('reports-heading') });
      const picker = page.getByRole('navigation', { name: 'Report pages', exact: true });
      const summary = picker.locator('summary');
      for (const report of reports) await test.step(report.label.en, async () => {
        await summary.click();
        const select = picker.getByLabel('Choose report', { exact: true });
        await expect(select).toBeVisible();
        await select.selectOption(report.id);
        await expect(summary).toContainText(report.label.en);
        await summary.click();
        const content = page.locator(`[data-report-view="${report.id}"]`);
        await expect(content, `${report.id} finished importing`).toBeVisible({ timeout: 15_000 });
        await expect(content.locator('[data-report-skeleton]:visible')).toHaveCount(0);
        await waitForFiniteAnimations(page);
        expect.soft(await measureReport(root), `${report.label.en} in ${theme} at ${WIDTH}px`).toEqual([]);
      });
      expect(crashes).toEqual([]);
    });
  }
}
