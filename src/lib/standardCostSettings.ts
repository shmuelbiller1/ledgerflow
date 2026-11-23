/**
 * M-21 standard costing: the workspace setting and the standard-cost validator, in their own module so the
 * server (posting at standard) does not pull the report code of src/lib/standardCost.ts into the bundle.
 */

/** M-21 step 2, workspace setting: whether receipts and sales post at the item's standard cost. */
export interface StandardCostingSettings {
  enabled: boolean;
  /** the account the purchase-price variance (actual − standard) posts to; required while enabled */
  varianceAccountId: string;
}

/**
 * A standard cost as stored: whole cents, more than zero; anything else (including zero, which would
 * relieve stock at nothing) means "none", and the books use the moving average for that item.
 */
export function validStandardCost(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}
