/**
 * #646: the server uses a credit note or vendor credit only when its own entry is in the books. Tests that write
 * a credit straight into the database write that entry with it, as issuing the credit does.
 */
import type { Firestore } from '../../server/db/pgFirestore';

export async function setCredit(db: Firestore, collection: 'creditNotes' | 'vendorCredits', id: string, data: Record<string, unknown>): Promise<void> {
  await db.collection(collection).doc(id).set(data);
  const amount = Number(data.amountCents) || 0;
  const rate = typeof data.exchangeRate === 'number' && data.exchangeRate > 0 ? data.exchangeRate : 1;
  const home = Math.round(amount * rate);
  const key = collection === 'creditNotes' ? 'creditNoteId' : 'vendorCreditId';
  await db.collection('transactions').doc(`${id}_posting`).set({
    id: `${id}_posting`, workspaceId: data.workspaceId, uid: data.uid || 'owner-1', date: data.date || '2026-01-01',
    description: `Credit ${id}`, status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 1, totalAmountCents: home,
    lines: [{ accountId: `${id}_dr`, amountCents: home }, { accountId: `${id}_cr`, amountCents: -home }],
    metadata: { [key]: id, type: collection === 'creditNotes' ? 'credit-note' : 'vendor-credit' },
  });
}
