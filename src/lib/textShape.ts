/**
 * Sonar S8786: small text checks written without backtracking regular expressions, so their time is linear in the
 * input whatever it holds. Each gives the same answer as the pattern it replaced (see src/tests/text-shape.test.ts).
 */

/** True when `text` has the shape name@domain.tld: no whitespace, exactly one @, a name, and a dot inside the domain
 * with something on both sides. Same answer as /^[^\s@]+@[^\s@]+\.[^\s@]+$/. */
export function isEmailShape(text: string): boolean {
  if (/\s/.test(text)) return false;
  const at = text.indexOf('@');
  if (at < 1 || text.indexOf('@', at + 1) !== -1) return false;
  const domain = text.slice(at + 1);
  return domain.length >= 3 && domain.lastIndexOf('.', domain.length - 2) >= 1;
}

/** `text` without any run of `char` at its end. Same as text.replace(/char+$/, ''). */
export function trimEndChar(text: string, char: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === char) end--;
  return text.slice(0, end);
}

/** `text` without any run of `char` at either end. Same as text.replace(/^char+|char+$/g, ''). */
export function trimChar(text: string, char: string): string {
  let start = 0;
  while (start < text.length && text[start] === char) start++;
  return trimEndChar(text.slice(start), char);
}

/** `text` without any run of the characters in `chars` at its end. Same as text.replace(/[chars]+$/, ''). */
export function trimEndChars(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1])) end--;
  return text.slice(0, end);
}

/** `text` without its trailing ASCII digits when there are at least `min` of them. Same as
 * text.replace(/\d{min,}$/, ''). */
export function trimEndDigits(text: string, min: number): string {
  let end = text.length;
  while (end > 0 && text[end - 1] >= '0' && text[end - 1] <= '9') end--;
  return text.length - end >= min ? text.slice(0, end) : text;
}

/** A run of digits with a comma between each group of three from the right: '1234567' → '1,234,567'. Same as
 * digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') for a string of digits. */
export function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/** True for a plain decimal: an optional '-', then digits with an optional point and more digits, or a point and
 * digits ('12', '12.', '12.5', '.5', '-3'). Same as /^-?(\d+\.?\d*|\.\d+)$/. */
export function isPlainDecimal(text: string): boolean {
  const body = text.startsWith('-') ? text.slice(1) : text;
  const point = body.indexOf('.');
  const whole = point === -1 ? body : body.slice(0, point);
  const fraction = point === -1 ? '' : body.slice(point + 1);
  const digits = (s: string) => [...s].every(c => c >= '0' && c <= '9');
  if (!digits(whole) || !digits(fraction)) return false;
  return whole.length > 0 || fraction.length > 0;
}

/** Each line of `text` without the spaces and tabs at its end. Same as text.replace(/[ \t]+\n/g, '\n') on every line
 * but the last, which keeps its trailing spaces as before. */
export function trimSpacesBeforeNewlines(text: string): string {
  const lines = text.split('\n');
  return lines.map((line, i) => (i < lines.length - 1 ? trimEndChars(line, ' \t') : line)).join('\n');
}

const LINE_BREAK = /[\n\r\u2028\u2029]/;

/** `text` split at its trailing run of ASCII digits: { head, digits }, or null when it does not end in a digit or the
 * head holds a line break. Same as text.match(/^(.*?)(\d+)$/) → [, head, digits]. */
export function splitTrailingDigits(text: string): { head: string; digits: string } | null {
  let start = text.length;
  while (start > 0 && text[start - 1] >= '0' && text[start - 1] <= '9') start--;
  if (start === text.length) return null;
  const head = text.slice(0, start);
  return LINE_BREAK.test(head) ? null : { head, digits: text.slice(start) };
}

/** "City 12345": the text before whitespace and exactly five final digits, or null. Same as
 * text.match(/^(.*?)\s+(\d{5})$/u)?.[1]. */
export function headBeforeFiveDigits(text: string): string | null {
  let start = text.length;
  while (start > 0 && text[start - 1] >= '0' && text[start - 1] <= '9') start--;
  if (text.length - start !== 5) return null;
  const head = text.slice(0, start);
  if (!/\s$/u.test(head)) return null;
  let end = head.length;
  while (end > 0 && /\s/u.test(head[end - 1])) end--;
  const before = head.slice(0, end);
  return LINE_BREAK.test(before) ? null : before;
}

