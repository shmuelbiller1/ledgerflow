import { useUiLanguage } from './useUiLanguage';
import { fillOnboarding } from './stringTable';

/** The reader’s UI preference (English by default), not the script of a name in their books.
 * Only chrome and column headings are translated; record values, IDs and machine exports are not. */
const hebrew = {
  Day: 'יום',
  Who: 'מי',
  What: 'תיאור',
  Hours: 'שעות',
  Value: 'שווי',
  Status: 'מצב',
  Remove: 'הסרה',
  Number: 'מספר',
  Vendor: 'ספק',
  Issued: 'תאריך הפקה',
  Expected: 'מועד צפוי',
  Amount: 'סכום',
  Actions: 'פעולות',
  Receipt: 'תעודת קבלה',
  Order: 'הזמנה',
  Date: 'תאריך',
  Items: 'פריטים',
  Condition: 'מצב הסחורה',
  'Pay Run Date': 'תאריך תשלום',
  Employees: 'עובדים',
  'Total Employer Cost': 'עלות מעסיק כוללת',
  Employee: 'עובד',
  'Role & State': 'תפקיד ומדינה',
  Frequency: 'תדירות',
  'Annual Gross': 'ברוטו שנתי',
  'Period Net Pay': 'נטו לתקופה',
  'Paid in {year}': 'שולם בשנת {year}',
  'Time off': 'חופשה',
  'Purchase orders': 'הזמנות רכש',
  'Goods received': 'סחורה שהתקבלה',
  'Pay runs': 'תשלומי שכר',
  "Everyone's time": 'שעות הצוות',
  'Your time': 'השעות שלך',
  'Search records...': 'חיפוש ברשומות…',
  'Showing {shown} of {total} entries': 'מוצגות {shown} מתוך {total} רשומות',
  'No records found matching query': 'לא נמצאו רשומות התואמות לחיפוש',
  'First page': 'עמוד ראשון',
  'Last page': 'עמוד אחרון',
  'Next page': 'עמוד הבא',
  'Previous page': 'עמוד קודם',
  'Page {page} of {total}': 'עמוד {page} מתוך {total}',
  'Rows per page': 'שורות לעמוד',
  'Show {size} rows': 'הצגת {size} שורות',
  Columns: 'עמודות',
  'Columns ({count} hidden)': 'עמודות ({count} מוסתרות)',
  'Show all columns': 'הצגת כל העמודות',
  'Columns to show in {label}': 'עמודות להצגה ב{label}',
  'Column {number} visibility': 'הצגת עמודה {number}',
  '{name} column': 'עמודת {name}',
  Description: 'תיאור',
  Total: 'סך הכל',
  'The draft invoice': 'טיוטת החשבונית',
} as const;

export function useListText() {
  const language = useUiLanguage();
  return (en: keyof typeof hebrew, values: Record<string, string | number> = {}) =>
    fillOnboarding(language === 'he' ? hebrew[en] : en, values);
}
