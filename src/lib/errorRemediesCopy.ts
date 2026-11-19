import type { DescribedError, ErrorRemedyRule } from './errorRemedies';

/**
 * The sentences a refusal is explained with, in both languages (AI12-N3).
 *
 * Kept apart from the rules that classify a refusal so the two concerns are separate files: the
 * classifier is logic, this is copy. Every rule has a pair here, and the compiler enforces that a new
 * rule cannot be added without both languages (the record is typed by `ErrorRemedyRule`).
 */

export const ENGLISH: Record<ErrorRemedyRule, DescribedError> = {
  fieldNotAllowed: {
    title: "This change couldn't be saved",
    remedy: "The app sent a detail the database doesn't accept. Please report it (Help → Support) with what you were doing.",
  },
  lockedPeriod: {
    title: 'That date is in a closed period',
    remedy: 'Use a date after the lock date, or ask an owner to reopen the period (Month-End Close).',
  },
  sessionEnded: {
    title: 'Your session ended',
    remedy: 'Sign in again. What you were doing on this screen was not saved.',
  },
  permission: {
    title: "You don't have permission to do this",
    remedy: 'Ask an owner of this workspace to change your role (Settings → Team).',
  },
  unreachable: {
    title: "Can't reach the server",
    remedy: 'Check your internet connection, then try again.',
  },
  alreadyExists: {
    title: 'This already exists',
    remedy: 'Use a different number or name, or open the existing one.',
  },
  gone: {
    title: 'It no longer exists',
    remedy: 'Someone may have deleted it. Refresh the list and try again.',
  },
  otherWorkspace: {
    title: 'This belongs to another workspace',
    remedy: 'Switch to that workspace (the workspace menu at the top) and open it there.',
  },
  unbalanced: {
    title: "The entry doesn't balance",
    remedy: 'Make the debits equal the credits, then save again.',
  },
  overDocumentBalance: {
    title: 'The allocated amount is more than the document balance',
    remedy: 'Reduce the amount applied to the invoice or bill after checking its current balance.',
  },
  overPaymentAmount: {
    title: 'The amounts applied add up to more than the payment',
    remedy: 'Reduce the amounts applied so their total is no more than the payment amount.',
  },
  unpayableDocument: {
    title: 'This invoice or bill is a draft or has been voided',
    remedy: 'Choose an open invoice or bill that still has a balance.',
  },
  mixedPaymentCurrencies: {
    title: 'These documents have different currencies or exchange rates',
    remedy: 'Record separate payments for documents with different currencies or exchange rates.',
  },
  invalid: {
    // the refusal's own words are the useful part, so they are kept and quoted
    title: 'Some details aren’t valid',
    remedy: 'Correct it and try again.',
  },
};

export const HEBREW: Record<ErrorRemedyRule, DescribedError> = {
  fieldNotAllowed: {
    title: 'לא הצלחנו לשמור את השינוי',
    remedy: 'האפליקציה שלחה פרט שהמסד לא מקבל. אפשר לדווח על כך (עזרה ← תמיכה) ולציין מה ניסיתם לעשות.',
  },
  lockedPeriod: {
    title: 'התאריך נמצא בתקופה סגורה',
    remedy: 'אפשר להשתמש בתאריך אחרי תאריך הנעילה, או לבקש מבעל העסק לפתוח את התקופה מחדש (סגירת חודש).',
  },
  sessionEnded: {
    title: 'פג תוקף החיבור',
    remedy: 'יש להתחבר שוב. מה שעשיתם במסך הזה לא נשמר.',
  },
  permission: {
    title: 'אין לכם הרשאה לפעולה הזו',
    remedy: 'אפשר לבקש מבעל העסק לשנות את התפקיד שלכם (הגדרות ← צוות).',
  },
  unreachable: {
    title: 'לא מצליחים להגיע לשרת',
    remedy: 'אפשר לבדוק את החיבור לאינטרנט ולנסות שוב.',
  },
  alreadyExists: {
    title: 'הרשומה הזו כבר קיימת',
    remedy: 'אפשר להשתמש במספר או בשם אחרים, או לפתוח את הרשומה הקיימת.',
  },
  gone: {
    title: 'הרשומה כבר לא קיימת',
    remedy: 'ייתכן שמישהו מחק אותה. אפשר לרענן את הרשימה ולנסות שוב.',
  },
  otherWorkspace: {
    title: 'הרשומה שייכת לסביבת עבודה אחרת',
    remedy: 'אפשר לעבור לסביבת העבודה הזו (בתפריט סביבות העבודה למעלה) ולפתוח אותה שם.',
  },
  unbalanced: {
    title: 'הפקודה אינה מאוזנת',
    remedy: 'אפשר לתקן כך שהחיובים יהיו שווים לזיכויים ולשמור שוב.',
  },
  overDocumentBalance: {
    title: 'הסכום שהוקצה גבוה מיתרת המסמך',
    remedy: 'יש לבדוק את היתרה העדכנית בחשבונית או בחשבון הספק ולהקטין את הסכום שהוקצה למסמך.',
  },
  overPaymentAmount: {
    title: 'סך הסכומים שהוקצו גבוה מסכום התשלום',
    remedy: 'יש להקטין את הסכומים שהוקצו כך שהסכום הכולל שלהם לא יעלה על סכום התשלום.',
  },
  unpayableDocument: {
    title: 'החשבונית או חשבון הספק עדיין בטיוטה או בוטלו',
    remedy: 'יש לבחור חשבונית פתוחה או חשבון ספק פתוח שנותרה בהם יתרה לתשלום.',
  },
  mixedPaymentCurrencies: {
    title: 'למסמכים האלה יש מטבעות או שערי חליפין שונים',
    remedy: 'יש לרשום תשלומים נפרדים למסמכים במטבעות או בשערי חליפין שונים.',
  },
  invalid: {
    title: 'חלק מהפרטים אינם תקינים',
    remedy: 'אפשר לתקן ולנסות שוב.',
  },
};

export const UNKNOWN_EN: DescribedError = {
  title: 'Something went wrong',
  remedy: 'Try again. If it keeps happening, report it (Help → Support).',
};

export const UNKNOWN_HE: DescribedError = {
  title: 'משהו השתבש',
  remedy: 'אפשר לנסות שוב. אם זה ממשיך, אפשר לדווח על כך (עזרה ← תמיכה).',
};
