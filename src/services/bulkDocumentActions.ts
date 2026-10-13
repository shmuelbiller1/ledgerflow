import { getIdToken } from '../firebase';
import type { BulkDocument, BulkSide, PlannedPayment } from '../lib/bulkDocuments';
import { documentLabel } from '../lib/bulkDocuments';

/**
 * Bulk actions on invoices and bills (K-06), one request per payment or email so one refusal
 * (a locked month, a missing email address) doesn't stop the rest; the results say which failed.
 */

async function post(path: string, body: unknown, operationId?: string): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}`, ...(operationId ? { 'x-operation-id': operationId } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data.message || data.error || 'The request failed'));
  return data;
}

export interface PaymentOptions { workspaceId: string; side: BulkSide; cashAccountId: string; date: string; method: string; sendRemittance?: boolean; /** Retains a payment's key across a failed or uncertain response in the same dialog. */ operationIds?: Map<string, string> }

export async function recordPayments(payments: PlannedPayment[], options: PaymentOptions) {
  const done: PlannedPayment[] = [];
  const failed: Array<{ payment: PlannedPayment; message: string }> = [];
  let remittancesSent = 0;
  for (const payment of payments) {
    // A retry uses the identical operation key only for exactly the same intended payment.
    // Include all fields that influence the POST, rather than only the vendor or amount.
    const signature = JSON.stringify([options.workspaceId, options.side, options.cashAccountId, options.date, options.method, !!options.sendRemittance, payment.partyId, payment.partyName, payment.amountCents, payment.allocations]);
    const operationId = options.operationIds?.get(signature) || crypto.randomUUID();
    options.operationIds?.set(signature, operationId);
    try {
      const result = await post('/api/v1/payments', {
        workspaceId: options.workspaceId,
        paymentDate: options.date,
        amountCents: payment.amountCents,
        paymentMethod: options.method,
        referenceNumber: '',
        memo: `Paid ${payment.allocations.map(a => a.label).join(', ')}`,
        ...(options.side === 'invoice' ? { customerId: payment.partyId } : { vendorId: payment.partyId }),
        entityName: payment.partyName,
        cashAccountId: options.cashAccountId,
        allocations: payment.allocations.map(({ documentId, documentType, amountCents }) => ({ documentId, documentType, amountCents })),
        ...(options.side === 'bill' && options.sendRemittance ? { sendRemittance: true } : {}),
      }, operationId);
      options.operationIds?.delete(signature);
      if ((result.data as { remittance?: string } | undefined)?.remittance === 'sent') remittancesSent++;
      done.push(payment);
    } catch (err) {
      failed.push({ payment, message: (err as Error).message });
    }
  }
  return { done, failed, remittancesSent };
}

/** Emails each invoice to its customer's address (the server picks it), with the PDF attached. */
export async function emailInvoices(invoices: BulkDocument[], workspaceId: string) {
  const sent: Array<{ id: string; label: string; to: string }> = [];
  const failed: Array<{ id: string; label: string; message: string }> = [];
  for (const invoice of invoices) {
    const label = documentLabel(invoice, 'invoice');
    try {
      const data = await post(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/emails/invoices/${encodeURIComponent(invoice.id)}`, { template: 'invoice' });
      sent.push({ id: invoice.id, label, to: String(data.to || '') });
    } catch (err) {
      failed.push({ id: invoice.id, label, message: (err as Error).message });
    }
  }
  return { sent, failed };
}
