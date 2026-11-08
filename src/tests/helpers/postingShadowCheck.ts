import type { Firestore } from '../../server/db/firestore';
import { postInvoiceLedger } from '../../services/ledgerPost/invoicePosting';
import { postBillLedger } from '../../services/ledgerPost/billPosting';
import { postCreditNoteLedger, postVendorCreditLedger } from '../../services/ledgerPost/creditPosting';
import { agreedPostingDay, loadPostingContext } from '../../server/services/postingContextLoader';
import type { EntityMutation, LedgerPostContext, PostableTransaction } from '../../services/ledgerPost/postingCore';
import type { Transaction } from '../../types';
import { byCodeUnit } from '../../lib/codeUnitOrder';

/**
 * L-94 step 1 (shadow), kept for the tests after L94-STEP2B: the browser no longer sends document entries, so the
 * server never had anything to compare; what this still proves is that the server, from the database alone, rebuilds
 * exactly the entries the browser's builder makes (the same context L94-STEP2's route uses). Was
 * src/server/services/postingShadowCheck.ts.
 *
 * L-94 step 1 (shadow): after an invoice, bill, credit note or vendor credit save commits (L94-SHADOW-MORE added the
 * last two; payments are not posted by the browser — POST /payments builds their entries on the server), the server rebuilds the entries the browser sent
 * with the same builder (postingCore, no browser code) from what is in the database, and compares them: the same
 * dates, accounts, amounts and labels. A difference is logged, never refused yet — the logs of the first testers
 * show whether the browser and the server ever disagree before step 1 starts refusing
 * (docs/design/L-94-server-postings.md). It never changes the save, and its own failure is only logged.
 */
export interface ShadowCheckInput {
  workspaceId: string;
  uid: string;
  mutation: EntityMutation;
  /** the entries this request wrote, as written */
  posted: Array<Pick<Transaction, 'id' | 'date' | 'lines'>>;
  /** the day the browser counted as today for this save (it dates reversals into a closed period) */
  postingDay?: unknown;
}

export type ShadowCheckResult = { checked: false; reason: string } | { checked: true; matched: boolean; expected: string[]; sent: string[] };

type Builder = (id: string, data: Record<string, unknown>, workspaceId: string, uid: string, mutation: EntityMutation, context: LedgerPostContext) => Promise<unknown>;

/** Each document the browser posts through /transactions/bulk (its allowlist): the metadata key its entries carry and its builder. */
export const DOCUMENT_BUILDERS: Record<string, { key: string; post: Builder }> = {
  invoices: { key: 'invoiceId', post: (id, data, ws, uid, m, c) => postInvoiceLedger(id, data, ws, uid, m, c) },
  bills: { key: 'billId', post: (id, data, ws, uid, m, c) => postBillLedger(id, data, ws, uid, m, c) },
  creditNotes: { key: 'creditNoteId', post: (id, data, ws, uid, m, c) => postCreditNoteLedger(id, data, ws, uid, m, c) },
  vendorCredits: { key: 'vendorCreditId', post: (id, data, ws, uid, m, c) => postVendorCreditLedger(id, data, ws, uid, m, c) },
};

/** One comparable row per entry line: date, account, cents and labels (order of lines and entries ignored). */
export function postingFingerprint(txs: Array<Pick<Transaction, 'date' | 'lines'> | PostableTransaction>): string[] {
  return txs.flatMap(tx => (tx.lines || []).map(line => {
    const labels = Object.entries((line as { dimensions?: Record<string, string> }).dimensions || {}).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b));
    return `${String(tx.date || '').slice(0, 10)}|${line.accountId}|${line.amountCents}|${JSON.stringify(labels)}`;
  })).sort(byCodeUnit);
}

export async function shadowCheckDocumentPosting(db: Firestore, input: ShadowCheckInput): Promise<ShadowCheckResult> {
  const { workspaceId, uid, mutation, posted } = input;
  const builder = DOCUMENT_BUILDERS[mutation.collection];
  if (!builder || (mutation.action !== 'create' && mutation.action !== 'update')) return { checked: false, reason: 'not a save of a document that posts' };

  const [docSnap, wsSnap] = await Promise.all([
    db.collection(mutation.collection).doc(mutation.docId).get(),
    db.collection('workspaces').doc(workspaceId).get(),
  ]);
  const document = docSnap.data();
  const workspace = wsSnap.data();
  if (!document || !workspace) return { checked: false, reason: 'document or workspace not found' };

  // the document's entries as they were before this request (everything except what it just wrote); the save already
  // passed the server's own period check, so the builder must not refuse it again
  const context = await loadPostingContext(db, { workspaceId, uid, collection: mutation.collection, docId: mutation.docId, document, workspace, exclude: new Set(posted.map(tx => tx.id)), lockChecked: true });
  context.today = agreedPostingDay(context.today || new Date().toISOString().slice(0, 10), input.postingDay);
  await builder.post(mutation.docId, { ...document, id: mutation.docId }, workspaceId, uid, mutation, context);

  const expected = postingFingerprint(context.capture!.flatMap(c => c.txs));
  const sent = postingFingerprint(posted);
  return { checked: true, matched: JSON.stringify(expected) === JSON.stringify(sent), expected, sent };
}
