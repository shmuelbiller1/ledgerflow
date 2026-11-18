import type { EffectIntent } from './sandboxEffects';
import type { DocumentData, Firestore } from '../db/firestore';
import { notifyPaymentReceived } from './notificationService';
import { emailRemittance, thankForPayment } from './documentEmailService';
import { logger } from '../utils/logger';

/** Intent only; recipient suppression, current preferences and delivery stay in the live callback. */
export function paymentEffectIntents(workspace: DocumentData, payment: DocumentData, options: { remittance: boolean }): EffectIntent[] {
  if (payment.direction === 'made' && options.remittance) return [{ kind: 'email', action: 'remittance', target: String(payment.id) }];
  if (payment.direction !== 'received' || !payment.workspaceId) return [];
  const intents: EffectIntent[] = [{ kind: 'notification', action: 'payment.received', target: String(payment.id) }];
  if (workspace.reminderSettings?.thankYou && Array.isArray(payment.allocations)) {
    for (const { documentType, documentId, amountCents } of payment.allocations) {
      if (documentType === 'invoice' && amountCents > 0) intents.push({ kind: 'email', action: 'payment-receipt', target: String(documentId) });
    }
  }
  return intents;
}

/**
 * What happens after a payment is saved (all three ways one is recorded: the payment dialog, a
 * bank line, an online payment): the in-app notification, and the customer's thank-you email when
 * the workspace turned it on (BE-02). Neither can undo or hold up the payment.
 */
export async function afterPaymentRecorded(db: Firestore, payment: DocumentData, actorUid?: string, options: { remittance?: boolean } = {}): Promise<string | void> {
  await notifyPaymentReceived(db, payment, actorUid);
  // K-25: a vendor payment can email the vendor a remittance advice, when asked for
  if (payment.direction === 'made' && options.remittance) {
    try {
      return await emailRemittance(db, payment);
    } catch (err) {
      logger.warn('remittance advice not sent', { workspaceId: payment.workspaceId, paymentId: payment.id, error: err instanceof Error ? err.message : String(err) });
      return 'failed';
    }
  }
  if (payment.direction !== 'received' || !payment.workspaceId) return;
  try {
    await thankForPayment(db, { workspaceId: String(payment.workspaceId), allocations: Array.isArray(payment.allocations) ? payment.allocations : [] });
  } catch (err) {
    logger.warn('thank-you email not sent', { workspaceId: payment.workspaceId, paymentId: payment.id, error: err instanceof Error ? err.message : String(err) });
  }
}
