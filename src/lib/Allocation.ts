/**
 * Canonical monetary allocation module.
 * Implements largest-remainder method (Hare-Niemeyer) for distributing
 * exact cent values without losing or gaining single cents.
 */

export function allocateCents(totalCents: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(totalCents)) {
    throw new Error('allocateCents: totalCents must be a safe integer.');
  }
  if (weights.length === 0) return [];
  if (weights.length === 1) {
    if (typeof weights[0] !== 'number' || Number.isNaN(weights[0]) || weights[0] < 0) {
      throw new Error('allocateCents: invalid weight.');
    }
    return [Math.round(totalCents)];
  }

  let totalWeight = 0;
  for (const w of weights) {
    if (typeof w !== 'number' || Number.isNaN(w) || w < 0 || !Number.isFinite(w)) {
      throw new Error('allocateCents: weights must be positive finite numbers.');
    }
    totalWeight += w;
  }

  if (totalWeight <= 0) {
    throw new Error('allocateCents: totalWeight must be > 0.');
  }

  // Calculate unrounded exact allocations and integer floors
  const allocations = weights.map((w) => {
    const exact = (totalCents * w) / totalWeight;
    const floor = Math.floor(exact);
    const remainder = exact - floor;
    return { floor, remainder };
  });

  const allocatedSum = allocations.reduce((acc, a) => acc + a.floor, 0);
  const unallocatedCents = Math.round(totalCents) - allocatedSum;

  const result = allocations.map((a) => a.floor);

  // Distribute remaining cents to shares with largest fractional remainders
  if (unallocatedCents > 0) {
    const indexed = allocations.map((a, idx) => ({ idx, remainder: a.remainder }));
    indexed.sort((a, b) => b.remainder - a.remainder);

    for (let i = 0; i < unallocatedCents && i < indexed.length; i++) {
      result[indexed[i].idx] += 1;
    }
  }

  return result;
}
