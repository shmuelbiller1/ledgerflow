/**
 * CON-2 (capability 138): the US economic-nexus watch from the books' own posted invoices. For each state the
 * customers are in, it adds up the sales (before sales tax, in the home currency) and the number of sales for the
 * calendar year to date and the whole previous calendar year, and compares each with the state's threshold
 * (`nexusWatch`, the A-27 table) — crossed, or at 80% of the way.
 *
 * Honest limits, said on the screen:
 *  - states measure differently (previous or current calendar year, the last four quarters, gross or retail
 *    sales, marketplace sales); this shows the two calendar years for every state, so it is a watch, never a
 *    conclusion that a seller must register;
 *  - LedgerFlow has checked TX, CA, NY, WA and CO; other states' figures are shown "not verified";
 *  - a sale is placed by its own tax place or ship-to state, else its customer's; one with neither is counted apart;
 *  - each selling entity (PLAN §6) is watched on its own, with its own permits: entities' sales are never pooled;
 *  - the thresholds are US dollars: books kept in another currency are refused, not converted at a guessed rate.
 * Pure: the same document figures (`taxReturnDocument`) and statuses (`COUNTED_SALES`) as the sales-tax return.
 */
import { COUNTED_SALES } from '../taxCodes';
import { taxReturnDocument, type TaxableDocument } from '../taxReturnDocs';
import { nexusWatch, type NexusWatchResult } from './usNexus';
import { placeState, registrationsOn, resolveSellerProfile, type TaxPlace, type TaxProfiles } from './profile';

/** The states whose tables LedgerFlow has checked (AI #1, 20 Oct); the same list as the invoice suggestion's. */
export const US_NEXUS_SUPPORTED_STATES = ['TX', 'CA', 'NY', 'WA', 'CO'] as const;

export interface NexusSaleDocument extends TaxableDocument {
  customerId?: string;
  /** document-level labels, when a document carries them (most keep them on their lines) */
  dimensions?: Record<string, string>;
  /** the lines' labels: the selling entity is the one every line names (PLAN §6) */
  items?: Array<{ dimensions?: Record<string, string> }>;
  /** a credit note's invoice: the credit belongs to that sale's entity and state */
  invoiceId?: string;
  /** where this sale went, when the document records it: it comes before the customer's own place */
  shippingAddress?: { country?: string; state?: string };
  /** an issued invoice's place on the day it was issued (saleDestinationSnapshot); null = none recorded */
  metadata?: { taxPlace?: TaxPlace | null } & Record<string, unknown>;
}

export interface NexusYear extends NexusWatchResult {
  year: number;
  /** the window measured: 1 Jan to the as-of date this year, the whole calendar year before */
  startDate: string;
  endDate: string;
}

export interface UsNexusStateWatch {
  /** the selling entity the totals belong to: its profile key (a label, or 'books') and its name */
  entity: string;
  entityName?: string;
  state: string;
  /** false outside TX, CA, NY, WA and CO */
  verified: boolean;
  /** the seller holds a sales-tax permit for the state on the as-of date */
  permit: boolean;
  thisYear?: NexusYear;
  lastYear?: NexusYear;
  /** the state has no economic-nexus test (no sales and no transaction threshold) */
  noTest: boolean;
  /** a threshold is crossed in either year */
  crossed: boolean;
  /** crossed, or 80% of the way, in either year */
  warning: boolean;
}

export interface UsNexusWatch {
  asOf: string;
  /** set when the figures cannot be compared with the thresholds (they are in US dollars); no states are given */
  problem?: string;
  states: UsNexusStateWatch[];
  /** posted sales whose customer has no US tax place recorded: in no state's figures */
  unplacedDocuments: number;
  /** #255 review: posted sales whose lines name different selling entities: left out, not split by a guess */
  mixedEntityDocuments?: number;
}

const toBase = (cents: number, rate?: number) => Math.round(cents * (rate && rate > 0 ? rate : 1));

