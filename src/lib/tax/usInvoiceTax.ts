/**
 * CON-1 (capabilities 137 + 139): the sales tax an invoice should carry, from the US state table, the item tax
 * categories of its lines and the seller's permits. An invoice carries one tax code, so this answers for the
 * whole invoice: one rate when every line is taxed alike, "mixed" when they differ, and "confirm" when a line's
 * category is one the state table leaves unclear. Per-line tax stays with AI #1 (decision of 20 Oct).
 *
 * Honest limits, said on the screen:
 *  - the rates come from the rule packs; only the state rate is there unless local rows are loaded, so the
 *    answer says whether city, county and district rates are included;
 *  - LedgerFlow has checked the state and local tables of TX, CA, NY, WA and CO only — every other state's
 *    answer is "not verified".
 * Pure.
 */
import { effectiveTaxCategory, taxCategoryLabel, type TaxCategoryId } from './taxCategories';
import { productTaxabilityRows } from './usProductTaxability';
import { resolveLineTax, type LineTaxReason, type RateTable, type RateTables, type TaxComponent } from './resolveLineTax';
import { placeState, type ResolvedProfile, type TaxPlace } from './profile';

/** The states whose state and local rate sources LedgerFlow has checked (AI #1, 20 Oct). */
export const US_SUPPORTED_STATES = ['TX', 'CA', 'NY', 'WA', 'CO'] as const;

export const isSupportedUsState = (state: string | undefined) =>
  (US_SUPPORTED_STATES as readonly string[]).includes(String(state || '').toUpperCase());

export interface UsRateGroup {
  category: TaxCategoryId;
  rate: number;
  components: TaxComponent[];
  /** how many of the invoice's lines are in this category */
  lines: number;
}

interface UsAnswerBase {
  state: string;
  /** false outside TX, CA, NY, WA and CO */
  verified: boolean;
  /** lines without an item: counted as general goods, and said so */
  linesWithoutItem: number;
}

/** The taxability row in force on the date; none means the table does not answer for that date (#239 review). */
const treatmentOn = (state: string, category: TaxCategoryId, date: string) =>
  productTaxabilityRows(state, category).find(r => r.validFrom <= date && (!r.validTo || date <= r.validTo))?.treatment;

export type UsInvoiceTax =
  /** no sales tax applies, for a reason that does not depend on what is sold */
  | { kind: 'none'; reason: Exclude<LineTaxReason, 'taxed'>; state?: string }
  /** every line is taxed alike: one rate for the invoice */
  | (UsAnswerBase & { kind: 'rate'; rate: number; components: TaxComponent[]; localIncluded: boolean; categories: TaxCategoryId[] })
  /** the lines are taxed differently: one invoice rate cannot be right */
  | (UsAnswerBase & { kind: 'mixed'; groups: UsRateGroup[]; localIncluded: boolean })
  /** a line's category is one the state table leaves unclear, or is not a known category: a person decides */
  | (UsAnswerBase & { kind: 'confirm'; unclear: TaxCategoryId[]; unknown: string[]; unloaded: number });

const total = (components: TaxComponent[]) => Math.round(components.reduce((s, c) => s + c.rate, 0) * 1e6) / 1e6;

/**
 * @param lineCategories one entry per invoice line: the line's item tax category (`''` for an item with none),
 *   `null` for a line with no item, or `undefined` while its item is not loaded (its category is not known yet).
 */
