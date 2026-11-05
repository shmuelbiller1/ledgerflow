import type { DocumentData, DocumentReference, Firestore } from '../db/firestore';
import { calculateAmountDue } from '../../lib/documentMath';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import { logger } from '../utils/logger';
import { notify } from './notificationService';

/**
 * "The customer opened the invoice" (S-02). When the invoice's own page (/i/<pay token>) is opened,
 * the invoice keeps when it was first and last seen and how often (at most one count an hour), and
 * the first time the people who keep the books are notified. Never breaks the page: failures are
 * logged and ignored. The app itself never opens this page, so a view is the customer's.
 */
const HOUR_MS = 60 * 60 * 1000;

export async function recordInvoiceView(db: Firestore, ref: DocumentReference, invoice: DocumentData, now = new Date()): Promise<'first' | 'again' | 'skipped'> {
  try {
    const first = !invoice.viewedAt;
    const last = typeof invoice.lastViewedAt === 'string' ? Date.parse(invoice.lastViewedAt) : 0;
    if (!first && now.getTime() - last < HOUR_MS) return 'skipped';
    const at = now.toISOString();
    await ref.update({ ...(first ? { viewedAt: at } : {}), lastViewedAt: at, viewCount: (Number(invoice.viewCount) || 0) + 1 });
    if (first && typeof invoice.workspaceId === 'string') {
      const who = String(invoice.customerName || 'The customer');
      const number = String(invoice.number || ref.id);
      const due = calculateAmountDue(invoice as never);
      await notify(db, {
        workspaceId: invoice.workspaceId, kind: 'invoice.viewed', title: `${who} opened invoice ${number}`,
        message: due > 0 ? `${formatCurrency(due, String(invoice.currency || 'USD'))} is still due${invoice.dueDate ? ` by ${String(invoice.dueDate).slice(0, 10)}` : ''}.` : 'It is paid.',
        eventKey: `invoice-viewed:${ref.id}`, recordId: ref.id,
      });
    }
    return first ? 'first' : 'again';
  } catch (err) {
    logger.warn('could not record an invoice view', { invoiceId: ref.id, error: err instanceof Error ? err.message : String(err) });
    return 'skipped';
  }
}
