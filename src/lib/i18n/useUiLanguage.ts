import { useUIStore } from '../../stores/useUIStore';
import type { UiLanguage } from './uiLanguage';

/**
 * The language prop the app passes to screens that are shown before sign-in (it is the same
 * persisted value as `useUIStore.language`, read once in `App.tsx`). Screens accept either this or a
 * `UiLanguage`; both are the two supported tags.
 */
export type UiLanguageTag = UiLanguage;

/**
 * AI12-N10-01 (#838): the language the reader selected in Accessibility & language.
 *
 * `useUIStore.language` is already persisted (`lf_language`) and already sets the document's
 * `lang`/`dir`, so the four screens a person meets before they have books read the same choice here
 * instead of printing English inside a right-to-left page. Nothing new is stored.
 */
export function useUiLanguage(): UiLanguage {
  return useUIStore(state => state.language);
}

/** Writing direction for a screen that sets it on its own container as well as on the document. */
export function directionOf(language: UiLanguage): 'rtl' | 'ltr' {
  return language === 'he' ? 'rtl' : 'ltr';
}
