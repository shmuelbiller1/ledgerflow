export type SupportedUiLanguage = 'en' | 'he';

export type TranslatedScreenId =
  | 'overview'
  | 'transactions'
  | 'sales'
  | 'purchases'
  | 'banking'
  | 'reconciliation'
  | 'reports'
  | 'planning'
  | 'forensics'
  | 'settings'
  | 'help'
  | 'support';

export interface ScreenStringEntry {
  key: string;
  en: string;
  he: string;
}

export interface ScreenTranslationBundle {
  screenId: TranslatedScreenId;
  screenNameEn: string;
  screenNameHe: string;
  strings: readonly ScreenStringEntry[];
}

/**
 * G-6: Structured English/Hebrew translation table across 12 main screens without altering default English behavior.
 * G-22: Inspected by `auditScreenTranslations` to list coverage and any missing target translations per screen.
 */
export const SCREEN_TRANSLATION_TABLE: readonly ScreenTranslationBundle[] = [
  {
    screenId: 'overview',
    screenNameEn: 'Overview',
    screenNameHe: 'סקירה כללית',
    strings: [
      { key: 'title.owner', en: 'Real-Time Financial Ledger', he: 'ספר חשבונות בזמן אמת' },
      { key: 'title.accountant', en: 'Consolidated Double-Entry Trial Balance', he: 'מאזן בוחן כפול ומאוחד' },
      { key: 'lens.owner', en: 'Owner Lens', he: 'תצוגת בעלים' },
      { key: 'lens.accountant', en: 'Accountant Lens', he: 'תצוגת רו״ח' },
      { key: 'action.addEntry', en: 'Add Entry', he: 'הוספת פקודה' },
      { key: 'checklist.title', en: 'Workspace Setup Checklist', he: 'רשימת הקמה למערכת' },
    ],
  },
  {
    screenId: 'transactions',
    screenNameEn: 'Transactions',
    screenNameHe: 'תנועות יומן',
    strings: [
      { key: 'title', en: 'Journal Entries', he: 'פקודות יומן' },
      { key: 'col.date', en: 'Date', he: 'תאריך' },
      { key: 'col.description', en: 'Description', he: 'תיאור' },
      { key: 'col.account', en: 'Account', he: 'חשבון' },
      { key: 'col.amount', en: 'Amount', he: 'סכום' },
      { key: 'status.balanced', en: 'Double-Entry Balanced', he: 'רישום כפול מאוזן' },
    ],
  },
  {
    screenId: 'sales',
    screenNameEn: 'Sales',
    screenNameHe: 'מכירות',
    strings: [
      { key: 'title', en: 'Invoicing & Customer Accounts', he: 'חשבוניות וחשבונות לקוחות' },
      { key: 'action.newInvoice', en: 'New Invoice', he: 'חשבונית חדשה' },
      { key: 'action.receivePayment', en: 'Receive Payment', he: 'קבלת תשלום' },
      { key: 'status.open', en: 'Open', he: 'פתוחה' },
      { key: 'status.overdue', en: 'Overdue', he: 'באיחור' },
      { key: 'status.paid', en: 'Paid', he: 'שולמה' },
    ],
  },
  {
    screenId: 'purchases',
    screenNameEn: 'Purchases',
    screenNameHe: 'רכש והוצאות',
    strings: [
      { key: 'title', en: 'Purchases & AP', he: 'רכש וספקים' },
      { key: 'action.newBill', en: 'Record New Bill', he: 'רישום חשבונית ספק' },
      { key: 'action.payVendor', en: 'Pay Vendor Bill', he: 'תשלום לספק' },
      { key: 'tab.vendors', en: 'Vendors', he: 'ספקים' },
      { key: 'tab.purchaseOrders', en: 'Purchase Orders', he: 'הזמנות רכש' },
    ],
  },
  {
    screenId: 'banking',
    screenNameEn: 'Banking',
    screenNameHe: 'בנקאות',
    strings: [
      { key: 'title', en: 'Bank Connections & Statements', he: 'חיבורי בנק ודפי חשבון' },
      { key: 'action.importStatement', en: 'Import Statement', he: 'ייבוא דף חשבון' },
      { key: 'action.moneyIn', en: 'Money in', he: 'כסף נכנס' },
      { key: 'action.moneyOut', en: 'Money out', he: 'כסף יוצא' },
    ],
  },
  {
    screenId: 'reconciliation',
    screenNameEn: 'Reconciliation',
    screenNameHe: 'התאמות בנק',
    strings: [
      { key: 'title', en: 'Smart Matching & Bank Reconciliation', he: 'התאמות בנק חכמות' },
      { key: 'field.statementBalance', en: 'Statement Closing Balance', he: 'יתרת סגירה בדף הבנק' },
      { key: 'field.difference', en: 'Difference', he: 'הפרש להתאמה' },
      { key: 'action.finish', en: 'Finish Reconciliation', he: 'סיום התאמה' },
    ],
  },
  {
    screenId: 'reports',
    screenNameEn: 'Reports',
    screenNameHe: 'דוחות כספיים',
    strings: [
      { key: 'title', en: 'Reports', he: 'דוחות' },
      { key: 'action.exportCsv', en: 'Export CSV', he: 'ייצוא CSV' },
      { key: 'action.reportPack', en: 'Report pack', he: 'חבילת דוחות' },
      { key: 'basis.accrual', en: 'Accrual', he: 'מצטבר' },
      { key: 'basis.cash', en: 'Cash', he: 'מזומן' },
    ],
  },
  {
    screenId: 'planning',
    screenNameEn: 'Planning',
    screenNameHe: 'תכנון ותקציב',
    strings: [
      { key: 'title', en: 'Budgets & Forecasting', he: 'תקציבים ותחזיות' },
      { key: 'tab.budgets', en: 'Budgets', he: 'תקציבים' },
      { key: 'tab.projects', en: 'Projects', he: 'פרויקטים' },
      { key: 'tab.forecast', en: '13-Week Cash Forecast', he: 'תחזית תזרים ל-13 שבועות' },
    ],
  },
  {
    screenId: 'forensics',
    screenNameEn: 'Forensics & Close',
    screenNameHe: 'בקרה וסגירת תקופה',
    strings: [
      { key: 'title', en: 'Audit Trail & Data Health', he: 'נתיב ביקורת ותקינות נתונים' },
      { key: 'tab.close', en: 'Month-End Close', he: 'סגירת חודש' },
      { key: 'tab.workpapers', en: 'Workpapers', he: 'ניירות עבודה' },
      { key: 'tab.audit', en: 'Audit Trail', he: 'יומן ביקורת' },
    ],
  },
  {
    screenId: 'settings',
    screenNameEn: 'Settings',
    screenNameHe: 'הגדרות',
    strings: [
      { key: 'title', en: 'Settings', he: 'הגדרות' },
      { key: 'search.label', en: 'Search settings', he: 'חיפוש בהגדרות' },
      { key: 'group.workspace', en: 'Workspace', he: 'סביבת עבודה' },
      { key: 'group.accounting', en: 'Accounting', he: 'חשבונאות' },
      { key: 'group.documents', en: 'Documents & sales', he: 'מסמכים ומכירות' },
      { key: 'group.automation', en: 'Automation', he: 'אוטומציה' },
      { key: 'group.data', en: 'Data & developer', he: 'נתונים ומפתחים' },
    ],
  },
  {
    screenId: 'help',
    screenNameEn: 'Help & Guide',
    screenNameHe: 'עזרה ומדריכים',
    strings: [
      { key: 'title', en: 'Help & Operational Guide', he: 'מרכז עזרה ומדריכי הפעלה' },
      { key: 'tab.workflows', en: 'Workflows', he: 'תהליכי עבודה' },
      { key: 'tab.howTo', en: 'How-to articles (EN/HE)', he: 'מדריכי הפעלה (עב/אנ)' },
      { key: 'tab.firstMonth', en: 'First month & demo', he: 'חודש ראשון ודמו' },
      { key: 'tab.allScreens', en: 'All screens', he: 'כל המסכים' },
      { key: 'tab.mainPath', en: 'Main path', he: 'המסלול הראשי' },
      { key: 'tab.a11yLang', en: 'Accessibility & language', he: 'נגישות ושפה' },
      { key: 'action.sendFeedback', en: 'Send feedback', he: 'שליחת משוב' },
    ],
  },
  {
    screenId: 'support',
    screenNameEn: 'Support & Feedback Triage',
    screenNameHe: 'תמיכה וניהול משוב',
    strings: [
      { key: 'title', en: 'Support', he: 'תמיכה ומשוב' },
      { key: 'action.newTicket', en: 'New Support Ticket', he: 'פנייה חדשה' },
      { key: 'action.markDone', en: 'Mark done', he: 'סימון כטופל' },
      { key: 'action.reopen', en: 'Re-open Ticket', he: 'פתיחה מחדש' },
      { key: 'filter.all', en: 'All', he: 'הכל' },
      { key: 'filter.open', en: 'Open', he: 'פתוח' },
      { key: 'filter.resolved', en: 'Resolved', he: 'טופל' },
    ],
  },
];

