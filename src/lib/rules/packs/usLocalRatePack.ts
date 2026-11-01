/**
 * A-40 (PLAN L-1): county, city and special-district rate rows as `Rule` rows over
 * state/county/city/district facts. The rows come from AI #5's E-11 importers
 * (`src/lib/tax/stateLocalRateImporters.ts`), which normalize a **human-reviewed** publication —
 * they never guess a rate, and neither does this pack.
 *
 * What the pack does, and refuses to do:
 *  - A row the publication marks as a **component** becomes an `accumulate` rule: it adds to the
 *    state rate and to the other components of the same place (Texas city + transit, Colorado
 *    home-rule parts).
 *  - A row published as a **combined** figure becomes an `override` rule that displaces the state's
 *    own rate rule (and any component rule for the same place): a combined figure is never added to
 *    its own constituents, which is the one mistake that would overtax every sale.
 *  - The fact key is taken from the row's own published wording. A row whose wording does not say
 *    what it is (California without a Type, Texas without a recognizable name, Washington without a
 *    location code) is **reported** in the pack's `unmapped` list with the reason; no rule is
 *    invented for it. `localRateKey()` is the one place that decides, and it is pure and testable.
 *  - Nothing here says an address's rates have been verified for filing. The pack is data with
 *    `source`, `sourceRow`, edition and dates; the caller states the facts (which is also where a
 *    wrong ZIP → jurisdiction mapping would live, outside this file).
 */
import type { StateLocalRateRow } from '../../tax/stateLocalRateImporters';
import type { Rule } from '../rules';
import { usSalesTaxPack } from './usSalesTaxPack';
import { rateRule, slug, type RateEffect, type TaxRulePack, type UnmappedRow } from './shared';

/** The fact attributes a local rate row can be keyed by. */
export type LocalKeyAttribute = 'county' | 'city' | 'district';

/** The published wording that marks a transit/transportation district in the state tables. */
const DISTRICT_WORDS = /\b(mta|dart|transit|transportation|district|authority|pta)\b/;
/** The published wording that marks a county. */
const COUNTY_WORDS = /\b(co|county|parish)\b/;

/** One reviewed row as the caller reads it, before the key is decided. */
export interface LocalRateKeyResult {
  key?: { attribute: LocalKeyAttribute; value: string };
  /** why no key could be taken from the row's own wording */
  reason?: string;
}

