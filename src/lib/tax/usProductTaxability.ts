/**
 * A-31 (PLAN US-1/US-3): which of A-30's item tax categories are taxable, exempt or reduced in each
 * US state, as dated rows with a source per row.
 *
 * How to read it: this is a **calculation-stage** table. A row is written where the state's published
 * answer is well known; where the state's treatment genuinely varies by product and price (SaaS,
 * services, digital goods, clothing below a price cap) the row is `unclear` and the tool must ask a
 * person instead of guessing. `reduced` means the state taxes the category at less than its own
 * general rate — the rate shown is the state part and local taxes may still apply.
 *
 * A-42 (12 Oct) extended the digital side: SaaS, downloads and streaming are answered per form in
 * `usDigitalTaxability.ts`, and this table's `saas` rows read that one (the `digital-goods` rows keep
 * the list both tables share — `DIGITAL_GOODS_TAXABLE_STATES`). A state that answers a download and a
 * stream differently is therefore `unclear` at the category level, and `digitalFormMismatches()`
 * names those states for a person.
 *
 * Every row carries the state's revenue-department link and the date the table was checked. Before a
 * filing position is taken, a person confirms the row against that source (PLAN §5: an accountant
 * checks one real period).
 */
import { US_STATE_SALES_TAX } from './usStateSalesTax';
import { TAX_CATEGORIES, TAX_CATEGORY_IDS, type TaxCategoryId } from './taxCategories';
import { DIGITAL_GOODS_TAXABLE_STATES, digitalTreatment } from './usDigitalTaxability';

export type TaxTreatment = 'taxable' | 'exempt' | 'reduced' | 'unclear';

export const TAX_TREATMENT_LABELS: Record<TaxTreatment, string> = {
  taxable: 'Taxable',
  exempt: 'Exempt',
  reduced: 'Reduced rate',
  unclear: 'Not established here — confirm with the state',
};

export interface UsProductTaxabilityRow {
  state: string;
  category: TaxCategoryId;
  treatment: TaxTreatment;
  /** for 'reduced': the state part of the rate, as a fraction (e.g. Illinois food 1% = 0.01) */
  rate?: number;
  /** where the answer was read */
  source: string;
  validFrom: string;
  validTo?: string;
  checked: string;
  note?: string;
}

const CHECKED = '2026-10-11';
/** The table starts here: these answers are the ones a person checked in the 2026 session. */
const VALID_FROM = '2026-01-01';

/** Clothing exempt with no cap in this table. */
const CLOTHING_EXEMPT = ['MN', 'NJ', 'PA', 'RI'];
/** Clothing exempt only below a price cap: the answer depends on the item price, so it is not a yes/no. */
const CLOTHING_CAPPED: Partial<Record<string, string>> = {
  CT: 'exempt up to $50 an item', MA: 'exempt up to $175 an item', NY: 'exempt up to $110 an item',
};
/** Groceries not taxed at all. */
const GROCERY_EXEMPT = ['AZ', 'CA', 'CO', 'FL', 'GA', 'IN', 'IA', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'NE', 'NV', 'NJ', 'NM', 'NC', 'ND', 'OH', 'PA', 'RI', 'SC', 'TX', 'VT', 'VA', 'WA', 'WI', 'WY'];
/** Groceries taxed at a lower state rate (the rate is in the table below). */
const GROCERY_REDUCED: Partial<Record<string, number>> = {
  AL: 0.03, AR: 0.0125, IL: 0.01, KS: 0, MO: 0.01225, MS: 0.05, SD: 0.042, TN: 0.04, UT: 0.03, VA: 0.025,
};
/** Groceries taxed at the full state rate (the states that do, and are not in either list above). */
const GROCERY_TAXABLE = ['HI', 'ID', 'OK'];
/** Prescription medicine: exempt unless listed here. */
const RX_REDUCED: Partial<Record<string, number>> = { IL: 0.01 };


/** A short, honest note for the categories where the state's answer depends on the product. */
const UNCLEAR_NOTE: Partial<Record<TaxCategoryId, string>> = {
  saas: 'whether cloud software is a sale of software or a service differs by state and has changed often; confirm with the state',
  services: 'services are taxed only where the state names the service; the state’s list decides',
  'digital-goods': 'the state’s answer here is not established in this table; confirm with the state',
  clothing: 'price caps and item rules apply; confirm the state’s cap',
  books: 'books and printed matter have their own lists in several states; confirm with the state',
};

