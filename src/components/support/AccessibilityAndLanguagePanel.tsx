import React, { useMemo, useState } from 'react';
import { Accessibility, CheckCircle2, Languages } from 'lucide-react';
import { auditScreenTranslations, SCREEN_TRANSLATION_TABLE } from '../../lib/i18n/screenTranslations';
import { useUIStore } from '../../stores/useUIStore';

interface AccessibilityAndLanguagePanelProps {
  onOpenSupport?: () => void;
}

export default function AccessibilityAndLanguagePanel({ onOpenSupport }: AccessibilityAndLanguagePanelProps) {
  const language = useUIStore(state => state.language);
  const setLanguage = useUIStore(state => state.setLanguage);
  const [selectedScreen, setSelectedScreen] = useState<string>(SCREEN_TRANSLATION_TABLE[0].screenId);
  const auditRows = useMemo(() => auditScreenTranslations(), []);
  const activeBundle =
    SCREEN_TRANSLATION_TABLE.find(bundle => bundle.screenId === selectedScreen) ??
    SCREEN_TRANSLATION_TABLE[0];

  return (
    <div dir={language === 'he' ? 'rtl' : 'ltr'} className="space-y-6">
      <section
        aria-labelledby="accessibility-statement-heading"
        className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="accessibility-statement-heading" className="text-base font-bold text-[var(--text)] flex items-center gap-2">
              <Accessibility className="w-4 h-4 text-[var(--brass)]" aria-hidden="true" />
              {language === 'he'
                ? 'הצהרת נגישות (יעד תאימות: WCAG 2.1 AA)'
                : 'Accessibility Statement (Target Standard: WCAG 2.1 AA)'}
            </h3>
            <p className="text-sm text-[var(--muted)] mt-1">
              {language === 'he'
                ? 'נבדק אוטומטית עם axe-core בערכות נושא בהירה וכהה, בניווט מקלדת מלא ובהגדלת תצוגה עד 200%.'
                : 'Verified automatically with axe-core 4.14 across light and dark themes, keyboard navigation, and 390px mobile viewports.'}
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-[var(--line)] overflow-hidden" role="group" aria-label="Accessibility panel language">
            <button
              type="button"
              onClick={() => setLanguage('en')}
              aria-pressed={language === 'en'}
              className={`min-h-11 px-3 text-xs font-medium ${language === 'en' ? 'bg-[var(--text)] text-[var(--bg)]' : 'bg-[var(--surface)] text-[var(--text)]'}`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setLanguage('he')}
              aria-pressed={language === 'he'}
              className={`min-h-11 px-3 text-xs font-medium ${language === 'he' ? 'bg-[var(--text)] text-[var(--bg)]' : 'bg-[var(--surface)] text-[var(--text)]'}`}
            >
              עברית
            </button>
          </div>
        </div>

        <ul className="space-y-2 text-sm text-[var(--text)]">
          <li>
            <strong>{language === 'he' ? 'ניגודיות וצבע:' : 'Contrast & colour independence:'}</strong>{' '}
            {language === 'he'
              ? 'יחס ניגודיות של לפחות 4.5:1 בטקסט, וסימון מספרי מפורש (+ / −) בנוסף לצבע.'
              : 'Minimum 4.5:1 contrast across light and dark themes, with explicit +/- signs alongside colour.'}
          </li>
          <li>
            <strong>{language === 'he' ? 'ניווט מקלדת וחלונות:' : 'Keyboard & dialogs:'}</strong>{' '}
            {language === 'he'
              ? 'כל החלונות לוכדים פוקוס, נסגרים ב-Escape ומחזירים פוקוס לכפתור המפעיל; לחצו ? לרשימת הקיצורים.'
              : 'Every modal traps focus, closes with Escape, and restores focus to its trigger; press ? anywhere for shortcuts.'}
          </li>
          <li>
            <strong>{language === 'he' ? 'מגבלות ידועות וחלופות:' : 'Known limitations & alternatives:'}</strong>{' '}
            {language === 'he'
              ? 'לגרפים מורכבים מצורפת תצוגת טבלה נגישה לקוראי מסך; לייבוא בנק זמינה העלאת CSV/OFX/QFX נגישה במקלדת.'
              : 'Interactive charts include accessible Table switches; native CSV/OFX/QFX upload complements external bank widgets.'}
          </li>
        </ul>

        {onOpenSupport && (
          <button
            type="button"
            onClick={onOpenSupport}
            className="btn-secondary min-h-11 px-4 rounded-lg text-xs font-semibold"
          >
            {language === 'he' ? 'דיווח על בעיית נגישות בתמיכה' : 'Report an accessibility barrier'}
          </button>
        )}
      </section>

      <section
        aria-labelledby="screen-translations-heading"
        className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 space-y-4"
      >
        <div>
          <h3 id="screen-translations-heading" className="text-base font-bold text-[var(--text)] flex items-center gap-2">
            <Languages className="w-4 h-4 text-[var(--brass)]" aria-hidden="true" />
            {language === 'he'
              ? 'בדיקת כיסוי תרגום מסכים (אנגלית / עברית)'
              : 'Screen Translation Coverage & Terminology Reference (EN / HE)'}
          </h3>
          <p className="text-xs text-[var(--muted)] mt-1">
            {language === 'he'
              ? 'מציג את כל מפתחות התרגום לפי מסך ומאתר מפתחות חסרים ללא שבירת ברירת המחדל באנגלית.'
              : 'Inspects English and Hebrew UI strings across all 12 core screen areas while keeping English default unchanged.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Select screen translation bundle">
          {auditRows.map(row => (
            <button
              key={row.screenId}
              type="button"
              onClick={() => setSelectedScreen(row.screenId)}
              aria-pressed={selectedScreen === row.screenId}
              className={`min-h-11 px-3 rounded-lg text-xs font-medium border inline-flex items-center gap-1.5 ${
                selectedScreen === row.screenId
                  ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]'
                  : 'bg-[var(--surface)] text-[var(--text)] border-[var(--line)]'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--pos)]" aria-hidden="true" />
              <bdi>{language === 'he' ? row.screenNameHe : row.screenNameEn}</bdi>
              <span className="opacity-80 tabular-nums">({row.translatedHeCount}/{row.totalKeys})</span>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">English and Hebrew UI strings for {activeBundle.screenNameEn}</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                <th scope="col" className="text-left py-2 pr-3">Key</th>
                <th scope="col" className="text-left py-2 pr-3">English (`en`)</th>
                <th scope="col" className="text-right py-2 pl-3">Hebrew (`he`)</th>
              </tr>
            </thead>
            <tbody>
              {activeBundle.strings.map(item => (
                <tr key={item.key} className="border-b border-[var(--line)]/60">
                  <td className="py-2 pr-3 font-mono text-xs text-[var(--muted)]">{item.key}</td>
                  <td className="py-2 pr-3 text-[var(--text)]">{item.en}</td>
                  <td className="py-2 pl-3 text-right text-[var(--text)]" dir="rtl"><bdi>{item.he}</bdi></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
