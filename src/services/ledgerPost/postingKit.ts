import { db } from '../../firebase';
import { doc, getDoc } from '../../lib/db/firestore';
import { toast } from 'sonner';
import { showBudgetWarnings } from '../../lib/budgetWarnings';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { Transaction, Invoice, Bill, InventoryItem } from '../../types';
import { postingToday, registerPostingHost } from './postingCore';
import { getLocalDateISO } from '../../lib/utils';
import type { EntityMutation, LedgerPostContext, PostableTransaction } from './postingCore';
import { reportCreditLimitRefusal } from '../../lib/creditLimitPrompt';
import { runCommand, ServerCommandError, type CommandBody } from '../../lib/runCommand';

// The browser's side of posting (L-94 step 0): the pure helpers are in postingCore.ts; this file
// gives them the screen's data (the stores) and the one call that sends entries to the server, and
// registers both as the posting host when it is imported (LedgerPostService imports it).
export * from './postingCore';

/**
 * The stock items a document names, for cost of goods sold (an invoice) or for receiving at standard cost
 * (a bill, M-21 step 2): the loaded inventory, plus any item on the document that isn't loaded yet
 * (inventory loads only once a screen needs it: src/lib/ledgerCollections.ts), read from the database.
 */
async function loadInventoryFromStore(documentData: Partial<Invoice> | Partial<Bill>): Promise<InventoryItem[]> {
  const loaded = useLedgerStore.getState().inventory || [];
  const known = new Set(loaded.map(i => i.id));
  const named = [...((documentData as Partial<Invoice>).items || []), ...((documentData as Partial<Bill>).splits || [])];
  const missing = [...new Set(named.map(l => l.itemId).filter((id): id is string => Boolean(id) && !known.has(id as string)))];
  if (!missing.length) return loaded;
  const fetched = await Promise.all(missing.map(async id => {
    const snap = await getDoc(doc(db, 'inventory', id)).catch(() => null);
    return snap?.exists() ? ({ id: snap.id, ...snap.data() } as InventoryItem) : null;
  }));
  return [...loaded, ...fetched.filter((i): i is InventoryItem => i !== null)];
}

/**
 * Send transactions array to Server API endpoint (/api/v1/transactions/bulk) atomically.
 */
/** Documents whose entries the server builds (L94-STEP2, L94-STEP2B): /transactions/bulk takes none of them. */
const SERVER_POSTED = new Set(['invoices', 'bills', 'creditNotes', 'vendorCredits']);

async function sendToServer(
  txs: PostableTransaction[],
  workspaceId: string,
  entityMutation?: EntityMutation,
  context?: LedgerPostContext
) {
  // L-94 step 2: an invoice, bill, credit note or vendor credit is saved or deleted by the server, which builds its
  // entries itself; the lines built here are not sent (they served the checks the browser shows before saving: the
  // closing date, the accounts)
  if (entityMutation && SERVER_POSTED.has(entityMutation.collection)) {
    return postDocumentToServer(workspaceId, entityMutation, context);
  }
  // Ids are chosen here so the entries added to the local store below carry the same ids as the
  // server copies; a quick second edit can then link its reversals to them.
  txs = (txs || []).map(tx => (tx.id ? tx : { ...tx, id: crypto.randomUUID() }));
  const idempotencyKey = context?.idempotencyKey || (txs.length > 0 ? txs[0].id : null) || crypto.randomUUID();
  const data = await runCommand<CommandBody>({
    path: '/api/v1/transactions/bulk',
    method: 'POST',
    // the key is what makes a retried posting one posting; the day is what lets the server's check rebuild
    // it with the same day (L-94)
    headers: { 'Idempotency-Key': idempotencyKey },
    body: { transactions: txs, workspaceId, entityMutation, postingDay: postingToday(context) }
  }) ?? {};

  if (Array.isArray(data.warnings)) data.warnings.forEach((w: unknown) => toast.warning(String(w)));
  showBudgetWarnings(data);

  // INT-2: the server says this save had already happened (an earlier save of the same posting); the
  // entries built here were not written, so they are not added to the local list either
  if (data.replayed) return;
  // AUD-15: the entries as the server wrote them (its ids, owner, checks and stamps), not the ones sent; an answer
  // without that list (a server from before AUD-15, during a deploy) leaves the sent ones as before
  putWrittenEntries(workspaceId, Array.isArray(data.transactions) ? data.transactions as Transaction[] : (txs as unknown as Transaction[]));
}

