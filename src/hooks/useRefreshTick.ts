import { useEffect, useState } from 'react';

/**
 * BC-04: a number that goes up when the tab comes back into view and every `everyMs` while it is in
 * view, for a widget that reads from the server once (the live lists update themselves): put it in
 * the reading effect's dependencies and the widget reads again.
 */
export function useRefreshTick(everyMs = 5 * 60_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => { if (document.visibilityState === 'visible') setTick(t => t + 1); };
    const timer = setInterval(bump, everyMs);
    if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    document.addEventListener('visibilitychange', bump);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', bump); };
  }, [everyMs]);
  return tick;
}