export function usInvoiceTax(input: {
  seller: ResolvedProfile;
  buyer?: TaxPlace | null;
  date: string;
  lineCategories: Array<string | null | undefined>;
  exempt?: boolean;
  tables?: RateTables;
  fallback?: RateTable;
}): UsInvoiceTax | undefined {
  if (input.seller.place?.country !== 'US') return undefined;
  const lines = input.lineCategories.length ? input.lineCategories : [null];
  const linesWithoutItem = lines.filter(c => c === null).length;
  const base = { seller: input.seller, buyer: input.buyer, date: input.date, exempt: input.exempt, tables: input.tables, fallback: input.fallback };
  // the place, the permit, a certificate and export do not depend on what is sold: ask once
  const first = resolveLineTax({ ...base, category: 'general' });
  if (first.reason !== 'taxed' && first.reason !== 'no-rate-table') return { kind: 'none', reason: first.reason };
  const state = placeState(input.buyer?.country ? input.buyer : input.seller.place);
  if (first.reason === 'no-rate-table') return { kind: 'none', reason: 'no-rate-table', state };
  const common = { state, verified: isSupportedUsState(state), linesWithoutItem };

  const counts = new Map<TaxCategoryId, number>();
  const unknown: string[] = [];
  const unloaded = lines.filter(c => c === undefined).length;
  for (const raw of lines) {
    if (raw === undefined) continue;
    const category = effectiveTaxCategory(raw);
    if (!category) { if (raw && !unknown.includes(raw)) unknown.push(raw); continue; }
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  // unclear in the table, or no row in force on the invoice date: a person decides, never a silent "taxable"
  const unclear = [...counts.keys()].filter(category => { const t = treatmentOn(state, category, input.date); return !t || t === 'unclear'; });
  if (unclear.length || unknown.length || unloaded) return { kind: 'confirm', ...common, unclear, unknown, unloaded };

  const groups: UsRateGroup[] = [...counts.entries()].map(([category, count]) => {
    const tax = resolveLineTax({ ...base, category });
    return { category, rate: tax.rate, components: tax.components, lines: count };
  });
  const localIncluded = groups.some(g => g.components.some(c => c.level !== 'state'));
  const rates = new Set(groups.map(g => g.rate));
  if (rates.size > 1) return { kind: 'mixed', ...common, groups, localIncluded };
  const one = groups[0];
  return { kind: 'rate', ...common, rate: total(one.components), components: one.components, localIncluded, categories: groups.map(g => g.category) };
}

/** The categories in words, for the screen ("Groceries (food at home), Services"). */
export const categoriesInWords = (ids: string[]) => ids.map(id => taxCategoryLabel(id) || id).join(', ');

/**
 * One invoice line's tax category for `usInvoiceTax`: its linked item's, else the item whose name it carries (a
 * service item fills the name only and stays unlinked), with a service item that has no category counted as
 * Services. `''` is an item with no category (general goods); null is a free-text line with no item; undefined is
 * a line whose item is not in the loaded list (its category is not known yet).
 */
export function lineTaxCategory(
  line: { itemId?: string; description?: string },
  items: Array<{ id: string; name: string; sku?: string; itemType?: string; productTaxCategory?: string }>,
  /** false while the item list is loading or capped: an item not found may just not be loaded (#239 review) */
  complete = true,
): string | null | undefined {
  // the same exact name-or-SKU match the invoice uses to link an item (findInventoryItem)
  const typed = (line.description || '').trim();
  const item = line.itemId ? items.find(i => i.id === line.itemId) : typed ? items.find(i => i.name === typed || (Boolean(i.sku) && i.sku === typed)) : undefined;
  if (!item) return line.itemId || !complete ? undefined : null;
  return item.productTaxCategory || (item.itemType === 'service' ? 'services' : '');
}

/**
 * #255 review (AI #1, 20 Oct): an issued invoice keeps where the sale went — the customer's tax place on the day it
 * was issued — in `metadata.taxPlace`, so editing the customer's address later does not move a past sale between
 * states (the nexus watch, usNexusWatch.ts, reads the invoice's own place first). A draft is not a sale yet: it takes
 * no snapshot, and takes it when it is issued. An issued invoice keeps its snapshot while it stays with the same
 * customer; changing the customer takes the new customer's place (or clears it, with null). Returns the metadata to
 * merge (or nothing).
 */
export function saleDestinationSnapshot(input: {
  status?: string;
  customerId?: string;
  /** the invoice as it was opened (its customer and its metadata) */
  initial?: { customerId?: string; metadata?: Record<string, unknown> | null };
  customers: Array<{ id: string; metadata?: unknown }>;
}): { taxPlace?: TaxPlace | null } {
  if (!input.customerId || ['draft', 'void', 'cancelled'].includes(String(input.status || ''))) return {};
  const kept = input.initial?.metadata?.taxPlace as TaxPlace | undefined;
  if (kept && input.initial?.customerId === input.customerId) return { taxPlace: kept };
  const place = ((input.customers.find(c => c.id === input.customerId)?.metadata as { taxPlace?: TaxPlace } | undefined)?.taxPlace);
  if (place?.country) return { taxPlace: { ...place } };
  // another customer with no place recorded: the earlier customer's place must not stay on the sale
  return kept ? { taxPlace: null } : {};
}