/** Lines of `text` without the whitespace next to each line break, empty lines dropped. Same as
 * text.split(/\s*\n\s*\/).filter(Boolean). */
export function splitTrimmedLines(text: string): string[] {
  const parts = text.split('\n');
  return parts
    .map((part, i) => {
      let s = part;
      if (i > 0) s = s.trimStart();
      if (i < parts.length - 1) s = s.trimEnd();
      return s;
    })
    .filter(Boolean);
}


/** The first "123,45" or "123.45" in `text`: a digit run, then ',' or '.', then two digits. Same as
 * text.match(/([0-9]+[,.][0-9]{2})/)?.[1]. */
export function firstTwoPlaceAmount(text: string): string | undefined {
  const digit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
  for (let i = 0; i < text.length; i++) {
    if (!digit(text[i]) || digit(text[i - 1])) continue;
    let j = i;
    while (digit(text[j])) j++;
    if ((text[j] === ',' || text[j] === '.') && digit(text[j + 1]) && digit(text[j + 2])) return text.slice(i, j + 3);
  }
  return undefined;
}

/** "1200 Accounts Receivable": a leading code that starts with a digit, then whitespace, then the rest. Same as
 * text.match(/^(\d[\w.-]*)\s+(.+)$/) → [, code, rest]. */
export function splitLeadingCode(text: string): { code: string; rest: string } | null {
  const word = (c: string) => /[\w.-]/.test(c);
  if (!(text[0] >= '0' && text[0] <= '9')) return null;
  let j = 1;
  while (j < text.length && word(text[j])) j++;
  const rest = restAfterWhitespace(text, j);
  return rest === null ? null : { code: text.slice(0, j), rest };
}

/** A typed amount: optional surrounding whitespace, an optional '-', digits, and an optional '.' with digits.
 * Same as /^\s*(-?)(\d*)(?:\.(\d*))?\s*$/.exec(text) → [, sign, whole, fraction]. */
export function splitTypedAmount(text: string): { sign: string; whole: string; fraction: string | undefined } | null {
  const t = text.trim();
  const sign = t.startsWith('-') ? '-' : '';
  const body = t.slice(sign.length);
  const point = body.indexOf('.');
  const whole = point === -1 ? body : body.slice(0, point);
  const fraction = point === -1 ? undefined : body.slice(point + 1);
  const digits = (s: string) => [...s].every(c => c >= '0' && c <= '9');
  return digits(whole) && (fraction === undefined || digits(fraction)) ? { sign, whole, fraction } : null;
}


/** What /\s+(.+)$/ captures when matched at index `from` of `text` (whitespace, then the rest on that line), or null.
 * When only whitespace follows, the whitespace gives back its last character as the rest, unless that is a line
 * break. */
export function restAfterWhitespace(text: string, from: number): string | null {
  let k = from;
  while (k < text.length && /\s/.test(text[k])) k++;
  if (k === from) return null;
  if (k === text.length) {
    if (k - from < 2 || LINE_BREAK.test(text[k - 1])) return null;
    return text.slice(k - 1);
  }
  const rest = text.slice(k);
  return LINE_BREAK.test(rest) ? null : rest;
}

/** "show maui repairs" → "maui repairs": the rest after one of `words` (any case) and whitespace. Same as
 * text.match(/^(?:word1|word2…)\s+(.+)$/i)?.[1], for words none of which begins another. */
export function restAfterCommandWord(text: string, words: readonly string[]): string | null {
  const lower = text.toLowerCase();
  const word = words.find(w => lower.startsWith(w));
  return word === undefined ? null : restAfterWhitespace(text, word.length);
}

/** The first number, with up to two decimals: "spent $12.345" → "12.34". Same as
 * text.match(/\$?\s*(\d+(?:\.\d{1,2})?)/)?.[1]. */
export function firstAmountText(text: string): string | undefined {
  const digit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
  let i = 0;
  while (i < text.length && !digit(text[i])) i++;
  if (i === text.length) return undefined;
  let j = i;
  while (digit(text[j])) j++;
  if (text[j] === '.' && digit(text[j + 1])) j += digit(text[j + 2]) ? 3 : 2;
  return text.slice(i, j);
}

