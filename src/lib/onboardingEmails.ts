import { trimEndChar } from './textShape';
export type OnboardingEmailDay = 1 | 3 | 7;

export interface OnboardingEmailContext {
  ownerName: string;
  workspaceName: string;
  appOrigin: string;
}

export interface RenderedOnboardingEmail {
  day: OnboardingEmailDay;
  slug: string;
  subjectEn: string;
  subjectHe: string;
  plainTextEn: string;
  plainTextHe: string;
  ctaPath: string;
  ctaLabelEn: string;
  ctaLabelHe: string;
}

export function onboardingEmailsStorageKey(workspaceId: string | null | undefined): string {
  return `lf_onboarding_emails_enabled:${workspaceId || 'default'}`;
}

export function isOnboardingEmailsEnabled(workspaceId: string | null | undefined): boolean {
  try {
    return localStorage.getItem(onboardingEmailsStorageKey(workspaceId)) === 'true';
  } catch {
    return false;
  }
}

export function setOnboardingEmailsEnabled(workspaceId: string | null | undefined, enabled: boolean): void {
  try {
    localStorage.setItem(onboardingEmailsStorageKey(workspaceId), enabled ? 'true' : 'false');
  } catch {
    // ignore storage failures
  }
}

function cleanText(input: string, fallback: string): string {
  const trimmed = input.replace(/[\r\n<>]+/g, ' ').trim();
  return trimmed || fallback;
}

/**
 * G-8 (part 1): Day 1 / Day 3 / Day 7 owner onboarding email templates (EN & HE).
 * Templates only: automated server scheduling and delivery remain gated on AI #1's mail service seam.
 */
export function buildOnboardingEmails(context: OnboardingEmailContext): RenderedOnboardingEmail[] {
  const owner = cleanText(context.ownerName, 'Owner');
  const books = cleanText(context.workspaceName, 'Your workspace');
  const base = trimEndChar(context.appOrigin, '/') || 'https://app.ledgerflow.example';

  return [
    {
      day: 1,
      slug: 'day-1-chart-and-company',
      subjectEn: `Day 1 · Set up the chart of accounts for ${books}`,
      subjectHe: `יום 1 · הגדרת אינדקס החשבונות עבור ${books}`,
      plainTextEn: [
        `Hello ${owner},`,
        '',
        `Your books "${books}" are ready. Today's goal takes five minutes:`,
        '1. Confirm your currency and fiscal year start date.',
        '2. Pick a chart of accounts template or review your cash, receivable, payable, and equity accounts.',
        '3. Record opening balances if moving from earlier books, or start cleanly from zero.',
        '',
        `Open setup: ${base}/#dashboard`,
      ].join('\n'),
      plainTextHe: [
        `שלום ${owner},`,
        '',
        `מערכת הספרים "${books}" מוכנה. היעד להיום אורך חמש דקות:`,
        '1. אשרו את מטבע הבסיס ותחילת שנת המס.',
        '2. בחרו תבנית חשבונות או בדקו חשבונות קופה, לקוחות, ספקים והון.',
        '3. הזינו יתרות פתיחה מאוזנות או התחילו מאפס.',
        '',
        `פתיחת המערכת: ${base}/#dashboard`,
      ].join('\n'),
      ctaPath: '/#dashboard',
      ctaLabelEn: 'Review company setup',
      ctaLabelHe: 'בדיקת הגדרות החברה',
    },
    {
      day: 3,
      slug: 'day-3-bank-and-import',
      subjectEn: `Day 3 · Import your first statement in ${books}`,
      subjectHe: `יום 3 · ייבוא דף הבנק הראשון ב-${books}`,
      plainTextEn: [
        `Hello ${owner},`,
        '',
        `Once ${books} has accounts in place, bring in real bank activity:`,
        '1. Upload a CSV, OFX, or QFX bank statement in Banking and review staged lines before saving.',
        '2. Create categorization rules for recurring vendors.',
        '3. Check Reconciliation to confirm your statement closing balance matches the ledger.',
        '',
        `Open Banking: ${base}/#banking`,
      ].join('\n'),
      plainTextHe: [
        `שלום ${owner},`,
        '',
        `לאחר הגדרת החשבונות ב-"${books}", ייבאו תנועות בנק:`,
        '1. העלו קובץ CSV, OFX או QFX במסך הבנקאות ובדקו את השורות לפני שמירה.',
        '2. הגדירו כללי סיווג לספקים קבועים.',
        '3. פתחו התאמות בנק כדי לוודא שיתרת הסגירה תואמת לספרים.',
        '',
        `פתיחת בנקאות: ${base}/#banking`,
      ].join('\n'),
      ctaPath: '/#banking',
      ctaLabelEn: 'Import a statement',
      ctaLabelHe: 'ייבוא דף חשבון',
    },
    {
      day: 7,
      slug: 'day-7-first-invoice-report-and-backup',
      subjectEn: `Day 7 · First invoice, customer statement, and JSON backup for ${books}`,
      subjectHe: `יום 7 · חשבונית ראשונה, כרטסת לקוח וגיבוי עבור ${books}`,
      plainTextEn: [
        `Hello ${owner},`,
        '',
        `Finish week one in "${books}" with three checks:`,
        '1. Issue your first customer invoice in Sales and verify the Customer Statement.',
        '2. Open Profit & Loss and Balance Sheet in Reports to verify your balances.',
        '3. Export a checksum-verified JSON backup in Settings -> Backup & Export.',
        '',
        `Open Reports: ${base}/#reports`,
      ].join('\n'),
      plainTextHe: [
        `שלום ${owner},`,
        '',
        `סיימו את השבוע הראשון ב-"${books}" בשלוש בדיקות:`,
        '1. הפיקו חשבונית ראשונה ללקוח ובדקו את דוח מצב החשבון.',
        '2. פתחו דוח רווח והפסד ומאזן כדי לוודא איזון מלא.',
        '3. הורידו גיבוי JSON מאומת תחת הגדרות -> גיבוי וייצוא.',
        '',
        `פתיחת דוחות: ${base}/#reports`,
      ].join('\n'),
      ctaPath: '/#reports',
      ctaLabelEn: 'Open financial reports',
      ctaLabelHe: 'פתיחת דוחות כספיים',
    },
  ];
}
