import type { Firestore } from '../db/firestore';
import { ledgerCreate } from './ledgerDoor';
import { FieldValue } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { fallbackTaxAccounts, findTaxDifferences, taxAdjustmentEntry, type TaxDifference } from '../../lib/taxRecompute';
import { formatTzDate } from '../../lib/calendarDate';
import type { Bill, ChartAccount, Invoice, Transaction } from '../../types';
import { writeServerAuditLog } from './auditLogService';

/**
 * Tax recompute (AE-04), run by hand with scripts/recompute-document-tax.ts. Lists the invoices
 * and bills whose ledger tax differs from the document (src/lib/taxRecompute.ts); with `apply`
 * it posts one adjusting entry per document, dated `date` (default: today in the workspace),
 * through the same checks as every posting (balanced, accounts in the workspace, period open)
 * and in the audit log. The old entries are never edited.
 */

export interface TaxRecomputeInput {
  workspaceId: string;
  uid: string;
  apply?: boolean;
  date?: string;
  /** Only these documents (ids); all when left out. */
  documentIds?: string[];
}

export interface TaxRecomputeResult {
  differences: TaxDifference[];
  posted: Array<{ documentId: string; transactionId: string }>;
  failed: Array<{ documentId: string; error: string }>;
}

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export async function recomputeDocumentTax(db: Firestore, input: TaxRecomputeInput): Promise<TaxRecomputeResult> {
  const workspace = (await db.collection('workspaces').doc(input.workspaceId).get()).data();
  if (!workspace) throw new Error('Workspace not found');
  const load = async <T>(collection: string) =>
    (await db.collection(collection).where('workspaceId', '==', input.workspaceId).get()).docs.map(d => ({ ...d.data(), id: d.id }) as T);
  const [invoices, bills, transactions, accounts] = await Promise.all([
    load<Invoice>('invoices'), load<Bill>('bills'), load<Transaction>('transactions'), load<ChartAccount>('chartAccounts'),
  ]);

  const only = input.documentIds ? new Set(input.documentIds) : null;
  const differences = findTaxDifferences({ invoices, bills, transactions }).filter(d => !only || only.has(d.id));
  const result: TaxRecomputeResult = { differences, posted: [], failed: [] };
  if (!input.apply) return result;

  const date = input.date || formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
  if (!DAY.test(date)) throw new Error('Date must be YYYY-MM-DD');
  const mappings = (workspace.defaultAccountMappings || {}) as Record<string, string>;

  for (const diff of differences) {
    const fallback = fallbackTaxAccounts(diff.kind, accounts, mappings);
    const built = taxAdjustmentEntry(diff, date, { tax: fallback.tax, offset: fallback.offset });
    if (!built.entry) {
      result.failed.push({ documentId: diff.id, error: built.error || 'Could not build the adjustment' });
      continue;
    }
    const entry = built.entry;
    try {
      const transactionId = await db.runTransaction(async (t) => {
        const prepared = await TransactionValidator.validateAndPrepare(
          {
            id: db.collection('transactions').doc().id, workspaceId: input.workspaceId, uid: input.uid,
            currency: workspace.currency || 'USD', exchangeRate: 1, status: 'completed', type: 'actual', ...entry,
          },
          { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t,
        );
        ledgerCreate(t, db.collection('transactions').doc(prepared.id), { ...prepared, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        await writeServerAuditLog({
          workspaceId: input.workspaceId, uid: input.uid, action: 'tax_recomputed',
          entityType: diff.kind, entityId: diff.id,
          details: { description: entry.description, transactionId: prepared.id, postedTaxCents: diff.postedTaxCents, expectedTaxCents: diff.expectedTaxCents },
        }, { db, tx: t });
        return prepared.id;
      });
      result.posted.push({ documentId: diff.id, transactionId });
    } catch (err) {
      result.failed.push({ documentId: diff.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