export function translateScreenString(
  screenId: TranslatedScreenId,
  key: string,
  language: SupportedUiLanguage,
  fallback?: string,
): string {
  const bundle = SCREEN_TRANSLATION_TABLE.find(entry => entry.screenId === screenId);
  const found = bundle?.strings.find(item => item.key === key);
  if (!found) return fallback ?? key;
  const candidate = language === 'he' ? found.he : found.en;
  return candidate.trim() ? candidate : (found.en || fallback || key);
}

export interface ScreenTranslationAuditRow {
  screenId: TranslatedScreenId;
  screenNameEn: string;
  screenNameHe: string;
  totalKeys: number;
  translatedHeCount: number;
  untranslatedKeys: string[];
  coveragePercent: number;
}

/**
 * G-22: Lists translated and untranslated keys per screen across English and Hebrew,
 * plus optional extra screen keys supplied at inspection time.
 */
export function auditScreenTranslations(
  bundles: readonly ScreenTranslationBundle[] = SCREEN_TRANSLATION_TABLE,
): ScreenTranslationAuditRow[] {
  return bundles.map(bundle => {
    const untranslatedKeys = bundle.strings
      .filter(entry => !entry.he.trim())
      .map(entry => entry.key);
    const totalKeys = bundle.strings.length;
    const translatedHeCount = totalKeys - untranslatedKeys.length;
    const coveragePercent = totalKeys === 0 ? 100 : Math.round((translatedHeCount / totalKeys) * 100);
    return {
      screenId: bundle.screenId,
      screenNameEn: bundle.screenNameEn,
      screenNameHe: bundle.screenNameHe,
      totalKeys,
      translatedHeCount,
      untranslatedKeys,
      coveragePercent,
    };
  });
}
