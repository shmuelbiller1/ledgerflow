/**
 * Israel's allocation numbers (PLAN IL-6, "חשבוניות ישראל", מספר הקצאה): a tax invoice to a business
 * buyer (one with a VAT / dealer number) above a threshold before VAT needs an allocation number from
 * the Tax Authority, or the buyer cannot deduct its VAT. The threshold steps down by date (rows with
 * the source). Until the workspace is registered for the Tax Authority's service the number is typed
 * on the invoice by hand (docs/FOR_YOU.md 42). Pure.
 */
import { rateOn, type DatedRate } from './ilVatRates';
import { convertMinorUnits } from '../currencyMinorUnits';

const ITA = 'https://www.gov.il/he/departments/topics/israel-invoices';

/** The threshold before VAT, in agorot (stored in `rate` as shekels for the shared row shape). */
export const IL_ALLOCATION_THRESHOLD: DatedRate[] = [
  { validFrom: '2024-05-05', validTo: '2024-12-31', rate: 25000, source: ITA },
  { validFrom: '2025-01-01', validTo: '2025-12-31', rate: 20000, source: ITA },
  { validFrom: '2026-01-01', validTo: '2026-05-31', rate: 10000, source: ITA },
  { validFrom: '2026-06-01', rate: 5000, source: ITA },
];

/** The threshold in agorot on `date`, or undefined before the rule began. */
export function allocationThresholdCents(date: string): number | undefined {
  const row = rateOn(IL_ALLOCATION_THRESHOLD, date);
  return row ? Math.round(row.rate * 100) : undefined;
}

/** Whether an invoice needs an allocation number: to a business buyer, net of VAT above the threshold, in shekels. */
export function needsAllocationNumber(input: { date: string; netCents: number; currency: string; exchangeRate?: number; buyerVatNumber?: string; taxCents: number }): boolean {
  const threshold = allocationThresholdCents(input.date);
  if (threshold === undefined || !input.buyerVatNumber?.trim() || input.taxCents <= 0) return false;
  // a foreign invoice without its rate yet is not judged (the rate fills in before it is issued)
  if (input.currency !== 'ILS' && !(input.exchangeRate && input.exchangeRate > 0)) return false;
  const shekels = input.currency === 'ILS' ? input.netCents : convertMinorUnits(input.netCents, input.exchangeRate as number, input.currency, 'ILS');
  return shekels > threshold;
}

/** An allocation number is 9 digits (the Tax Authority's confirmation number). */
export const allocationNumberProblem = (value: string) => (/^\d{9}$/.test(value.trim()) ? null : 'An allocation number is 9 digits');
