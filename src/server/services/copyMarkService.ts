/**
 * Original and copy (PLAN IL-2): an Israeli tax document (tax invoice, credit invoice, receipt) is
 * given to the customer once as the original (מקור); every later print says it is a true copy (העתק
 * נאמן למקור). Applies when the books' tax profile is Israeli. The first print takes the original
 * in a transaction (`originalIssuedAt` on the document, server-written), so two prints at once
 * cannot both be originals. Drafts and void documents carry no mark.
 */
import type { Firestore } from '../db/firestore';
import type { TaxProfiles } from '../../lib/tax/profile';

const MARKED: Record<string, string> = { invoice: 'invoices', creditNote: 'creditNotes', payment: 'payments' };

export function marksOriginals(workspace: { taxProfiles?: TaxProfiles } | null | undefined): boolean {
  const books = workspace?.taxProfiles?.books;
  return books?.place?.country === 'IL' || Boolean(books?.registrations?.some(r => r.kind === 'vat' && r.place.country === 'IL'));
}

export async function takeCopyMark(
  db: Firestore,
  type: string,
  id: string,
  workspace: { taxProfiles?: TaxProfiles } | null | undefined,
  options?: { readOnly?: boolean },
): Promise<'original' | 'copy' | undefined> {
  const collection = MARKED[type];
  if (!collection || !marksOriginals(workspace)) return undefined;
  if (options?.readOnly) {
    const doc = (await db.collection(collection).doc(id).get()).data();
    if (!doc || doc.status === 'draft' || doc.status === 'void') return undefined;
    return 'copy';
  }
  return db.runTransaction(async t => {
    const ref = db.collection(collection).doc(id);
    const doc = (await t.get(ref)).data();
    if (!doc || doc.status === 'draft' || doc.status === 'void') return undefined;
    if (doc.originalIssuedAt) return 'copy';
    t.update(ref, { originalIssuedAt: new Date().toISOString() });
    return 'original';
  });
}
