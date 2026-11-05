import type { Page } from '@playwright/test';

/** Observe the real screen subtree; include recent-input shifts rather than exempting them. */
export async function observeMainLayout(page: Page) {
  await page.evaluate(async () => {
    if (!PerformanceObserver.supportedEntryTypes.includes('layout-shift')) throw new Error('Layout-shift observation is required');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const root = document.getElementById('root')!;
    const state = { value: 0, entries: 0 };
    const consume = (entries: PerformanceEntry[]) => {
      for (const entry of entries) {
        const shift = entry as PerformanceEntry & { value: number; sources?: Array<{ node?: Node }> };
        if (shift.sources?.some(source => source.node && root.contains(source.node))) {
          state.value += shift.value;
          state.entries++;
        }
      }
    };
    const observer = new PerformanceObserver(list => consume(list.getEntries()));
    observer.observe({ type: 'layout-shift' });
    Object.assign(window, { __loadingLayout: { state, observer, consume } });
  });
}

export async function readMainLayout(page: Page, stop = true) {
  return page.evaluate(stop => {
    const { state, observer, consume } = (window as unknown as { __loadingLayout: {
      state: { value: number; entries: number }; observer: PerformanceObserver; consume: (entries: PerformanceEntry[]) => void;
    } }).__loadingLayout;
    consume(observer.takeRecords());
    if (stop) observer.disconnect();
    return state;
  }, stop);
}