/**
 * The saved entries go into the screen's list at once (this host runs only in the browser): only while the workspace
 * they were saved in is still open, and by id — an entry the live updates already brought in, or a retried save, is
 * replaced, never shown twice (BUG-05, AUD-15).
 */
function putWrittenEntries(workspaceId: string, written: Transaction[]) {
  if (written.length === 0 || useAuthStore.getState().currentWorkspaceId !== workspaceId) return;
  const store = useLedgerStore.getState();
  const posted = new Set(written.map(tx => tx.id));
  store.setTransactions([...written, ...(store.transactions || []).filter(tx => !posted.has(tx.id))]);
}

/** POST /api/v1/documents/:type/:id/post: the document only; the entries the server wrote go into the screen's list. */
async function postDocumentToServer(workspaceId: string, entityMutation: EntityMutation, context?: LedgerPostContext) {
  // EG-5: an override of the credit limit rides with the invoice from the form; it is sent beside the document, never saved as a field
  const { creditLimitOverride, ...data } = (entityMutation.data || {}) as Record<string, unknown>;
  let answer: { code?: string; error?: string; canOverride?: unknown; warnings?: unknown[]; creditLimitNote?: unknown; replayed?: boolean; transactions?: unknown };
  try {
    answer = await runCommand<typeof answer>({
      path: `/api/v1/documents/${entityMutation.collection}/${encodeURIComponent(entityMutation.docId)}/post`,
      method: 'POST',
      // the key makes a retried save one save
      headers: { 'Idempotency-Key': context?.idempotencyKey || crypto.randomUUID() },
      body: { workspaceId, action: entityMutation.action, ...(entityMutation.action === 'delete' ? {} : { data }), postingDay: postingToday(context), ...(creditLimitOverride ? { creditLimitOverride } : {}) }
    }) ?? {};
  } catch (error) {
    // A credit-limit refusal is a 409 with the overridable fact attached: the screen turns it into "post anyway?".
    const refusal = error instanceof ServerCommandError ? error.body as { code?: string; error?: string; canOverride?: unknown } | null : null;
    if (error instanceof ServerCommandError && error.status === 409 && refusal?.code === 'CREDIT_LIMIT') {
      reportCreditLimitRefusal({ docId: entityMutation.docId, message: String(refusal.error), canOverride: refusal.canOverride === true });
    }
    throw error;
  }
  if (Array.isArray(answer.warnings)) answer.warnings.forEach((w: unknown) => toast.warning(String(w)));
  if (typeof answer.creditLimitNote === 'string') toast.info(answer.creditLimitNote);
  showBudgetWarnings(answer);
  if (answer.replayed) return;
  putWrittenEntries(workspaceId, Array.isArray(answer.transactions) ? answer.transactions as Transaction[] : []);
}

registerPostingHost({
  accounts: () => useLedgerStore.getState().accounts || [],
  transactions: () => useLedgerStore.getState().transactions || [],
  invoices: () => useLedgerStore.getState().invoices || [],
  workspaces: () => useAuthStore.getState().workspaces || [],
  lockDate: () => useLedgerStore.getState().lockDate,
  lockException: () => useLedgerStore.getState().lockException,
  loadInventory: loadInventoryFromStore,
  today: () => getLocalDateISO(),
  uid: () => useAuthStore.getState().user?.uid,
  send: sendToServer,
});
