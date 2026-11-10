import type { Locator } from '@playwright/test';

/**
 * Browser-side: every horizontal scroll box inside the region that sticks out of the phone
 * without a fitting scroller around it. A box wider than the phone is fine when a fitting
 * scroller contains it (its columns stay reachable there); a box clipped by the shell is not.
 */
export function scrollBoxProblemsInPage(root: Element): string[] {
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
  return problems;
}

/** Node-side: run the scroll-box check inside the given region of the page. */
export async function scrollBoxProblems(region: Locator): Promise<string[]> {
  return region.evaluate(scrollBoxProblemsInPage);
}
