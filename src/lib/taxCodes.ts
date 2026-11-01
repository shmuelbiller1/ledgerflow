/**
 * Tax codes and the tax return (launch step 7: T-01 compound tax, T-02 tax groups, T-03 reverse
 * charge, T-04 zero-rated vs exempt, T-06 return boxes). Generic rules that work in any country
 * (owner decision #12, default until a market is chosen).
 *
 * A tax code is one or more parts ("GST 5% + PST 7%"); a compound part is charged on the amount
 * plus the parts before it (Quebec-style). Its treatment says how the amount is reported:
 *  - standard: taxed at the parts' rates
 *  - zero_rated: taxable at 0% (counted as taxable sales; input tax on related costs is reclaimable)
 *  - exempt: not taxable (counted separately; not taxable sales)
 *  - reverse_charge: purchases where the buyer accounts for the tax: the bill carries no tax, but
 *    the same amount is due (box 2) and reclaimable (box 4)
 *  - out_of_scope: not reported
 * All money is integer cents; the return is in the home currency (amount × the document's rate).
 */

import { calculateDocumentNet, calculateDocumentTax, netFromGross } from './documentMath';
import type { DocumentTaxInput } from './documentMath';

export type TaxTreatment = 'standard' | 'zero_rated' | 'exempt' | 'reverse_charge' | 'out_of_scope';

export const TAX_TREATMENTS: Record<TaxTreatment, string> = {
  standard: 'Taxed',
  zero_rated: 'Zero-rated (0%, taxable)',
  exempt: 'Exempt (not taxable)',
  reverse_charge: 'Reverse charge (buyer accounts for the tax)',
  out_of_scope: 'Out of scope (not reported)',
};

export interface TaxComponent {
  name: string;
  /** Percent, e.g. 5 or 9.975. */
  rate: number;
  /** Charged on the amount plus the parts listed before it. */
  compound?: boolean;
}

export interface TaxCode {
  id: string;
  name: string;
  treatment: TaxTreatment;
  components: TaxComponent[];
}

export interface TaxBreakdown {
  treatment: TaxTreatment;
  netCents: number;
  /** Tax charged on the document (0 for zero-rated, exempt, reverse charge, out of scope). */
  taxCents: number;
  components: Array<{ name: string; rate: number; taxCents: number }>;
  /** Reverse charge only: the tax the buyer must account for (due and reclaimable). */
  selfAssessedCents: number;
}

/**
 * Y-35: how a tax amount is rounded to whole cents, set per workspace (Settings). `half_up` is the
 * default and what every document saved before this setting used; `half_even` (banker's rounding)
 * sends exact halves to the even cent; `down` drops the fraction (some authorities allow it).
 * Only the tax on a document is rounded this way; line amounts and money conversion are unchanged.
 */
export type TaxRounding = 'half_up' | 'half_even' | 'down';

export const TAX_ROUNDING: Record<TaxRounding, string> = {
  half_up: 'Half up (0.5 cent rounds up)',
  half_even: 'Half to even (banker\'s rounding)',
  down: 'Down (drop the fraction)',
};

// a product like 1005 × 10 / 100 can land a hair off its exact value in floating point
const EPSILON = 1e-7;

/** A non-negative amount of cents (with a fraction) rounded to whole cents by the policy. */
export function roundTaxCents(cents: number, mode: TaxRounding = 'half_up'): number {
  if (!Number.isFinite(cents)) return 0;
  if (cents < 0) return -roundTaxCents(-cents, mode);
  const whole = Math.floor(cents + EPSILON);
  const fraction = cents - whole;
  if (mode === 'down') return whole;
  if (mode === 'half_even' && Math.abs(fraction - 0.5) < EPSILON) return whole % 2 === 0 ? whole : whole + 1;
  return fraction >= 0.5 - EPSILON ? whole + 1 : whole;
}

function componentTaxes(baseCents: number, components: TaxComponent[], mode: TaxRounding = 'half_up'): number[] {
  let running = 0;
  return components.map(c => {
    const onAmount = c.compound ? baseCents + running : baseCents;
    const tax = roundTaxCents((onAmount * c.rate) / 100, mode);
    running += tax;
    return tax;
  });
}

/** Tax per 1 of net amount, exactly (compound parts included), e.g. 0.05 + 0.09975 × 1.05. */
export function effectiveRate(components: TaxComponent[]): number {
  let running = 0;
  for (const c of components) running += ((c.compound ? 1 + running : 1) * c.rate) / 100;
  return running;
}

