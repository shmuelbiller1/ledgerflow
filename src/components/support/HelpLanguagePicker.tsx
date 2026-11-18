import type { UiLanguage } from '../../lib/i18n/uiLanguage';

/** Both help surfaces use screen-theme colours; --bg exists only in the print stylesheet. */
export default function HelpLanguagePicker({ language, onChange }: {
  language: UiLanguage;
  onChange: (next: UiLanguage) => void;
}) {
  return (
    <div role="group" aria-label={language === 'he' ? 'שפת המדריך' : 'Help language'}
      className="inline-flex overflow-hidden rounded border border-[var(--line)]">
      {(['en', 'he'] as const).map(code => (
        <button key={code} type="button" lang={code} aria-pressed={language === code} onClick={() => onChange(code)}
          className="min-h-11 px-3 text-xs font-medium bg-[var(--surface)] text-[var(--text)] aria-pressed:bg-[var(--text)] aria-pressed:text-[var(--panel)]">
          {code === 'he' ? 'עברית' : 'English'}
        </button>
      ))}
    </div>
  );
}
