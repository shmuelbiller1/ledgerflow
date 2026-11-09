/**
 * A-70: overdue reminders (dunning) in three steps, each with its own wording in English or Hebrew.
 * A letter is one step for one invoice, sent through the existing email path (the caller sends it);
 * this module chooses the step, writes the text and keeps the log of what was sent.
 *
 * The default schedule (days past due at which each step is due) is a starting point the owner
 * confirms or changes in the workspace's settings; a workspace may pass its own schedule. A step is
 * sent once: after step 2 went out, step 1 is never sent again for that invoice. When several steps
 * are due and none was sent, only the latest due step is sent (one letter, not three at once).
 *
 * Money: amounts are whole minor units, shown as the invoice's own currency code and two decimals.
 */
export type DunningLanguage = 'en' | 'he';

export interface DunningStep {
  step: 1 | 2 | 3;
  /** the step is due once the invoice is at least this many days past its due date */
  fromDaysOverdue: number;
}

export const DEFAULT_DUNNING_SCHEDULE: DunningStep[] = [
  { step: 1, fromDaysOverdue: 7 },
  { step: 2, fromDaysOverdue: 21 },
  { step: 3, fromDaysOverdue: 45 },
];

export interface DunningLogEntry {
  invoiceId: string;
  step: 1 | 2 | 3;
  sentAt: string;
  channel: 'email';
}

/** The step that is due for an invoice this many days overdue, or 0 when none is due yet. */
export function dunningStepDue(daysOverdue: number, schedule: DunningStep[] = DEFAULT_DUNNING_SCHEDULE): number {
  if (!(daysOverdue > 0)) return 0;
  return schedule.reduce((due, s) => (daysOverdue >= s.fromDaysOverdue && s.step > due ? s.step : due), 0);
}

/** The step to send now for an invoice, or null when nothing new is due. */
export function nextDunningStep(log: DunningLogEntry[], invoiceId: string, daysOverdue: number, schedule: DunningStep[] = DEFAULT_DUNNING_SCHEDULE): 1 | 2 | 3 | null {
  const due = dunningStepDue(daysOverdue, schedule);
  if (!due) return null;
  const sent = log.filter(e => e.invoiceId === invoiceId).reduce((max, e) => (e.step > max ? e.step : max), 0);
  return due > sent ? (due as 1 | 2 | 3) : null;
}

/** The letters already sent for one invoice, oldest first. */
export const dunningLogFor = (log: DunningLogEntry[], invoiceId: string) => log.filter(e => e.invoiceId === invoiceId).sort((a, b) => a.sentAt.localeCompare(b.sentAt));

export interface DunningLetterInput {
  invoiceNumber: string;
  customerName: string;
  companyName: string;
  dueDate: string;
  /** what is still owed, in minor units of the invoice currency */
  outstandingCents: number;
  currency: string;
  daysOverdue: number;
  step: 1 | 2 | 3;
  language?: DunningLanguage;
}

export interface DunningLetter {
  subject: string;
  body: string;
  language: DunningLanguage;
  direction: 'ltr' | 'rtl';
}

const TEMPLATES: Record<DunningLanguage, Record<1 | 2 | 3, { subject: string; body: string }>> = {
  en: {
    1: {
      subject: 'Friendly reminder: invoice {number} is due',
      body: 'Dear {customer},\n\nThis is a friendly reminder that invoice {number}, due on {due}, is still open. The outstanding amount is {amount}.\n\nIf you have already paid, please ignore this message. Otherwise, we would be grateful if you could pay it soon.\n\nKind regards,\n{company}',
    },
    2: {
      subject: 'Second reminder: invoice {number} is overdue',
      body: 'Dear {customer},\n\nInvoice {number} was due on {due} and is now {days} days overdue. The outstanding amount is {amount}.\n\nPlease arrange payment, or contact us today if there is a problem with the invoice.\n\nKind regards,\n{company}',
    },
    3: {
      subject: 'Final notice: invoice {number}',
      body: 'Dear {customer},\n\nInvoice {number} was due on {due} and remains unpaid {days} days after its due date. The outstanding amount is {amount}.\n\nThis is our final reminder before we take further steps. Please pay the amount in full, or contact us without delay.\n\nKind regards,\n{company}',
    },
  },
  he: {
    1: {
      subject: 'תזכורת ידידותית: חשבונית {number} לתשלום',
      body: 'שלום {customer},\n\nרצינו להזכיר שחשבונית {number}, שמועד פירעונה {due}, עדיין פתוחה. היתרה לתשלום היא {amount}.\n\nאם כבר שילמתם, אנא התעלמו מהודעה זו. אחרת, נודה לכם על התשלום בקרוב.\n\nבברכה,\n{company}',
    },
    2: {
      subject: 'תזכורת שנייה: חשבונית {number} בפיגור',
      body: 'שלום {customer},\n\nחשבונית {number} הייתה לתשלום ב-{due} ומאז עברו {days} ימים. היתרה לתשלום היא {amount}.\n\nאנא סדרו את התשלום, או צרו איתנו קשר היום אם יש בעיה בחשבונית.\n\nבברכה,\n{company}',
    },
    3: {
      subject: 'הודעה אחרונה: חשבונית {number}',
      body: 'שלום {customer},\n\nחשבונית {number} הייתה לתשלום ב-{due} ועדיין לא שולמה, {days} ימים אחרי מועד הפירעון. היתרה לתשלום היא {amount}.\n\nזו התזכורת האחרונה שלנו לפני צעדים נוספים. אנא שלמו את הסכום במלואו, או צרו איתנו קשר בהקדם.\n\nבברכה,\n{company}',
    },
  },
};

/** Money in the invoice currency as plain text: "1,234.50 EUR" (never a float on the amount). */
export function dunningAmountText(cents: number, currency: string): string {
  const whole = Math.trunc(Math.abs(cents) / 100);
  const frac = String(Math.abs(cents) % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}${grouped}.${frac} ${currency}`;
}

const clean = (value: unknown, max = 200) => [...String(value ?? '')].map(ch => { const c = ch.charCodeAt(0); return c < 32 || c === 127 ? ' ' : ch; }).join('').trim().slice(0, max);

/** The letter for one step: its subject and body, with the figures filled in. */
export function dunningLetter(input: DunningLetterInput): DunningLetter {
  const language: DunningLanguage = input.language === 'he' ? 'he' : 'en';
  const template = TEMPLATES[language][input.step];
  const values: Record<string, string> = {
    number: clean(input.invoiceNumber, 60),
    customer: clean(input.customerName, 120),
    company: clean(input.companyName, 120),
    due: clean(input.dueDate, 10),
    days: String(Math.max(0, Math.floor(input.daysOverdue))),
    amount: dunningAmountText(input.outstandingCents, clean(input.currency, 3).toUpperCase()),
  };
  const fill = (text: string) => text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
  return { subject: fill(template.subject), body: fill(template.body), language, direction: language === 'he' ? 'rtl' : 'ltr' };
}
