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
