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

/** The A-233 contract on screen: a real 44 px box, reachable by scrolling its own box, fully visible. */
async function expect44px(button: Locator, name: string) {
  await expect(button, `${name} is on the screen`).toHaveCount(1);

  const scrolled = await button.evaluate((el, width) => {
    const inside = (r: DOMRect) => r.left >= 0 && r.right <= width + 0.5;
    const rect = el.getBoundingClientRect();
    if (inside(rect)) return { state: 'already-visible' as const };
    // Walk up to the first ancestor that can actually scroll horizontally — the A-233 scroll box.
    let box: HTMLElement | null = el.parentElement;
    while (box && box !== document.body && box !== document.documentElement && box.scrollWidth <= box.clientWidth + 1) {
      box = box.parentElement;
    }
    if (!box || box === document.body || box === document.documentElement) return { state: 'no-scroll-box' as const };
    const before = box.scrollLeft;
    const boxRect = box.getBoundingClientRect();
    // Scroll the box, not the page, until the button's left edge sits at the box's left edge.
    box.scrollTo({ left: before + (rect.left - boxRect.left), behavior: 'instant' });
    const after = box.scrollLeft;
    return { state: 'scrolled' as const, boxFits: boxRect.left >= 0 && boxRect.right <= width + 0.5, before, after };
  }, WIDTH);

  expect(
    scrolled.state,
    `${name} is behind the table's edge and no inner scroll box reaches it — the A-233 scroll box is missing`,
  ).not.toBe('no-scroll-box');
  if (scrolled.state === 'scrolled') {
    expect(scrolled.boxFits, `${name}'s scroll box itself must fit the ${WIDTH} px phone`).toBe(true);
  }

  // Let any smooth-scroll or relayout settle, then measure where the button really is.
  await expect
    .poll(
      async () => {
        const b = await button.boundingBox();
        return b ? Math.max(0, b.x + b.width - WIDTH, -b.x) : 1;
      },
      { message: `${name} settles fully inside the ${WIDTH} px viewport after its scroll box is scrolled` },
    )
    .toBeLessThanOrEqual(1);

  // Intersection-based: bounding-box arithmetic alone can pass on a clipped button.
  await expect(button, `${name} is fully visible, not clipped by an ancestor`).toBeInViewport({ ratio: 1 });

  const box = await button.boundingBox();
  expect(box, `${name} has a rendered box`).not.toBeNull();
  expect(box!.width, `${name} is at least 44 px wide`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${name} is at least 44 px tall`).toBeGreaterThanOrEqual(44);
  expect(box!.x, `${name} is not clipped on the left`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${name} is not clipped at the top`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${name} is not clipped on the right`).toBeLessThanOrEqual(WIDTH);
  expect(box!.y + box!.height, `${name} is not clipped at the bottom`).toBeLessThanOrEqual(844);

  // Scrolling the box must not have moved the page itself.
  expect(
    await button.evaluate(() => document.documentElement.scrollLeft),
    `${name}: the page itself must not scroll sideways`,
  ).toBe(0);
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
