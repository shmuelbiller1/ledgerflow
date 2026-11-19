import type { UiLanguage } from './uiLanguage';

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

export interface OnboardingStringEntry {
  key: string;
  en: string;
  he: string;
}

/** Shown in both languages: an example address, not copy. */
export const EXAMPLE_EMAIL = 'you@company.com';

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

  // ---- Setup wizard --------------------------------------------------------------------------
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

export type OnboardingStringKey = keyof typeof STRINGS;

export const ONBOARDING_STRINGS: readonly OnboardingStringEntry[] = Object.entries(STRINGS)
  .map(([key, value]) => ({ key, en: value.en, he: value.he }));

const BY_KEY = new Map<string, OnboardingStringEntry>(ONBOARDING_STRINGS.map(entry => [entry.key, entry]));

/**
 * The sentence for a key in the selected language. A missing entry, or a blank one, falls back to
 * the component's own English text so a gap can never turn into a visible key.
 */
export function onboardingText(
  key: OnboardingStringKey,
  language: UiLanguage,
  fallback: string,
): string {
  const entry = BY_KEY.get(key);
  if (!entry) return fallback;
  const candidate = language === 'he' ? entry.he : entry.en;
  return candidate.trim() ? candidate : (entry.en || fallback);
}

/** Fills `{name}` placeholders. Values are not translated: amounts, counts and names stay as given. */
export function fillOnboarding(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : whole);
}

