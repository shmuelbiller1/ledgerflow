import type { UiLanguage } from './uiLanguage';
import { EXAMPLE_EMAIL, fillOnboarding, indexTable, tableRows, tableText, translationGaps, type StringEntry, type TranslationGap } from './stringTable';

/**
 * AI12-N10-01 (#838): the words on the four screens a person meets before they have any books —
 * sign-in/sign-up, the setup wizard, the first-hour guide and the first-week checklist — in English
 * and Hebrew.
 *
 * Before this table those four screens changed the document language and direction but printed
 * English only, so somebody who chose Hebrew read "Create Account" and "1. Choose accounts" in an
 * RTL page. The table carries copy, accessible names and errors; what people type and what the
 * templates write into their chart of accounts (account names, label names, customer names) stays
 * exactly as stored and is never translated here.
 *
 * The English column is also the fallback the components pass, so a missing entry still shows the
 * English sentence rather than a key. `onboardingTranslationGaps()` lists any gap for the guard test.
 */

export type OnboardingStringEntry = StringEntry;
export { EXAMPLE_EMAIL, fillOnboarding, translationGaps };

const STRINGS = {
  // ---- Sign-in / registration -----------------------------------------------------------------
  'auth.page': { en: 'Authentication Page', he: 'עמוד התחברות' },
  'auth.badge': { en: 'Multi-Entity & Dimensional Ledger', he: 'ספר תנועות רב־חברות לפי תגיות' },
  'auth.hero.title': {
    en: 'Continuous accounting with multi-dimensional slicing.',
    he: 'הנהלת חשבונות שוטפת עם פילוח לפי ממדים.',
  },
  'auth.hero.body': {
    en: 'Slice transactions across entities, properties, projects, and departments. Real-time depreciation schedules, deterministic cash forecasting, and audit-ready tax tagging.',
    he: 'פילוח תנועות לפי חברות, נכסים, פרויקטים ומחלקות. לוחות פחת בזמן אמת, תחזית תזרים יציבה וסימון מס שמוכן לביקורת.',
  },
  'auth.hero.footer': {
    en: 'DIMENSIONAL LEDGER · REAL-TIME ANALYTICS · AUDIT-READY',
    he: 'ספר לפי ממדים · ניתוח בזמן אמת · מוכן לביקורת',
  },
  'auth.section.register': { en: 'Registration Form', he: 'טופס הרשמה' },
  'auth.section.signin': { en: 'Login Form', he: 'טופס התחברות' },
  'auth.title.register': { en: 'Create Account', he: 'פתיחת חשבון' },
  'auth.title.signin': { en: 'Sign in', he: 'התחברות' },
  'auth.subtitle.register': { en: 'Start tracking your finances.', he: 'מתחילים לעקוב אחרי הכספים שלכם.' },
  'auth.subtitle.signin': { en: 'Access your financial control room.', he: 'כניסה לחדר הבקרה הכספי שלכם.' },
  'auth.form.register': { en: 'Sign up with Email', he: 'הרשמה בדוא״ל' },
  'auth.form.signin': { en: 'Sign in with Email', he: 'התחברות בדוא״ל' },
  'auth.limit.title': { en: '⚠️ Platform limit reached', he: '⚠️ הגעתם למגבלת המערכת' },
  'auth.limit.body': {
    en: 'New sign-ups are temporarily capped at {limit} users. Currently, {total} users are registered. Please contact support@ledgerflow.app for a custom account creation.',
    he: 'ההרשמות החדשות מוגבלות כרגע ל־{limit} משתמשים. נכון לעכשיו רשומים {total} משתמשים. לפנייה לפתיחת חשבון מותאם: support@ledgerflow.app.',
  },
  'auth.label.email': { en: 'Email', he: 'דוא״ל' },
  'auth.aria.emailAddress': { en: 'Email address', he: 'כתובת דוא״ל' },
  'auth.label.password': { en: 'Password', he: 'סיסמה' },
  'auth.aria.password': { en: 'Password', he: 'סיסמה' },
  'auth.passwordRule': {
    en: 'At least {min} characters; not a common password or your email name.',
    he: 'לפחות {min} תווים; לא סיסמה נפוצה ולא שם המשתמש מתוך כתובת הדוא״ל שלכם.',
  },
  'auth.submit.register': { en: 'Sign up with Email', he: 'הרשמה בדוא״ל' },
  'auth.submit.signin': { en: 'Sign in with Email', he: 'התחברות בדוא״ל' },
  'auth.loading.register': { en: 'Signing up...', he: 'נרשם...' },
  'auth.loading.signin': { en: 'Signing in...', he: 'מתחבר...' },
  'auth.aria.submitRegister': { en: 'Submit Registration', he: 'שליחת הרשמה' },
  'auth.aria.submitLogin': { en: 'Submit Login', he: 'שליחת התחברות' },
  'auth.forgot': { en: 'Forgot your password?', he: 'שכחתם את הסיסמה?' },
  'auth.or': { en: 'Or', he: 'או' },
  'auth.google': { en: 'Continue with Google', he: 'המשך עם Google' },
  'auth.aria.google': { en: 'Continue with Google Authentication', he: 'המשך עם אימות Google' },
  'auth.connecting': { en: 'Connecting...', he: 'מתחבר...' },
  'auth.microsoft': { en: 'Continue with Microsoft', he: 'המשך עם Microsoft' },
  'auth.passkey': { en: 'Sign in with a passkey', he: 'התחברות עם מפתח גישה' },
  'auth.passkey.waiting': { en: 'Waiting for your passkey...', he: 'ממתין למפתח הגישה...' },
  'auth.guest': { en: 'Continue as Guest', he: 'המשך כאורח' },
  'auth.aria.guest': { en: 'Continue as Guest', he: 'המשך כאורח' },
  'auth.freeInvoice': { en: 'Just need an invoice? Make one free', he: 'צריכים רק חשבונית? אפשר להפיק אחת בחינם' },
  'auth.haveAccount': { en: 'Already have an account?', he: 'כבר יש לכם חשבון?' },
  'auth.noAccount': { en: "Don't have an account?", he: 'אין לכם חשבון?' },
  'auth.switch.signin': { en: 'Sign in', he: 'התחברות' },
  'auth.switch.signup': { en: 'Sign up', he: 'הרשמה' },
  'auth.aria.switchSignin': { en: 'Switch to Sign in', he: 'מעבר להתחברות' },
  'auth.aria.switchSignup': { en: 'Switch to Sign up', he: 'מעבר להרשמה' },
  'auth.legalLabel': { en: 'Legal policy', he: 'מדיניות משפטית' },
  'auth.terms': { en: 'Terms of Service', he: 'תנאי שימוש' },
  'auth.privacy': { en: 'Privacy Policy', he: 'מדיניות פרטיות' },
  'auth.error.microsoft': {
    en: 'Microsoft sign-in could not start. Try again.',
    he: 'לא הצלחנו להתחיל התחברות עם Microsoft. נסו שוב.',
  },
  'auth.error.needEmail': { en: 'Please enter your email address first.', he: 'יש להזין קודם כתובת דוא״ל.' },

  // ---- Password rules (the same sentences the auth screens show) ------------------------------
  'password.tooShort': { en: 'Use at least {min} characters', he: 'יש להשתמש בלפחות {min} תווים' },
  'password.tooLong': { en: 'Use at most 128 characters', he: 'יש להשתמש ב־128 תווים לכל היותר' },
  'password.common': { en: 'That password is one of the most used; choose another', he: 'הסיסמה הזו נפוצה מאוד; יש לבחור אחרת' },
  'password.repeated': { en: 'Do not repeat one character', he: 'אין לחזור על תו אחד' },
  'password.emailName': { en: 'Do not use your email name in the password', he: 'אין להשתמש בשם מתוך כתובת הדוא״ל בסיסמה' },
  'password.mismatch': { en: 'The two passwords are not the same', he: 'הסיסמאות אינן זהות' },
  'password.notSaved': { en: 'The password could not be saved', he: 'לא הצלחנו לשמור את הסיסמה' },
  'password.new.heading': { en: 'Choose a new password', he: 'בחירת סיסמה חדשה' },
  'password.new.for': {
    en: 'For {email}. At least {min} characters; not a common password or your email name.',
    he: 'עבור {email}. לפחות {min} תווים; לא סיסמה נפוצה ולא שם המשתמש מתוך כתובת הדוא״ל שלכם.',
  },
  'password.new.yourAccount': { en: 'your account', he: 'החשבון שלכם' },
  'password.new.field': { en: 'New password', he: 'סיסמה חדשה' },
  'password.new.again': { en: 'The same again', he: 'אותה סיסמה שוב' },
  'password.new.saving': { en: 'Saving…', he: 'שומר…' },
  'password.new.save': { en: 'Save the new password', he: 'שמירת הסיסמה החדשה' },
  'password.new.signOut': { en: 'Sign out instead', he: 'להתנתק במקום' },

} as const;