/** The tax on an amount (net, or gross when `inclusive`) under a tax code. */
export function computeTax(amountCents: number, code: TaxCode | null | undefined, inclusive = false, rounding: TaxRounding = 'half_up'): TaxBreakdown {
  const amount = Math.max(0, Math.round(amountCents || 0));
  const treatment = code?.treatment || 'out_of_scope';
  const components = code?.components?.filter(c => Number.isFinite(c.rate) && c.rate > 0) || [];
  const none: TaxBreakdown = { treatment, netCents: amount, taxCents: 0, components: [], selfAssessedCents: 0 };
  if (!code || components.length === 0 || treatment === 'zero_rated' || treatment === 'exempt' || treatment === 'out_of_scope') return none;

  if (treatment === 'reverse_charge') {
    const taxes = componentTaxes(amount, components, rounding);
    return { ...none, selfAssessedCents: taxes.reduce((s, t) => s + t, 0), components: components.map((c, i) => ({ name: c.name, rate: c.rate, taxCents: taxes[i] })) };
  }

  let net = amount;
  let taxes: number[];
  if (inclusive) {
    net = netFromGross(amount, effectiveRate(components));
    // the net is what is left of the gross after tax, so the policy rounds the net's tax parts
    taxes = componentTaxes(net, components, rounding);
    // the parts must add up to the gross amount exactly: the rounding cent goes on the last part
    taxes[taxes.length - 1] += amount - net - taxes.reduce((s, t) => s + t, 0);
  } else {
    taxes = componentTaxes(net, components, rounding);
  }
  return {
    treatment, netCents: net, taxCents: taxes.reduce((s, t) => s + t, 0), selfAssessedCents: 0,
    components: components.map((c, i) => ({ name: c.name, rate: c.rate, taxCents: taxes[i] })),
  };
}

/** The workspace's saved tax rates as tax codes (a rate without parts is one part at its rate). */
export function taxCodeFromRate(rate: { id: string; name: string; rate?: number; treatment?: TaxTreatment; components?: TaxComponent[] }): TaxCode {
  // Only the single legacy `rate` may be a fraction (0.2 = 20%). Components are always saved as
  // percentages (TaxManager), so a 0.5% component must stay 0.5, not become 50 (AI #4, D-11).
  const percent = (r: number) => (r > 0 && r <= 1 ? r * 100 : r);
  const components = rate.components?.length
    ? rate.components.map(c => ({ ...c, rate: Number(c.rate) || 0 }))
    : [{ name: rate.name, rate: percent(Number(rate.rate) || 0) }];
  return { id: rate.id, name: rate.name, treatment: rate.treatment || 'standard', components };
}

/** A one-off rate typed on the document (older documents and "custom rate"). */
export function customRateCode(percent: number): TaxCode | null {
  if (!(percent > 0)) return null;
  return { id: 'custom', name: `Tax ${percent}%`, treatment: 'standard', components: [{ name: 'Tax', rate: percent > 0 && percent <= 1 ? percent * 100 : percent }] };
}

export interface DocumentTotals extends TaxBreakdown {
  /** Sum of the lines as entered. */
  subtotalCents: number;
  discountCents: number;
  /** What the customer owes / the vendor is owed: after the discount, tax included. */
  amountCents: number;
}

/**
 * A document's totals from its lines (as entered: with or without tax), the discount and the tax
 * code. The forms save `amountCents` (the total owed), `taxAmountCents` and `taxVersion: 2`, so
 * every report, posting and payment reads the same numbers (documentMath.ts).
 */
export function documentTotals(linesCents: number, discountCents: number, code: TaxCode | null | undefined, pricesIncludeTax: boolean, rounding: TaxRounding = 'half_up'): DocumentTotals {
  const subtotal = Math.round(linesCents || 0);
  const discount = Math.min(Math.max(0, Math.round(discountCents || 0)), Math.max(0, subtotal));
  const base = Math.max(0, subtotal - discount);
  const tax = computeTax(base, code, pricesIncludeTax, rounding);
  return { ...tax, subtotalCents: subtotal, discountCents: discount, amountCents: pricesIncludeTax ? base : base + tax.taxCents };
}

/**
 * The tax inside a credit for part (or all) of a document (L-118): the document's share of tax,
 * so crediting a taxed sale also reduces the tax owed. Works for old and new documents (the
 * total including tax is net + tax by the shared money rules).
 */
export function creditTaxFrom(creditCents: number, doc: DocumentTaxInput & { taxTreatment?: TaxTreatment }) {
  const tax = calculateDocumentTax(doc);
  const gross = calculateDocumentNet(doc) + tax;
  const taxAmountCents = gross > 0 && tax > 0 ? Math.round((Math.max(0, creditCents) * tax) / gross) : 0;
  return {
    taxAmountCents,
    taxInclusive: true,
    taxVersion: 2 as const,
    taxTreatment: doc.taxTreatment || (tax > 0 ? 'standard' as const : undefined),
  };
}

// ---------------------------------------------------------------------------
// The tax return
// ---------------------------------------------------------------------------

/** What a document contributes: its net and tax, the treatment, and the rate to the home currency. */
export interface TaxReturnDocument {
  id: string;
  date?: string;
  issueDate?: string;
  status?: string;
  exchangeRate?: number;
  taxTreatment?: TaxTreatment;
  /** Net (excluding tax) and tax in the document currency, as saved on the document. */
  netCents: number;
  taxCents: number;
  /** Reverse charge on a purchase: the tax the buyer accounts for. */
  selfAssessedCents?: number;
}

