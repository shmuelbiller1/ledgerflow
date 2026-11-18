import { getTransactions, postTxsServerApi, postingToday, postingUid, liveDocumentPostings, reversalEntries } from './postingCore';
import type { EntityMutation, LedgerPostContext } from './postingCore';

/**
 * Reverse all postings when an invoice or bill is deleted.
 */
export async function deletePostings(
  id: string, 
  keyName: 'invoiceId' | 'billId' | 'creditNoteId' | 'vendorCreditId', 
  workspaceId: string, 
  entityMutation?: EntityMutation, 
  context?: LedgerPostContext
) {
  if (!workspaceId || !id) return;

  const existingTxs = liveDocumentPostings(
    getTransactions(context),
    t => t.metadata?.[keyName] === id,
    { excludeTypes: new Set(['invoice-bad-debt-writeoff', 'invoice-bad-debt-recovery']) },
  );
  if (existingTxs.length === 0) { if (entityMutation) { await postTxsServerApi([], workspaceId, entityMutation, context); } return; }

  const reversals = reversalEntries(existingTxs, {
    uid: postingUid(context),
    workspaceId,
    today: postingToday(context),
    context,
    verifyLock: true,
    describe: prevTx => `Reversal: ${prevTx.description}`,
    metadata: () => ({ [keyName]: id, type: `${keyName}-deletion-reversal` })
  });

  await postTxsServerApi(reversals, workspaceId, entityMutation, context);
}