export type OnboardingStringKey = keyof typeof STRINGS;

export const ONBOARDING_STRINGS: readonly OnboardingStringEntry[] = tableRows(STRINGS);

const BY_KEY = indexTable(STRINGS);

/**
 * The sentence for a key in the selected language.
 *
 * The table holds both languages, so a component does not repeat its English sentence as an argument:
 * a second copy of every sentence in every screen is code the entry bundle has to download and keep in
 * step with the table. A key the table does not know falls back to the key's last segment rather than
 * vanishing, and the guard tests fail first.
 */
export function onboardingText(key: OnboardingStringKey, language: UiLanguage): string {
  return tableText(BY_KEY, key, language);
}

/** `onboardingText` with placeholders filled in one step. */
export function onboardingTextWith(
  key: OnboardingStringKey,
  language: UiLanguage,
  values: Readonly<Record<string, string | number>>,
): string {
  return fillOnboarding(onboardingText(key, language), values);
}

export type OnboardingTranslationGap = TranslationGap;

/** The shared table's own gaps (each screen-specific table is checked with `translationGaps`). */
export function onboardingTranslationGaps(
  entries: readonly OnboardingStringEntry[] = ONBOARDING_STRINGS,
): OnboardingTranslationGap[] {
  return translationGaps(entries);
}
