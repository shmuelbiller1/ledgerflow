/**
 * Width of a decorative progress/share track, as a CSS-safe percentage.
 *
 * A track's width is presentation, so it must never be able to say something the number it draws does
 * not: a negative width is rejected by the browser and the block falls back to `auto`, filling the whole
 * track, and `NaN`/`Infinity` (a share divided by a zero total) does the same. Both make a refund look
 * like a full contribution, or a division by zero look like 100 % (the #909 class; #924 has the same
 * shape in the project split tranches).
 *
 * The *text* beside a track keeps its true, unclamped value — this helper only clamps the drawing.
 */
export function barWidthPercent(value: unknown): string {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return '0%';
  return `${Math.min(100, Math.max(0, amount))}%`;
}
