/**
 * EU-F3: the everyday question each main report answers, shown beside its name and found by the report search, so
 * "did I make money?" leads to Profit & Loss without knowing the word.
 */
export const REPORT_QUESTIONS: Readonly<Record<string, { en: string; he: string }>> = {
  pnl: { en: 'Did I make money?', he: 'האם הרווחתי?' },
  'balance-sheet': { en: 'What do I own and owe?', he: 'מה יש לי ומה אני חייב?' },
  'cash-flow': { en: 'Where did the cash go?', he: 'לאן הלך הכסף?' },
  'ar-aging': { en: 'Who owes me, and for how long?', he: 'מי חייב לי, וממתי?' },
  'ap-aging': { en: 'What do I owe, and when is it due?', he: 'מה אני חייב, ומתי זה לתשלום?' },
  'budget-actual': { en: 'Am I on budget?', he: 'האם אני עומד בתקציב?' },
  'general-ledger': { en: 'What exactly went through each account?', he: 'מה בדיוק עבר בכל חשבון?' },
  'customer-balance-summary': { en: 'How much does each customer owe?', he: 'כמה כל לקוח חייב?' },
  'vendor-balance-summary': { en: 'How much do I owe each vendor?', he: 'כמה אני חייב לכל ספק?' },
  'sales-trends': { en: 'Are sales going up?', he: 'האם המכירות עולות?' },
  'gross-profit-by-customer': { en: 'Which customers earn me the most?', he: 'אילו לקוחות מרוויחים לי הכי הרבה?' },
  compare: { en: 'How does one thing compare with another?', he: 'איך דבר אחד משתווה לאחר?' },
};

/** The question in this language, or "" for a report without one. */
export const reportQuestion = (id: string, language: 'en' | 'he' = 'en') => REPORT_QUESTIONS[id]?.[language] || '';
