/** PM-04: the offset lines a payment's transaction posts. Without allocations (or without any
 *  retainage), the whole offset goes to the single resolved control account, exactly as before. */
import type { RateUsed } from '../../lib/rateUsed';

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
  rateOn: (r: RateUsed | null) => { rateUsedId?: string };
  bookedRate: RateUsed | null;
}): Array<{ accountId: string; amountCents: number; description?: string; rateUsedId?: string }> {
  const { isReceipt, paymentId, offsetAccountId, offsetBaseCents, hasAdvance, retainageSplits, retainageAccounts, rateOn, bookedRate } = opts;
  const desc = `Offset ${isReceipt ? 'Credit' : 'Debit'} for Payment ${paymentId}`;
  if (retainageSplits.some(r => r.retainagePartDoc > 0)) {
    return retainageSplits.flatMap((split, i) => {
      const accs = retainageAccounts[i] || {};
      const rate = Number(bookedRate?.rate ?? 1);
      const lines = [
        { accountId: accs.trade?.accountId ?? offsetAccountId, amountCents: split.tradePartDoc * rate },
        { accountId: accs.retainage?.accountId ?? accs.trade?.accountId ?? offsetAccountId, amountCents: split.retainagePartDoc * rate },
      ];
      return lines.filter(l => l.amountCents).map(l => ({ accountId: l.accountId, amountCents: isReceipt ? -l.amountCents : l.amountCents, description: desc, ...rateOn(bookedRate) }));
    });
  }
  return offsetBaseCents !== 0 || !hasAdvance ? [{ accountId: offsetAccountId, amountCents: isReceipt ? -offsetBaseCents : offsetBaseCents, description: desc, ...rateOn(bookedRate) }] : [];
}

/** PM-04: for each allocation's retainage split, find the trade and retainage control accounts. */
export async function buildRetainageAccounts(
  splits: Array<{ retainagePartDoc: number; documentType: 'invoice' | 'bill' }>,
  chart: Array<{ id: string; name: string }>,
): Promise<Array<{ trade?: { accountId: string; name: string }; retainage?: { accountId: string; name: string } }>> {
  const out: Array<{ trade?: { accountId: string; name: string }; retainage?: { accountId: string; name: string } }> = [];
  for (const split of splits) {
    if (split.retainagePartDoc <= 0) { out.push({}); continue; }
    const isReceipt = split.documentType === 'invoice';
    // the retainage account: first try the one matching the document's side (receivable for
    // invoices, payable for bills), then fall back to any account with retainage in its name.
    const retAcc = chart.find(a => /retainage/i.test(a.name) && (isReceipt
      ? (a.name || '').toLowerCase().includes('receivable')
      : (a.name || '').toLowerCase().includes('payable')))
      || chart.find(a => /retainage/i.test(a.name));
    // the trade account: the first asset (ar) or liability (ap) account that is not the retainage account
    const tradeAcc = chart.find(a => a.id !== retAcc?.id && (isReceipt
      ? (a.name || '').toLowerCase().includes('receivable')
      : (a.name || '').toLowerCase().includes('payable')));
    out.push({
      trade: tradeAcc ? { accountId: tradeAcc.id, name: tradeAcc.name } : undefined,
      retainage: retAcc ? { accountId: retAcc.id, name: retAcc.name } : undefined,
    });
  }
  return out;
}

/** PM-04: split an allocation between the trade and retainage control accounts. */
export function computeRetainageSplit(docData: { retainageCents?: number; amountCents?: number; amountPaidCents?: number }, allocAmountCents: number): { tradePartDoc: number; retainagePartDoc: number } {
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

