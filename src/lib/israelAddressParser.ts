/**
 * E-36: conservative suggestions for free-text Israeli contact addresses.
 * This is a preview-only parser, not an address verifier or a source of tax jurisdiction. It keeps
 * the user's original address and returns only fields it can separate without guessing a gazetteer.
 */
export interface IsraeliAddressSuggestion {
  readonly source: string;
  readonly street?: string;
  readonly city?: string;
  readonly postalCode?: string;
  readonly warnings: readonly string[];
}

const POSTAL_LABEL = /(?:\b(?:postal(?:\s+code)?|zip(?:\s+code)?)\b|מיקוד)\s*[:#-]?\s*(\d{5}|\d{7})(?!\d)/giu;
const BARE_SEVEN_DIGIT_POSTAL = /(?:^|[^\d])(\d{7})(?!\d)/g;
const ENGLISH_STREET_MARKER = /\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way|highway|hwy\.?)\b/iu;
const HEBREW_STREET_MARKER = /(?:רחוב|רח׳|רח'|דרך|כביש|שדרות|שדר׳|שד׳|שד'|סמטה|כיכר)/u;
const STREET_MARKER = new RegExp(`${ENGLISH_STREET_MARKER.source}|${HEBREW_STREET_MARKER.source}`, 'iu');
const BUILDING_NUMBER = /(?<!\d)\d{1,4}(?:[A-Za-zא-ת])?(?!\d)/gu;

function stripPostalCode(source: string): { text: string; postalCode?: string; ambiguous: boolean } {
  const explicit = [...source.matchAll(POSTAL_LABEL)];
  const uniqueExplicit = [...new Set(explicit.map(match => match[1]))];
  if (uniqueExplicit.length > 1) {
    let text = source;
    for (const match of explicit) text = text.replace(match[0], ' ');
    return { text, ambiguous: true };
  }
  if (uniqueExplicit.length === 1) {
    const postalCode = uniqueExplicit[0];
    const text = source.replace(POSTAL_LABEL, (_match, code: string) => code === postalCode ? ' ' : _match);
    return { text, postalCode, ambiguous: false };
  }

  const bare = [...source.matchAll(BARE_SEVEN_DIGIT_POSTAL)];
  const candidates = [...new Set(bare.map(match => match[1]))];
  if (candidates.length > 1) {
    let text = source;
    for (const match of bare) text = text.replace(match[0], ' ');
    return { text, ambiguous: true };
  }
  if (candidates.length === 1) {
    const postalCode = candidates[0];
    return { text: source.replace(new RegExp(`(^|[^\\d])${postalCode}(?!\\d)`), ' '), postalCode, ambiguous: false };
  }
  return { text: source, ambiguous: false };
}

function splitSingleLine(segment: string): { street?: string; city?: string } {
  const marker = STREET_MARKER.exec(segment);
  if (!marker) return {};
  const numbers = [...segment.matchAll(BUILDING_NUMBER)];
  if (numbers.length !== 1) return {};
  const number = numbers[0];
  const before = segment.slice(0, number.index).trim().replace(/(?<![ ,])[ ,]+$/u, '');
  const after = segment.slice(number.index! + number[0].length).trim().replace(/^[ ,]+/u, '');

  // Hebrew street prefixes and English suffixes both place the house number after the street name.
  if (before && after && marker.index! < number.index! && STREET_MARKER.test(before)) {
    return { street: `${before} ${number[0]}`, city: after };
  }

  // In "10 Herzl St Tel Aviv", the number comes first and the English street marker ends the street.
  const markerEnd = marker.index! + marker[0].length;
  if (number.index === 0 && markerEnd < segment.length) {
    const street = segment.slice(0, markerEnd).trim().replace(/(?<![ ,])[ ,]+$/u, '');
    const city = segment.slice(markerEnd).trim().replace(/^[ ,]+/u, '');
    if (street && city && /\p{L}/u.test(city)) return { street, city };
  }
  return {};
}

/**
 * Suggests street, city and a five- or seven-digit Israeli postal code from common free-text shapes.
 * A postal code is inferred only when labelled, or when one unlabelled seven-digit token is present;
 * unlabelled five-digit values are left alone because they can be house numbers or other data.
 */
export function parseIsraeliAddress(source: string | null | undefined): IsraeliAddressSuggestion {
  const original = String(source ?? '');
  const warnings: string[] = [];
  if (!original.trim()) return { source: original, warnings: [] };

  const postal = stripPostalCode(original);
  const text = postal.text;
  if (postal.ambiguous) warnings.push('More than one possible postal code was found; none was selected.');
  else if (postal.postalCode) warnings.push('Postal code is a suggestion only; check it against the original address.');

  let segments = text
    .replace(/[\r\n]+/gu, ',')
    .split(/[,;|]+/u)
    .map(part => part.replace(/\s+/gu, ' ').trim().replace(/^[,;|]+|[,;|]+$/gu, '').trim())
    .filter(Boolean);
  // Contact exporters often append the country to a free-text address. It is not one of the fields
  // this Israeli parser returns, so remove only an exact terminal country label.
  if (segments.length && /^(?:israel|ישראל|il)$/iu.test(segments.at(-1) ?? '')) segments = segments.slice(0, -1);

  let street: string | undefined;
  let city: string | undefined;
  if (segments.length === 1) {
    const split = splitSingleLine(segments[0]);
    street = split.street;
    city = split.city;
    if (!street && !city) {
      if (STREET_MARKER.test(segments[0])) street = segments[0];
      else if (!/\d/u.test(segments[0])) city = segments[0];
    }
  } else if (segments.length > 1) {
    const markedStreets = segments.filter(segment => STREET_MARKER.test(segment));
    const numericStreets = segments.filter(segment => /\p{L}/u.test(segment) && /\d/u.test(segment));
    const candidate = markedStreets.length === 1 ? markedStreets[0] :
      markedStreets.length === 0 && numericStreets.length === 1 ? numericStreets[0] : undefined;
    if (candidate) {
      street = candidate;
      const remaining = segments.filter(segment => segment !== candidate);
      if (remaining.length === 1 && !/\d/u.test(remaining[0])) city = remaining[0];
      else if (remaining.length === 1) {
        const possibleCity = remaining[0].match(/^(.*?)\s+(\d{5})$/u);
        if (possibleCity?.[1] && /\p{L}/u.test(possibleCity[1])) {
          city = possibleCity[1].trim();
          warnings.push('An unlabelled five-digit value was left unclassified, not treated as a postal code.');
        } else warnings.push('City could not be separated unambiguously; review the original address.');
      } else if (remaining.length > 0) warnings.push('City could not be separated unambiguously; review the original address.');
    } else if (markedStreets.length > 1 || numericStreets.length > 1) {
      warnings.push('More than one street-like part was found; no street or city was selected.');
    } else {
      warnings.push('The address has multiple parts but no street marker; city and street were not guessed.');
    }
  }

  if (!street && !city && !postal.postalCode && !postal.ambiguous && warnings.length === 0) {
    warnings.push('City, street and postal code could not be separated; keep the original address for review.');
  } else if (street && !city) {
    warnings.push('Street suggested, but city could not be identified.');
  } else if (city && !street) {
    warnings.push('City suggested, but street could not be identified.');
  }

  return { source: original, ...(street ? { street } : {}), ...(city ? { city } : {}), ...(postal.postalCode ? { postalCode: postal.postalCode } : {}), warnings };
}
