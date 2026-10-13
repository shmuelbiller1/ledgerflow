/**
 * Facts (docs/PLAN.md §10, the owner's rule graph): what is true about an organisation, a place, a
 * status or a period, kept on the books or on any label value (an entity, a location, a legal form,
 * a programme, or another dimension). Facts are composed across **every** dimension of a line, not only the
 * first one that has something (the old `resolveSellerProfile` stopped there), each value with its
 * parents (`us/texas/austin` → `us/texas` → `us`) and then the books.
 *
 * Facts and conclusions stay apart: a label only *declares* a fact. A fact is verified when it carries
 * evidence (a registration, an authority's letter, a document) that someone checked. Rules can require
 * verified facts, so choosing a label never by itself creates a legal status or proves compliance.
 * Pure.
 */
import { nodeAncestry } from '../tax/profile';

/** The attributes the rules know. Independent of each other: an LLC can be taxed as an S corporation. */
export type FactAttribute =
  | 'legalForm'           // llc, corporation, partnership, sole_proprietor, nonprofit_corporation, ltd (Israel חברה בע"מ), osek_murshe …
  | 'taxTreatment'        // c_corporation, s_corporation, partnership, disregarded, il_company, il_osek_murshe, il_osek_patur …
  | 'exemptStatus'        // not_exempt, recognized_exempt, pending (separate from legal form: a nonprofit corporation is not exempt until recognised)
  | 'country' | 'state' | 'county' | 'city' | 'district'
  | 'activity'            // retail, services, manufacturing … (a set: a business can do several)
  | 'productCategory'     // A-30's item tax categories (clothing, groceries, SaaS …): what is being sold
  | 'accountingMethod'    // accrual, cash
  | 'channel'             // A-41: where the sale happens — direct, marketplace, own-website …
  | 'paymentType'         // A-43: what a payment to a vendor is for — services-or-assets, rent-expense, interest, royalty
  | 'payeeResidence'      // A-43: where the payee is a resident — IL (Israeli resident) or foreign
  | 'registration';       // a set of keys from src/lib/tax/profile.ts registrationKey

/** Single-valued attributes may conflict between dimensions; set-valued ones accumulate. */
export const SET_ATTRIBUTES: ReadonlySet<FactAttribute> = new Set(['activity', 'registration', 'productCategory']);

export interface Evidence {
  kind: 'declared' | 'document' | 'registration' | 'authority';
  /** what shows it: a document id, a registration number, a letter's reference */
  ref?: string;
  /** who checked it and when (YYYY-MM-DD); without these the fact is only declared */
  verifiedBy?: string;
  verifiedAt?: string;
}

export interface Fact {
  attribute: FactAttribute;
  value: string;
  validFrom?: string;
  validTo?: string;
  evidence?: Evidence;
}

/** Facts kept on the books and on label values, keyed `dimensionId:nodeId` (as tax profiles). */
export interface FactSources {
  books?: Fact[];
  labels?: Record<string, Fact[]>;
}

export interface ComposedFact {
  attribute: FactAttribute;
  /** one value, or several for a set attribute */
  values: string[];
  /** where each value came from (label key or 'books'), nearest first */
  from: string[];
  /** every value carries checked evidence */
  verified: boolean;
}

export interface FactConflict {
  attribute: FactAttribute;
  /** the different values and where each came from */
  candidates: Array<{ value: string; from: string }>;
}

export interface ComposedFacts {
  facts: Partial<Record<FactAttribute, ComposedFact>>;
  /** single-valued attributes that two dimensions answer differently: shown, never silently chosen */
  conflicts: FactConflict[];
}

export const isVerified = (f: Fact) => Boolean(f.evidence && f.evidence.kind !== 'declared' && f.evidence.verifiedBy && f.evidence.verifiedAt);
const inForce = (f: Fact, date: string) => (!f.validFrom || f.validFrom <= date) && (!f.validTo || date <= f.validTo);

/**
 * The facts of a line (its labels) on a date. For each dimension in `order`, the nearest label value
 * (or parent) that states an attribute gives it; the books fill what no label states. A single-valued
 * attribute stated differently by two dimensions is a conflict: the first dimension in `order` is
 * used, and the conflict is reported so the screen can ask. Set attributes are the union.
 */
export function composeFacts(sources: FactSources | null | undefined, dimensions: Record<string, string> | null | undefined, order: string[], date: string): ComposedFacts {
  const levels: Array<[string, Fact[]]> = [];
  const labels = sources?.labels || {};
  for (const dimensionId of order) {
    const nodeId = dimensions?.[dimensionId];
    if (!nodeId) continue;
    // within one dimension the nearest value wins per attribute, so its chain is one level
    const chain = nodeAncestry(nodeId).map(id => `${dimensionId}:${id}`).filter(key => labels[key]);
    if (!chain.length) continue;
    const seen = new Set<FactAttribute>();
    const merged: Fact[] = [];
    for (const key of chain) {
      for (const fact of labels[key].filter(f => inForce(f, date))) {
        if (SET_ATTRIBUTES.has(fact.attribute) || !seen.has(fact.attribute)) merged.push(Object.assign({ from: key }, fact));
        seen.add(fact.attribute);
      }
    }
    levels.push([dimensionId, merged]);
  }
  const books = (sources?.books || []).filter(f => inForce(f, date)).map(f => Object.assign({ from: 'books' }, f));

  const facts: ComposedFacts['facts'] = {};
  const conflicts: FactConflict[] = [];
  const all = [...levels.flatMap(([, list]) => list), ...books] as Array<Fact & { from: string }>;
  const attributes = [...new Set(all.map(f => f.attribute))];
  for (const attribute of attributes) {
    const stated = all.filter(f => f.attribute === attribute);
    if (SET_ATTRIBUTES.has(attribute)) {
      const unique = stated.filter((f, i) => stated.findIndex(g => g.value === f.value) === i);
      facts[attribute] = { attribute, values: unique.map(f => f.value), from: unique.map(f => f.from), verified: unique.every(isVerified) };
      continue;
    }
    const fromLabels = stated.filter(f => f.from !== 'books');
    const differing = fromLabels.filter((f, i) => fromLabels.findIndex(g => g.value === f.value) === i);
    if (differing.length > 1) conflicts.push({ attribute, candidates: differing.map(f => ({ value: f.value, from: f.from })) });
    const chosen = stated[0];
    facts[attribute] = { attribute, values: [chosen.value], from: [chosen.from], verified: isVerified(chosen) };
  }
  return { facts, conflicts };
}
