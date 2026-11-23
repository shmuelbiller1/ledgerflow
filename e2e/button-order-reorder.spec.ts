import { test, expect, type Page } from '@playwright/test';
import { mountJourney, captured } from './support/journeyFixture';

const sidebar = {
  module: '/src/components/layout/Sidebar.tsx',
  props: {
    activeTab: 'dashboard',
    setActiveTab: '__capture:tab',
    onLogout: '__fn:noop',
    projects: [],
    onNewProject: '__fn:noop',
    workspaces: [],
    currentWorkspaceId: 'order-workspace-a',
    onSelectWorkspace: '__fn:noop',
    onNewWorkspace: '__fn:noop',
    onAction: '__fn:noop',
  },
};

const mountSidebar = async (page: Page, workspaceId: string) => {
  const handle = await mountJourney(page, {
    workspaceId,
    ledger: {},
    mounts: [{ ...sidebar, props: { ...sidebar.props, currentWorkspaceId: workspaceId } }],
  });
  await page.evaluate(async () => {
    const [{ useUIStore }, { useAuthStore }] = await Promise.all([
      import('/src/stores/useUIStore.ts'),
      import('/src/stores/useAuthStore.ts'),
    ]);
    useUIStore.setState({ isSidebarOpen: true, isProMode: false, developerMode: false, language: 'en' });
    const state = useAuthStore.getState();
    useAuthStore.setState({ workspaces: [
      ...state.workspaces,
      { id: 'order-workspace-b', uid: 'journey-user', name: 'Second books', currency: 'USD', roles: { 'journey-user': 'owner' } },
    ] });
  });
  const daily = page.getByRole('navigation', { name: 'Daily tools', exact: true });
  await expect(daily.locator('[data-reorder-item]')).toHaveCount(8);
  return { ...handle, daily };
};

const labels = async (daily: ReturnType<Page['getByRole']>) =>
  daily.locator('[data-reorder-item]').evaluateAll(items => items.map(item => item.textContent?.trim() ?? ''));

const center = async (locator: ReturnType<Page['locator']>) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected reorder button to have a visible browser box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};

const dragMouse = async (page: Page, source: ReturnType<Page['locator']>, target: ReturnType<Page['locator']>, before = true) => {
  const from = await center(source);
  const to = await center(target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Stay clearly inside the target's before/after half while exercising real pointer capture and layout.
  await page.mouse.move(to.x, to.y + (before ? -to.box.height * 0.35 : to.box.height * 0.35), { steps: 6 });
  await page.mouse.up();
};

test('sidebar tool order uses real pointer input, survives reload, stays workspace-scoped, and Escape cancels the held release', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'false');
    localStorage.setItem('has_seen_onboarding', 'true');
  });
  const { daily, errors } = await mountSidebar(page, 'order-workspace-a');
  const standard = await labels(daily);
  expect(standard).toEqual(['Overview', 'To review', 'AI assistant', 'Sales', 'Purchases', 'Bank', 'Reports', 'Settings']);

  // Drag Reports before Sales through the real browser's pointer lifecycle; the drop must not activate it.
  await dragMouse(page, daily.locator('[data-reorder-item="reports"]'), daily.locator('[data-reorder-item="sales"]'));
  const workspaceAOrder = ['Overview', 'To review', 'AI assistant', 'Reports', 'Sales', 'Purchases', 'Bank', 'Settings'];
  await expect(daily.locator('[data-reorder-item]')).toHaveText(workspaceAOrder);
  expect(await captured(page, 'tab')).toEqual([]);

  // Cancel after the gesture has become a drag, while the mouse is still down, then release over its source.
  const source = daily.locator('[data-reorder-item="reports"]');
  const target = daily.locator('[data-reorder-item="settings"]');
  const from = await center(source);
  const to = await center(target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y - to.box.height * 0.35, { steps: 5 });
  await expect(source).toHaveAttribute('data-reorder-dragging', 'true');
  await page.keyboard.press('Escape');
  await page.mouse.move(from.x, from.y);
  await page.mouse.up();
  await expect(daily.locator('[data-reorder-item]')).toHaveText(workspaceAOrder);
  expect(await captured(page, 'tab')).toEqual([]);
  // The cancellation guard expires with the pointer sequence; an ordinary click still navigates.
  await source.click();
  expect(await captured(page, 'tab')).toEqual([['reports']]);
  expect(errors).toEqual([], 'the real mouse-drag, cancel, and click phase must not throw');

  // A browser reload discards React state; remount the same signed-in user/workspace from localStorage.
  await page.reload();
  await page.unrouteAll({ behavior: 'wait' });
  const reloaded = await mountSidebar(page, 'order-workspace-a');
  await expect(reloaded.daily.locator('[data-reorder-item]')).toHaveText(workspaceAOrder);

  // Switch only the active workspace. It has no custom order until the user changes it there.
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    useAuthStore.setState({ currentWorkspaceId: 'order-workspace-b' });
  });
  await expect(reloaded.daily.locator('[data-reorder-item]')).toHaveText(standard);
  await dragMouse(page, reloaded.daily.locator('[data-reorder-item="settings"]'), reloaded.daily.locator('[data-reorder-item="dashboard"]'));
  const workspaceBOrder = ['Settings', 'Overview', 'To review', 'AI assistant', 'Sales', 'Purchases', 'Bank', 'Reports'];
  await expect(reloaded.daily.locator('[data-reorder-item]')).toHaveText(workspaceBOrder);

  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    useAuthStore.setState({ currentWorkspaceId: 'order-workspace-a' });
  });
  await expect(reloaded.daily.locator('[data-reorder-item]')).toHaveText(workspaceAOrder);
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    useAuthStore.setState({ currentWorkspaceId: 'order-workspace-b' });
  });
  await expect(reloaded.daily.locator('[data-reorder-item]')).toHaveText(workspaceBOrder);
  expect(reloaded.errors).toEqual([]);
});