/** The count before a word: "2 kids" → "2". Same as text.match(/(\d+)\s*(word1|word2…)/)?.[1] (case-sensitive). */
export function countBeforeWord(text: string, words: readonly string[]): string | undefined {
  const digit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
  for (let i = 0; i < text.length; i++) {
    if (!digit(text[i]) || digit(text[i - 1])) continue;
    let j = i;
    while (digit(text[j])) j++;
    let k = j;
    while (k < text.length && /\s/.test(text[k])) k++;
    if (words.some(w => text.startsWith(w, k))) return text.slice(i, j);
  }
  return undefined;
}

const US_COUNTRY = ['UNITED STATES OF AMERICA', 'UNITED STATES', 'U.S.A.', 'U.S.A', 'USA', 'US'];

/** A last address line without a trailing United States: "Austin, TX 78701, USA" → "Austin, TX 78701". Same as
 * line.match(/^(.*?)(?:,\s*|\s+)(US|USA|U\.S\.A\.?|UNITED STATES(?: OF AMERICA)?)$/i)?.[1], or null. */
export function headBeforeUsCountry(line: string): string | null {
  const asciiUpper = (t: string) => t.replace(/[a-z]/g, c => c.toUpperCase());
  for (const country of US_COUNTRY) {
    if (line.length < country.length || asciiUpper(line.slice(line.length - country.length)) !== country) continue;
    let end = line.length - country.length;
    const wsEnd = end;
    while (end > 0 && /\s/.test(line[end - 1])) end--;
    if (end > 0 && line[end - 1] === ',') end--;
    else if (end === wsEnd) continue;
    const head = line.slice(0, end);
    if (!LINE_BREAK.test(head)) return head;
  }
  return null;
}

const EMAIL_LOCAL = (c: string | undefined) => c !== undefined && /[a-zA-Z0-9_.+-]/.test(c);
const EMAIL_LABEL = (c: string | undefined) => c !== undefined && /[a-zA-Z0-9-]/.test(c);

/** `text` with every email address replaced by `mask`, scanning once. Same as
 * text.replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, mask). */
export function maskEmails(text: string, mask: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (!EMAIL_LOCAL(text[i])) { out += text[i]; i++; continue; }
    let at = i;
    while (EMAIL_LOCAL(text[at])) at++;
    let ok = false;
    let end = at;
    if (text[at] === '@') {
      let d = at + 1;
      while (EMAIL_LABEL(text[d])) d++;
      if (d > at + 1 && text[d] === '.') {
        let e = d + 1;
        while (EMAIL_LABEL(text[e]) || text[e] === '.') e++;
        if (e > d + 1) { ok = true; end = e; }
      }
    }
    if (ok) { out += mask; i = end; } else { out += text.slice(i, at); i = at; }
  }
  return out;
}

const DIM_KEY = /[\p{L}\p{M}\p{N}_-]+/uy;
const DIM_GAP = /\s*/uy;

/** Every "[key:value]" (or "[key=value]") in reading order, in one pass over the text.
 * Gives the same matches as /\[([\p{L}\p{M}\p{N}_-]+)\s*[:=]\s*([^\]]+)\]/gu once the value is trimmed. */
export function bracketDimensions(text: string): Array<{ index: number; key: string; value: string }> {
  const found: Array<{ index: number; key: string; value: string }> = [];
  let close = -1; // the first ']' at or after the current scan point
  for (let open = text.indexOf('['); open !== -1; open = text.indexOf('[', open + 1)) {
    DIM_KEY.lastIndex = open + 1;
    if (!DIM_KEY.test(text)) continue;
    const keyEnd = DIM_KEY.lastIndex;
    DIM_GAP.lastIndex = keyEnd;
    DIM_GAP.test(text);
    const sep = DIM_GAP.lastIndex;
    if (text[sep] !== ':' && text[sep] !== '=') continue;
    if (close <= sep) close = text.indexOf(']', sep + 1);
    if (close === -1) break; // no ']' left, so no later bracket can close either
    if (close === sep + 1) continue; // the value needs at least one character
    found.push({ index: open, key: text.slice(open + 1, keyEnd), value: text.slice(sep + 1, close) });
    open = close; // the next match starts after this one
  }
  return found;
}