export function usNexusWatch(input: {
  asOf: string;
  invoices: NexusSaleDocument[];
  creditNotes?: NexusSaleDocument[];
  customers: Array<{ id: string; metadata?: unknown }>;
  profiles?: TaxProfiles | null;
  /** the label order that finds a document's selling entity (World / Entity first) */
  order?: string[];
  /** the workspace (home) currency the figures are in; the thresholds are US dollars */
  currency?: string;
}): UsNexusWatch {
  const asOf = input.asOf.slice(0, 10);
  const currency = (input.currency || 'USD').toUpperCase();
  if (currency !== 'USD') {
    return { asOf, states: [], unplacedDocuments: 0, problem: `The state thresholds are in US dollars and these books are kept in ${currency}, so the sales cannot be compared with them here. Nothing is converted at a guessed rate.` };
  }
  const year = Number(asOf.slice(0, 4));
  const windows = [
    { key: 'thisYear' as const, year, startDate: `${year}-01-01`, endDate: asOf },
    { key: 'lastYear' as const, year: year - 1, startDate: `${year - 1}-01-01`, endDate: `${year - 1}-12-31` },
  ];
  const customers = new Map(input.customers.map(c => [c.id, c]));
  // per selling entity and state: two entities' sales are never added together (each has its own nexus)
  const totals = new Map<string, { entity: string; entityName?: string; state: string; permit: boolean; thisYear: { salesCents: number; orders: number }; lastYear: { salesCents: number; orders: number } }>();
  let unplacedDocuments = 0;
  let mixedEntityDocuments = 0;
  const invoicesById = new Map((input.invoices || []).map(d => [d.id, d]));
  const entityKeys = input.order || [];
  // #255 review: invoices keep their labels on their lines; the entity is the one all lines agree on, for each
  // label in the entity order. Lines that disagree make the sale "mixed" (null): never pooled into one entity.
  const sellerLabels = (doc: NexusSaleDocument): Record<string, string> | null | undefined => {
    if (doc.dimensions) return doc.dimensions;
    const lines = (doc.items || []).map(l => l.dimensions || {});
    if (!lines.length) return undefined;
    const shared: Record<string, string> = {};
    for (const key of entityKeys) {
      const values = new Set(lines.map(l => l[key] || ''));
      if (values.size > 1) return null;
      const [value] = [...values];
      if (value) shared[key] = value;
    }
    return shared;
  };

  const add = (docs: NexusSaleDocument[] | undefined, sign: 1 | -1) => {
    for (const doc of docs || []) {
      const date = String(doc.date || doc.issueDate || '').slice(0, 10);
      if (!COUNTED_SALES.has(String(doc.status))) continue;
      const window = windows.find(w => date >= w.startDate && date <= w.endDate);
      if (!window) continue;
      // a credit note follows its invoice: the same destination and the same selling entity
      const invoice = sign === -1 && doc.invoiceId ? invoicesById.get(doc.invoiceId) : undefined;
      const placeOf = (d: NexusSaleDocument | undefined) => {
        if (!d) return undefined;
        if (d.metadata?.taxPlace) return d.metadata.taxPlace;
        const st = placeState(d.shippingAddress);
        return st ? { country: d.shippingAddress?.country || 'US', state: st } : undefined;
      };
      // the sale's own destination first (its tax place, then its ship-to), then the customer's place
      const customerPlace = ((doc.customerId ? customers.get(doc.customerId) : undefined)?.metadata as { taxPlace?: TaxPlace } | undefined)?.taxPlace;
      const place = placeOf(doc) || placeOf(invoice) || customerPlace;
      if (place && String(place.country || '').toUpperCase() !== 'US') continue; // a sale abroad is in no state
      const state = placeState(place);
      if (!state) { if (sign === 1) unplacedDocuments++; continue; }
      const own = sellerLabels(doc);
      const labels = own === undefined && invoice ? sellerLabels(invoice) : own;
      if (labels === null) { if (sign === 1) mixedEntityDocuments++; continue; }
      const seller = resolveSellerProfile(input.profiles, labels, input.order || []);
      const entity = seller.from?.[0] || 'books';
      const key = `${entity}|${state}`;
      const row = totals.get(key) || {
        entity, ...(seller.name ? { entityName: seller.name } : {}), state,
        permit: registrationsOn(seller, 'sales_tax', asOf).some(r => placeState(r.place) === state),
        thisYear: { salesCents: 0, orders: 0 }, lastYear: { salesCents: 0, orders: 0 },
      };
      // credit notes lower the sales of the year they fall in; they are not sales, so the count is unchanged
      row[window.key].salesCents += sign * toBase(taxReturnDocument(doc).netCents, doc.exchangeRate);
      if (sign === 1) row[window.key].orders += 1;
      totals.set(key, row);
    }
  };
  add(input.invoices, 1);
  add(input.creditNotes, -1);

  const states = [...totals.values()].map((row): UsNexusStateWatch => {
    const { state } = row;
    const years = windows.map(w => {
      const result = nexusWatch({ state, ...row[w.key] }, w.endDate);
      return result ? { ...result, year: w.year, startDate: w.startDate, endDate: w.endDate } : undefined;
    });
    const [thisYear, lastYear] = years;
    const rule = thisYear || lastYear;
    return {
      entity: row.entity, ...(row.entityName ? { entityName: row.entityName } : {}),
      state,
      verified: (US_NEXUS_SUPPORTED_STATES as readonly string[]).includes(state),
      // the seller's own permit: one entity's permit does not cover another's sales
      permit: row.permit,
      noTest: Boolean(rule && rule.salesThresholdCents === null && rule.transactions === null),
      ...(thisYear ? { thisYear } : {}),
      ...(lastYear ? { lastYear } : {}),
      crossed: years.some(y => y?.crossed),
      warning: years.some(y => y?.warning),
    };
  });
  const rank = (s: UsNexusStateWatch) => (s.crossed ? 2 : s.warning ? 1 : 0);
  const reach = (s: UsNexusStateWatch) => Math.max(s.thisYear?.ratio ?? 0, s.lastYear?.ratio ?? 0);
  states.sort((a, b) => rank(b) - rank(a) || reach(b) - reach(a) || a.state.localeCompare(b.state) || a.entity.localeCompare(b.entity));
  return { asOf, states, unplacedDocuments, ...(mixedEntityDocuments ? { mixedEntityDocuments } : {}) };
}
