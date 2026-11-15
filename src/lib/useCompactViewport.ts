import { useEffect, useState } from 'react';

const COMPACT_QUERY = '(max-width: 639px)';

function readsCompact(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    const mql = window.matchMedia(COMPACT_QUERY);
    // Notice jsdom's stub matchMedia returns matches:false unless a test installs one,
    // so check innerWidth when window width was explicitly narrowed below 640px.
    if (mql.matches) return true;
  }
  return typeof window.innerWidth === 'number' && window.innerWidth > 0 && window.innerWidth < 640;
}

/**
 * Single-branch responsive detector for 390px phone cards vs desktop table.
 * Returns `false` at default 1024px+ jsdom/desktop viewports so action buttons keep one DOM copy.
 */
export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState<boolean>(() => readsCompact());

  useEffect(() => {
    const sync = () => setCompact(readsCompact());
    sync();
    window.addEventListener('resize', sync);
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia(COMPACT_QUERY) : null;
    mql?.addEventListener?.('change', sync);
    return () => {
      window.removeEventListener('resize', sync);
      mql?.removeEventListener?.('change', sync);
    };
  }, []);

  return compact;
}
