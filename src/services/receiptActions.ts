import { toast } from 'sonner';
import { commandErrorMessage, runCommand, writeWasAccepted } from '../lib/runCommand';
import { calculateAmountDue } from '../lib/documentMath';

/**
 * The payment half of a sale receipt (K-03): the invoice was just saved as issued; its whole amount
 * due is recorded as a payment into the chosen account (a bank, or Undeposited Funds for "Make
 * deposit"), through the same server payments as everywhere else. If that fails the invoice stays
 * open and the person is told to record the payment.
 */
export async function recordReceiptPayment(
  workspaceId: string,
  invoice: { id: string; number?: string; date?: string; customerId?: string; customerName?: string; amountCents?: number; amountPaidCents?: number; depositCents?: number },
  payment: { cashAccountId: string; method: string },
): Promise<boolean> {
  const due = calculateAmountDue(invoice);
  if (due <= 0) return true;
  try {
    await runCommand({
      path: '/api/v1/payments',
      method: 'POST',
      // #114: one receipt per sale invoice, so its id is the operation key — a retry is recorded once
      headers: { 'x-operation-id': `sale-receipt:${invoice.id}`.slice(0, 128) },
      body: {
        workspaceId, amountCents: due, paymentDate: invoice.date, cashAccountId: payment.cashAccountId, paymentMethod: payment.method,
        customerId: invoice.customerId, entityName: invoice.customerName || '', memo: `Sale receipt ${invoice.number || ''}`.trim(),
        allocations: [{ documentId: invoice.id, documentType: 'invoice', amountCents: due }],
      },
    });
  } catch (error) {
    // A 2xx whose body was cut off still means the payment was recorded. Saying otherwise would send the person to
    // "Receive payment", which does not carry the `sale-receipt:` key — and the invoice would be paid twice.
    if (writeWasAccepted(error)) { toast.success(`Sale receipt ${invoice.number || ''} saved and paid`.replace('  ', ' ')); return true; }
    // the invoice is saved; only the payment failed, and the reason is the server's
    toast.error(`Saved as an open invoice, but the payment was not recorded (${commandErrorMessage(error)}): record it with Receive payment.`);
    return false;
  }
  toast.success(`Sale receipt ${invoice.number || ''} saved and paid`.replace('  ', ' '));
  return true;
}
