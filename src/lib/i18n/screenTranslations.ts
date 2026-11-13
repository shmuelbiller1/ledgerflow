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
      { key: 'title.owner', en: 'Dashboard', he: 'לוח בקרה' },
      { key: 'title.accountant', en: 'Dashboard', he: 'לוח בקרה' },
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
      { key: 'title', en: 'Sales', he: 'מכירות' },
      { key: 'description', en: 'Invoices you send and the money customers owe you.', he: 'חשבוניות ששלחת והכספים שהלקוחות חייבים לך.' },
      { key: 'tab.invoices', en: 'Invoices', he: 'חשבוניות' },
      { key: 'tab.customers', en: 'Customers', he: 'לקוחות' },
      { key: 'action.addInvoice', en: 'Add Invoice', he: 'הוספת חשבונית' },
      { key: 'action.addCustomer', en: 'Add Customer', he: 'הוספת לקוח' },
      { key: 'action.saleReceipt', en: 'Sale receipt', he: 'קבלה על מכירה' },
      { key: 'action.openingInvoices', en: 'Opening invoices', he: 'חשבוניות פתיחה' },
      { key: 'summary.overdue', en: 'Overdue', he: 'באיחור' },
      { key: 'summary.pastDue', en: 'Past the due date', he: 'עבר מועד התשלום' },
      { key: 'summary.dueSoon', en: 'Due in the next 30 days', he: 'לתשלום ב־30 הימים הקרובים' },
      { key: 'summary.notDue', en: 'Not yet due', he: 'טרם הגיע מועד התשלום' },
      { key: 'summary.totalOwed', en: 'Total owed to you', he: 'סך החוב כלפיך' },
      { key: 'summary.unpaid', en: 'Unpaid invoices, all customers', he: 'חשבוניות שלא שולמו, מכל הלקוחות' },
      { key: 'table.selection', en: 'Selection', he: 'בחירה' },
      { key: 'table.number', en: 'Number', he: 'מספר' },
      { key: 'table.customer', en: 'Customer', he: 'לקוח' },
      { key: 'table.date', en: 'Date', he: 'תאריך' },
      { key: 'table.due', en: 'Due', he: 'לתשלום עד' },
      { key: 'table.amount', en: 'Amount', he: 'סכום' },
      { key: 'table.state', en: 'State', he: 'מצב' },
      { key: 'table.actions', en: 'Actions', he: 'פעולות' },
      { key: 'common.of', en: 'of', he: 'מתוך' },
      { key: 'status.refreshing', en: 'Refreshing this screen…', he: 'מרענן את המסך…' },
      { key: 'status.daysLeft', en: 'T-Days Left', he: 'ימים עד לתשלום' },
      { key: 'status.receipt', en: 'Receipt', he: 'קבלה' },
      { key: 'status.writtenOff', en: 'written off', he: 'נמחק כחוב אבוד' },
      { key: 'status.openedByCustomer', en: 'Opened by the customer', he: 'נפתח על ידי הלקוח' },
      { key: 'status.costNotRecorded', en: 'Cost not recorded', he: 'העלות לא נרשמה' },
      { key: 'help.costNotRecorded', en: 'The cost of the items sold was not recorded: add an Inventory and a Cost of Goods Sold account, then retry.', he: 'עלות הפריטים שנמכרו לא נרשמה: הוסיפו חשבון מלאי וחשבון עלות מכר, ואז נסו שוב.' },
      { key: 'action.retry', en: 'Retry', he: 'ניסיון חוזר' },
      { key: 'action.applyDeposit', en: 'Apply deposit', he: 'החלת מקדמה' },
      { key: 'action.undoSpread', en: 'Undo spread', he: 'ביטול פריסת ההכנסה' },
      { key: 'action.spread', en: 'Spread', he: 'פריסת הכנסה' },
      { key: 'action.showMoreInvoices', en: 'Show more invoices', he: 'הצגת חשבוניות נוספות' },
      { key: 'action.remindersOff', en: 'No reminders', he: 'תזכורות כבויות' },
      { key: 'action.remindersOn', en: 'Reminders on', he: 'תזכורות פעילות' },
      { key: 'table.selectAll', en: 'Select all invoices shown', he: 'בחירת כל החשבוניות המוצגות' },
      { key: 'customer.table.profile', en: 'Customer Profile', he: 'פרטי לקוח' },
      { key: 'customer.table.contact', en: 'Contact', he: 'פרטי קשר' },
      { key: 'customer.table.receivable', en: 'Net Receivable', he: 'יתרת לקוחות נטו' },
      { key: 'empty.noInvoices', en: 'No invoices yet', he: 'אין עדיין חשבוניות' },
      { key: 'empty.noInvoiceMatches', en: 'No invoices match your search', he: 'לא נמצאו חשבוניות התואמות לחיפוש' },
      { key: 'empty.tryAnotherSearch', en: 'Try another name or number.', he: 'נסו שם או מספר אחר.' },
      { key: 'empty.createFirstInvoice', en: 'Create your first invoice to bill a customer.', he: 'צרו חשבונית ראשונה כדי לחייב לקוח.' },
      { key: 'empty.createInvoice', en: 'Create invoice', he: 'יצירת חשבונית' },
      { key: 'empty.noCustomers', en: 'No customers yet', he: 'אין עדיין לקוחות' },
      { key: 'empty.noCustomerMatches', en: 'No customers match these filters', he: 'אין לקוחות התואמים למסננים האלה' },
      { key: 'empty.addCustomerFirst', en: 'Add a customer before creating their first invoice.', he: 'הוסיפו לקוח לפני יצירת החשבונית הראשונה שלו.' },
      { key: 'empty.changeCustomerFilters', en: 'Choose another tag or show archived customers.', he: 'בחרו תגית אחרת או הציגו לקוחות בארכיון.' },
      { key: 'empty.addFirstCustomer', en: 'Add first customer', he: 'הוספת לקוח ראשון' },
      { key: 'action.newInvoice', en: 'New Invoice', he: 'חשבונית חדשה' },
      { key: 'action.receivePayment', en: 'Receive Payment', he: 'קבלת תשלום' },
      { key: 'status.open', en: 'Open', he: 'פתוחה' },
      { key: 'status.draft', en: 'draft', he: 'טיוטה' },
      { key: 'status.sent', en: 'sent', he: 'נשלחה' },
      { key: 'status.pending', en: 'pending', he: 'ממתינה' },
      { key: 'status.overdue', en: 'overdue', he: 'באיחור' },
      { key: 'status.paid', en: 'paid', he: 'שולמה' },
      { key: 'status.void', en: 'void', he: 'בוטלה' },
      { key: 'status.written_off', en: 'written_off', he: 'נמחקה כחוב אבוד' },
      { key: 'status.rejected', en: 'rejected', he: 'נדחתה' },
      { key: 'status.cancelled', en: 'cancelled', he: 'בוטלה' },
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
      { key: 'action.paymentRun', en: 'Payment run', he: 'ריצת תשלומים' },
      { key: 'action.openingBills', en: 'Opening bills', he: 'חשבוניות פתיחה' },
      { key: 'action.exportCsv', en: 'Export CSV', he: 'ייצוא CSV' },
      { key: 'tab.bills', en: 'Bills', he: 'חשבוניות ספק' },
      { key: 'col.vendor', en: 'Vendor', he: 'ספק' },
      { key: 'col.billNumber', en: 'Bill #', he: 'מס׳ חשבונית' },
      { key: 'col.date', en: 'Date', he: 'תאריך' },
      { key: 'col.dueDate', en: 'Due Date', he: 'תאריך פירעון' },
      { key: 'col.status', en: 'Status', he: 'סטטוס' },
      { key: 'col.amount', en: 'Amount', he: 'סכום' },
      { key: 'col.actions', en: 'Actions', he: 'פעולות' },
      { key: 'label.expenseClaim', en: 'Expense claim', he: 'בקשת החזר הוצאות' },
      { key: 'action.undoSpread', en: 'Undo spread', he: 'ביטול פריסה' },
      { key: 'action.spread', en: 'Spread', he: 'פריסה' },
      { key: 'action.pay', en: 'Pay', he: 'תשלום' },
      { key: 'action.void', en: 'Void', he: 'ביטול' },
      { key: 'col.vendorName', en: 'Vendor Name', he: 'שם הספק' },
      { key: 'col.category', en: 'Category', he: 'קטגוריה' },
      { key: 'col.email', en: 'Email', he: 'דוא״ל' },
      { key: 'col.phone', en: 'Phone', he: 'טלפון' },
      { key: 'col.outstanding', en: 'Outstanding balance', he: 'יתרה פתוחה' },
      { key: 'list.showMore', en: 'Show more bills', he: 'הצגת חשבוניות נוספות' },
      { key: 'list.of', en: 'of', he: 'מתוך' },
      { key: 'label.rejected', en: 'rejected', he: 'נדחתה' },
      { key: 'aria.selectAll', en: 'Select all bills shown', he: 'בחירת כל החשבוניות המוצגות' },
      { key: 'aria.selectBill', en: 'Select bill {n}', he: 'בחירת חשבונית {n}' },
      { key: 'aria.pdf', en: 'PDF of bill {n}', he: 'PDF של חשבונית {n}' },
      { key: 'aria.edit', en: 'Edit bill {n}', he: 'עריכת חשבונית {n}' },
      { key: 'aria.undoSpread', en: 'Undo the spread of bill {n}', he: 'ביטול פריסה של חשבונית {n}' },
      { key: 'aria.spread', en: 'Spread bill {n} over months', he: 'פריסה של חשבונית {n} על פני חודשים' },
      { key: 'aria.deleteDraft', en: 'Delete draft bill {n}', he: 'מחיקת טיוטת חשבונית {n}' },
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
      { key: 'heading', en: 'Bank & Institution Connections', he: 'חיבורי בנקים ומוסדות פיננסיים' },
      { key: 'subtitle', en: 'Manage your connected financial institutions, live feeds, and reconciliation pipelines.', he: 'ניהול המוסדות הפיננסיים המחוברים, העדכונים השוטפים ותהליכי ההתאמה.' },
      { key: 'action.importStatementButton', en: 'Import statement', he: 'ייבוא דף חשבון' },
      { key: 'note.importPermission', en: 'Importing a statement requires a signed-in workspace owner, accountant or bookkeeper. Guest and viewer sessions cannot import bank data.', he: 'ייבוא דף חשבון דורש בעלים, רואה חשבון או מנהל חשבונות מחובר. במצב אורח או צפייה בלבד אי אפשר לייבא נתוני בנק.' },
      { key: 'action.transfer', en: 'Transfer Funds', he: 'העברת כספים' },
      { key: 'action.deposit', en: 'Make deposit', he: 'הפקדה' },
      { key: 'error.loadTitle', en: 'We couldn\'t load your bank accounts', he: 'לא הצלחנו לטעון את חשבונות הבנק' },
      { key: 'error.loadBody', en: 'Your chart of accounts did not arrive, so nothing can be listed here yet.', he: 'לוח החשבונות לא נטען, ולכן עדיין אין מה להציג כאן.' },
      { key: 'action.retry', en: 'Try again', he: 'ניסיון נוסף' },
      { key: 'status.ready', en: 'Ready', he: 'מוכן' },
      { key: 'label.type', en: 'Type', he: 'סוג' },
      { key: 'notice.relogin', en: '{bank} needs you to log in again.', he: '{bank} מבקש שתתחבר מחדש.' },
      { key: 'label.aBank', en: 'A bank', he: 'בנק' },
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
