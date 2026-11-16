/** EU-G1: the Reports text helper. `reportText(key, englishFallback)` answers in the person's language. */
import { useCallback } from 'react';
import { useUIStore } from '../../stores/useUIStore';
import { translateScreenString } from '../../lib/i18n/screenTranslations';

export function useReportText() {
  const language = useUIStore(s => s.language);
  return useCallback((key: string, fallback: string) => translateScreenString('reports', key, language, fallback), [language]);
}

/** Puts values into a translated template: fill('Open {name}', { name }) — the value is inserted as is, `$` included. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}
