import type { Firestore } from '../db/firestore';

/**
 * Aging (RP-01 follow-up): the date each voided or cancelled document stopped being owed — the date of
 * the latest reversal of its posting ('invoice-reversal' / 'bill-reversal', written when the document
 * is voided). A void in an open period reverses on the original day; one in a closed period reverses on
 * the day it was voided, so a historic snapshot before that day still shows the document as owed.
 */
export async function documentVoidDates(db: Firestore, workspaceId: string, documentType: 'invoice' | 'bill'): Promise<Map<string, string>> {
  const type = documentType === 'invoice' ? 'invoice-reversal' : 'bill-reversal';
  const link = documentType === 'invoice' ? 'invoiceId' : 'billId';
  const snap = await db.collection('transactions').where('workspaceId', '==', workspaceId).where('metadata.type', '==', type).get();
  const dates = new Map<string, string>();
  for (const d of snap.docs) {
    const row = d.data() as { date?: unknown; metadata?: Record<string, unknown> };
    const documentId = row.metadata?.[link];
    const date = typeof row.date === 'string' ? row.date.slice(0, 10) : '';
    if (typeof documentId !== 'string' || !documentId || !date) continue;
    const known = dates.get(documentId);
    if (!known || date > known) dates.set(documentId, date);
  }
  return dates;
}
