/**
 * A-54 (PLAN): US use tax — when the seller charged none of its state's sales tax on a purchase and
 * the purchase is taxable where this workspace uses it, the workspace's own state taxes it as use
 * tax, generally at the same rate as its sales tax.
 *
 * Two parts, both read-only:
 *  - `usUseTaxPack()` (rules/packs): one dated rule per taxing state over the facts
 *    country=US, state=S and taxCollectedBySeller=no — the rule graph's answer to "does use tax
 *    apply here", with the state's own department as source;
 *  - `reviewUseTax()`: the "use tax you may owe" list from recorded bills — which bills in the
 *    period carry no sales tax, what base of each is taxable by the item's own A-31 category in the
 *    chosen state, and the estimated tax at the state-level rate in force on the bill's date.
 *
 * Honesty: the estimate is **state-level only** (county, city and district use-tax additions follow
 * the state's own rules and are not concluded here); a bill line with no item or an unknown category
 * is listed as *unclear for a person to review* and is never counted in the estimate; a bill whose
 * currency is not the workspace currency is skipped and counted, never converted; and nothing here
 * files, accrues or posts — the payment of use tax happens on the state's own return.
 */
import { US_STATE_SALES_TAX, NO_STATE_SALES_TAX, stateSalesTaxRate } from './usStateSalesTax';
import { productTreatment, type TaxTreatment } from './usProductTaxability';
import { effectiveTaxCategory } from './taxCategories';
import { rateRule, where, slug, type TaxRulePack, type UseTaxEffect } from '../rules/packs/shared';

/* ------------------------------------------------------------------ the pack */

/** The states whose rules are written: every taxing jurisdiction of A-22's table (45 states + DC). */
export const USE_TAX_STATES = US_STATE_SALES_TAX.filter(row => !NO_STATE_SALES_TAX.includes(row.state)).map(row => row.state);

export function usUseTaxPack(): TaxRulePack {
  const rules = US_STATE_SALES_TAX
    .filter(row => row.rate > 0)
    .map(row => rateRule<UseTaxEffect>({
      id: `us-use-tax-${slug(row.state)}-${slug(row.validFrom)}`,
      name: `${row.stateName}: use tax where the seller charged no ${row.state} sales tax`,
      scope: 'line',
      when: [where('country', ['US']), where('state', [row.state]), where('taxCollectedBySeller', ['no'])],
      effect: {
        kind: 'use-tax',
        state: row.state,
        stateName: row.stateName,
        rate: row.rate,
        note: 'state-level rate only; local additions follow the state’s own use-tax rules, and category exemptions are the state’s own answers (A-31)',
      },
      validFrom: row.validFrom,
      ...(row.validTo ? { validTo: row.validTo } : {}),
      source: { authority: `${row.stateName} revenue department`, url: row.source, retrieved: row.checked },
    }));
  return { id: 'us-use-tax', name: 'US state use tax on uncollected purchases', rules, unmapped: [] };
}

/* ------------------------------------------------------------- the review list */

export interface UseTaxBill {
  id: string;
  workspaceId?: string;
  vendorName?: string;
  number?: string;
  date?: string;
  issueDate?: string;
  amountCents: number;
  currency?: string;
  status?: string;
  taxAmountCents?: number;
  taxCents?: number;
  salesTaxCents?: number;
  splits?: Array<{ amountCents: number; itemId?: string; description?: string }>;
}

export interface UseTaxItem {
  id: string;
  productTaxCategory?: string;
}

export interface UseTaxRow {
  billId: string;
  date: string;
  vendor: string;
  billNumber: string;
  currency: string;
  /** the base by treatment, in the bill's own currency */
  taxableCents: number;
  reducedCents: number;
  exemptCents: number;
  /** lines a person must review: no item, an unknown category, or a category the state leaves open */
  unclearCents: number;
  /** the state-level rate in force on the bill's date, or undefined when the table has none */
  rate: number | undefined;
  /** taxable lines at the state rate plus reduced lines at their own rate; unclear lines are never estimated */
  estimatedUseTaxCents: number;
  note: string;
}

export interface UseTaxReview {
  state: string;
  from: string;
  to: string;
  rows: UseTaxRow[];
  totals: { taxableCents: number; unclearCents: number; estimatedUseTaxCents: number };
  skipped: { taxCharged: number; otherCurrency: number; undated: number; notRecorded: number };
  /** a plain-word problem with the request itself; undefined when the review ran */
  problem?: string;
}

const ESTIMATE_STATUSES = new Set(['pending', 'approved', 'paid', 'partially_paid', 'overdue', 'unpaid']);
/** statuses that mean the bill is not a purchase of record (a draft or a cancelled document) */
const NOT_RECORDED = new Set(['draft', 'void', 'cancelled', 'rejected']);

const taxOnBill = (bill: UseTaxBill) => Math.max(0, bill.taxAmountCents || 0, bill.taxCents || 0, bill.salesTaxCents || 0);

/**
 * The "use tax you may owe" review of recorded bills for one state and period. Pure: it changes
 * nothing and posts nothing, and every figure is in whole cents of the bill's own currency.
 */
