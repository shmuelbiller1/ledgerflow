/**
 * Audit F8 (5 Nov): an invoice or bill whose total is smaller than its own items can say. The audit saved one item of
 * $100.00 on a sent invoice with a total of $0.01, and the server posted $0.01. Totals follow several rules (tax
 * added or included, the explicit tax-code form, a header discount, retainage), so this refuses only what none of
 * them allows: whatever the tax rule, the total owed is at least the items less the header discount and retainage.
 * Items without a whole-cent amount, and documents without items, are not judged. A cent per item is allowed for
 * rounding. Returns the refusal message, or null when the total is possible.
 */
export function itemsExceedTotal(doc: { amountCents?: unknown; items?: unknown; discountCents?: unknown; retainageCents?: unknown }): string | null {
  if (!Array.isArray(doc.items) || doc.items.length === 0) return null;
  const amounts: number[] = [];
  for (const item of doc.items as Array<{ amountCents?: unknown }>) {
    if (!item || !Number.isSafeInteger(item.amountCents)) return null;
    amounts.push(item.amountCents as number);
  }
  if (!Number.isSafeInteger(doc.amountCents)) return null;
  const items = amounts.reduce((sum, a) => sum + a, 0);
  const off = (v: unknown) => (Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : 0);
  const least = items - off(doc.discountCents) - off(doc.retainageCents) - amounts.length;
  if (items <= 0 || (doc.amountCents as number) >= least) return null;
  return `The document total (${doc.amountCents}) is less than its items allow (${items} in items, less ${off(doc.discountCents)} discount and ${off(doc.retainageCents)} retainage). Recalculate the total and save again.`;
}
