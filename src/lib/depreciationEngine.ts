import { FixedAsset } from '../model/operations';

/**
 * Fixed-asset depreciation (R-06), in integer cents and whole months, no time zones.
 * Convention: depreciation starts in the month after the purchase month and runs for the useful
 * life; the last month takes the rounding difference, so the total is exactly cost − salvage.
 * - straight-line: the same amount every month;
 * - declining-balance (double declining): 2 / (life in months) of the remaining book value each
 *   month, never below salvage, the rest in the last month.
 * The month-end run (src/server/services/depreciationService.ts) posts, per asset, the
 * difference between depreciationThrough(asset, month) and what was posted before, so running a
 * month twice posts nothing and a missed month is caught up.
 *
 * FA-01: a cost capitalized after purchase (asset.costaddition) depreciates PROSPECTIVELY over the
 * life remaining on the month it was capitalized (IAS 16 ¶55 / IAS 8 ¶36–37): each addition gets its
 * own component schedule from its own month to the end of the original useful life, never a
 * retroactive catch-up to the purchase date. An addition capitalized at or after the end of the
 * original life is expensed in the month it was capitalized.
 */

export interface DepreciationPeriodEntry {
  periodDate: string;
  depreciationAmountCents: number;
  accumulatedDepreciationCents: number;
  bookValueCents: number;
}

const monthIndex = (ymd: string) => {
  const [y, m] = ymd.slice(0, 7).split('-').map(Number);
  return y * 12 + (m - 1);
};

const lifeMonths = (asset: Pick<FixedAsset, 'usefulLifeYears'>) => Math.max(1, Math.round((asset.usefulLifeYears || 1) * 12));

/** The asset's original purchase cost: the current basis minus what was capitalized as additions (FA-01). */
function originalCost(asset: FixedAsset): number {
  const additions = costAdditionsOf(asset).reduce((sum, a) => sum + a.amountCents, 0);
  return Math.max(0, (asset.purchasePriceCents || 0) - additions);
}

/** Depreciation for each month of the useful life (month 1 = the month after the purchase). */
function monthlyAmounts(asset: FixedAsset): number[] {
  const cost = originalCost(asset);
  const salvage = Math.min(asset.salvageValueCents || 0, cost);
  const depreciable = Math.max(0, cost - salvage);
  const months = lifeMonths(asset);
  const amounts: number[] = [];
  let accumulated = 0;
  for (let n = 1; n <= months; n++) {
    let amount: number;
    if (n === months) {
      amount = depreciable - accumulated;
    } else if (asset.depreciationMethod === 'declining-balance') {
      const book = cost - accumulated;
      amount = Math.min(Math.round((book * 2) / months), depreciable - accumulated);
    } else {
      amount = Math.min(Math.round(depreciable / months), depreciable - accumulated);
    }
    amount = Math.max(0, amount);
    accumulated += amount;
    amounts.push(amount);
  }
  return amounts;
}

/** A capitalized addition's own schedule: the month it was capitalized to the end of the original life. */
function additionMonthlyAmounts(asset: FixedAsset, addition: { date: string; amountCents: number }): Array<{ monthIndex: number; amountCents: number }> {
  const amount = Math.max(0, addition.amountCents || 0);
  if (!amount || !asset.purchaseDate) return [];
  const lifeEnd = monthIndex(asset.purchaseDate) + lifeMonths(asset); // the original schedule's last month
  const start = monthIndex(addition.date);
  const remaining = lifeEnd - start + 1; // months from the addition's month to the life end, inclusive
  if (remaining <= 0) {
    // the original life has run out: the addition is expensed in the month it was capitalized
    return [{ monthIndex: start, amountCents: amount }];
  }
  const amounts: number[] = [];
  let accumulated = 0;
  for (let n = 1; n <= remaining; n++) {
    let part: number;
    if (n === remaining) {
      part = amount - accumulated;
    } else if (asset.depreciationMethod === 'declining-balance') {
      const book = amount - accumulated;
      part = Math.min(Math.round((book * 2) / remaining), amount - accumulated);
    } else {
      part = Math.min(Math.round(amount / remaining), amount - accumulated);
    }
    part = Math.max(0, part);
    accumulated += part;
    amounts.push(part);
  }
  return amounts.map((part, i) => ({ monthIndex: start + i, amountCents: part }));
}

