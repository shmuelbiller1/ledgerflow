/**
 * One clamp for every decorative percentage bar (progress tracks, share bars, small meters).
 *
 * Why this exists (issue #909, and the same class in #924): a bar is drawn with an inline
 * `width: "${share}%"`. A browser rejects a negative or `NaN` width, drops the declaration, and
 * the block falls back to `auto` — which fills the whole track. A refund, a negative net, a
 * missing value or a division by a zero total therefore paints a **full** bar exactly where the
 * number beside it says something else. The printed number is the truth; the bar is decoration,
 * so it is clamped here and nowhere else, and `percent-bar-widths.test.ts` fails when a new
 * percent width is written without this helper.
 *
 * Contract:
 *  - a finite value inside [min, max] is returned unchanged (a 0–100 % contribution keeps its
 *    exact proportion);
 *  - a value above `max` is capped (a 119 % share fills exactly one track);
 *  - a value below `min` is floored (a −19 % share leaves its positive track empty);
 *  - a non-finite value (`NaN`, `±Infinity`, `undefined` from a dividing-by-zero total, a string
 *    that is not a number) becomes `min`, never `NaN` — `Math.max(0, Math.min(100, NaN))` is
 *    still `NaN`, which is the trap this helper removes.
 *
 * The true signed figure, its text, its sorting key and its CSV cell are not touched: only the
 * geometry.
 */
export function clampPercentWidth(value: unknown, min = 0, max = 100): number {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  const raw = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(raw)) return lower;
  return Math.max(lower, Math.min(upper, raw));
}

/** The inline style for a decorative percentage track, already clamped. */
export function percentWidthStyle(value: unknown, min = 0, max = 100): { width: string } {
  return { width: `${clampPercentWidth(value, min, max)}%` };
}
