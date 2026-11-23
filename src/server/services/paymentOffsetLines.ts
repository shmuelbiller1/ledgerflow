/** PM-04: the offset lines a payment's transaction posts. Without allocations (or without any
 *  retainage), the whole offset goes to the single resolved control account, exactly as before. */
import type { RateUsed } from '../../lib/rateUsed';
import type { ChartAccount } from '../../types';
import { findRetainageReceivable } from '../../lib/retainageAccount';

interface RetainageSplit { tradePartDoc: number; retainagePartDoc: number; documentType: 'invoice' | 'bill' }
interface RetainageAccount { trade?: { accountId: string; name: string }; retainage?: { accountId: string; name: string } }

export function buildOffsetLines(opts: {
  isReceipt: boolean;
  paymentId: string;
  offsetAccountId: string;
  offsetBaseCents: number;
  hasAdvance: boolean;
  retainageSplits: RetainageSplit[];
  retainageAccounts: RetainageAccount[];
  /** each allocation's cleared amount in the books' cents (documentClearing: rate, currency exponent and
   * the final-settlement rounding already applied), in the same order as `retainageSplits` */
  clearedBaseByAlloc?: number[];
  rateOn: (r: RateUsed | null) => { rateUsedId?: string };
  bookedRate: RateUsed | null;
}): Array<{ accountId: string; amountCents: number; description?: string; rateUsedId?: string }> {
  const { isReceipt, paymentId, offsetAccountId, offsetBaseCents, hasAdvance, retainageSplits, retainageAccounts, clearedBaseByAlloc, rateOn, bookedRate } = opts;
  const desc = `Offset ${isReceipt ? 'Credit' : 'Debit'} for Payment ${paymentId}`;
  const signed = (l: { accountId: string; amountCents: number }) => ({ accountId: l.accountId, amountCents: isReceipt ? -l.amountCents : l.amountCents, description: desc, ...rateOn(bookedRate) });
  if (retainageSplits.some(r => r.retainagePartDoc > 0)) {
    // each document's cleared base amount is divided between its trade and retainage control accounts
    // in the proportion of the document-currency parts, so the lines add up to exactly what clears
    // (never document minor units × a major-unit rate)
    const lines: Array<{ accountId: string; amountCents: number }> = [];
    let allocated = 0;
    retainageSplits.forEach((split, i) => {
      const accs = retainageAccounts[i] || {};
      const cleared = clearedBaseByAlloc?.[i] ?? Math.round((split.tradePartDoc + split.retainagePartDoc) * Number(bookedRate?.rate ?? 1));
      const docTotal = split.tradePartDoc + split.retainagePartDoc;
      const tradePart = docTotal > 0 ? Math.round(cleared * split.tradePartDoc / docTotal) : cleared;
      allocated += cleared;
      lines.push(
        { accountId: accs.trade?.accountId ?? offsetAccountId, amountCents: tradePart },
        { accountId: accs.retainage?.accountId ?? accs.trade?.accountId ?? offsetAccountId, amountCents: cleared - tradePart },
      );
    });
    // what the allocations do not cover (an unmatched part with no advance account) still offsets on
    // the resolved control account, as it does without retainage
    const rest = offsetBaseCents - allocated;
    if (rest !== 0) lines.push({ accountId: offsetAccountId, amountCents: rest });
    return lines.filter(l => l.amountCents).map(signed);
  }
  return offsetBaseCents !== 0 || !hasAdvance ? [signed({ accountId: offsetAccountId, amountCents: offsetBaseCents })] : [];
}

/**
 * PM-04: for each allocation's retainage split, the trade and retainage control accounts the document
 * was posted to: the trade part clears the receivable the payment already settles (`tradeAccountId`, the
 * document's own A/R), the retained part clears the Retainage Receivable resolved exactly as invoice
 * posting resolves it (workspace mapping first, then an asset Receivables account named for retainage) —
 * never by a name-only search that could land on Retainage Payable.
 */
export async function buildRetainageAccounts(
  splits: Array<{ retainagePartDoc: number; documentType: 'invoice' | 'bill' }>,
  chart: ChartAccount[],
  opts: { tradeAccountId?: string; mappings?: Record<string, string> } = {},
): Promise<Array<{ trade?: { accountId: string; name: string }; retainage?: { accountId: string; name: string } }>> {
  const tradeAcc = opts.tradeAccountId ? chart.find(a => a.id === opts.tradeAccountId) : undefined;
  const trade = tradeAcc ? { accountId: tradeAcc.id, name: tradeAcc.name } : undefined;
  const retAcc = findRetainageReceivable(chart, opts.mappings);
  const retainage = retAcc ? { accountId: retAcc.id, name: retAcc.name } : undefined;
  // only invoices post a retained part (bill posting credits the whole bill to A/P)
  return splits.map(split => (split.retainagePartDoc > 0 && split.documentType === 'invoice' ? { trade, retainage } : {}));
}

/** PM-04: split an allocation between the trade and retainage control accounts. */
export function computeRetainageSplit(docData: { retainageCents?: number; amountCents?: number; amountPaidCents?: number }, allocAmountCents: number, documentType: 'invoice' | 'bill' = 'invoice'): { tradePartDoc: number; retainagePartDoc: number } {
  // bill posting credits the whole bill to ordinary A/P (no retainage line), so paying a bill clears A/P
  // in full: splitting part of it to Retainage Payable would leave A/P open on a fully paid bill
  if (documentType === 'bill') return { tradePartDoc: allocAmountCents, retainagePartDoc: 0 };
  const retainageDocCents = Math.max(0, Number(docData.retainageCents) || 0);
  const tradeDocCents = Math.max(0, (Number(docData.amountCents) || 0) - retainageDocCents);
  const tradeOutstandingDoc = Math.max(0, tradeDocCents - (Number(docData.amountPaidCents) || 0));
  const tradePartDoc = Math.min(allocAmountCents, tradeOutstandingDoc);
  return { tradePartDoc, retainagePartDoc: allocAmountCents - tradePartDoc };
}
/** PM-01/02: a payment settles one document kind, and its own party owns every document it settles. */
export function assertPaymentAllocation(opts: { seenDocumentType: 'invoice' | 'bill' | undefined; customerId: string | undefined; vendorId: string | undefined; documentType: 'invoice' | 'bill'; docCustomerId?: string; docVendorId?: string }): void {
  if (opts.seenDocumentType && opts.seenDocumentType !== opts.documentType) {
    throw new Error('One payment can only settle invoices or only bills: record separate payments for each kind');
  }
  if (opts.customerId && opts.documentType === 'bill') throw new Error('This is a customer payment: it cannot settle a bill. Record a vendor payment for the bill');
  if (opts.vendorId && opts.documentType === 'invoice') throw new Error('This is a vendor payment: it cannot settle an invoice. Record a customer receipt for the invoice');
  const docPartyId = (opts.documentType === 'invoice' ? opts.docCustomerId : opts.docVendorId) || null;
  if (opts.customerId && opts.documentType === 'invoice' && docPartyId && docPartyId !== opts.customerId)
    throw new Error(`This payment identifies a different customer than the invoice it settles (${docPartyId})`);
  if (opts.vendorId && opts.documentType === 'bill' && docPartyId && docPartyId !== opts.vendorId)
    throw new Error(`This payment identifies a different vendor than the bill it settles (${docPartyId})`);
}

