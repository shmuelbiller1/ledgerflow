export type UiLanguage = 'en' | 'he';

/** Apply the document language and writing direction for the selected UI language. */
export function applyUiLanguage(
  language: UiLanguage,
  root: Pick<HTMLElement, 'dir' | 'lang'>,
): void {
  root.dir = language === 'he' ? 'rtl' : 'ltr';
  root.lang = language === 'he' ? 'he' : 'en';
}
