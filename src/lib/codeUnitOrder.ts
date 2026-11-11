/**
 * The order a plain `.sort()` gives strings (UTF-16 code units), written out so the order is stated rather than
 * implied. Use it where a sort needs a stable, locale-free order: ISO dates, ids, currency codes, map keys.
 */
export function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
