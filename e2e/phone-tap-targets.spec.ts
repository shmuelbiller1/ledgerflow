import { test, expect, type Locator } from '@playwright/test';
import { mountJourney } from './support/journeyFixture';

/**
 * A-257(3) (CodeRabbit follow-up on PR #436): on a phone (390 px), the customer and vendor row
 * buttons are real targets — the rendered box measures at least 44 × 44 px and sits whole inside
 * the viewport, not clipped by the table's scroll box. The jsdom companion
 * (src/tests/phone-tap-targets.test.tsx, A-233) can only check the min-h-11/min-w-11 classes;
 * this spec measures the pixels, with one customer and one vendor actually listed.
 *
 * The A-233 contract this enforces: the row's actions live in a horizontal scroll box that fits
 * the phone, so the reader scrolls the box — never the page — to reach them. The spec scrolls that
 * box itself (programmatic `scrollIntoViewIfNeeded` moves the page on this fixed-position screen
 * and leaves the button pinned off-viewport, which is precisely the untestable-by-layout-box trap
 * CodeRabbit #440's note is about): a button that is invisible, unscrollable-to or clipped fails,
 * even when its layout `boundingBox()` happens to fit.
 */

const WIDTH = 390;

/** A compact dump of the button's ancestor chain, for the CI annotation when measurement fails. */
async function ancestorDump(button: Locator): Promise<string> {
  return button.evaluate((el) => {
    const out: string[] = [];
    let node: HTMLElement | null = el;
    for (let i = 0; node && i < 8; i++, node = node.parentElement) {
      const cs = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      out.push(
        `${node.tagName}.${String(node.className).split(' ').slice(0, 3).join('.')}` +
        `[ox=${cs.overflowX},sw=${node.scrollWidth},cw=${node.clientWidth},sl=${Math.round(node.scrollLeft)},x=${Math.round(r.left)}-${Math.round(r.right)}]`,
      );
    }
    return out.join(' < ');
  });
}

/** The A-233 contract on screen: a real 44 px box, reachable with the page, fully visible. */
async function expect44px(button: Locator, name: string) {
  await expect(button, `${name} is on the screen`).toHaveCount(1);
  // Playwright's own actionability check does the scrolling it stands behind (children of inner
  // scroll boxes included) and verifies the button is hit-testable where it lands — a clipped or
  // off-viewport button fails here with the actionable-not-reachable error.
  await button.click({ trial: true });

  const box = await button.boundingBox();
  expect(box, `${name} has a rendered box after the trial click scrolled it into view`).not.toBeNull();
  const geom =
    `box=${box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}` : 'null'} ` +
    `chain=${await ancestorDump(button)}`;
  expect(box!.width, `${name} is at least 44 px wide | ${geom}`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${name} is at least 44 px tall | ${geom}`).toBeGreaterThanOrEqual(44);
  expect(box!.x, `${name} is not clipped on the left | ${geom}`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${name} is not clipped on the right of the ${WIDTH} px viewport | ${geom}`).toBeLessThanOrEqual(WIDTH);
  expect(box!.y, `${name} is not clipped at the top | ${geom}`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${name} is not clipped at the bottom | ${geom}`).toBeLessThanOrEqual(844);

  // Intersection-based: bounding-box arithmetic alone can pass on an ancestor-clipped button.
  await expect(button, `${name} is fully visible, not clipped by an ancestor | ${geom}`).toBeInViewport({ ratio: 1 });
}

/** The page itself fits the phone on these screens (A-233): the lists carry their own scroll. */
async function expectNoSidewaysPageScroll(page: import('@playwright/test').Page) {
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
}

test.use({ reducedMotion: 'reduce' });

test('a customer row at 390 px: Enter Invoice, Archive and Delete measure 44 px and are not clipped', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: WIDTH, height: 844 });
  const { errors } = await mountJourney(page, {
    workspaceId: 'tap-targets-customers',
    ledger: {
      customers: [{ id: 'c1', uid: 'journey-user', workspaceId: 'tap-targets-customers', name: 'Acme Corp', status: 'active', email: 'acme@example.test', phone: '', balanceCents: 0 }],
    },
    mounts: [{ module: '/src/components/sales/Sales.tsx' }],
  });
  await page.getByRole('button', { name: 'Customers & Clients', exact: true }).click();
  await expect(page.getByText('Acme Corp', { exact: true }).first()).toBeVisible();
  await expectNoSidewaysPageScroll(page);
  await expect44px(page.locator('button[title="Enter Invoice"]'), 'Enter Invoice');
  await expect44px(page.getByRole('button', { name: 'Archive Acme Corp', exact: true }), 'Archive Acme Corp');
  await expect44px(page.getByRole('button', { name: 'Delete Acme Corp', exact: true }), 'Delete Acme Corp');
  await expectNoSidewaysPageScroll(page);
  expect(errors).toEqual([]);
});

test('a vendor row at 390 px: Archive and Delete measure 44 px and are not clipped', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: WIDTH, height: 844 });
  const { errors } = await mountJourney(page, {
    workspaceId: 'tap-targets-vendors',
    ledger: {
      vendors: [{ id: 'v1', uid: 'journey-user', workspaceId: 'tap-targets-vendors', name: 'Parts Ltd', status: 'active', category: 'Supplies', email: '', phone: '', balanceCents: 0 }],
    },
    mounts: [{ module: '/src/components/purchases/Purchases.tsx' }],
  });
  await page.getByRole('button', { name: /^Vendors/ }).click();
  await expect(page.getByText('Parts Ltd', { exact: true }).first()).toBeVisible();
  await expectNoSidewaysPageScroll(page);
  await expect44px(page.getByRole('button', { name: 'Archive Parts Ltd', exact: true }), 'Archive Parts Ltd');
  await expect44px(page.getByRole('button', { name: 'Delete Parts Ltd', exact: true }), 'Delete Parts Ltd');
  await expectNoSidewaysPageScroll(page);
  expect(errors).toEqual([]);
});
