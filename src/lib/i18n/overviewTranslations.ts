import type { UiLanguage } from './uiLanguage';
import { fillOnboarding, indexTable, tableRows, tableText, type StringEntry } from './stringTable';

/**
 * AI12-N10-01 (#838): the words of the first-hour guide and the first-week checklist, in English and
 * Hebrew.
 *
 * These two screens travel with the Dashboard, which the app already loads in its own chunk, so their
 * copy belongs there rather than in the table the sign-in screen needs in the first download. The
 * English column is the only copy of these sentences: the screens no longer repeat them.
 */
const SCREEN_STRINGS = {
  // ---- First-hour guide ----------------------------------------------------------------------
  'firstHour.region': { en: 'First-hour bookkeeping guide', he: 'מדריך הצעדים הראשונים בהנהלת חשבונות' },
  'firstHour.guest.title': { en: 'Try bookkeeping in the sample company', he: 'לנסות הנהלת חשבונות בחברת הדוגמה' },
  'firstHour.guest.body': {
    en: 'Try creating invoices, contacts and other local sample records. Saved sample records stay in this browser tab after a refresh; leaving the demo discards them. Server-only tools and file attachments still need sign-in.',
    he: 'אפשר לנסות ליצור חשבוניות, אנשי קשר ורשומות דוגמה מקומיות. רשומות הדוגמה נשמרות בלשונית הדפדפן גם אחרי רענון; יציאה מהדמו מוחקת אותן. כלים שפועלים בשרת וקבצים מצורפים עדיין דורשים התחברות.',
  },
  'firstHour.guest.signIn': { en: 'Sign in to start bookkeeping', he: 'התחברות כדי להתחיל בהנהלת חשבונות' },
  'firstHour.intro': {
    en: 'Start with a small set of test records. These links open the existing screens; they do not save records or mark steps complete. Return to Overview to continue this guide.',
    he: 'מתחילים בכמה רשומות בדיקה. הקישורים פותחים את המסכים הקיימים; הם לא שומרים רשומות ולא מסמנים שלב כהושלם. חזרו לסקירה כללית כדי להמשיך במדריך.',
  },
  'firstHour.step1.title': { en: 'Choose accounts', he: 'בחירת חשבונות' },
  'firstHour.step1.description': {
    en: 'After saving your business details in setup, choose a chart of accounts. Review it before recording entries.',
    he: 'אחרי שמירת פרטי העסק בהגדרה, בחרו תרשים חשבונות. עברו עליו לפני רישום תנועות.',
  },
  'firstHour.step1.action': { en: 'Choose accounts', he: 'בחירת חשבונות' },
  'firstHour.step2.title': { en: 'Add a customer', he: 'הוספת לקוח' },
  'firstHour.step2.description': {
    en: 'In Sales, open Customers, then Add Customer. Keep names and addresses in their original language.',
    he: 'במסך מכירות, פתחו לקוחות ואחר כך הוספת לקוח. השאירו שמות וכתובות בשפה המקורית שלהם.',
  },
  'firstHour.step2.action': { en: 'Open customers', he: 'פתיחת לקוחות' },
  'firstHour.step3.title': { en: 'Create an invoice', he: 'יצירת חשבונית' },
  'firstHour.step3.description': {
    en: 'In Sales, choose Add Invoice. Select the customer, date, account and amount. A draft is not a posted sale.',
    he: 'במסך מכירות בחרו הוספת חשבונית. בחרו לקוח, תאריך, חשבון וסכום. טיוטה אינה מכירה שנרשמה בספרים.',
  },
  'firstHour.step3.action': { en: 'Open invoices', he: 'פתיחת חשבוניות' },
  'firstHour.step4.title': { en: 'Record a bill', he: 'רישום חשבונית ספק' },
  'firstHour.step4.description': {
    en: 'In Purchases, add a vendor, then choose Record Bill. Review the account, date and amount before saving.',
    he: 'במסך רכש הוסיפו ספק, ואחר כך בחרו רישום חשבונית ספק. בדקו חשבון, תאריך וסכום לפני השמירה.',
  },
  'firstHour.step4.action': { en: 'Open bills', he: 'פתיחת חשבוניות ספק' },
  'firstHour.step5.title': { en: 'Record a payment', he: 'רישום תשלום' },
  'firstHour.step5.description': {
    en: 'Open an unpaid invoice in Sales and use Receive Payment. For a bill payment, use Purchases. Recording a payment does not send money through your bank.',
    he: 'פתחו חשבונית שלא שולמה במסך מכירות ובחרו קליטת תשלום. לתשלום לספק השתמשו במסך רכש. רישום התשלום לא מעביר כסף דרך הבנק שלכם.',
  },
  'firstHour.step5.action': { en: 'Open unpaid invoices', he: 'פתיחת חשבוניות שלא שולמו' },
  'firstHour.step6.title': { en: 'Import a bank statement', he: 'ייבוא תדפיס בנק' },
  'firstHour.step6.description': {
    en: 'In Bank Connections, choose Import statement and review the file mapping. Importing bank lines does not mean they have been reconciled.',
    he: 'במסך חיבורי בנק בחרו ייבוא תדפיס ובדקו את מיפוי הקובץ. ייבוא תנועות בנק אינו אומר שהן הותאמו.',
  },
  'firstHour.step6.action': { en: 'Open bank import', he: 'פתיחת ייבוא בנק' },
  'firstHour.step7.title': { en: 'Reconcile the bank', he: 'התאמת הבנק' },
  'firstHour.step7.description': {
    en: 'Select a bank line and its entry under To review. Check the dates and amounts before confirming. A match is not a statement close.',
    he: 'בחרו תנועת בנק ואת הפקודה המתאימה לה תחת לבדיקה. בדקו תאריכים וסכומים לפני האישור. התאמה אינה סגירת תדפיס.',
  },
  'firstHour.step7.action': { en: 'Open reconciliation', he: 'פתיחת התאמת בנק' },
  'firstHour.step8.title': { en: 'Review profit and loss', he: 'סקירת דוח רווח והפסד' },
  'firstHour.step8.description': {
    en: 'Choose the reporting dates and Generate. Check the results against your posted documents; a balanced report alone does not prove the books are correct.',
    he: 'בחרו את תאריכי הדוח ולחצו הפקה. השוו את התוצאות למסמכים שנרשמו; דוח מאוזן לבדו אינו מוכיח שהספרים נכונים.',
  },
  'firstHour.step8.action': { en: 'Open profit and loss', he: 'פתיחת רווח והפסד' },
  'firstHour.footer.guest': { en: 'Sample records are practice only, not your real books.', he: 'רשומות הדוגמה הן תרגול בלבד, לא הספרים האמיתיים שלכם.' },
  'firstHour.footer.signedIn': {
    en: 'Cannot save? Check the message beside the field and your workspace role. If data did not load, use Data Status to retry.',
    he: 'לא מצליחים לשמור? בדקו את ההודעה שליד השדה ואת התפקיד שלכם בסביבת העבודה. אם הנתונים לא נטענו, נסו שוב דרך מצב הנתונים.',
  },
  'firstHour.footer.limits': {
    en: 'Unverified tax filing and live bank payments are not part of this walkthrough.',
    he: 'הגשת דוחות מס שלא אומתו ותשלומים חיים מהבנק אינם חלק מהמדריך הזה.',
  },
  'firstHour.openHelp': { en: 'Open help and guide', he: 'פתיחת העזרה והמדריך' },

  // ---- First-week checklist ------------------------------------------------------------------
  'firstWeek.heading': { en: 'Your first week', he: 'השבוע הראשון שלכם' },
  'firstWeek.progress': { en: '{done} of {total} steps complete', he: '{done} מתוך {total} שלבים הושלמו' },
  'firstWeek.intro': {
    en: 'Build a few real records, then review your first report. Steps update from this workspace’s saved records.',
    he: 'צרו כמה רשומות אמיתיות, ואחר כך עברו על הדוח הראשון. השלבים מתעדכנים לפי הרשומות השמורות בסביבת העבודה הזו.',
  },
  'firstWeek.hide': { en: 'Hide first-week checklist', he: 'הסתרת רשימת השבוע הראשון' },
  'firstWeek.hideTitle': { en: 'Hide checklist', he: 'הסתרת הרשימה' },
  'firstWeek.capped': {
    en: 'Some older records are outside the loaded list. Unfinished steps may already be complete.',
    he: 'חלק מהרשומות הישנות אינן ברשימה שנטענה. ייתכן ששלבים שלא סומנו כבר הושלמו.',
  },
  'firstWeek.failed': {
    en: 'Could not load the records for this checklist, so progress is not shown.',
    he: 'לא הצלחנו לטעון את הרשומות של הרשימה הזו, ולכן ההתקדמות לא מוצגת.',
  },
  'firstWeek.retry': { en: 'Retry checklist', he: 'ניסיון נוסף לטעינת הרשימה' },
  'firstWeek.loading': { en: 'Loading your checklist…', he: 'טוען את הרשימה שלכם…' },
  'firstWeek.complete': { en: 'Complete', he: 'הושלם' },
  'firstWeek.step.bank.title': { en: 'Add a bank account', he: 'הוספת חשבון בנק' },
  'firstWeek.step.bank.description': {
    en: 'Set up a bank account in your chart of accounts. This does not connect a live bank feed.',
    he: 'הגדירו חשבון בנק בתרשים החשבונות. זה לא מחבר תזרים חי מהבנק.',
  },
  'firstWeek.step.bank.action': { en: 'Open Banking', he: 'פתיחת בנקים' },
  'firstWeek.step.customer.title': { en: 'Add a customer', he: 'הוספת לקוח' },
  'firstWeek.step.customer.description': { en: 'Save a customer record in this workspace.', he: 'שמרו כרטיס לקוח בסביבת העבודה הזו.' },
  'firstWeek.step.customer.action': { en: 'Open Customers', he: 'פתיחת לקוחות' },
  'firstWeek.step.invoice.title': { en: 'Send your first invoice', he: 'שליחת החשבונית הראשונה' },
  'firstWeek.step.invoice.description': {
    en: 'A sent or posted invoice counts; a draft does not.',
    he: 'חשבונית שנשלחה או נרשמה נחשבת; טיוטה לא.',
  },
  'firstWeek.step.invoice.action': { en: 'Open Sales', he: 'פתיחת מכירות' },
  'firstWeek.step.payment.title': { en: 'Record a customer payment', he: 'רישום תשלום מלקוח' },
  'firstWeek.step.payment.description': {
    en: 'A posted payment received from a customer counts; a draft does not.',
    he: 'תשלום שהתקבל מלקוח ונרשם נחשב; טיוטה לא.',
  },
  'firstWeek.step.payment.action': { en: 'Open Payments', he: 'פתיחת תשלומים' },
  'firstWeek.step.profit-and-loss.title': { en: 'See the profit and loss report', he: 'צפייה בדוח רווח והפסד' },
  'firstWeek.step.profit-and-loss.description': {
    en: 'Open the report to review the activity in your books.',
    he: 'פתחו את הדוח כדי לעבור על הפעילות בספרים שלכם.',
  },
  'firstWeek.step.profit-and-loss.action': { en: 'Open profit and loss', he: 'פתיחת רווח והפסד' },
} as const;

