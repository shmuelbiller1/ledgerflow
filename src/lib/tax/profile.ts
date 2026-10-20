/**
 * Tax profiles (docs/PLAN.md §6): tax follows the entity, not only the workspace. A profile belongs to
 * the books, or to a label value (an entity, a location, a branch, or another label). It says where that
 * organisation sits and what it is registered for. A label value without its own profile, or without
 * some field, inherits from its parent value (`homes/maui` → `homes`), then from the books.
 *
 * An invoice line's seller profile comes from the line's labels; with the buyer's place, the item's
 * tax code and any exemption certificate it decides the tax (the rate tables plug in later). Each
 * tax return is built per registration, from the lines whose seller profile carries it.
 * Pure: no store or I/O. Stored on the workspace as `taxProfiles` (server-written; not yet).
 */

/** A place, from the widest to the narrowest. Country is ISO 3166-1 alpha-2; state is the subdivision code (TX, CA). */
export interface TaxPlace {
  country: string;
  state?: string;
  county?: string;
  city?: string;
  /** a special taxing district (transit, stadium) or a special area (Eilat) */
  district?: string;
  postalCode?: string;
}

export type RegistrationKind =
  | 'vat'             // VAT / GST number (Israel: dealer number, עוסק מורשה)
  | 'sales_tax'       // a US state sales tax permit (or a local one)
  | 'employer'        // an employer number: US EIN or state employer account; Israel withholding file (תיק ניכויים)
  | 'income_tax'      // the company's income tax file
  | 'withholding';    // a certificate for tax withheld at source (Israel ניכוי במקור)

export type FilingFrequency = 'monthly' | 'bimonthly' | 'quarterly' | 'yearly';

export interface TaxRegistration {
  kind: RegistrationKind;
  number: string;
  /** where it is registered: the country, and the state or city for a state or local permit */
  place: TaxPlace;
  filing?: FilingFrequency;
  /** YYYY-MM-DD; none means from the start / no end */
  validFrom?: string;
  validTo?: string;
}

export interface TaxProfile {
  /** shown in lists, e.g. "Acme Texas LLC" */
  name?: string;
  place?: TaxPlace;
  registrations?: TaxRegistration[];
  basis?: 'accrual' | 'cash';
  /** Israel: advance income-tax payment (mikdamot) rate on turnover, as a percentage (e.g. 3.5 for 3.5%) */
  advanceTaxRatePercent?: number;
  /** Israel: advance income-tax payment (mikdamot) filing frequency */
  advanceTaxFrequency?: 'monthly' | 'bimonthly';
}

/** Where profiles are kept: the books' own and one per label value, keyed `dimensionId:nodeId`. */
export interface TaxProfiles {
  books?: TaxProfile;
  labels?: Record<string, TaxProfile>;
}

export const labelKey = (dimensionId: string, nodeId: string) => `${dimensionId}:${nodeId}`;

/** `homes/maui` → [`homes/maui`, `homes`]: the value and its parents, nearest first. */
export function nodeAncestry(nodeId: string): string[] {
  const parts = nodeId.split('/').filter(Boolean);
  return parts.map((_, i) => parts.slice(0, parts.length - i).join('/'));
}

export interface ResolvedProfile extends TaxProfile {
  /** where each field came from, nearest first: label keys, then 'books' */
  from: string[];
}

/**
 * The seller's profile for a line with these labels. Labels are tried in `order` (put the World /
 * Entity label first); the first label value (or a parent of it) that has a profile wins, and its
 * missing fields come from its parents and then the books. Registrations are not merged across
 * levels: the nearest level that lists any is the one that counts (a Texas LLC files its own
 * returns, not the parent's).
 */
export function resolveSellerProfile(profiles: TaxProfiles | null | undefined, dimensions: Record<string, string> | null | undefined, order: string[]): ResolvedProfile {
  const chain: Array<[string, TaxProfile]> = [];
  const labels = profiles?.labels || {};
  for (const dimensionId of order) {
    const nodeId = dimensions?.[dimensionId];
    if (!nodeId) continue;
    const found = nodeAncestry(nodeId).map(id => labelKey(dimensionId, id)).filter(key => labels[key]);
    if (found.length) { found.forEach(key => chain.push([key, labels[key]])); break; }
  }
  if (profiles?.books) chain.push(['books', profiles.books]);
  const out: ResolvedProfile = { from: chain.map(([key]) => key) };
  for (const [, profile] of chain) {
    if (out.name === undefined && profile.name) out.name = profile.name;
    if (out.basis === undefined && profile.basis) out.basis = profile.basis;
    if (out.advanceTaxRatePercent === undefined && profile.advanceTaxRatePercent !== undefined) out.advanceTaxRatePercent = profile.advanceTaxRatePercent;
    if (out.advanceTaxFrequency === undefined && profile.advanceTaxFrequency !== undefined) out.advanceTaxFrequency = profile.advanceTaxFrequency;
    if (out.registrations === undefined && profile.registrations?.length) out.registrations = profile.registrations;
    if (profile.place) out.place = { ...profile.place, ...stripEmpty(out.place) };
  }
  return out;
}

