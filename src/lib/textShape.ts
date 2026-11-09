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
  let k = j;
  while (k < text.length && /\s/.test(text[k])) k++;
  if (k === j) return null;
  let p = k;
  if (k === text.length) {
    // only whitespace follows: the whitespace gives back its last character as the rest, unless that is a line break
    if (k - j < 2 || LINE_BREAK.test(text[k - 1])) return null;
    p = k - 1;
  } else if (LINE_BREAK.test(text.slice(k))) return null;
  return { code: text.slice(0, j), rest: text.slice(p) };
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
