import type { ScreenHelpDoc } from './helpCenterArticles';

/** The three Reports subviews and the trial balance inside Ledger → Accountant Lens. */
export const STATEMENT_SCREEN_GUIDES: readonly ScreenHelpDoc[] = [
  {
    slug: 'pnl',
    screenIds: ['pnl'],
    docPath: 'docs/help/pnl.md',
    titleEn: 'Profit and loss',
    titleHe: 'רווח והפסד',
    summaryEn: 'Compare income and expenses to see whether the business made a profit over a period. Profit is not the bank balance.',
    summaryHe: 'משווים בין הכנסות להוצאות כדי לבדוק אם העסק הרוויח בתקופה שנבחרה. הרווח אינו יתרת הבנק.',
    keyTasksEn: [
      'Choose the start and end dates for the activity you want to review.',
      'Check the accounting basis; use the comparison control when you need the previous period.',
      'Open Entries under a total to see what contributed to it. Read the report’s data-status note before relying on the figure.',
    ],
    keyTasksHe: [
      'בחרו תאריך התחלה ותאריך סיום לפעילות שברצונכם לבדוק.',
      'בדקו את בסיס הדיווח. להשוואה לתקופה הקודמת הפעילו את אפשרות ההשוואה.',
      'פתחו את פירוט התנועות מתחת לסכום כדי לראות ממה הוא מורכב. קראו את ההערה על מקור הנתונים לפני שמסתמכים עליו.',
    ],
    illustration: {
      screenId: 'pnl',
      altEn: 'Date and basis controls above income, expenses and net profit.',
      altHe: 'בחירת תאריכים ובסיס דיווח מעל ההכנסות, ההוצאות והרווח הנקי.',
    },
  },
  {
    slug: 'balance-sheet',
    screenIds: ['balance-sheet'],
    docPath: 'docs/help/balance-sheet.md',
    titleEn: 'Balance sheet',
    titleHe: 'מאזן',
    summaryEn: 'See what the business owns and owes, and the equity in it, as of one date. Earlier activity still counts.',
    summaryHe: 'כאן רואים את הנכסים, ההתחייבויות וההון העצמי של העסק ליום מסוים. גם פעילות קודמת נכללת במאזן.',
    keyTasksEn: [
      'Set the as-of date to the day you want to check.',
      'Compare assets with liabilities plus equity. A balanced total alone does not prove that each entry is correct.',
      'Inspect an account or open the entries behind a total to understand a balance.',
    ],
    keyTasksHe: [
      'בחרו את התאריך שלגביו ברצונכם לבדוק את היתרות.',
      'השוו בין הנכסים לבין ההתחייבויות בתוספת ההון העצמי. שוויון בין הסכומים אינו מוכיח שכל רישום נכון.',
      'עיינו בחשבון או פתחו את פירוט התנועות שמאחורי סכום כדי להבין את היתרה.',
    ],
    illustration: {
      screenId: 'balance-sheet',
      altEn: 'As-of date and balance check above assets, liabilities and equity.',
      altHe: 'תאריך המאזן ובדיקת האיזון מעל הנכסים, ההתחייבויות וההון העצמי.',
    },
  },
  {
    slug: 'trial-balance',
    screenIds: ['trial-balance'],
    docPath: 'docs/help/trial-balance.md',
    titleEn: 'Trial balance',
    titleHe: 'מאזן בוחן',
    summaryEn: 'In Ledger & Journal, the trial balance shows the debit and credit balances of accounts on a chosen day.',
    summaryHe: 'באזור הספר הראשי והיומן, מאזן הבוחן מציג את יתרות החובה והזכות של החשבונות ליום שנבחר.',
    keyTasksEn: [
      'Choose Accountant Lens, then Trial Balance.',
      'Set the as-of date and compare the debit and credit totals. Equal totals do not rule out missing or misclassified entries.',
      'Select an account to inspect its entries, or print the trial balance for the date shown.',
    ],
    keyTasksHe: [
      'עברו לתצוגת רואה החשבון ואז בחרו במאזן בוחן.',
      'בחרו תאריך והשוו בין סך החובה לסך הזכות. סכומים שווים אינם שוללים רישומים חסרים או סיווג שגוי.',
      'בחרו חשבון כדי לעיין בתנועות שלו, או הדפיסו את מאזן הבוחן לתאריך המוצג.',
    ],
    illustration: {
      screenId: 'trial-balance',
      altEn: 'Trial Balance date selector, debit and credit totals, and account rows.',
      altHe: 'תאריך מאזן הבוחן, סך החובה והזכות ושורות החשבונות.',
    },
  },
  {
    slug: 'israel-vat-report',
    screenIds: ['israel-vat-report'],
    docPath: 'docs/help/israel-vat-report.md',
    titleEn: 'Israel VAT report',
    titleHe: 'דוח מע״מ בישראל',
    summaryEn: 'Review periodic Israeli VAT figures calculated from the books. This worksheet does not convert currencies, file a return or pay tax.',
    summaryHe: 'כאן בודקים את נתוני המע״מ התקופתיים בישראל לפי הספרים. הגיליון אינו ממיר מטבעות, מגיש דוח לרשות המסים או משלם מס.',
    keyTasksEn: [
      'Choose the dates and, if there is more than one registration, the VAT registration to review.',
      'Compare output VAT with input VAT, including the separate equipment amount. A missing registration does not mean zero tax.',
      'Check the workspace currency and data warnings before printing or exporting the figures for your accountant.',
    ],
    keyTasksHe: [
      'בחרו את התאריכים, ואם יש יותר מרישום אחד בחרו גם את תיק המע״מ לבדיקה.',
      'השוו בין מס העסקאות למס התשומות ובדקו את הסכום הנפרד בגין ציוד. היעדר רישום אינו מעיד שסכום המס הוא אפס.',
      'בדקו את מטבע הספרים ואת ההודעות על מצב הנתונים לפני הדפסה או ייצוא של הנתונים לרואה החשבון.',
    ],
    illustration: {
      screenId: 'israel-vat-report',
      altEn: 'VAT dates, currency notice and periodic return summary.',
      altHe: 'תאריכי הדוח, ההערה על המטבע וסיכום דוח המע״מ התקופתי.',
    },
  },
];
