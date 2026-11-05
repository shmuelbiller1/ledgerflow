/**
 * Transaction enrichment (K-36): a readable payee name from a bank line's raw text —
 * "SQ *JOES COFFEE 4421 SEATTLE WA" → "Joes Coffee", "AMZN Mktp US*2K4L91TQ0" → "Amazon". Card
 * processor prefixes, card numbers, dates, store numbers and reference codes are removed; well-known
 * merchants get their usual name; Hebrew and other non-Latin text is kept as written. Display only:
 * the bank line keeps the bank's own text (matching and reconciliation use that).
 */

const KNOWN: Array<[RegExp, string]> = [
  [/\b(amzn|amazon)\b/i, 'Amazon'],
  [/\bgoogle\b/i, 'Google'],
  [/\b(apple\.com|itunes|apple)\b/i, 'Apple'],
  [/\buber\s*eats\b/i, 'Uber Eats'],
  [/\buber\b/i, 'Uber'],
  [/\blyft\b/i, 'Lyft'],
  [/\bstarbucks\b/i, 'Starbucks'],
  [/\bnetflix\b/i, 'Netflix'],
  [/\bspotify\b/i, 'Spotify'],
  [/\b(microsoft|msft)\b/i, 'Microsoft'],
  [/\badobe\b/i, 'Adobe'],
  [/\bshopify\b/i, 'Shopify'],
  [/\bzoom\.us\b|\bzoom video\b/i, 'Zoom'],
  [/\bslack\b/i, 'Slack'],
  [/\bdropbox\b/i, 'Dropbox'],
  [/\bwalmart|wal-mart\b/i, 'Walmart'],
  [/\bcostco\b/i, 'Costco'],
  [/\bairbnb\b/i, 'Airbnb'],
  [/\bfacebk|facebook|meta ads\b/i, 'Meta'],
  [/\blinkedin\b/i, 'LinkedIn'],
];

// card processors and payment rails that come before the merchant's own name
const PREFIX = /^(sq|tst|sp|pp|paypal|pos|pmt|ach|dd|card|debit|credit|purchase|recurring|visa|mc|mastercard)\s*\*\s*|^(pos|purchase|debit card purchase|card purchase|recurring payment|visa purchase|checkcard|chk card|ach)\s+/i;

const NOISE = [
  /\b(x{2,}|\*{2,})\d{2,4}\b/gi,          // XXXX1234 card numbers
  /\bcard\s*(ending|no\.?)?\s*\d{4}\b/gi,
  /\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g, // dates
  /#\s*\d+/g,                              // store numbers
  /\b[A-Z0-9]*\d[A-Z0-9]*\b/g,             // codes with digits (2K4L91TQ0, 4421, 800-123)
  /\b(us|usa|ca|gb|uk|il)\b$/i,            // trailing country
];

const US_STATE = /\s+[A-Z]{2}$/;

const SUFFIX: Record<string, string> = { llc: 'LLC', inc: 'Inc', ltd: 'Ltd', co: 'Co', gmbh: 'GmbH', plc: 'PLC' };
const SMALL = new Set(['to', 'of', 'at', 'in', 'on', 'by', 'for', 'and', 'the']);

function titleCase(word: string, i: number): string {
  if (!/^[A-Za-z][A-Za-z'&.-]*$/.test(word)) return word; // leave non-Latin and mixed tokens alone
  const lower = word.toLowerCase().replace(/\.$/, '');
  if (SUFFIX[lower]) return SUFFIX[lower];
  if (i > 0 && SMALL.has(lower)) return lower;
  if (/[a-z]/.test(word) && /[A-Z]/.test(word.slice(1))) return word; // already mixed case (eBay, McDonald)
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** A readable name for a bank line's text, or the text itself when nothing better can be said. */
export function cleanMerchantName(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  for (const [pattern, name] of KNOWN) if (pattern.test(text)) return name;
  // not Latin script at all (Hebrew, Arabic…): keep it, only tidy spaces and trailing numbers
  if (!/\p{L}/u.test(text)) return text; // no letters at all: nothing better to say
  if (!/[A-Za-z]/.test(text)) return text.replace(/\s+\d[\d\s-]*$/, '').replace(/\s+/g, ' ').trim() || text;

  let s = text;
  for (let before = ''; before !== s;) { before = s; s = s.replace(PREFIX, ''); } // "POS PURCHASE …"

  s = s.replace(/\s{2,}.*$/, m => (/\b[A-Z]{2}\s*$/.test(m) ? '' : m)); // "NAME      CITY ST" → "NAME"
  for (const n of NOISE) s = s.replace(n, ' ');
  s = s.replace(/[*_|]+/g, ' ').replace(/\s+/g, ' ').trim();
  // "JOES COFFEE SEATTLE WA": drop a trailing two-letter state (and the city before it only when the name has 3+ words)
  if (US_STATE.test(s) && s.split(' ').length >= 3) s = s.replace(US_STATE, '').split(' ').slice(0, -1).join(' ');
  s = s.replace(/(?<![\s,.-])[\s,.-]+$/, '').trim();
  if (s.length < 2) return text;
  return s.split(' ').map((w, i) => titleCase(w, i)).join(' ');
}

/** What kind of line it looks like, for a hint next to the name (or null). */
export function lineKind(raw: string): 'transfer' | 'fee' | 'payroll' | 'refund' | 'interest' | null {
  const t = String(raw || '').toLowerCase();
  if (/\b(refund|reversal|chargeback)\b/.test(t)) return 'refund';
  if (/\b(interest)\b/.test(t)) return 'interest';
  if (/\b(fee|charge|commission)\b/.test(t) && !/\bservice\b.*\bpayment\b/.test(t)) return 'fee';
  if (/\b(payroll|salary|wages)\b/.test(t)) return 'payroll';
  if (/\b(transfer|xfer|tfr|wire|zelle|venmo)\b/.test(t)) return 'transfer';
  return null;
}
