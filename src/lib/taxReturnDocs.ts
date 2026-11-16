/**
 * Turns invoices, bills, credit notes and vendor credits into the tax return's inputs
 * (src/lib/taxCodes.ts computeTaxReturn), using the one money rule for net and tax
 * (documentMath.ts). Used by the Tax return screen and by the server when a return is filed.
 */
import { calculateDocumentNet, calculateDocumentTax } from './documentMath';
import type { DocumentTaxInput } from './documentMath';
import { minorUnitRate } from './currencyMinorUnits';
import { computeTaxReturn, COUNTED_PURCHASES, COUNTED_SALES } from './taxCodes';
import type { TaxReturn, TaxReturnDocument, TaxTreatment } from './taxCodes';

export interface TaxableDocument extends DocumentTaxInput {
  id: string;
  date?: string;
  issueDate?: string;
  status?: string;
  currency?: string;
  exchangeRate?: number;
  taxTreatment?: TaxTreatment;
  selfAssessedTaxCents?: number;
  /** The parts of the tax code as saved on the document ("GST 5%", "PST 7%"). */
  taxBreakdown?: Array<{ name: string; rate: number; taxCents: number }>;
}

export function taxReturnDocument(doc: TaxableDocument): TaxReturnDocument {
  return {
    id: doc.id,
    date: doc.date || doc.issueDate,
    status: doc.status,
    currency: doc.currency,
    exchangeRate: doc.exchangeRate,
    taxTreatment: doc.taxTreatment,
    netCents: calculateDocumentNet(doc),
    taxCents: calculateDocumentTax(doc),
    selfAssessedCents: doc.selfAssessedTaxCents || 0,
  };
}

export function buildTaxReturn(input: {
  invoices: TaxableDocument[];
  bills: TaxableDocument[];
  creditNotes?: TaxableDocument[];
  vendorCredits?: TaxableDocument[];
  startDate: string;
  endDate: string;
  baseCurrency?: string;
}): TaxReturn {
  return computeTaxReturn({
    startDate: input.startDate,
    endDate: input.endDate,
    baseCurrency: input.baseCurrency,
    sales: input.invoices.map(taxReturnDocument),
    salesCredits: (input.creditNotes || []).map(taxReturnDocument),
    purchases: input.bills.map(taxReturnDocument),
    purchaseCredits: (input.vendorCredits || []).map(taxReturnDocument),
  });
}

/** Box-by-box differences between a filed return and the same period recomputed now (T-07, T-08). */
export function returnChanges(filed: Pick<TaxReturn, 'boxes'>, now: Pick<TaxReturn, 'boxes'>): Array<{ key: string; label: string; filedCents: number; nowCents: number }> {
  return now.boxes
    .map(box => ({ key: box.key, label: box.label, filedCents: filed.boxes.find(b => b.key === box.key)?.cents ?? 0, nowCents: box.cents }))
    .filter(change => change.filedCents !== change.nowCents);
}

export interface TaxRateRow {
  name: string;
  rate: number;
  /** Net amount of the documents this tax was charged on (a two-part code counts it under both). */
  salesNetCents: number;
  salesTaxCents: number;
  purchasesNetCents: number;
  purchasesTaxCents: number;
  /** Collected minus paid. */
  netTaxCents: number;
}

/** Splits `total` over `weights` in whole cents, largest remainder first, so the parts add up exactly. */
function splitCents(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map(w => (total * w) / sum);
  const out = raw.map(r => Math.trunc(r));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: Math.abs(r - Math.trunc(r)) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest !== 0 && k < order.length; k++, rest -= Math.sign(rest)) out[order[k].i] += Math.sign(rest);
  return out;
}

/**
 * Sales Tax Liability Summary (J-11): for each tax (part of a tax code, e.g. "GST 5%"), the tax
 * collected on sales and paid on purchases in the period, in the home currency; credit notes and
 * vendor credits reduce them. A document's tax (documentMath, the same figure as box 1 and box 4)
 * is split over its saved parts; taxed documents without saved parts are listed as "Tax" at their
 * effective rate.
 */
export function taxByRate(input: {
  invoices: TaxableDocument[];
  bills: TaxableDocument[];
  creditNotes?: TaxableDocument[];
  vendorCredits?: TaxableDocument[];
  startDate: string;
  endDate: string;
  baseCurrency?: string;
}): TaxRateRow[] {
  const rows = new Map<string, TaxRateRow>();
  const toBase = (cents: number, rate?: number, currency?: string) => {
    const r = rate && rate > 0 ? rate : 1;
    return Math.round(cents * (currency && input.baseCurrency ? minorUnitRate(r, currency, input.baseCurrency) : r));
  };
  const add = (docs: TaxableDocument[] | undefined, counted: Set<string>, sign: 1 | -1, side: 'sales' | 'purchases') => {
    for (const doc of docs || []) {
      const day = String(doc.date || doc.issueDate || '').slice(0, 10);
      if (!counted.has(String(doc.status)) || day < input.startDate || day > input.endDate) continue;
      const tax = calculateDocumentTax(doc);
      if (tax === 0) continue;
      const net = calculateDocumentNet(doc);
      const parts = doc.taxBreakdown && doc.taxBreakdown.length > 0
        ? doc.taxBreakdown
        : [{ name: 'Tax', rate: net ? Math.round((tax / net) * 10000) / 100 : 0, taxCents: tax }];
      const shares = splitCents(tax, parts.map(p => Math.abs(p.taxCents || 0)));
      parts.forEach((part, i) => {
        const key = `${part.name}|${part.rate}`;
        const row = rows.get(key) || { name: part.name, rate: part.rate, salesNetCents: 0, salesTaxCents: 0, purchasesNetCents: 0, purchasesTaxCents: 0, netTaxCents: 0 };
        row[`${side}NetCents`] += sign * toBase(net, doc.exchangeRate, doc.currency);
        row[`${side}TaxCents`] += sign * toBase(shares[i], doc.exchangeRate, doc.currency);
        rows.set(key, row);
      });
    }
  };
  add(input.invoices, COUNTED_SALES, 1, 'sales');
  add(input.creditNotes, COUNTED_SALES, -1, 'sales');
  add(input.bills, COUNTED_PURCHASES, 1, 'purchases');
  add(input.vendorCredits, COUNTED_PURCHASES, -1, 'purchases');
  return [...rows.values()]
    .map(row => ({ ...row, netTaxCents: row.salesTaxCents - row.purchasesTaxCents }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.rate - b.rate);
}