export function reviewUseTax(input: {
  bills: UseTaxBill[];
  items: UseTaxItem[];
  state: string;
  from: string;
  to: string;
  workspaceId?: string;
  homeCurrency?: string;
}): UseTaxReview {
  const state = (input.state || '').toUpperCase();
  const home = (input.homeCurrency || 'USD').toUpperCase();
  const skipped = { taxCharged: 0, otherCurrency: 0, undated: 0, notRecorded: 0 };
  const base: UseTaxReview = { state, from: input.from, to: input.to, rows: [], totals: { taxableCents: 0, unclearCents: 0, estimatedUseTaxCents: 0 }, skipped };
  if (!state) return { ...base, problem: 'Choose the state the purchases are used in.' };
  if (!USE_TAX_STATES.includes(state)) {
    return NO_STATE_SALES_TAX.includes(state)
      ? { ...base, problem: `${state} has no state sales tax, so this table has no state use tax for it; local rules are not concluded here.` }
      : { ...base, problem: `${state} is not in the state sales-tax table (A-22), so no rate is known here.` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to) || input.from > input.to) {
    return { ...base, problem: 'The period needs two dates, from first.' };
  }
  const itemsById = new Map(input.items.map(item => [item.id, item]));
  const scoped = input.bills.filter(bill => !input.workspaceId || !bill.workspaceId || bill.workspaceId === input.workspaceId);
  const rows: UseTaxRow[] = [];
  for (const bill of scoped) {
    if (bill.status && NOT_RECORDED.has(bill.status)) { skipped.notRecorded++; continue; }
    if (bill.status && !ESTIMATE_STATUSES.has(bill.status)) { skipped.notRecorded++; continue; }
    const date = bill.date || bill.issueDate || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < input.from || date > input.to) {
      if (date) continue; // dated outside the period: simply not this review
      skipped.undated++;
      continue;
    }
    if (taxOnBill(bill) > 0) { skipped.taxCharged++; continue; }
    if ((bill.currency || home).toUpperCase() !== home) { skipped.otherCurrency++; continue; }
    const rate = stateSalesTaxRate(state, date);
    const row: UseTaxRow = {
      billId: bill.id, date, vendor: bill.vendorName || '', billNumber: bill.number || '', currency: home,
      taxableCents: 0, reducedCents: 0, exemptCents: 0, unclearCents: 0, rate, estimatedUseTaxCents: 0, note: '',
    };
    const lines: Array<{ amountCents: number; treatment: TaxTreatment | 'unknown'; reducedRate?: number }> = bill.splits && bill.splits.length
      ? bill.splits.map(split => {
        // an item the line names but the loaded list cannot read is unknown — never the default
        // category; an item that is loaded with no category of its own is 'general' (the vocabulary's
        // own default), which is a recorded fact, not a guess
        const item = split.itemId ? itemsById.get(split.itemId) : undefined;
        const category = item ? effectiveTaxCategory(item.productTaxCategory) : undefined;
        const found = category ? productTreatment(state, category) : undefined;
        return found
          ? { amountCents: split.amountCents, treatment: found.treatment, ...(found.rate !== undefined ? { reducedRate: found.rate } : {}) }
          : { amountCents: split.amountCents, treatment: 'unknown' as const };
      })
      : [{ amountCents: bill.amountCents, treatment: 'unknown' as const }];
    let estimated = 0;
    for (const line of lines) {
      if (line.treatment === 'exempt') row.exemptCents += line.amountCents;
      else if (line.treatment === 'reduced') {
        row.reducedCents += line.amountCents;
        if (line.reducedRate !== undefined && rate !== undefined) estimated += Math.round(line.amountCents * line.reducedRate);
        else if (rate !== undefined) estimated += Math.round(line.amountCents * rate);
      } else if (line.treatment === 'taxable' && rate !== undefined) {
        row.taxableCents += line.amountCents;
        estimated += Math.round(line.amountCents * rate);
      } else {
        // 'unclear' or 'unknown' (no item, an unknown category), or taxable with no rate for the
        // date: listed for a person to review and never estimated
        row.unclearCents += line.amountCents;
      }
    }
    row.estimatedUseTaxCents = estimated;
    row.note = rate === undefined ? 'no state rate is known for this date; review on the state’s own return'
      : row.unclearCents > 0 ? 'some lines have no item category or one the state leaves open: review them, they are not estimated'
      : '';
    rows.push(row);
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.vendor.localeCompare(b.vendor)));
  base.rows = rows;
  base.totals = {
    taxableCents: rows.reduce((sum, row) => sum + row.taxableCents + row.reducedCents, 0),
    unclearCents: rows.reduce((sum, row) => sum + row.unclearCents, 0),
    estimatedUseTaxCents: rows.reduce((sum, row) => sum + row.estimatedUseTaxCents, 0),
  };
  return base;
}

export const USE_TAX_CSV_HEADERS = ['Bill date', 'Vendor', 'Bill number', 'Taxable base', 'Reduced-rate base', 'Exempt base', 'Unclear base (review)', 'State rate %', 'Estimated use tax', 'Currency', 'Note'];

export function reviewUseTaxCsvRows(review: UseTaxReview): string[][] {
  return review.rows.map(row => [
    row.date, row.vendor, row.billNumber,
    (row.taxableCents / 100).toFixed(2), (row.reducedCents / 100).toFixed(2), (row.exemptCents / 100).toFixed(2),
    (row.unclearCents / 100).toFixed(2),
    row.rate !== undefined ? (row.rate * 100).toFixed(3).replace(/\.?(?<!0)0+$/, '') : '',
    (row.estimatedUseTaxCents / 100).toFixed(2), row.currency, row.note,
  ]);
}
