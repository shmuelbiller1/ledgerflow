/**
 * SBX-2 Part 6: the facts a model needs to read the books right, sent at the start of the question
 * (not in the fixed system prompt, which stays byte-identical so it is cached). Without them models
 * guessed today's date, asked which year "this year" means, and quoted amounts in cents.
 */
import { currencyDigits } from '../../lib/currencyMinorUnits';
import { getFiscalYearBounds } from '../../lib/fiscalCalendar';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface AssistantFactsInput {
  /** Today in the workspace's time zone, YYYY-MM-DD. */
  today: string;
  timeZone?: string | null;
  currency?: string | null;
  /** 1–12; January when not set. */
  fiscalYearStartMonth?: number | null;
  /** 1–28; the 1st when not set. */
  fiscalYearStartDay?: number | null;
}

/** Today's date in a time zone as YYYY-MM-DD (UTC when the zone is missing or unknown). */
export function todayIn(timeZone: string | null | undefined, now = new Date()): string {
  const format = (zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  try { return format(timeZone || 'UTC'); } catch { return format('UTC'); }
}

/** How stored amounts relate to normal money, by the currency's own minor units (JPY has none, KWD has three). */
function minorUnits(currency: string | null): string {
  const digits = currencyDigits(currency ?? undefined);
  const example = digits === 0 ? '120000 is 120,000' : `120000 is ${(120000 / 10 ** digits).toLocaleString('en-US', { minimumFractionDigits: digits })}`;
  return `- Amounts in fields ending in "Cents" are stored in the currency's minor units (${currency ?? 'books currency'}: ${example}). A record with its own currency uses that currency's minor units. Show the person normal amounts in the record's currency, never minor units.`;
}

export function assistantFacts(input: AssistantFactsInput): string {
  const [y, m] = input.today.split('-').map(Number);
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${input.today}T12:00:00Z`));
  const lastMonth = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  // the same bounds the rest of the app uses (start month and day)
  const fyStart = getFiscalYearBounds(input.today, input.fiscalYearStartMonth ?? 1, input.fiscalYearStartDay ?? 1).startDate;
  const startMonth = Number(fyStart.slice(5, 7)), startDay = Number(fyStart.slice(8, 10));
  const currency = input.currency && /^[A-Z]{3}$/.test(input.currency) ? input.currency : null;
  return [
    'Facts for this turn (from the application, not from the person):',
    `- Today is ${day} ${input.today}${input.timeZone ? ` (${input.timeZone})` : ''}. "This month" is ${MONTHS[m - 1]} ${y}; "last month" is ${MONTHS[lastMonth.m - 1]} ${lastMonth.y}.`,
    `- The financial year starts on ${MONTHS[startMonth - 1]} ${startDay}: "this year" means ${fyStart} to today unless the person says otherwise.`,
    currency ? `- The books are kept in ${currency}.` : '- The books\' currency is not set: say amounts without a currency symbol.',
    minorUnits(currency),
  ].join('\n');
}
