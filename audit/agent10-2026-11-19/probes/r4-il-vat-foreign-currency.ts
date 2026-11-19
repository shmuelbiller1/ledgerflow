/**
 * r4 — does the Israeli VAT return (form 836) convert a foreign-currency document to home cents?
 *
 * `israelVatReturn` calls `buildTaxReturn` without `baseCurrency`, and `computeTaxReturn`'s `toBase`
 * only applies the ISO-4217 minor-unit shift when both `currency` and `baseCurrency` are given:
 *
 *   const toBase = (cents, rate, currency, baseCurrency) => {
 *     const r = rate && rate > 0 ? rate : 1;
 *     return Math.round(cents * (currency && baseCurrency ? minorUnitRate(r, currency, baseCurrency) : r));
 *   };
 *
 * So a zero-decimal currency (JPY) should come out 100x low and a three-decimal one (KWD) 10x low.
 * This probe measures it with the product's own function, on a registration that is in force, with
 * documents that are postable (status 'paid', taxVersion 2) — the reason r3's H1-il was 0 was its
 * fixture, not the code.
 *
 * Run: DATABASE_URL/… not needed; this is pure. `npx tsx audit/agent10-2026-11-19/probes/r4-il-vat-foreign-currency.ts`
 */
import { israelVatReturn, type IlVatDocument } from '../../../src/lib/tax/ilVatReturn';
import type { TaxProfiles } from '../../../src/lib/tax/profile';
import { minorUnitRate } from '../../../src/lib/currencyMinorUnits';

const profiles: TaxProfiles = {
  books: {
    name: 'IL probe books',
    place: { country: 'IL' },
    registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' }, filing: 'bimonthly' }],
  },
} as unknown as TaxProfiles;
const registration = 'vat:IL:514000000';

/** A postable, explicitly-taxed sale in `currency` (taxVersion 2: gross total + the tax inside it). */
const sale = (currency: string, netCents: number, rate: number, taxTreatment: IlVatDocument['taxTreatment'], vatCents = 0): IlVatDocument => ({
  id: `inv-${currency}`,
  date: '2026-09-10',
  status: 'paid',
  currency,
  exchangeRate: rate,
  taxVersion: 2,
  amountCents: netCents + vatCents,
  taxAmountCents: vatCents,
  taxTreatment,
} as IlVatDocument);

const period = { startDate: '2026-09-01', endDate: '2026-10-31' };

function run(currency: string, netCents: number, rate: number, expectedHomeCents: number) {
  const fast = israelVatReturn({
    registration, profiles, order: ['entity'],
    invoices: [sale(currency, netCents, rate, 'standard', 0)], bills: [],
    ...period,
  });
  const scaled = israelVatReturn({
    registration, profiles, order: ['entity'],
    // the same document, but with the rate the app uses everywhere else (minorUnitRate)
    invoices: [sale(currency, netCents, minorUnitRate(rate, currency, 'ILS'), 'standard', 0)], bills: [],
    ...period,
  });
  return {
    currency,
    documentMinorUnits: netCents,
    storedRate: rate,
    expectedHomeCents,
    reportedTaxableSalesCents: fast.taxableSalesCents,
    reportedWithScaledRate: scaled.taxableSalesCents,
    ratio: expectedHomeCents === 0 ? null : Number((fast.taxableSalesCents / expectedHomeCents).toFixed(4)),
    verdict: fast.taxableSalesCents === expectedHomeCents
      ? 'OK'
      : (fast.taxableSalesCents < expectedHomeCents ? 'UNDERCONVERTED' : 'OVERCONVERTED'),
  };
}

const results = [
  // ILS books, so the home currency is ILS (2 decimals).
  // ¥10,000 at 0.0067 ILS/JPY = ₪67.00 = 6,700 agorot; the stored rate applied raw gives 67 agorot.
  run('JPY', 10_000, 0.0067, 6_700),
  // KWD 12.345 at 12.0 ILS/KWD = ₪148.14 = 14,814 agorot; the stored rate applied raw gives 148,140.
  run('KWD', 12_345, 12, 14_814),
  // USD 1,000.00 at 3.7 ILS/USD = ₪3,700.00 = 370,000 agorot (two decimals: no shift, must be exact).
  run('USD', 100_000, 3.7, 370_000),
];

// `ratio` is reported / expected, so 0.01 is a 99% understatement and 10 an overstatement.
console.log(JSON.stringify({ probe: 'r4-il-vat-foreign-currency', results }, null, 2));
