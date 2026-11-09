/**
 * A browser-like document for component tests (jsdom). Import this first in a *.test.tsx file.
 * The app's database layer is never reached: tests stub fetch and the stores.
 *
 * "first" is not a style point: @testing-library/dom reads `document` off the global when it loads, so
 * importing it (or @testing-library/react) before this file leaves every `screen` query reporting that
 * there is no document — while `render` goes on working, which makes it look like something else.
 */
import 'global-jsdom/register';
import { GoTrueClient } from '@supabase/auth-js';
import { RealtimeClient } from '@supabase/realtime-js';

GoTrueClient.prototype.dispose = async function() {};
RealtimeClient.prototype.disconnect = async function() {
  try {
    (this as unknown as { _terminateWorker?: () => void })._terminateWorker?.();
  } catch { /* ignore */ }
  return 'ok';
};

// Node.js BroadcastChannel creates MessagePort handles that keep the event loop alive in test runner.
if (typeof globalThis.BroadcastChannel === 'function') {
  const OriginalBroadcastChannel = globalThis.BroadcastChannel;
  class UnrefBroadcastChannel extends OriginalBroadcastChannel {
    constructor(name: string) {
      super(name);
      (this as unknown as { unref?: () => void }).unref?.();
    }
  }
  (globalThis as unknown as { BroadcastChannel: typeof BroadcastChannel }).BroadcastChannel = UnrefBroadcastChannel as unknown as typeof BroadcastChannel;
}

// jsdom has no layout; motion and some widgets ask for these
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (!('ResizeObserver' in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
// Prevent JSDOM from throwing "Not implemented: navigation" on anchor download clicks
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.tagName === 'A' || target?.closest?.('a')) {
      e.preventDefault();
    }
  }, true);
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** fetch that answers every call with `status` and records the URLs asked for. */
export function stubFetch(status = 404, body: unknown = {}): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return urls;
}

export interface FetchCall { url: string; method: string; body: unknown }

/** fetch that answers every call with `status` and records URL, method and JSON body (live array). */
export function stubFetchWithBodies(status = 404, body: unknown = {}): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method || 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}