const sourceFor = (state: string) => US_STATE_SALES_TAX.find(r => r.state === state)?.source || '';

function treatmentFor(state: string, category: TaxCategoryId, noStateTax: boolean): { treatment: TaxTreatment; rate?: number; note?: string } {
  // A-42: the SaaS answer is kept per form in usDigitalTaxability; this row reads it, never a guess
  if (category === 'saas' && !noStateTax) {
    const row = digitalTreatment(state, 'saas');
    return { treatment: row?.treatment ?? 'unclear', ...(row?.rate !== undefined ? { rate: row.rate } : {}), ...(row?.note ? { note: row.note } : {}) };
  }
  if (noStateTax) return { treatment: category === 'general' ? 'exempt' : 'unclear' };
  switch (category) {
    case 'general':
    case 'prepared-food':
      return { treatment: 'taxable' };
    case 'clothing':
      if (CLOTHING_EXEMPT.includes(state)) return { treatment: 'exempt' };
      if (state in CLOTHING_CAPPED) return { treatment: 'unclear' };
      return { treatment: 'taxable' };
    case 'groceries':
      if (GROCERY_EXEMPT.includes(state)) return { treatment: 'exempt' };
      if (state in GROCERY_REDUCED) return { treatment: 'reduced', rate: GROCERY_REDUCED[state] };
      if (GROCERY_TAXABLE.includes(state)) return { treatment: 'taxable' };
      return { treatment: 'unclear' };
    case 'prescription-medicine':
      if (state in RX_REDUCED) return { treatment: 'reduced', rate: RX_REDUCED[state] };
      return { treatment: 'exempt' };
    case 'digital-goods':
      return DIGITAL_GOODS_TAXABLE_STATES.includes(state) ? { treatment: 'taxable' } : { treatment: 'exempt' };
    case 'saas':
    case 'services':
    case 'books':
      return { treatment: 'unclear' };
  }
}

function expand(): UsProductTaxabilityRow[] {
  const rows: UsProductTaxabilityRow[] = [];
  for (const state of US_STATE_SALES_TAX) {
    const source = sourceFor(state.state);
    const noStateTax = state.rate === 0;
    for (const category of TAX_CATEGORY_IDS) {
      const { treatment, rate, note: own } = treatmentFor(state.state, category, noStateTax);
      const note = [
        treatment === 'unclear' ? UNCLEAR_NOTE[category] : undefined,
        own,
        category === 'clothing' && state.state in CLOTHING_CAPPED ? CLOTHING_CAPPED[state.state] : undefined,
        treatment === 'reduced' ? 'the state or local part may still apply' : undefined,
        noStateTax && category !== 'general' ? 'no state sales tax; a local jurisdiction may still tax this' : undefined,
      ].filter(Boolean).join('; ');
      rows.push({
        state: state.state, category, treatment, ...(rate !== undefined ? { rate } : {}),
        source, validFrom: VALID_FROM, checked: CHECKED, ...(note ? { note } : {}),
      });
    }
  }
  return rows;
}

/** 51 states + DC × 9 categories, one dated row each. */
export const US_PRODUCT_TAXABILITY: UsProductTaxabilityRow[] = expand();

/** The rows for one state (and one category, when asked). */
export function productTaxabilityRows(state: string, category?: TaxCategoryId): UsProductTaxabilityRow[] {
  const code = state.toUpperCase();
  return US_PRODUCT_TAXABILITY.filter(r => r.state === code && (!category || r.category === category));
}

/** The treatment of a category in a state; undefined when the state is not in the table at all. */
export function productTreatment(state: string, category: TaxCategoryId): UsProductTaxabilityRow | undefined {
  return productTaxabilityRows(state, category)[0];
}

/** True only when the state's published answer is that the category is not taxed. */
export function productIsExempt(state: string, category: TaxCategoryId): boolean {
  return productTreatment(state, category)?.treatment === 'exempt';
}

/** The categories a state's table leaves for a person to confirm (never shown as a yes/no). */
export function unclearCategories(state: string): TaxCategoryId[] {
  return productTaxabilityRows(state).filter(r => r.treatment === 'unclear').map(r => r.category);
}

export const US_PRODUCT_TAXABILITY_CATEGORIES = TAX_CATEGORIES.map(c => c.id);
