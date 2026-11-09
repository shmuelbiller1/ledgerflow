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
