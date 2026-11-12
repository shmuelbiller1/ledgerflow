/**
 * #652 / #662: the server's own answer to "may this ledger entry be changed or removed at all?".
 *
 * The browser already refuses to edit, void or reverse an entry that belongs to a document or a system
 * run (`src/lib/transactionEdits.ts` `isDocumentEntry`, used by the transaction row and the ledger
 * list), but the generic entry routes enforced none of it: a bookkeeper could PUT an invoice's or a
 * payment's entry (status → void/failed, lines rewritten) or reverse it, and the document kept saying
 * `paid` while the books said something else. A posted entry could also be un-posted in place by setting
 * its status to `failed`/`draft`, which `isPostable` drops from every report — "Undo" then answered 200
 * while the entry stayed out of the books.
 *
 * The rule is the client's rule, applied on the server: a document's entry is changed through that
 * document (void or credit the invoice, bill or payment), and a posted entry is un-posted only by a
 * reversing entry, which the books keep. A platform admin keeps the existing override, exactly as the
 * status/cleared locks already do.
 */
import type { Transaction } from '../../types';
import { isDocumentEntry } from '../../lib/transactionEdits';

/** Statuses a posted entry must not be moved to in place: `isPostable` drops both from the books. */
const UNPOSTS = new Set(['failed', 'draft']);

/** True when the entry is posted in the sense the reports use: completed, cleared or reconciled. */
export function isPostedEntry(tx: Partial<Transaction> | null | undefined): boolean {
  if (!tx) return false;
  return tx.status === 'completed' || tx.isCleared === true || tx.reconciled === true;
}

/**
 * The refusal for an entry that belongs to a document or a system run, or null when it may be changed
 * here. `isDocumentEntry` is the shared predicate (metadata document ids, `type`, `isReversal`).
 */
export function documentEntryRefusal(
  tx: Pick<Transaction, 'metadata'> | null | undefined,
  admin = false,
): string | null {
  if (!tx || admin || !isDocumentEntry(tx)) return null;
  return 'This entry belongs to a document or a system run. Change it through that document — void or credit the invoice, bill or payment it came from — instead of editing the ledger entry.';
}

/** The refusal for un-posting a posted entry in place (status → failed/draft), or null when allowed. */
export function postedStatusRefusal(
  tx: Partial<Transaction> | null | undefined,
  nextStatus: unknown,
  admin = false,
): string | null {
  if (!tx || admin || typeof nextStatus !== 'string' || !UNPOSTS.has(nextStatus)) return null;
  if (!isPostedEntry(tx)) return null;
  if (tx.status === nextStatus) return null;
  return 'A posted entry is not un-posted in place. Post a reversing entry instead: the books keep both the original and the correction.';
}

/** What an audit row records before and after an edit: the figures an auditor asks about first. */
export function auditSnapshot(tx: Partial<Transaction> | null | undefined): Record<string, unknown> | null {
  if (!tx) return null;
  return {
    status: tx.status ?? null,
    date: tx.date ?? null,
    totalAmountCents: tx.totalAmountCents ?? null,
    description: tx.description ?? null,
    lineCount: Array.isArray(tx.lines) ? tx.lines.length : 0,
    currency: tx.currency ?? null,
    exchangeRate: tx.exchangeRate ?? null,
  };
}
