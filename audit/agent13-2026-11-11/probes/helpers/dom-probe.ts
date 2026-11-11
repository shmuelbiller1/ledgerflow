/** jsdom for the Agent #13 probes: the same setup src/tests/helpers/dom.ts uses. */
import 'global-jsdom/register';
import { GoTrueClient } from '@supabase/auth-js';
import { RealtimeClient } from '@supabase/realtime-js';

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (!('ResizeObserver' in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
RealtimeClient.prototype.disconnect = async function disconnect() { return 'ok'; };
GoTrueClient.prototype.dispose = async function dispose(this: { stopAutoRefresh?: () => void }) { this.stopAutoRefresh?.(); };
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