/** The asset's capitalized additions, oldest first. */
function costAdditionsOf(asset: FixedAsset): Array<{ date: string; amountCents: number }> {
  return (Array.isArray(asset.costAdditions) ? asset.costAdditions : [])
    .filter((a): a is { date: string; amountCents: number } => !!a && typeof a.date === 'string' && typeof a.amountCents === 'number' && a.amountCents > 0);
}

/** The original schedule's month amounts keyed by their month index (month 1 = month after purchase). */
function originalSchedule(asset: FixedAsset): Array<{ monthIndex: number; amountCents: number }> {
  if (!asset.purchaseDate) return [];
  const start = monthIndex(asset.purchaseDate);
  return monthlyAmounts(asset).map((amount, i) => ({ monthIndex: start + i + 1, amountCents: amount }));
}

/** Every scheduled depreciation month of the asset: the purchase schedule plus each addition's own. */
function allSchedule(asset: FixedAsset): Array<{ monthIndex: number; amountCents: number }> {
  if (asset.status === 'in_progress') return [];
  return [
    ...originalSchedule(asset),
    ...costAdditionsOf(asset).flatMap(addition => additionMonthlyAmounts(asset, addition)),
  ].sort((a, b) => a.monthIndex - b.monthIndex);
}

/** Depreciation that should have been posted through the end of a YYYY-MM month. */
export function depreciationThrough(asset: FixedAsset, month: string): number {
  // X-09: still being built: nothing depreciates until it is placed in service
  if (!asset.purchaseDate || asset.status === 'in_progress') return 0;
  const target = monthIndex(`${month}-01`);
  return allSchedule(asset)
    .filter(slot => slot.monthIndex <= target)
    .reduce((sum, slot) => sum + slot.amountCents, 0);
}

/** The full schedule, one entry per month (dated the 1st of the month after each elapsed month). */
export function calculateStraightLineDepreciation(asset: FixedAsset): DepreciationPeriodEntry[] {
  if (asset.status === 'in_progress') return [];
  const cost = asset.purchasePriceCents || 0;
  const salvage = asset.salvageValueCents || 0;
  let accumulated = 0;
  return allSchedule({ ...asset, depreciationMethod: 'straight-line' }).map(slot => {
    accumulated += slot.amountCents;
    return {
      periodDate: `${Math.floor(slot.monthIndex / 12)}-${String((slot.monthIndex % 12) + 1).padStart(2, '0')}-01`,
      depreciationAmountCents: slot.amountCents,
      accumulatedDepreciationCents: accumulated,
      bookValueCents: Math.max(salvage, cost - accumulated),
    };
  });
}

export interface ScheduleMonth { month: string; amountCents: number; accumulatedCents: number; bookValueCents: number; posted: boolean }
export interface ScheduleYear { year: string; amountCents: number; accumulatedCents: number; bookValueCents: number; months: number; posted: boolean }

/**
 * X-02: the whole schedule by the asset's own method, one row per month from the month after the
 * purchase to the end of its life; `posted` for the months the month-end run already covered.
 * FA-01: cost additions appear as their own months on the same schedule.
 */
export function depreciationSchedule(asset: FixedAsset): ScheduleMonth[] {
  if (!asset.purchaseDate || asset.status === 'in_progress') return [];
  const cost = asset.purchasePriceCents || 0;
  const postedThrough = asset.depreciatedThrough ? monthIndex(`${asset.depreciatedThrough}-01`) : -1;
  let accumulated = 0;
  return allSchedule(asset).map(slot => {
    accumulated += slot.amountCents;
    return {
      month: `${Math.floor(slot.monthIndex / 12)}-${String((slot.monthIndex % 12) + 1).padStart(2, '0')}`,
      amountCents: slot.amountCents, accumulatedCents: accumulated, bookValueCents: cost - accumulated,
      posted: slot.monthIndex <= postedThrough,
    };
  });
}

/** The schedule added up by calendar year (amounts for the year; accumulated and book value at its last month). */
export function scheduleByYear(months: ScheduleMonth[]): ScheduleYear[] {
  const years = new Map<string, ScheduleYear>();
  for (const m of months) {
    const year = m.month.slice(0, 4);
    const row = years.get(year) || { year, amountCents: 0, accumulatedCents: 0, bookValueCents: 0, months: 0, posted: true };
    row.amountCents += m.amountCents;
    row.accumulatedCents = m.accumulatedCents;
    row.bookValueCents = m.bookValueCents;
    row.months++;
    row.posted = row.posted && m.posted;
    years.set(year, row);
  }
  return [...years.values()];
}
