/**
 * M-21 standard costing, step 1: a standard cost per item and how far the actual cost is from it.
 *
 * An item may carry `standardCostCents` — what one unit is expected to cost. The books keep valuing stock at
 * the moving weighted average (`unitCostCents`, the cost the posting engine uses); nothing here posts or
 * changes a figure. The variance shows where the actual cost drifted from the plan: per unit, as a
 * percentage of the standard, and for the stock on hand (actual − standard, × quantity). A positive
 * variance means the stock cost more than planned (unfavourable).
 *
 * Posting at standard (stock carried at standard, differences to a purchase-price variance account) changes
 * how money is booked and is the owner's decision (docs/FOR_YOU.md); it is not done here.
 */
import type { InventoryItem } from '../model/operations';

export interface StandardCostRow {
  itemId: string;
  itemName: string;
  quantity: number;
  standardCostCents: number;
  actualUnitCostCents: number;
  /** actual − standard, per unit */
  varianceUnitCents: number;
  /** variance as a share of the standard (0.1 = 10 % over); null when the standard is 0 */
  variancePct: number | null;
  /** variance on the stock on hand (never negative stock: 0 units count) */
  varianceValueCents: number;
}

export interface StandardCostReport {
  rows: StandardCostRow[];
  /** stock items that have no standard cost yet */
  withoutStandard: number;
  totalVarianceCents: number;
}

type ItemLike = Pick<InventoryItem, 'id' | 'name' | 'quantityAtHand' | 'unitCostCents'> & Partial<Pick<InventoryItem, 'itemType' | 'bundleParts' | 'standardCostCents'>>;

/** A standard cost as stored: whole cents, zero or more; anything else means "none". */
export function validStandardCost(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Stock items only (services and bundles keep no stock of their own); largest variance first. */
export function standardCostReport(items: ItemLike[]): StandardCostReport {
  const rows: StandardCostRow[] = [];
  let withoutStandard = 0;
  for (const item of items) {
    if (item.itemType === 'service' || (item.bundleParts && item.bundleParts.length)) continue;
    const standard = validStandardCost(item.standardCostCents);
    if (standard === null) { withoutStandard += 1; continue; }
    const actual = Math.round(Number(item.unitCostCents) || 0);
    const quantity = Math.max(0, Number(item.quantityAtHand) || 0);
    const varianceUnitCents = actual - standard;
    rows.push({
      itemId: item.id,
      itemName: item.name,
      quantity,
      standardCostCents: standard,
      actualUnitCostCents: actual,
      varianceUnitCents,
      variancePct: standard > 0 ? varianceUnitCents / standard : null,
      varianceValueCents: Math.round(varianceUnitCents * quantity),
    });
  }
  rows.sort((a, b) => Math.abs(b.varianceValueCents) - Math.abs(a.varianceValueCents) || a.itemName.localeCompare(b.itemName));
  return { rows, withoutStandard, totalVarianceCents: rows.reduce((s, r) => s + r.varianceValueCents, 0) };
}

/** "+12.5 %" / "−3.0 %" / "—" for a variance share. */
export function formatVariancePct(pct: number | null): string {
  if (pct === null) return '—';
  const v = Math.round(pct * 1000) / 10;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} %`;
}