test('phone touch swipe scrolls the sidebar; a long press then drag reorders without scrolling', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3000', viewport: { width: 390, height: 650 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      localStorage.setItem('isGuest', 'false');
      localStorage.setItem('has_seen_onboarding', 'true');
    });
    const { daily, errors } = await mountSidebar(page, 'order-workspace-a');
    const sidebarNav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    const scroller = sidebarNav.locator(':scope > div').nth(1);
    const cdp = await context.newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) => {
      await cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ id: 1, x: x!, y: y!, radiusX: 2, radiusY: 2, force: 1 }],
      });
    };

    const scrollerBox = await scroller.boundingBox();
    if (!scrollerBox) throw new Error('Expected the phone sidebar list to be visible');
    const scrollMetrics = await scroller.evaluate(element => ({ client: element.clientHeight, total: element.scrollHeight }));
    expect(scrollMetrics.total).toBeGreaterThan(scrollMetrics.client);
    const initialScroll = await scroller.evaluate(element => element.scrollTop);
    const swipeButton = await center(daily.locator('[data-reorder-item="sales"]'));
    const swipeX = swipeButton.x;
    const swipeStart = swipeButton.y;
    await touch('touchStart', swipeX, swipeStart);
    await touch('touchMove', swipeX, swipeStart - 70);
    await touch('touchMove', swipeX, swipeStart - 150);
    await touch('touchEnd');
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(initialScroll);
    expect(await captured(page, 'tab')).toEqual([], 'a swipe beginning on a tool scrolls instead of activating it');

    // Reset to a known visual state, then hold on Reports before dragging it above Sales.
    await scroller.evaluate(element => { element.scrollTop = 0; });
    await daily.locator('[data-reorder-item="reports"]').scrollIntoViewIfNeeded();
    const from = await center(daily.locator('[data-reorder-item="reports"]'));
    const target = await center(daily.locator('[data-reorder-item="sales"]'));
    const scrollBeforeHold = await scroller.evaluate(element => element.scrollTop);
    await touch('touchStart', from.x, from.y);
    await page.waitForTimeout(450); // use the hook's real 350ms long-press threshold
    await touch('touchMove', target.x, target.y - target.box.height * 0.35);
    await expect(daily.locator('[data-reorder-item="reports"]')).toHaveAttribute('data-reorder-dragging', 'true');
    await touch('touchEnd');
    await expect(daily.locator('[data-reorder-item]')).toHaveText(['Overview', 'To review', 'AI assistant', 'Reports', 'Sales', 'Purchases', 'Bank', 'Settings']);
    expect(await scroller.evaluate(element => element.scrollTop)).toBe(scrollBeforeHold);
    expect(errors).toEqual([]);
    await cdp.detach();
  } finally {
    await context.close();
  }
});