function stripEmpty(place: TaxPlace | undefined): Partial<TaxPlace> {
  if (!place) return {};
  return Object.fromEntries(Object.entries(place).filter(([, v]) => v !== undefined && v !== '')) as Partial<TaxPlace>;
}

/** The registrations of a kind that are in force on `date` (YYYY-MM-DD). */
export function registrationsOn(profile: TaxProfile, kind: RegistrationKind, date: string): TaxRegistration[] {
  return (profile.registrations || []).filter(r => r.kind === kind && (!r.validFrom || r.validFrom <= date) && (!r.validTo || date <= r.validTo));
}

/** A stable key for a registration, to group a return's lines: `vat:IL:514000000`, `sales_tax:US-TX:3200…`. */
export function registrationKey(r: TaxRegistration): string {
  return `${r.kind}:${r.place.country}${r.place.state ? `-${r.place.state}` : ''}${r.place.city ? `-${r.place.city}` : ''}:${r.number}`;
}

const KINDS: RegistrationKind[] = ['vat', 'sales_tax', 'employer', 'income_tax', 'withholding'];
const FREQUENCIES: FilingFrequency[] = ['monthly', 'bimonthly', 'quarterly', 'yearly'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.trim().length > 0 && v.length <= max);

function placeProblem(place: unknown, where: string): string | null {
  if (place === undefined) return null;
  const p = place as Partial<TaxPlace> | null;
  if (!p || typeof p !== 'object') return `${where}: the place is not readable`;
  if (typeof p.country !== 'string' || !/^[A-Z]{2}$/.test(p.country)) return `${where}: the country is a two-letter code (US, IL)`;
  if (p.state !== undefined && !/^[A-Z0-9]{1,3}$/.test(String(p.state))) return `${where}: the state is a short code (TX, CA)`;
  for (const k of ['county', 'city', 'district', 'postalCode'] as const) if (!text(p[k], 80)) return `${where}: the ${k === 'postalCode' ? 'postal code' : k} is 1 to 80 characters`;
  return null;
}

function profileProblem(profile: unknown, where: string): string | null {
  const p = profile as TaxProfile | null;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return `${where}: not readable`;
  if (!text(p.name, 120)) return `${where}: the name is 1 to 120 characters`;
  if (p.basis !== undefined && p.basis !== 'accrual' && p.basis !== 'cash') return `${where}: the basis is accrual or cash`;
  if (p.advanceTaxRatePercent !== undefined) {
    if (typeof p.advanceTaxRatePercent !== 'number' || !Number.isFinite(p.advanceTaxRatePercent) || p.advanceTaxRatePercent < 0 || p.advanceTaxRatePercent > 100) {
      return `${where}: the advance tax rate is a percentage between 0 and 100`;
    }
  }
  if (p.advanceTaxFrequency !== undefined && p.advanceTaxFrequency !== 'monthly' && p.advanceTaxFrequency !== 'bimonthly') {
    return `${where}: the advance tax frequency is monthly or bimonthly`;
  }
  const place = placeProblem(p.place, where);
  if (place) return place;
  if (p.registrations !== undefined) {
    if (!Array.isArray(p.registrations) || p.registrations.length > 30) return `${where}: up to 30 registrations`;
    for (const r of p.registrations) {
      if (!r || !KINDS.includes(r.kind)) return `${where}: a registration's kind is not known`;
      if (typeof r.number !== 'string' || !/^[A-Za-z0-9 .\-/]{1,40}$/.test(r.number.trim())) return `${where}: a registration number is 1 to 40 letters, digits, spaces, dots, dashes or slashes`;
      const rp = placeProblem(r.place, `${where}, registration ${r.number}`);
      if (rp || !r.place) return rp || `${where}: registration ${r.number} needs its place`;
      if (r.filing !== undefined && !FREQUENCIES.includes(r.filing)) return `${where}: registration ${r.number} has an unknown filing frequency`;
      for (const d of [r.validFrom, r.validTo]) if (d !== undefined && !YMD.test(String(d))) return `${where}: registration ${r.number} has a date that is not YYYY-MM-DD`;
      if (r.validFrom && r.validTo && r.validFrom > r.validTo) return `${where}: registration ${r.number} ends before it starts`;
    }
  }
  return null;
}

/** What is wrong with profiles sent to be saved, or null. */
export function taxProfilesProblem(value: unknown): string | null {
  const v = value as TaxProfiles | null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'The tax profiles are not readable';
  if (v.books !== undefined) { const p = profileProblem(v.books, 'The books\' profile'); if (p) return p; }
  if (v.labels !== undefined) {
    if (!v.labels || typeof v.labels !== 'object' || Array.isArray(v.labels)) return 'The label profiles are not readable';
    const keys = Object.keys(v.labels);
    if (keys.length > 500) return 'Up to 500 label profiles';
    for (const key of keys) {
      if (!/^[A-Za-z0-9_-]{1,40}:[^:\s][^:]{0,199}$/.test(key)) return `"${key}" is not a label (label:value)`;
      const p = profileProblem(v.labels[key], `The profile of ${key}`);
      if (p) return p;
    }
  }
  return null;
}
