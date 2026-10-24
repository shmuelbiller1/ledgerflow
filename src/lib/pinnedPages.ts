/**
 * Pinned pages (I-21, owner request). Every page can be pinned; pinned pages are one click (and
 * Alt+1 … Alt+9) away from every other page. A page is a main tab, plus the report or settings
 * tab inside it.
 */
export interface PinnedPage { tab: string; sub?: string }

export const MAX_PINNED = 9;
const SUB_TABS = new Set(['reports', 'settings']);

export const pageKey = (p: PinnedPage) => (p.sub ? `${p.tab}/${p.sub}` : p.tab);

/** The page being shown: the report or settings tab counts as part of it. */
export function currentPage(state: { activeTab: string; activeReportTab?: string | null; activeSettingsTab?: string | null }): PinnedPage {
  const sub = state.activeTab === 'reports' ? state.activeReportTab : state.activeTab === 'settings' ? state.activeSettingsTab : null;
  return sub ? { tab: state.activeTab, sub } : { tab: state.activeTab };
}

/** Pins the page, or unpins it when it is pinned; at most MAX_PINNED (then unchanged). */
export function togglePinned(list: PinnedPage[], page: PinnedPage): PinnedPage[] {
  const key = pageKey(page);
  if (list.some(p => pageKey(p) === key)) return list.filter(p => pageKey(p) !== key);
  if (list.length >= MAX_PINNED) return list;
  return [...list, page.sub && SUB_TABS.has(page.tab) ? { tab: page.tab, sub: page.sub } : { tab: page.tab }];
}

/** Saved pins, ignoring anything malformed. An allowlist is required for synced/untrusted data. */
export function normalizePinned(value: unknown, validPageKeys?: ReadonlySet<string>): PinnedPage[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(v => {
    if (!v || typeof v !== 'object' || typeof (v as PinnedPage).tab !== 'string' || !(v as PinnedPage).tab) return [];
    const page: PinnedPage = typeof (v as PinnedPage).sub === 'string' && (v as PinnedPage).sub ? { tab: (v as PinnedPage).tab, sub: (v as PinnedPage).sub } : { tab: (v as PinnedPage).tab };
    const key = pageKey(page);
    if (seen.has(key) || (validPageKeys && !validPageKeys.has(key))) return [];
    seen.add(key);
    return [page];
  }).slice(0, MAX_PINNED);
}

/** Device-local pins from older versions did not have a route allowlist. */
export function parsePinned(raw: string | null): PinnedPage[] {
  try {
    return normalizePinned(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}
