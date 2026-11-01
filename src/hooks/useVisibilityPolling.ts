import { useEffect, useRef } from 'react';

export interface VisibilityPollingOptions {
  /** Whether recurring polling is active. Default: true. */
  enabled?: boolean;
  /** Run callback once immediately when `enabled` becomes true. Default: false. */
  runImmediately?: boolean;
  /** Run an immediate catch-up poll when the tab becomes visible or regains connectivity. Default: true. */
  refreshOnResume?: boolean;
  /** Minimum elapsed ms before a resume event triggers an immediate poll. Default: 1000. */
  minResumeIntervalMs?: number;
}

/**
 * Returns true when the browser tab is visible and not explicitly offline.
 * Safe in SSR / Node test environments where `document` or `navigator` may be partial.
 */
export function isClientActiveForPolling(): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return false;
  }
  const nav =
    typeof window !== 'undefined' && window.navigator
      ? window.navigator
      : typeof navigator !== 'undefined'
        ? navigator
        : undefined;
  if (nav && nav.onLine === false) {
    return false;
  }
  return true;
}

/** Marks a Node timer as unreferenced so open test suites are not kept alive by idle pollers. */
function unrefTimer(timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>): void {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref();
  }
}

/**
 * Runs `callback` on `intervalMs` only while `enabled` is true and the client tab is
 * visible and online, deduplicating overlapping in-flight executions and optionally
 * refreshing immediately when the user returns to the tab or reconnects.
 */
export function useVisibilityPolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  options: VisibilityPollingOptions = {},
): void {
  const {
    enabled = true,
    runImmediately = false,
    refreshOnResume = true,
    minResumeIntervalMs = 1_000,
  } = options;

  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const lastRunAtRef = useRef(0);
  const wasPausedRef = useRef(false);
  const inFlightRef = useRef(false);
  const pendingCatchUpRef = useRef(false);
  const activeExecuteRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) {
      pendingCatchUpRef.current = false;
      activeExecuteRef.current = null;
      return undefined;
    }

    let cancelled = false;

    const execute = async (fromCatchUp = false) => {
      if (cancelled) return;
      if (inFlightRef.current) {
        if (fromCatchUp) {
          pendingCatchUpRef.current = true;
        }
        return;
      }
      pendingCatchUpRef.current = false;
      inFlightRef.current = true;
      lastRunAtRef.current = Date.now();
      try {
        await callbackRef.current();
      } finally {
        inFlightRef.current = false;
        if (pendingCatchUpRef.current) {
          pendingCatchUpRef.current = false;
          const nextExecute = !cancelled ? execute : activeExecuteRef.current;
          if (nextExecute && isClientActiveForPolling()) {
            wasPausedRef.current = false;
            void nextExecute();
          } else {
            wasPausedRef.current = true;
          }
        }
      }
    };

    const runCatchUp = () => execute(true);
    activeExecuteRef.current = runCatchUp;

    let initialTimer: ReturnType<typeof setTimeout> | null = null;
    if (runImmediately) {
      initialTimer = setTimeout(() => {
        if (!isClientActiveForPolling()) {
          wasPausedRef.current = true;
          return;
        }
        void execute();
      }, 0);
      unrefTimer(initialTimer);
    } else if (!isClientActiveForPolling()) {
      wasPausedRef.current = true;
    }

    const interval = setInterval(() => {
      if (!isClientActiveForPolling()) {
        wasPausedRef.current = true;
        return;
      }
      wasPausedRef.current = false;
      void execute();
    }, intervalMs);
    unrefTimer(interval);

    const handleResume = () => {
      if (!isClientActiveForPolling()) {
        wasPausedRef.current = true;
        return;
      }
      const elapsed = Date.now() - lastRunAtRef.current;
      if (refreshOnResume && (wasPausedRef.current || elapsed >= intervalMs) && elapsed >= minResumeIntervalMs) {
        if (inFlightRef.current) {
          pendingCatchUpRef.current = true;
          return;
        }
        wasPausedRef.current = false;
        void execute(true);
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleResume);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleResume);
    }

    return () => {
      cancelled = true;
      if (activeExecuteRef.current === runCatchUp) {
        activeExecuteRef.current = null;
      }
      if (initialTimer !== null) clearTimeout(initialTimer);
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleResume);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleResume);
      }
    };
  }, [enabled, intervalMs, minResumeIntervalMs, refreshOnResume, runImmediately]);
}
