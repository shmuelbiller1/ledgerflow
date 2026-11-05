/**
 * E-16: Read-only USPS state/ZIP recognition from human-entered address text.
 *
 * NOT geocoding, USPS deliverability, state residency, postal code validation,
 * sales-tax sourcing, county/city/district resolution, or tax jurisdiction proof.
 * USPS ZIP boundaries do not reliably follow civic/tax boundaries.
 *
 * USPS Publication 28 Appendix B:
 * https://pe.usps.com/text/pub28/28apb.htm
 */
export const US_POSTAL_REGIONS = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
  CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii',
  ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  AS: 'American Samoa', FM: 'Federated States of Micronesia', GU: 'Guam',
  MH: 'Marshall Islands', MP: 'Northern Mariana Islands', PW: 'Palau',
  PR: 'Puerto Rico', VI: 'Virgin Islands',
  AA: 'Armed Forces Americas', AE: 'Armed Forces Europe',
  AP: 'Armed Forces Pacific',
} as const;

export type UsPostalCode = keyof typeof US_POSTAL_REGIONS;
export type UsPostalKind = 'state' | 'territory' | 'military';

const TERRITORIES = new Set<UsPostalCode>(['AS','FM','GU','MH','MP','PW','PR','VI']);
const MILITARY = new Set<UsPostalCode>(['AA','AE','AP']);
const FULL_NAMES = (Object.entries(US_POSTAL_REGIONS) as Array<[UsPostalCode, string]>)
  .sort((a, b) => b[1].length - a[1].length);