const normalize = (value: string) => value
  .replace(/\u200f|\u200e/g, '')
  .replace(/[.]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/**
 * A county keeps the place's own name as the fact value: "Taylor Co" and "Alameda County" both key
 * the county `taylor` / `alameda`, so a fact composed from an address county matches the row.
 */
const placeValue = (label: string) => {
  const words = normalize(label).split(' ').filter(w => !['co', 'county', 'parish'].includes(w));
  return slug(words.join(' '));
};

/** Names that are city boroughs or city rows rather than counties, whatever the suffix says. */
const CITY_WORDS = /\b(city|ville|town|village|borough|nyc)\b/;

/**
 * The fact key of a reviewed local-rate row, taken only from what the row itself publishes. Pure.
 */
export function localRateKey(row: StateLocalRateRow): LocalRateKeyResult {
  const label = String(row.jurisdiction || '').trim();
  const words = normalize(label);
  const code = String(row.code || '').trim();
  switch (row.state) {
    case 'CA': {
      const type = normalize(code);
      if (/\bcity\b/.test(type)) return { key: { attribute: 'city', value: slug(label) } };
      if (/\bcount/.test(type)) return { key: { attribute: 'county', value: placeValue(label) } };
      if (/\bdistrict\b|\bcounty\b.*\bdistrict\b/.test(type)) return { key: { attribute: 'district', value: slug(label) } };
      return { reason: `the California row "${label}" does not say whether it is a city, county or district (Type: ${code || 'blank'})` };
    }
    case 'WA': {
      if (!code) return { reason: `the Washington row for ZIP ${row.zip ?? '?'} has no location code to key the district by` };
      return { key: { attribute: 'district', value: slug(code) } };
    }
    case 'NY':
      // the New York publication is the "County or other locality" column: a county unless the name
      // itself says city (New York City is published as one row)
      return CITY_WORDS.test(words)
        ? { key: { attribute: 'city', value: slug(label) } }
        : { key: { attribute: 'county', value: placeValue(label) } };
    default: {
      // TX, CO: the published name says what the place is
      if (DISTRICT_WORDS.test(words)) return { key: { attribute: 'district', value: slug(label) } };
      if (COUNTY_WORDS.test(words)) return { key: { attribute: 'county', value: placeValue(label) } };
      if (CITY_WORDS.test(words) || words) return { key: { attribute: 'city', value: slug(label) } };
      return { reason: 'the row has no jurisdiction name to key by' };
    }
  }
}

/** A rate rule with the local row it came from kept for the evidence trail. */
export interface LocalRateEffect extends RateEffect {
  /** a combined figure replaces the state and local rules it already contains */
  basis: 'combined' | 'component';
  jurisdictionLabel: string;
  sourceRow: number;
  locationCode?: string;
  zipRange?: { zip: string; zip4Low: string; zip4High: string };
  edition?: string;
}

/** The state rate rule ids of one state whose validity touches the row's: an override names them. */
function stateRateTargets(state: string, validFrom: string, validTo: string | null): string[] {
  return usSalesTaxPack().rules
    .filter(rule => rule.when.some(c => c.attribute === 'state' && (c.values || []).includes(state)))
    .filter(rule => (!rule.validTo || rule.validTo >= validFrom) && (!validTo || rule.validFrom <= validTo))
    .map(rule => rule.id);
}

const overlaps = (a: { validFrom: string; validTo?: string | null }, b: { validFrom: string; validTo?: string | null }) => {
  const aEnds = a.validTo ?? '9999-12-31';
  const bEnds = b.validTo ?? '9999-12-31';
  return aEnds >= b.validFrom && bEnds >= a.validFrom;
};

/**
 * The local-rate rules of one reviewed import. Rows are grouped per state; nothing is invented where
 * the row's own wording does not say what the place is.
 */
export function usLocalRatePack(rows: readonly StateLocalRateRow[]): TaxRulePack {
  const rules: Array<Rule<LocalRateEffect>> = [];
  const unmapped: UnmappedRow[] = [];
  for (const row of rows) {
    const keyed = localRateKey(row);
    if (!keyed.key) {
      unmapped.push({ row: `${row.state} row ${row.sourceRow} (${row.jurisdiction || 'blank'})`, reason: keyed.reason || 'no key' });
      continue;
    }
    const dateKey = slug(row.validFrom);
    const id = `us-local-${slug(row.state)}-${slug(keyed.key.value)}-${dateKey}`;
    const combined = row.basis === 'combined';
    const samePlace = rules.filter(other =>
      other.effect.jurisdictionLabel === row.jurisdiction &&
      other.effect.basis === 'component' &&
      other.when.some(c => c.attribute === 'state' && (c.values || []).includes(row.state)) &&
      overlaps({ validFrom: other.validFrom, validTo: other.validTo ?? null }, { validFrom: row.validFrom, validTo: row.validTo }),
    ).map(other => other.id);
    rules.push(rateRule<LocalRateEffect>({
      id,
      name: `${row.jurisdiction} ${combined ? 'combined' : 'component'} local sales tax ${(row.rate * 100).toFixed(3).replace(/\.?(?<!0)0+$/, '')}%`,
      when: [
        { attribute: 'country', op: 'in', values: ['US'] },
        { attribute: 'state', op: 'in', values: [row.state] },
        { attribute: keyed.key.attribute, op: 'in', values: [keyed.key.value] },
      ],
      combine: combined ? 'override' : 'accumulate',
      ...(combined ? { targets: [...stateRateTargets(row.state, row.validFrom, row.validTo), ...samePlace] } : {}),
      effect: {
        kind: 'rate',
        level: keyed.key.attribute,
        name: `${row.jurisdiction} local sales tax`,
        rate: row.rate,
        basis: row.basis,
        jurisdictionLabel: row.jurisdiction,
        sourceRow: row.sourceRow,
        ...(row.code ? { locationCode: row.code } : {}),
        ...(row.zip && row.zip4Low !== undefined && row.zip4High !== undefined
          ? { zipRange: { zip: row.zip, zip4Low: row.zip4Low, zip4High: row.zip4High } } : {}),
        ...(row.edition ? { edition: row.edition } : {}),
      },
      validFrom: row.validFrom,
      ...(row.validTo ? { validTo: row.validTo } : {}),
      source: { authority: `${row.state} local rate publication`, url: row.source, retrieved: row.validFrom },
      status: 'calculation',
    }));
  }
  return {
    id: 'us-local-rates',
    name: 'US county, city and district rates (reviewed import rows)',
    rules,
    unmapped,
  };
}