export interface TaxReturnBox { key: string; label: string; cents: number }

export interface TaxReturn {
  startDate: string;
  endDate: string;
  boxes: TaxReturnBox[];
  sales: Record<TaxTreatment, { netCents: number; taxCents: number }>;
  purchases: Record<TaxTreatment, { netCents: number; taxCents: number }>;
  documentCount: number;
}

export const COUNTED_SALES = new Set(['sent', 'pending', 'approved', 'paid', 'partially_paid', 'overdue', 'issued', 'applied', 'partially_applied', 'open']);
export const COUNTED_PURCHASES = new Set(['pending', 'approved', 'paid', 'partially_paid', 'overdue', 'unpaid', 'issued', 'applied', 'partially_applied', 'open']);

const emptyTotals = (): Record<TaxTreatment, { netCents: number; taxCents: number }> => ({
  standard: { netCents: 0, taxCents: 0 }, zero_rated: { netCents: 0, taxCents: 0 }, exempt: { netCents: 0, taxCents: 0 },
  reverse_charge: { netCents: 0, taxCents: 0 }, out_of_scope: { netCents: 0, taxCents: 0 },
});

function inPeriod(doc: TaxReturnDocument, start: string, end: string) {
  const d = String(doc.date || doc.issueDate || '').slice(0, 10);
  return d >= start && d <= end;
}

const toBase = (cents: number, rate?: number) => Math.round(cents * (rate && rate > 0 ? rate : 1));

/**
 * The return for a period. Credit notes and vendor credits are passed with `credit: true` groups
 * and reduce sales / purchases. Boxes (generic layout):
 *  1 tax on sales · 2 tax due on reverse-charge purchases · 3 total tax due (1+2)
 *  4 tax reclaimable on purchases (including reverse charge) · 5 net tax to pay (3−4; negative = reclaim)
 *  6 sales excluding tax (taxed, zero-rated and exempt) · 7 purchases excluding tax
 *  8 of which zero-rated sales · 9 of which exempt sales
 */
export function computeTaxReturn(input: {
  sales: TaxReturnDocument[];
  salesCredits?: TaxReturnDocument[];
  purchases: TaxReturnDocument[];
  purchaseCredits?: TaxReturnDocument[];
  startDate: string;
  endDate: string;
}): TaxReturn {
  const sales = emptyTotals();
  const purchases = emptyTotals();
  let documentCount = 0;
  let reverseChargeCents = 0;

  const add = (docs: TaxReturnDocument[] | undefined, totals: typeof sales, counted: Set<string>, sign: 1 | -1, purchase: boolean) => {
    for (const doc of docs || []) {
      if (!counted.has(String(doc.status)) || !inPeriod(doc, input.startDate, input.endDate)) continue;
      const treatment = doc.taxTreatment || (doc.taxCents > 0 ? 'standard' : 'out_of_scope');
      totals[treatment].netCents += sign * toBase(doc.netCents, doc.exchangeRate);
      totals[treatment].taxCents += sign * toBase(doc.taxCents, doc.exchangeRate);
      if (purchase && treatment === 'reverse_charge') reverseChargeCents += sign * toBase(doc.selfAssessedCents || 0, doc.exchangeRate);
      documentCount++;
    }
  };
  add(input.sales, sales, COUNTED_SALES, 1, false);
  add(input.salesCredits, sales, COUNTED_SALES, -1, false);
  add(input.purchases, purchases, COUNTED_PURCHASES, 1, true);
  add(input.purchaseCredits, purchases, COUNTED_PURCHASES, -1, true);

  const sum = (t: typeof sales, key: 'netCents' | 'taxCents', which: TaxTreatment[]) => which.reduce((s, k) => s + t[k][key], 0);
  const outputTax = sum(sales, 'taxCents', ['standard']);
  const inputTax = sum(purchases, 'taxCents', ['standard', 'zero_rated']) + reverseChargeCents;
  const box3 = outputTax + reverseChargeCents;
  const boxes: TaxReturnBox[] = [
    { key: '1', label: 'Tax on sales', cents: outputTax },
    { key: '2', label: 'Tax due on reverse-charge purchases', cents: reverseChargeCents },
    { key: '3', label: 'Total tax due', cents: box3 },
    { key: '4', label: 'Tax reclaimable on purchases', cents: inputTax },
    { key: '5', label: 'Net tax to pay (negative: to reclaim)', cents: box3 - inputTax },
    { key: '6', label: 'Sales excluding tax', cents: sum(sales, 'netCents', ['standard', 'zero_rated', 'exempt']) },
    { key: '7', label: 'Purchases excluding tax', cents: sum(purchases, 'netCents', ['standard', 'zero_rated', 'exempt', 'reverse_charge']) },
    { key: '8', label: 'Zero-rated sales', cents: sales.zero_rated.netCents },
    { key: '9', label: 'Exempt sales', cents: sales.exempt.netCents },
  ];
  return { startDate: input.startDate, endDate: input.endDate, boxes, sales, purchases, documentCount };
}