export interface UsTypedAddress {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export type UsAddressProblem =
  | 'no-region' | 'invalid-region' | 'invalid-zip' | 'foreign-country'
  | 'ambiguous-address' | 'conflicting-fields' | 'military-mail';

export interface UsAddressResult {
  status: 'parsed' | 'partial' | 'needs-review' | 'empty';
  state: UsPostalCode | null;
  regionKind: UsPostalKind | null;
  zip5: string | null;
  zip4: string | null;
  postalCode: string | null;
  issue: UsAddressProblem | null;
  /** Recognition only: never use as a tax calculation or address verification gate. */
  readyForTaxCalculation: false;
}

interface Candidate {
  state: UsPostalCode | null;
  zip5: string | null;
  zip4: string | null;
  invalidZip: boolean;
}

const COUNTRY_US = /^(?:US|USA|U\.S\.A\.?|UNITED STATES(?: OF AMERICA)?)$/i;
const COUNTRY_FOREIGN = /^(?:CANADA|ISRAEL|UNITED KINGDOM|UK|GREAT BRITAIN|AUSTRALIA|MEXICO)$/i;
const POSTAL_END = /(?:^|[\s,])([0-9]{5})(?:-([0-9]{4}))?$/;
const BAD_POSTAL_END = /(?:^|[\s,])(?:[0-9]{5}-[0-9]{1,3}|[0-9]{5}-[0-9]{5,}|[0-9]{6,})$/;

function isCode(value: string): value is UsPostalCode {
  return Object.prototype.hasOwnProperty.call(US_POSTAL_REGIONS, value);
}

/** Exact two-letter USPS code or official full name only; no fuzzy guesses. */
function regionCode(value: string): UsPostalCode | null {
  const upper = value.trim().toUpperCase().replace(/\s+/g, ' ');
  if (isCode(upper)) return upper;
  return FULL_NAMES.find(([, name]) => name.toUpperCase() === upper)?.[0] ?? null;
}

function lastRegion(text: string, hasPostal: boolean): UsPostalCode | null {
  const value = text.trim().replace(/(?<!,),+$/, '').trim().toUpperCase().replace(/\s+/g, ' ');
  const abbr = value.match(/(?:^|[ ,])([A-Z]{2})$/)?.[1];
  if (abbr && isCode(abbr) && (hasPostal || value.includes(','))) return abbr;

  for (const [code, name] of FULL_NAMES) {
    const upper = name.toUpperCase();
    if (value !== upper && value.endsWith(' ' + upper)) {
      const prefix = value.slice(0, -upper.length).trim().replace(/,$/, '').trim();
      if (prefix && (hasPostal || value.includes(','))) return code;
    }
  }
  return null;
}

function candidateFromLine(line: string): Candidate | null {
  const match = line.match(POSTAL_END);
  const invalidZip = !match && BAD_POSTAL_END.test(line);
  const postalPart = match ? line.slice(0, match.index).trim() : line.trim();
  const state = lastRegion(postalPart, Boolean(match));
  if (!match && !state && !invalidZip) return null;
  return {
    state, zip5: match?.[1] ?? null, zip4: match?.[2] ?? null, invalidZip,
  };
}

function countryProblem(country: string): boolean {
  return Boolean(country.trim()) && !COUNTRY_US.test(country.trim());
}

function result(
  state: UsPostalCode | null, zip5: string | null,
  zip4: string | null, issue: UsAddressProblem | null = null,
  empty = false,
): UsAddressResult {
  const regionKind: UsPostalKind | null = state
    ? MILITARY.has(state) ? 'military' : TERRITORIES.has(state) ? 'territory' : 'state'
    : null;
  const problem = issue ?? (regionKind === 'military' ? 'military-mail' : !state ? 'no-region' : null);
  const status = empty ? 'empty'
    : problem ? 'needs-review'
    : state && zip5 ? 'parsed' : 'partial';
  return {
    status, state, regionKind, zip5, zip4,
    postalCode: zip5 ? zip5 + (zip4 ? '-' + zip4 : '') : null,
    issue: empty ? null : problem, readyForTaxCalculation: false,
  };
}

/**
 * Accepts free text or explicitly typed fields.
 * - Reads region only from the LAST address line beside a ZIP or after a comma.
 * - Explicit structured fields take precedence only if they agree with text.
 * - Leaves partial/conflicting/foreign/military records for human review.
 *
 * This function never derives state from ZIP prefixes or resolves local tax.
 */
export function parseUsStateAndZip(input: string | UsTypedAddress | null | undefined): UsAddressResult {
  if (input === null || input === undefined) return result(null, null, null, null, true);
  const structured = typeof input !== 'string';
  const obj: UsTypedAddress = structured ? input : { address: input };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return result(null, null, null, 'no-region');
  const raw = typeof obj.address === 'string' ? obj.address.trim() : '';
  const explicitState = typeof obj.state === 'string' ? obj.state.trim() : '';
  const explicitPostal = typeof obj.postalCode === 'string' ? obj.postalCode.trim() : '';
  const country = typeof obj.country === 'string' ? obj.country.trim() : '';
  if (countryProblem(country)) return result(null, null, null, 'foreign-country');

  const lines = raw.split(/[\r\n;]+/).map(s => s.trim()).filter(Boolean);
  // Country on a separate line or after the last city/ZIP must not be
  // mistaken for a state; reject a plainly foreign address.
  if (lines.length && COUNTRY_FOREIGN.test(lines[lines.length - 1])) {
    return result(null, null, null, 'foreign-country');
  }
  if (lines.length && COUNTRY_US.test(lines[lines.length - 1])) lines.pop();
  if (lines.length) {
    const last = lines.length - 1;
    const suffix = lines[last].match(/^(.*?)(?:,\s*|\s+)(US|USA|U\.S\.A\.?|UNITED STATES(?: OF AMERICA)?)$/i);
    if (suffix) lines[last] = suffix[1].trim();
  }

  const found = lines.map(candidateFromLine).filter((v): v is Candidate => v !== null);
  if (found.length > 1) return result(null, null, null, 'ambiguous-address');
  const candidate = found[0];
  if (candidate?.invalidZip) return result(candidate.state, null, null, 'invalid-zip');

  const fieldState = explicitState ? regionCode(explicitState) : null;
  if (explicitState && !fieldState) return result(candidate?.state ?? null, candidate?.zip5 ?? null, candidate?.zip4 ?? null, 'invalid-region');
  const fieldZip = explicitPostal.match(/^([0-9]{5})(?:-([0-9]{4}))?$/);
  if (explicitPostal && !fieldZip) return result(fieldState ?? candidate?.state ?? null, null, null, 'invalid-zip');

  if (fieldState && candidate?.state && fieldState !== candidate.state) {
    return result(null, null, null, 'conflicting-fields');
  }
  const typedPostal = fieldZip ? fieldZip[1] + (fieldZip[2] ? '-' + fieldZip[2] : '') : null;
  const extractedPostal = candidate?.zip5 ? candidate.zip5 + (candidate.zip4 ? '-' + candidate.zip4 : '') : null;
  if (typedPostal && extractedPostal && typedPostal !== extractedPostal) {
    return result(null, null, null, 'conflicting-fields');
  }
  const state = fieldState ?? candidate?.state ?? null;
  const zip5 = fieldZip?.[1] ?? candidate?.zip5 ?? null;
  const zip4 = fieldZip?.[2] ?? candidate?.zip4 ?? null;
  if (!raw && !explicitState && !explicitPostal) return result(null, null, null, null, true);
  return result(state, zip5, zip4);
}