export type OverviewStringKey = keyof typeof SCREEN_STRINGS;

export const OVERVIEW_TRANSLATIONS: readonly StringEntry[] = tableRows(SCREEN_STRINGS);

const BY_KEY = indexTable(SCREEN_STRINGS);

/** The sentence for a key in the selected language. */
export function overviewText(key: OverviewStringKey, language: UiLanguage): string {
  return tableText(BY_KEY, key, language);
}

/** `overviewText` with `{name}` placeholders filled: counts stay as given. */
export function overviewTextWith(
  key: OverviewStringKey,
  language: UiLanguage,
  values: Readonly<Record<string, string | number>>,
): string {
  return fillOnboarding(overviewText(key, language), values);
}

export type FirstWeekStepIdLike = 'bank' | 'customer' | 'invoice' | 'payment' | 'profit-and-loss';

const STEP_KEYS: Readonly<Record<FirstWeekStepIdLike, { title: OverviewStringKey; description: OverviewStringKey; action: OverviewStringKey }>> = {
  bank: { title: 'firstWeek.step.bank.title', description: 'firstWeek.step.bank.description', action: 'firstWeek.step.bank.action' },
  customer: { title: 'firstWeek.step.customer.title', description: 'firstWeek.step.customer.description', action: 'firstWeek.step.customer.action' },
  invoice: { title: 'firstWeek.step.invoice.title', description: 'firstWeek.step.invoice.description', action: 'firstWeek.step.invoice.action' },
  payment: { title: 'firstWeek.step.payment.title', description: 'firstWeek.step.payment.description', action: 'firstWeek.step.payment.action' },
  'profit-and-loss': { title: 'firstWeek.step.profit-and-loss.title', description: 'firstWeek.step.profit-and-loss.description', action: 'firstWeek.step.profit-and-loss.action' },
};

/** The checklist's words for a step, by id (the step list and its completion signals are unchanged). */
export function firstWeekStepText(
  step: { id: string },
  language: UiLanguage,
): { title: string; description: string; action: string } {
  const keys = STEP_KEYS[step.id as FirstWeekStepIdLike];
  if (!keys) return { title: '', description: '', action: '' };
  return {
    title: overviewText(keys.title, language),
    description: overviewText(keys.description, language),
    action: overviewText(keys.action, language),
  };
}
