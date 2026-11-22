import { civilDateParts, dayNumber } from './calendarDate';

export type BankLineAgeGroup = 'over30' | '7to30' | 'under7' | 'future' | 'unknown';

export const bankLineAgeLabels: Record<BankLineAgeGroup, string> = {
  over30: 'Over 30 days',
  '7to30': '7–30 days',
  under7: 'Under 7 days',
  future: 'Future statement dates',
  unknown: 'Unknown statement date',
};

/** Statement-date age, not import age: the stored bank line has no received-at field. */
export function bankLineAgeGroup(date: string, today: string): BankLineAgeGroup {
  if (!civilDateParts(date) || !civilDateParts(today)) return 'unknown';
  const age = dayNumber(today.trim()) - dayNumber(date.trim());
  if (age < 0) return 'future';
  if (age > 30) return 'over30';
  return age >= 7 ? '7to30' : 'under7';
}

/** Calendar-day ordering avoids DST/UTC shifts. Never mutates the browser cache. */
export function oldestBankLinesFirst<T extends { date: string }>(lines: readonly T[]): T[] {
  const dateNumber = (date: string) => civilDateParts(date) ? dayNumber(date.trim()) : Infinity;
  return [...lines].sort((a, b) => dateNumber(a.date) - dateNumber(b.date));
}
