/**
 * The lines of a new quote while it is being written (BF-08): quantity and price as typed, the
 * cents worked out from them, and the stock item a line is linked to. The form is
 * src/components/sales/EstimateLinesEditor.tsx; orders built from these lines are invoiced by
 * quantity (src/lib/salesOrders.ts).
 */
import type { InvoiceLineDraft } from './invoiceLines';
import { parseAmountToCents, readAmountCents } from './utils';
import type { Estimate } from '../types';

export interface EstimateLineDraft extends InvoiceLineDraft {
  quantityText: string;
  priceText: string;
}

let made = 0;
export function blankEstimateLine(description = '', priceText = ''): EstimateLineDraft {
  made += 1;
  const rateCents = parseAmountToCents(priceText);
  return { id: `line-${Date.now().toString(36)}-${made}`, description, quantity: 1, quantityText: '1', rateCents, priceText, amountCents: rateCents, accountId: '' };
}

const hundredths = (n: number) => Math.round(n * 100) / 100;

/** Why these lines cannot be saved, or null. */
export function estimateLinesProblem(lines: EstimateLineDraft[]): string | null {
  for (const [i, line] of lines.entries()) {
    const which = line.description.trim() || `line ${i + 1}`;
    if (!line.description.trim()) return `Describe line ${i + 1}`;
    if (!Number.isFinite(line.quantity) || line.quantity <= 0 || hundredths(line.quantity) !== line.quantity) return `Enter how many for ${which} (more than zero, two decimals at most)`;
    if (line.priceText.trim() === '' || line.rateCents < 0 || readAmountCents(line.priceText) === null) return `Enter the price of ${which}`;
  }
  if (lines.reduce((s, l) => s + l.amountCents, 0) <= 0) return 'The quote must come to more than zero';
  return null;
}

/** The lines as they are saved on the quote. */
export function toEstimateLines(lines: EstimateLineDraft[]): Estimate['lines'] {
  return lines.map(l => ({
    ...(l.itemId ? { itemId: l.itemId } : {}),
    description: l.description.trim(),
    quantity: l.quantity,
    unitPriceCents: l.rateCents,
    amountCents: l.amountCents,
  }));
}