const isWs = (c: string | undefined) => c !== undefined && /\s/.test(c);
const isAsciiDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

/** Where a trailing " 123 45-6" begins: whitespace, a digit, then only digits, whitespace and '-' to the end; or -1.
 * text.slice(0, i) is the same as text.replace(/\s+\d[\d\s-]*$/, ''). */
export function trailingNumberStart(text: string): number {
  let tail = text.length;
  while (tail > 0 && (isAsciiDigit(text[tail - 1]) || isWs(text[tail - 1]) || text[tail - 1] === '-')) tail--;
  for (let p = tail; p < text.length; p++) {
    if (!isWs(text[p])) continue;
    let q = p;
    while (isWs(text[q])) q++;
    if (isAsciiDigit(text[q])) return p;
    p = q;
  }
  return -1;
}

/** Where a trailing " WA" begins: whitespace, then exactly two capital letters A–Z at the end; or -1.
 * Same as /\s+[A-Z]{2}$/ (index of the match, which text.replace removes). */
export function trailingStateStart(text: string): number {
  const n = text.length;
  const cap = (c: string | undefined) => c !== undefined && c >= 'A' && c <= 'Z';
  if (n < 3 || !cap(text[n - 1]) || !cap(text[n - 2]) || !isWs(text[n - 3])) return -1;
  let p = n - 3;
  while (p > 0 && isWs(text[p - 1])) p--;
  return p;
}

const PHONE_BODY = (c: string) => isAsciiDigit(c) || isWs(c) || c === '(' || c === ')' || c === '.' || c === '-';
const EXTENSION_WORDS = ['extension.', 'extension', 'ext.', 'ext', 'x', '#'];

/** A phone number as typed: an optional '+', then digits, spaces, ( ) . -, and an optional extension
 * ("ext. 12", "x12", "#12"). Same as /^\+?[0-9\s().-]+(?:\s*(?:ext(?:ension)?\.?|x|#)\s*\d+)?$/i. */
export function isPhoneText(text: string): boolean {
  const s = text.startsWith('+') ? text.slice(1) : text;
  let f = 0;
  while (f < s.length && PHONE_BODY(s[f])) f++;
  if (f === 0) return false;
  if (f === s.length) return true;
  const lower = s.slice(f).replace(/[A-Z]/g, c => c.toLowerCase());
  return EXTENSION_WORDS.some(word => {
    if (!lower.startsWith(word)) return false;
    let k = word.length;
    while (isWs(lower[k])) k++;
    if (!isAsciiDigit(lower[k])) return false;
    while (isAsciiDigit(lower[k])) k++;
    return k === lower.length;
  });
}

/** The first <Amt …>value</Amt> in `xml` (any case): its attribute text and value, or null. Same as
 * /<Amt\b([^<>]*)>\s*([^<]+)<\/Amt\s*>/i.exec(xml) → [, attributes, value]. */
export function firstAmtElement(xml: string): { attributes: string; value: string } | null {
  // ASCII-only lowering keeps every offset equal to the source's ('İ'.toLowerCase() is two characters)
  const lower = xml.replace(/[A-Z]/g, c => c.toLowerCase());
  const wordChar = (c: string | undefined) => c !== undefined && /\w/.test(c);
  for (let i = lower.indexOf('<amt'); i !== -1; i = lower.indexOf('<amt', i + 1)) {
    let j = i + 4;
    if (wordChar(xml[j])) continue;
    while (j < xml.length && xml[j] !== '<' && xml[j] !== '>') j++;
    if (xml[j] !== '>') continue;
    const attributes = xml.slice(i + 4, j);
    let k = j + 1;
    while (isWs(xml[k])) k++;
    let end = k;
    while (end < xml.length && xml[end] !== '<') end++;
    let start = k;
    if (end === k) {
      if (k === j + 1) continue; // nothing between > and <
      start = k - 1; // whitespace gives back one character to the value
    }
    if (!lower.startsWith('</amt', end)) continue;
    let m = end + 5;
    while (isWs(xml[m])) m++;
    if (xml[m] !== '>') continue;
    return { attributes, value: xml.slice(start, end) };
  }
  return null;
}
