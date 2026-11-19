import type { UiLanguage } from './uiLanguage';
import { fillOnboarding } from './onboardingTranslations';

/**
 * AI12-N10-01 (#838): the words of the setup wizard, in English and Hebrew.
 *
 * Kept out of `onboardingTranslations.ts` on purpose, with the chart-template names beside it in
 * `onboardingTemplateCopy.ts`: the wizard is a lazy chunk (a person sees it once, on their first
 * visit), while the sign-in and first-hour guides are on the entry path. Putting this copy in the
 * shared table put it in the first download for every visitor and took the entry bundle past its
 * size budget.
 */
const SETUP_STRINGS = {
  'setup.notSetUp': {
    en: "This workspace isn't set up yet. Ask an owner or accountant to finish the setup.",
    he: 'סביבת העבודה הזו עדיין לא הוגדרה. בקשו מבעל העסק או מרואה החשבון להשלים את ההגדרה.',
  },
  'setup.title': { en: 'Set up your books', he: 'הגדרת הספרים שלכם' },
  'setup.stepsLabel': { en: 'Setup steps', he: 'שלבי ההגדרה' },
  'setup.step.business': { en: 'Your business', he: 'פרטי העסק' },
  'setup.step.chart': { en: 'Chart of accounts', he: 'תרשים החשבונות' },
  'setup.step.done': { en: 'Done', he: 'סיום' },
  'setup.business.heading': { en: 'What kind of business?', he: 'איזה סוג עסק?' },
  'setup.business.legend': {
    en: 'Choose a starting point. You can change the accounts and labels later.',
    he: 'בחרו נקודת התחלה. אפשר לשנות את החשבונות והתגיות אחר כך.',
  },
  'setup.comingFrom': {
    en: 'Coming from QuickBooks, Xero or Wave? Bring in your customers, vendors, items, chart of accounts and opening balances; it ends by checking your trial balance matches.',
    he: 'עוברים מ־QuickBooks, ‏Xero או ‏Wave? אפשר לייבא לקוחות, ספקים, פריטים, תרשים חשבונות ויתרות פתיחה; בסוף התהליך נבדוק שמאזן הביקורת תואם.',
  },
  'setup.comingFrom.button': { en: 'Bring in my books', he: 'ייבוא הספרים שלי' },
  'setup.suggestedLabels': {
    en: 'Suggested labels: {labels}. Existing labels stay unchanged. Fund is self-balancing for a new non-profit label.',
    he: 'תגיות מוצעות: {labels}. תגיות קיימות נשארות ללא שינוי. התגית Fund מאזנת את עצמה בתגית חדשה של עמותה.',
  },
  'setup.labels.none': { en: 'None', he: 'ללא' },
  'setup.field.name': { en: 'Business name', he: 'שם העסק' },
  'setup.field.currency': { en: 'Home currency', he: 'מטבע הבית' },
  'setup.field.fiscal': { en: 'Financial year starts in', he: 'שנת הכספים מתחילה בחודש' },
  'setup.field.timezone': { en: 'Time zone', he: 'אזור זמן' },
  'setup.currencyLocked': {
    en: "The home currency can't be changed once there are entries.",
    he: 'לא ניתן לשנות את מטבע הבית לאחר שנרשמו תנועות.',
  },
  'setup.skip': { en: 'Skip setup', he: 'דילוג על ההגדרה' },
  'setup.next': { en: 'Next', he: 'הבא' },
  'setup.saving': { en: 'Saving…', he: 'שומר…' },
  'setup.chart.heading': { en: 'Chart of accounts', he: 'תרשים החשבונות' },
  'setup.chart.existing': {
    en: 'This workspace has {count} accounts. Keep them, or pick a template to replace them (only possible before the first entry).',
    he: 'בסביבת העבודה הזו יש {count} חשבונות. אפשר להשאיר אותם, או לבחור תבנית שתחליף אותם (רק לפני התנועה הראשונה).',
  },
  'setup.chart.legend': { en: 'Start from a template for your kind of business', he: 'נקודת פתיחה: תבנית לסוג העסק שלכם' },
  'setup.chart.keep': { en: 'Keep my accounts', he: 'להשאיר את החשבונות שלי' },
  'setup.back': { en: 'Back', he: 'חזרה' },
  'setup.applying': { en: 'Applying…', he: 'מחיל…' },
  'setup.done.heading': { en: 'Your books are set up', he: 'הספרים שלכם מוגדרים' },
  'setup.done.body': {
    en: "Your starter settings are ready. If you have previous books, use “Bring in last year's numbers” on Overview when you are ready.",
    he: 'הגדרות הפתיחה מוכנות. אם יש לכם ספרים קודמים, השתמשו ב״ייבוא המספרים של השנה שעברה״ במסך סקירה כללית כשתבחרו.',
  },
  'setup.done.invoice': { en: 'Create the first invoice', he: 'יצירת החשבונית הראשונה' },
  'setup.done.bank': { en: 'Connect or import a bank account', he: 'חיבור או ייבוא חשבון בנק' },
  'setup.done.overview': { en: 'Go to Overview', he: 'מעבר לסקירה כללית' },

} as const;

export type SetupStringKey = keyof typeof SETUP_STRINGS;

export const SETUP_TRANSLATIONS: readonly { key: string; en: string; he: string }[] = Object.entries(SETUP_STRINGS)
  .map(([key, value]) => ({ key, en: value.en, he: value.he }));

const BY_KEY = new Map<string, { key: string; en: string; he: string }>(SETUP_TRANSLATIONS.map(entry => [entry.key, entry]));

/** The wizard's sentence for a key; the table is the one place both languages live. */
export function setupText(key: SetupStringKey, language: UiLanguage): string {
  const entry = BY_KEY.get(key);
  if (!entry) return String(key).split('.').pop() || '';
  const candidate = language === 'he' ? entry.he : entry.en;
  return candidate.trim() ? candidate : entry.en;
}

/** `setupText` with `{name}` placeholders filled: amounts, counts and names are not translated. */
export function setupTextWith(
  key: SetupStringKey,
  language: UiLanguage,
  values: Readonly<Record<string, string | number>>,
): string {
  return fillOnboarding(setupText(key, language), values);
}

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
] as const;

export const ENGLISH_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Month names for the "financial year starts in" choice: the calendar the reader selected. */
export function monthNames(language: UiLanguage): readonly string[] {
  return language === 'he' ? HEBREW_MONTHS : ENGLISH_MONTHS;
}

/** The Hebrew name for a business preset (`BUSINESS_PRESETS`), falling back to its English name. */
const PRESET_NAMES_HE: Readonly<Record<string, string>> = {
  retail: 'חנות',
  service: 'שירותים',
  realestate: 'נדל״ן',
  construction: 'בנייה',
  nonprofit: 'עמותה',
  creative: 'פרילנסר',
  software_agency: 'סוכנות',
};

export function businessPresetName(id: string, englishName: string, language: UiLanguage): string {
  return language === 'he' ? (PRESET_NAMES_HE[id] ?? englishName) : englishName;
}
