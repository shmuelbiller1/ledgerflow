/**
 * Rounds float noise out of a model's answer before it is shown: "$42,454.545454545456" becomes
 * "$42,454.55" (27 Nov 2026 model test: the sum was right, the display was not). Only a number with five
 * or more decimals is touched, which is never a real amount: amounts have two decimals, and exchange
 * rates and percentages at most four, so those stay as written. Thousands separators are kept as written.
 */
const LONG_DECIMAL = /(?<![\w.]|\w-)(\d{1,3}(?:,\d{3})+|\d+)\.(\d{5,})(?!\w|\.\d)/g;

export function tidyFigures(text: string): string {
  return text.replace(LONG_DECIMAL, (_match, whole: string, decimals: string) => {
    const grouped = whole.includes(',');
    const value = Number(`${whole.replace(/,/g, '')}.${decimals}`);
    if (!Number.isFinite(value)) return _match;
    const [int, frac] = value.toFixed(2).split('.');
    return `${grouped ? Number(int).toLocaleString('en-US') : int}.${frac}`;
  });
}
