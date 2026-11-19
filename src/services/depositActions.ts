import { toast } from 'sonner';
import { uiLanguageNow } from '../lib/i18n/uiLanguageNow';
import { commandErrorMessage, runCommand, writeWasAccepted } from '../lib/runCommand';
import { depositApplication } from '../lib/advancePayments';
import { formatCurrency } from '../lib/utils';

/**
 * Apply an estimate's deposits to its invoice once the invoice is issued (BE-05): each deposit still
 * waiting (oldest first) settles the invoice up to what is due, through the server's payment apply
 * (BE-12), which moves the money from Customer Deposits to receivables. Returns what was applied.
 */
export async function applyEstimateDeposits(
  workspaceId: string,
  invoice: { id: string; number?: string; currency?: string },
  waiting: Array<{ id: string; unappliedCents?: number }>,
  dueCents: number,
): Promise<number> {
  let applied = 0;
  for (const part of depositApplication(waiting, dueCents)) {
    try {
      await runCommand({
        path: `/api/v1/payments/${encodeURIComponent(part.paymentId)}/apply`,
        method: 'POST',
        body: { workspaceId, allocations: [{ documentId: invoice.id, documentType: 'invoice', amountCents: part.amountCents }] },
      });
    } catch (error) {
      // committed, answer cut off: the deposit *was* applied, so it counts — stopping here would leave the
      // invoice short and the screen claiming nothing was applied
      if (!writeWasAccepted(error)) {
        // the server's own words, so a refusal says which rule it broke
        toast.error(commandErrorMessage(error, uiLanguageNow()));
        break;
      }
    }
    applied += part.amountCents;
  }
  if (applied > 0) toast.success(`Deposit of ${formatCurrency(applied, invoice.currency)} applied to invoice ${invoice.number || ''}`.trim());
  return applied;
}
