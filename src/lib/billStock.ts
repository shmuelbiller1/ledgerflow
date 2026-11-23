/**
 * Buying stock on a bill (J-08): a bill line can name an inventory item and how many units came in.
 * Such a line posts to the workspace's Inventory account, and the bill's entry carries the item lines
 * (`metadata.stockIn`: the item, the units, and the value the line posted, in the workspace's
 * currency). The server raises the stock and the item's average cost with the entry, in the same
 * transaction, and undoing the entry takes them out again (src/server/services/cogsStockService.ts).
 *
 * Landed cost (BA-03): a line marked "spread over the items" (freight, duty, insurance) also posts to
 * Inventory, and its amount is added to the item lines' values in proportion to them (whole cents,
 * the remainder by largest share), so what the items cost includes getting them in.
 */
import { allocateCents } from './Allocation';
export const BILL_ACCRUAL_TYPE = 'bill-accrual';

export interface BillStockLine {
  itemId: string;
  quantity: number;
  /** what the line posts to Inventory, whole cents */
  valueCents: number;
  /** M-21 step 2: the line's actual cost, kept for the moving-average basis */
  actualValueCents?: number;
  /** its place among the bill's lines */
  line: number;
}

/** Why a bill line with an item can't be saved, or null. */
export function billItemProblem(line: { itemId?: string; quantity?: number; amountCents?: number }): string | null {
  if (!line.itemId) return null;
  const q = Number(line.quantity);
  if (!Number.isFinite(q) || q <= 0) return 'Enter how many units came in';
  if (Math.round(q * 1e6) / 1e6 !== q) return 'Six decimals at most for the units';
  if (!(Number(line.amountCents) > 0)) return 'Enter what the units cost';
  return null;
}

/** The item lines of a bill, with the share of the posted amount each line got (same order as its lines). */
export function billStockLines(splits: Array<{ itemId?: string; quantity?: number; landedCost?: boolean }> | undefined, shares: number[]): BillStockLine[] {
  const lines = (splits || []).flatMap((s, line) => (s.itemId && Number(s.quantity) > 0
    ? [{ itemId: s.itemId, quantity: Number(s.quantity), valueCents: shares[line] || 0, line }]
    : []));
  // BA-03: the lines spread over the items, in proportion to their values (else their units)
  const landed = (splits || []).reduce((sum, s, line) => sum + (!s.itemId && s.landedCost ? shares[line] || 0 : 0), 0);
  if (landed !== 0 && lines.length > 0) {
    const byValue = lines.some(l => l.valueCents > 0);
    allocateCents(landed, lines.map(l => (byValue ? Math.max(0, l.valueCents) : l.quantity))).forEach((extra, i) => { lines[i].valueCents += extra; });
  }
  return lines;
}

/**
 * M-21 step 2: what a bill's receipt posts at standard. Each item line that carries a valid standard cost
 * comes in at quantity × standard; a line without one keeps its actual value (landed cost included). The
 * difference between what the lines posted to Inventory (the actual total) and the standard total is the
 * purchase-price variance, which the posting sends to the workspace's variance account.
 */
import { validStandardCost } from './standardCostSettings';
import type { InventoryItem } from '../model/operations';

export interface StandardReceiptPlan {
  /** the stock-in lines with their standard values (actual where no standard applies) */
  entries: BillStockLine[];
  /** what the lines posted to Inventory as posted today (actual, landed cost included) */
  actualTotalCents: number;
  /** what they post to Inventory under standard costing */
  standardTotalCents: number;
  /** actual − standard: a debit when the stock cost more than planned (unfavourable) */
  varianceCents: number;
}

/** The standard-cost plan for a receipt, or null when the workspace does not post at standard. */
export function planStandardReceipt(
  stockIn: BillStockLine[],
  items: Array<Pick<InventoryItem, 'id' | 'standardCostCents'>>,
  standardizing: boolean,
  /**
   * M-21 step 2: the carrying value each item's original receipt posted at (itemId → the quantity and
   * value of the units already in the books). A bill being reposted keeps the basis its original receipt
   * used for unchanged lines — an item's standard can legally change once its stock sold down to zero,
   * and repricing the replacement at the new standard would leave Inventory out of step. Lines whose
   * quantity changed take the item's current standard.
   */
  originalReceipt?: Map<string | number, { itemId: string; quantity: number; valueCents: number }>
): StandardReceiptPlan | null {
  if (!standardizing) return null;
  const byId = new Map(items.map(i => [i.id, i]));
  const entries = stockIn.map(line => {
    // the original receipt's row for this bill line (keyed by the line's index, so repeated items on
    // separate lines keep their own basis); the item must match too, or a line re-pointed at a different
    // item would inherit the previous item's carrying value
    const original = originalReceipt?.get(line.line !== undefined ? line.line : `item:${line.itemId}`);
    const originalQty = original !== undefined && original.itemId === line.itemId && Number.isFinite(original.quantity) && original.quantity > 0 ? original.quantity : 0;
    const atOriginal = originalQty > 0 ? Math.min(line.quantity, originalQty) : 0;
    const extra = line.quantity - atOriginal;
    let standardValueCents: number;
    if (originalQty > 0) {
      // the units the original receipt covered keep its carrying basis (pro-rated when the line shrank);
      // units a later edit added take the item's current standard
      const originalUnit = original!.valueCents / originalQty;
      const currentStandard = validStandardCost(byId.get(line.itemId)?.standardCostCents);
      const extraBasis = extra > 0 ? (currentStandard ?? originalUnit) : 0;
      standardValueCents = Math.round(atOriginal * originalUnit) + Math.round(extra * extraBasis);
    } else {
      const standard = validStandardCost(byId.get(line.itemId)?.standardCostCents);
      standardValueCents = standard !== null && line.quantity > 0 ? Math.round(line.quantity * standard) : line.valueCents;
    }
    return {
      ...line,
      valueCents: standardValueCents,
      ...(standardValueCents !== line.valueCents ? { actualValueCents: line.valueCents } : {}),
    };
  });
  const actualTotalCents = stockIn.reduce((sum, l) => sum + l.valueCents, 0);
  const standardTotalCents = entries.reduce((sum, l) => sum + l.valueCents, 0);
  return { entries, actualTotalCents, standardTotalCents, varianceCents: actualTotalCents - standardTotalCents };
}
