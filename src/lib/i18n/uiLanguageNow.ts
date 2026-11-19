import { useUIStore } from '../../stores/useUIStore';
import type { UiLanguage } from './uiLanguage';

/**
 * AI12-N3: the language a person is reading in, read where a hook cannot be used.
 *
 * Toasts and the shared error reporter are plain functions called from event handlers, not React
 * components, so they cannot call `useUIStore(...)`. `useUIStore.getState()` is the same selector the
 * hook would subscribe to, read once at the moment the message is shown — the store is a module
 * singleton, so this is the current value, not a copy.
 */
export function uiLanguageNow(): UiLanguage {
  return useUIStore.getState().language;
}