/** `onboardingText` with placeholders filled in one step. */
export function onboardingTextWith(
  key: OnboardingStringKey,
  language: UiLanguage,
  fallback: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return fillOnboarding(onboardingText(key, language, fallback), values);
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

/** Display names and one-line descriptions of the chart templates, for the setup screen only. */
const TEMPLATE_COPY_HE: Readonly<Record<string, { name: string; description: string }>> = {
  creative: { name: 'פרויקט יצירתי', description: 'מתאים לפרילנסרים, לאמנים ולבתי הפקה.' },
  retail: { name: 'מסחר אלקטרוני / קמעונאות', description: 'מתאים לחנויות שמוכרות מוצרים פיזיים או דיגיטליים.' },
  saas: { name: 'SaaS / מנויים', description: 'מתאים לחברות תוכנה עם הכנסה חוזרת.' },
  realestate: { name: 'נדל״ן / נכסים', description: 'מתאים למנהלי נכסים ולמשקיעי נדל״ן.' },
  nonprofit: { name: 'עמותה / ארגון ללא כוונת רווח', description: 'מתאים לעמותות, לקרנות ולקבוצות קהילתיות.' },
  service: { name: 'שירותים מקצועיים', description: 'מתאים לייעוץ, למשרדי עורכי דין ולרואי חשבון.' },
  manufacturing: { name: 'ייצור / תפוקה', description: 'מתאים למפעלים ולחברות פיתוח מוצר.' },
  hospitality: { name: 'אירוח / מסעדנות', description: 'מתאים לבתי מלון, למסעדות ולבתי קפה.' },
  agriculture: { name: 'חקלאות', description: 'מתאים למשקי חי, לגידולים ולחוות אורגניות שעוקבות אחר מזון, ציוד וסובסידיות.' },
  healthcare: { name: 'בריאות / מרפאה', description: 'מתאים למרפאות, לרופאים ולשיניים.' },
  logistics: { name: 'לוגיסטיקה וציים', description: 'מתאים לחברות הובלה, למשלוחים ולמסופי מטענים.' },
  subscription_box: { name: 'קופסת מנוי / מכירה ישירה', description: 'מתאים למודלים של משלוח קופסה חוזר ולערכות חודשיות.' },
  construction: { name: 'בנייה וקבלנות', description: 'מתאים לקבלנים, ליזמים ולבעלי מקצוע.' },
  automotive: { name: 'רכב ומוסכים', description: 'מתאים למוסכים, למכוני תיקון ולמכוני דיטיילינג.' },
  renewable_energy: { name: 'אנרגיה מתחדשת', description: 'מתאים למתקיני סולארי, לתפעול מיקרו־רשתות ולניהול אשראי ירוק.' },
  import_export: { name: 'ייבוא / ייצוא', description: 'מתאים לסוחרים בינלאומיים, למתווכים ולשחרור ממכס.' },
  franchise: { name: 'מפעיל זכיינות', description: 'מתאים לזכיינים של מותגי מזון, כושר או קמעונאות.' },
  software_agency: { name: 'סוכנות תוכנה ופיתוח', description: 'מתאים לפיתוח אתרים, למערכות מידע ולעבודות תוכנה בהתאמה.' },
  enterprise_saas: { name: 'SaaS ארגוני (עולמי)', description: 'מתאים לחברות תוכנה עם כמה מוצרים וכמה אזורים.' },
  holding_company: { name: 'חברת החזקות / קונגלומרט', description: 'מתאים למבנים של כמה חברות, לחברות החזקות ולתיקים מגוונים.' },
  manufacturing_multi: { name: 'ייצור והפצה רב־חברתי', description: 'מתאים לשרשראות אספקה מורכבות, לכמה מפעלים ולהפצה עולמית.' },
  private_equity: { name: 'קרן הון סיכון / השקעות', description: 'מתאים לקרנות שמנהלות הון משקיעים, שווי תיק ודמי ניהול.' },
  personal: { name: 'עושר אישי / משק בית', description: 'מתאים למעקב אחר הוצאות אישיות, השקעות ותקציב הבית.' },
};

export function businessTemplateName(id: string, englishName: string, language: UiLanguage): string {
  return language === 'he' ? (TEMPLATE_COPY_HE[id]?.name ?? englishName) : englishName;
}

export function businessTemplateDescription(id: string, englishDescription: string, language: UiLanguage): string {
  return language === 'he' ? (TEMPLATE_COPY_HE[id]?.description ?? englishDescription) : englishDescription;
}

/** The checklist's own words for a step, by id; the English in `firstWeekChecklist.ts` is the fallback. */
export type FirstWeekStepIdLike = 'bank' | 'customer' | 'invoice' | 'payment' | 'profit-and-loss';

const STEP_KEYS: Readonly<Record<FirstWeekStepIdLike, { title: OnboardingStringKey; description: OnboardingStringKey; action: OnboardingStringKey }>> = {
  bank: { title: 'firstWeek.step.bank.title', description: 'firstWeek.step.bank.description', action: 'firstWeek.step.bank.action' },
  customer: { title: 'firstWeek.step.customer.title', description: 'firstWeek.step.customer.description', action: 'firstWeek.step.customer.action' },
  invoice: { title: 'firstWeek.step.invoice.title', description: 'firstWeek.step.invoice.description', action: 'firstWeek.step.invoice.action' },
  payment: { title: 'firstWeek.step.payment.title', description: 'firstWeek.step.payment.description', action: 'firstWeek.step.payment.action' },
  'profit-and-loss': { title: 'firstWeek.step.profit-and-loss.title', description: 'firstWeek.step.profit-and-loss.description', action: 'firstWeek.step.profit-and-loss.action' },
};

export function firstWeekStepText(
  step: { id: string; title: string; description: string; action: string },
  language: UiLanguage,
): { title: string; description: string; action: string } {
  const keys = STEP_KEYS[step.id as FirstWeekStepIdLike];
  if (!keys) return { title: step.title, description: step.description, action: step.action };
  return {
    title: onboardingText(keys.title, language, step.title),
    description: onboardingText(keys.description, language, step.description),
    action: onboardingText(keys.action, language, step.action),
  };
}

export interface OnboardingTranslationGap {
  key: string;
  problem: 'missing Hebrew' | 'blank English' | 'Hebrew identical to English';
}

/**
 * Every entry that would leave a Hebrew reader with English (or nothing). The guard test fails on a
 * non-empty result, so a new sentence cannot ship without its Hebrew.
 */
export function onboardingTranslationGaps(
  entries: readonly OnboardingStringEntry[] = ONBOARDING_STRINGS,
): OnboardingTranslationGap[] {
  const gaps: OnboardingTranslationGap[] = [];
  for (const entry of entries) {
    if (!entry.en.trim()) gaps.push({ key: entry.key, problem: 'blank English' });
    else if (!entry.he.trim()) gaps.push({ key: entry.key, problem: 'missing Hebrew' });
    else if (!/\p{Script=Hebrew}/u.test(entry.he)) gaps.push({ key: entry.key, problem: 'Hebrew identical to English' });
  }
  return gaps;
}

/** Template ids that have Hebrew display copy, so the setup screen can be checked for gaps. */
export function templateCopyIds(): string[] {
  return Object.keys(TEMPLATE_COPY_HE);
}
