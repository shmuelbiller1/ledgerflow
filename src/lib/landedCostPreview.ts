/**
 * A-63: landed cost preview on a receipt. Freight, duty and handling entered against a receipt are
 * spread over its goods by value or by quantity, and the per-unit cost after spreading is shown.
 * Preview only: nothing is posted here (the posting of landed cost is AI #1's, BF-04).
 *
 * The spread uses exact integer arithmetic (BigInt): each line's share is rounded down, and the
 * cents left over go to the lines with the largest remainders (ties to the earlier line), so the
 * allocations add up to the extra cost exactly.
 */
export type SpreadBasis = 'value' | 'quantity' | 'weight';

export interface LandedCostLine {
  id: string;
  description: string;
  quantity: number;
  /** the goods' unit cost on the receipt, whole cents */
  unitCostCents: number;
  /** EG-6: the line's weight (any unit, the same for every line), for a spread by weight */
  weight?: number;
}

export interface LandedCostPreviewLine extends LandedCostLine {
  goodsCents: number;
  allocatedCents: number;
  landedCents: number;
  /** landed cost per unit, rounded to whole cents */
  landedUnitCents: number;
}

export interface LandedCostPreview {
  basis: SpreadBasis;
  extraCostCents: number;
  goodsCents: number;
  landedCents: number;
  lines: LandedCostPreviewLine[];
}

/** Why the preview cannot be worked out, in plain words, or null when it can. */
export function landedCostProblem(lines: LandedCostLine[], extraCostCents: number, basis: SpreadBasis): string | null {
  if (!Number.isSafeInteger(extraCostCents) || extraCostCents < 0) return 'The freight and other costs are an amount of 0 or more, in whole cents.';
  if (basis !== 'value' && basis !== 'quantity' && basis !== 'weight') return 'Spread the costs by value, by quantity or by weight.';
  if (!lines.length) return 'The receipt has no lines to spread the costs over.';
  for (const line of lines) {
    if (!(line.quantity > 0) || !Number.isFinite(line.quantity)) return `“${line.description}” needs a quantity above zero.`;
    if (!Number.isSafeInteger(line.unitCostCents) || line.unitCostCents < 0) return `“${line.description}” needs a unit cost of 0 or more, in whole cents.`;
    if (basis === 'weight' && !(Number(line.weight) >= 0 && Number.isFinite(Number(line.weight)))) return `“${line.description}” needs a weight of 0 or more to spread by weight.`;
  }
  if (extraCostCents > 0) {
    const weight = lines.reduce((s, l) => s + weightOf(l, basis), 0);
    if (!(weight > 0)) return basis === 'value' ? 'The goods have no value to spread by; spread by quantity instead.' : basis === 'weight' ? 'The goods have no weight to spread by.' : 'The goods have no quantity to spread by.';
  }
  return null;
}

/**
 * The weights of each line, as integers for the exact spread: its goods value in cents, or its quantity or weight in
 * millionths (EG-6: a fractional quantity such as 2.5 units, or a weight of 1.25 kg, spreads in the same ratio).
 */
function weightOf(line: LandedCostLine, basis: SpreadBasis): number {
  if (basis === 'value') return Math.round(line.quantity * line.unitCostCents);
  return Math.round((basis === 'weight' ? Number(line.weight) || 0 : line.quantity) * 1e6);
}

/** Exact largest-remainder spread of `total` cents over `weights` (integers, not all zero when total > 0). */
export function spreadCents(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  const T = BigInt(total);
  const S = BigInt(sum);
  const shares = weights.map(w => {
    const numerator = T * BigInt(w);
    return { floor: numerator / S, rest: numerator % S };
  });
  let leftover = Number(T - shares.reduce((s, x) => s + x.floor, 0n));
  const order = shares.map((x, i) => i).sort((a, b) => (shares[b].rest > shares[a].rest ? 1 : shares[b].rest < shares[a].rest ? -1 : a - b));
  const extra = shares.map(() => 0);
  for (const i of order) {
    if (leftover <= 0) break;
    extra[i] = 1;
    leftover -= 1;
  }
  return shares.map((x, i) => Number(x.floor) + extra[i]);
}

/** The preview for a receipt, or the reason it cannot be shown. */
export function landedCostPreview(lines: LandedCostLine[], extraCostCents: number, basis: SpreadBasis): { ok: true; preview: LandedCostPreview } | { ok: false; problem: string } {
  const problem = landedCostProblem(lines, extraCostCents, basis);
  if (problem) return { ok: false, problem };
  const allocated = spreadCents(extraCostCents, lines.map(l => weightOf(l, basis)));
  const out: LandedCostPreviewLine[] = lines.map((line, i) => {
    const goodsCents = Math.round(line.quantity * line.unitCostCents);
    const landedCents = goodsCents + allocated[i];
    return { ...line, goodsCents, allocatedCents: allocated[i], landedCents, landedUnitCents: Math.round(landedCents / line.quantity) };
  });
  return {
    ok: true,
    preview: {
      basis,
      extraCostCents,
      goodsCents: out.reduce((s, l) => s + l.goodsCents, 0),
      landedCents: out.reduce((s, l) => s + l.landedCents, 0),
      lines: out,
    },
  };
}
