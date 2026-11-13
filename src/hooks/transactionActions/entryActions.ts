import { recategorizeLines } from '../../lib/accountChoices';
import { identityScope } from '../../lib/serverAction';
import { currentIdentity, useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { Transaction, TransactionLine } from '../../types';
import { toast } from 'sonner';
import { savedInOtherWorkspace, workspaceChangedSince } from '../../lib/saveWorkspace';
import { showBudgetWarnings } from '../../lib/budgetWarnings';
import { getLocalDateISO } from '../../lib/utils';
import { useBillingStore } from '../../modules/billing/BillingService';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import type { ActionContext, TransactionUpdates, TransactionConflictError } from './shared';
import { UNDO_WINDOW_MS, errorMessage, isConflictError } from './shared';
import type { PostingHelpers } from './postingHelpers';
import type { RuleActions } from './ruleActions';
import { ensureTransactionDimensionNodes } from '../../lib/dimensionNodeActions';
import { isDocumentEntry } from '../../lib/transactionEdits';
import { db } from '../../firebase';
import { doc, getDoc } from '../../lib/db/firestore';
import { resolveAccountRole } from '../../lib/accountUtils';

/** One entry or a selection: add, change, void, reverse, duplicate, flag, bulk changes. (F-05, moved from useTransactionActions.) */
/**
 * The time a retried entry was first sent, by operation id. The server compares a retry with the request it
 * already holds for that id; a fresh createdAt would make a lost-reply retry look like a different request (409).
 */
const firstSentAt = new Map<string, string>();

/** Creates single-entry and batch mutation handlers for adding, updating, voiding, reversing, and duplicating transactions. */
export function createEntryActions(ctx: ActionContext, posting: PostingHelpers, rules: RuleActions) {
  const { user, currentWorkspaceId, setTransactions, accounts, setIsSyncing, recordAudit, isPeriodLocked } = ctx;
  const { recordRulePattern, balanceTransactionLines } = posting;
  const { handleAddRule } = rules;

  /**
   * #662: the ledger list's "Reverse transaction" button. A posted entry is never un-posted in place: one typed by
   * hand gets a reversing entry dated today (POST /transactions/:id/reverse), and an entry that belongs to a
   * document (invoice, bill, payment, credit…) is changed through that document, so the document and the books agree.
   */
  const handleVoidTransaction = async (id: string) => {
    const tx = useLedgerStore.getState().transactions.find(t => t.id === id);
    if (!tx) return;
    if (isDocumentEntry(tx)) {
      toast.error('This entry belongs to a document', { description: 'Void or credit the invoice, bill or payment it came from; the entry follows.' });
      return;
    }
    const today = getLocalDateISO();
    if (isPeriodLocked(today)) {
      toast.error('Security alert: This period is locked for historical integrity.');
      return;
    }
    await handleReverseTransaction(id, today, 'Reversed from the ledger list').catch(() => undefined);
  };

  const handleQuickAdd = async (data: Partial<Transaction>, operationId?: string): Promise<boolean> => {
    if (!user || !currentWorkspaceId) return false;
    
    // Core App Feature: Integrity Enforcement
    try {
      if (data.lines) {
        TruthEngine.validateAccountingIntegrity(data.lines.map((l: TransactionLine) => ({
          amount: l.amountCents,
          type: l.amountCents > 0 ? 'debit' : 'credit' // Simple mapping for validation demo
        })));
      }
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }

    // Core App Feature: Billing and Usage limits
    const checkQuota = useBillingStore.getState().checkQuota;
    const incrementTransaction = useBillingStore.getState().incrementTransaction;
    const currentWorkspace = useAuthStore.getState().getCurrentWorkspace();
    const transactions = useLedgerStore.getState().transactions;
    if (!checkQuota(currentWorkspace?.plan, transactions?.length)) {
      toast.error("Usage Limit Reached: Please upgrade your plan to record more transactions.");
      return false;
    }
    
    if (data.date && isPeriodLocked(data.date)) {
      toast.error("Historical freeze active. Cannot inject data into locked periods.");
      return false;
    }
    
    const processedLines = balanceTransactionLines(data.lines || [], data.totalAmountCents || 0);
    const balancedData = {
      ...data,
      lines: processedLines
    };
    // an entry needs two sides; say so here instead of the server's 'Protocol interrupted … 2 lines required'
    if (processedLines.length < 2) {
      toast.error('This entry has no amount or accounts to post. Enter an amount and an account, then save again.');
      return false;
    }

    // Create optimistic ID
    const tempId = operationId || `temp-${crypto.randomUUID().split('-')[0]}`;
    const optimisticTx: Transaction = {
      uid: user.uid,
      workspaceId: currentWorkspaceId,
      status: 'completed',
      type: 'actual',
      createdAt: new Date().toISOString(),
      description: 'New Transaction',
      totalAmountCents: 0,
      currency: 'USD',
      date: getLocalDateISO(),
      ...balancedData,
      // Reuse the exact transaction ID and server idempotency key when a failed/unknown response is retried.
      id: operationId || balancedData.id || tempId,
      lines: balancedData.lines || []
    };

    // Double-Entry Integrity Check
    const balance = optimisticTx.lines?.reduce((sum, l) => sum + (l.amountCents || 0), 0) || 0;
    if (balance !== 0) {
      toast.error("Double-entry violation: Debits and Credits must sum to zero.");
      return false;
    }

    // (A block here used to add four made-up tax rates — "Federal 22%", "State 5%"… — to the
    // workspace the first time an entry fell in a new year; they then showed up as tax codes. L-185)

    // Deferred to ledger integrity stream
    setIsSyncing(true);

    
    const token = await user?.getIdToken();
    let err;
    try {
      const finalTx = {
        ...balancedData,
        id: optimisticTx.id,
        totalAmountCents: Math.round(balancedData.totalAmountCents || 0),
        schemaVersion: '1.1',
        uid: user.uid,
        workspaceId: currentWorkspaceId,
        status: 'completed',
        type: 'actual',
        createdAt: operationId ? firstSentAt.get(operationId) ?? new Date().toISOString() : new Date().toISOString()
      };
      if (operationId) firstSentAt.set(operationId, finalTx.createdAt);
      // Let's preserve the optimistic ID
      finalTx.id = optimisticTx.id;
      
      const res = await fetch('/api/v1/transactions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${token}`,
          'x-operation-id': finalTx.id
        },
        body: JSON.stringify({ transaction: finalTx })
      });
      const answer = await res.json().catch(() => ({}));
      // EG-4: a refusal over the budget comes as { message } (409); an entry posted over it lists budgetWarnings
      if (!res.ok) throw new Error(answer.error || answer.message || 'Failed to save transaction');
      showBudgetWarnings(answer);
      err = null;
    } catch(e) {
      err = e;
    }
    if (!err) {
      if (operationId) firstSentAt.delete(operationId);
      incrementTransaction();
      if (workspaceChangedSince(currentWorkspaceId)) {
        // the reply came after the user opened other books: say where it was saved, not "added" here (PREV-5)
        toast.info(savedInOtherWorkspace('The transaction', currentWorkspaceId));
        return true;
      }
      // learn categorising rules only from an entry the server saved, in the books it was saved in
      if (optimisticTx.description && optimisticTx.lines && optimisticTx.lines.length > 0) {
        optimisticTx.lines.forEach((line) => {
          if (line.accountName && line.accountName !== 'Uncategorized' && line.accountName !== 'Manual Review') {
            const searchDesc = line.description || (optimisticTx.lines.length === 1 ? optimisticTx.description : undefined);
            if (searchDesc) {
              void recordRulePattern(searchDesc, line.accountId || 'unassigned', line.accountName, line.tags, line.dimensions);
            }
          }
        });
      }
      toast.success('Transaction added and certified', {
        duration: UNDO_WINDOW_MS,
        action: {
          label: 'Undo',
          onClick: () => handleVoidTransaction(optimisticTx.id)
        }
      });
    } else {
      // Handled by true sync errors
      toast.error('Failed to add transaction. Protocol interrupted.', { description: errorMessage(err) });
    }
    return !err;
  };

  const handleBulkUpdate = async (ids: string[], updates: TransactionUpdates) => {
    if (!user || !currentWorkspaceId || !ids || ids.length === 0) return;
    
    setIsSyncing(true);
    const loader = toast.loading(`Synchronizing ${ids.length} updates...`);

    try {
      const oldStates = new Map<string, Transaction>();
      const currentTransactions = useLedgerStore.getState().transactions;
      const updatesMap = new Map<string, TransactionUpdates>();
      const skipped: string[] = [];

      const targetAccount = accounts.find(a => 
        (updates.accountId && a.id === updates.accountId) || 
        (updates.accountName && a.name === updates.accountName)
      );
      // EU-E2: a label value typed for the first time is added to the label once, before the entries change
      if (updates.labels) updates = { ...updates, labels: (await ensureTransactionDimensionNodes({ dimensions: updates.labels })).dimensions || updates.labels };
      const accId = targetAccount?.id || updates.accountId;
      const accName = targetAccount?.name || updates.accountName;
      const projId = updates.project || updates.projectId;

      for (const id of ids) {
        const tx = currentTransactions.find(t => t.id === id);
        if (tx) {
          oldStates.set(id, { ...tx });

          const updateData: TransactionUpdates = {
            updatedAt: new Date().toISOString()
          };

          if (updates.isLocked !== undefined) updateData.isLocked = updates.isLocked;
          if (updates.status !== undefined) updateData.status = updates.status;
          if (updates.category !== undefined) updateData['dimensions.category'] = updates.category;
          if (projId !== undefined) {
            updateData['dimensions.project'] = projId;
            updateData.projectId = projId;
          }

          // Lines: bank/cash lines keep their account; transfers and journal entries are skipped (K-06)
          if (accId !== undefined || accName !== undefined || projId !== undefined) {
            const existingLines = tx.lines && tx.lines.length > 0 ? tx.lines : [];
            if (existingLines.length > 0) {
              const newLines = recategorizeLines(existingLines, accounts, {
                ...(accId !== undefined ? { accountId: accId } : {}),
                ...(accName !== undefined ? { accountName: accName } : {}),
                ...(projId !== undefined ? { project: projId } : {}),
              });
              if (!newLines) { skipped.push(tx.description || id); oldStates.delete(id); continue; }
              updateData.lines = newLines;
            } else if (tx.totalAmountCents) {
              // Balance from scratch if previously unlined
              updateData.lines = balanceTransactionLines([], tx.totalAmountCents);
            }
          }

          // EU-E2: "Set label" on the selection — the entry and its category lines; money in or out of the bank keeps its own
          if (updates.labels && Object.keys(updates.labels).length) {
            const withLabels = (d?: Record<string, string>) => ({ ...(d || {}), ...updates.labels });
            const isBank = (accountId?: string) => {
              const account = accounts.find(a => a.id === accountId);
              return account ? resolveAccountRole(account) === 'cash' : false;
            };
            updateData.dimensions = withLabels(tx.dimensions);
            updateData.lines = (updateData.lines || tx.lines || []).map(l => (isBank(l.accountId) ? l : { ...l, dimensions: withLabels(l.dimensions) }));
          }

          updatesMap.set(id, updateData);
        }
      }

      const updatesPayload: { id: string; data: Partial<Transaction> }[] = [];
      for (const id of ids) {
        const u = updatesMap.get(id);
        if (u) {
          updatesPayload.push({ id, data: u });
        }
      }

      if (updatesPayload.length > 0) {
        const token = await user.getIdToken();
        const res = await fetch('/api/v1/transactions/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            workspaceId: currentWorkspaceId,
            updates: updatesPayload
          })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Server rejected batch updates');
        }
      }

      // Update local state atomically
      useLedgerStore.setState(state => ({
        transactions: state.transactions.map(t => {
          const u = updatesMap.get(t.id);
          if (!u) return t;
          const merged = { ...t, ...u };
          if (u['dimensions.category'] !== undefined || u['dimensions.project'] !== undefined) {
            merged.dimensions = {
              ...merged.dimensions, // EU-E2: labels set in the same update stay
              ...(u['dimensions.category'] !== undefined ? { category: u['dimensions.category'] } : {}),
              ...(u['dimensions.project'] !== undefined ? { project: u['dimensions.project'] } : {})
            };
          }
          return merged;
        })
      }));
      
      toast.success(`Updated ${updatesMap.size} transaction${updatesMap.size === 1 ? '' : 's'}${skipped.length ? `; ${skipped.length} transfer or journal entr${skipped.length === 1 ? 'y' : 'ies'} left as they were (change those one by one)` : ''}.`, { 
        id: loader,
        action: {
          label: 'Undo',
          onClick: async () => {
            const undoLoader = toast.loading('Reverting bulk updates...');
            try {
              const undoPayload: { id: string; data: Partial<Transaction> }[] = [];
              for (const id of ids) {
                const oldState = oldStates.get(id);
                const forward = updatesMap.get(id);
                if (oldState && forward) {
                  // only what the update wrote, back to its old value: the batch route refuses every other key
                  // (identity, date, totals), and a label map the entry did not have goes back to empty
                  const data: Record<string, unknown> = {};
                  for (const key of Object.keys(forward)) {
                    if (key === 'updatedAt') data[key] = new Date().toISOString(); // the undo is a change of its own
                    else if (key.startsWith('dimensions.')) data[key] = oldState.dimensions?.[key.slice('dimensions.'.length)] ?? null;
                    else if (key === 'dimensions') data[key] = oldState.dimensions ?? {};
                    // an entry that had no lines keeps the balanced lines it was given: the route needs two or more
                    else if (key === 'lines') { if ((oldState.lines?.length ?? 0) >= 2) data[key] = oldState.lines; }
                    else data[key] = (oldState as unknown as Record<string, unknown>)[key] ?? null;
                  }
                  undoPayload.push({ id, data: data as Partial<Transaction> });
                }
              }
              if (undoPayload.length > 0) {
                const token = await user.getIdToken();
                const res = await fetch('/api/v1/transactions/batch', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                  },
                  body: JSON.stringify({
                    workspaceId: currentWorkspaceId,
                    updates: undoPayload
                  })
                });
                if (!res.ok) {
                  const errData = await res.json().catch(() => ({}));
                  throw new Error(errData.error || 'Server rejected undo batch updates');
                }
              }
              // Revert store state
              useLedgerStore.setState(state => ({
                transactions: state.transactions.map(t => oldStates.get(t.id) || t)
              }));
              toast.success('Bulk update reverted.', { id: undoLoader });
            } catch {
              toast.error('Failed to revert bulk update.', { id: undoLoader });
            }
          }
        }
      });
    } catch (error) {
      console.error('Bulk update error:', error);
      const message = errorMessage(error) || 'Unknown network error';
      toast.error('Could not complete bulk update.', { 
        id: loader,
        description: `Sequence aborted. (${message})`
      });
      throw error;
    } finally {
      setIsSyncing(false);
    }
  };

  const handleToggleFlag = async (id: string) => {
    const scope = identityScope(currentIdentity, () => useAuthStore.getState().currentWorkspaceId);
    const tx = useLedgerStore.getState().transactions.find(t => t.id === id);
    if (!tx) return;
    const nextFlagged = !tx.isFlagged;
    const res = await fetch(`/api/v1/transactions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await user?.getIdToken()}` },
      body: JSON.stringify({
        partialUpdate: { isFlagged: nextFlagged },
        expectedUpdatedAt: tx.updatedAt,
      }),
    });
    if (!scope.isCurrent()) return;
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (!scope.isCurrent()) return;
      toast.error(body?.error || 'Could not update transaction flag');
      return;
    }
    const body = await res.json().catch(() => null);
    if (!scope.isCurrent()) return;
    // The partial-update API currently omits the server-owned updatedAt. Read the
    // committed row if realtime has not already advanced our cache, so the next
    // flag toggle or journal edit never sends a stale version immediately after this write.
    let persistedUpdatedAt: string | undefined = body?.data?.updatedAt;
    let persistedFlag = nextFlagged;
    if (!persistedUpdatedAt &&
        useLedgerStore.getState().transactions.find(t => t.id === id)?.updatedAt === tx.updatedAt) {
      try {
        const fresh = await getDoc(doc(db, 'transactions', id));
        if (!scope.isCurrent()) return;
        const record = fresh.data();
        if (fresh.exists() && record?.workspaceId === currentWorkspaceId) {
          if (typeof record.updatedAt === 'string') persistedUpdatedAt = record.updatedAt;
          if (typeof record.isFlagged === 'boolean') persistedFlag = record.isFlagged;
        }
      } catch (error) {
        // A realtime event may still bring the authoritative version; never
        // fabricate a timestamp or roll back a confirmed server flag change.
        console.warn('Unable to refresh flag version after update:', error);
      }
    }
    if (!scope.isCurrent()) return;
    setTransactions(
      useLedgerStore.getState().transactions.map(t => {
        if (t.id !== id) return t;
        const newerInStore = persistedUpdatedAt && t.updatedAt &&
          Number.isFinite(Date.parse(t.updatedAt)) &&
          Date.parse(t.updatedAt) > Date.parse(persistedUpdatedAt);
        return {
          ...t,
          isFlagged: newerInStore ? t.isFlagged : persistedFlag,
          ...(persistedUpdatedAt && !newerInStore ? { updatedAt: persistedUpdatedAt } : {}),
        };
      }),
    );
    toast.info(tx.isFlagged ? 'Transaction flag removed' : 'Transaction flagged for review');
  };

  const handleDuplicateTransaction = async (id: string) => {
    const tx = useLedgerStore.getState().transactions.find(t => t.id === id);
    if (!tx) return;

    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      verification: _verification,
      invoiceId: _invoiceId,
      billId: _billId,
      paymentId: _paymentId,
      creditNoteId: _creditNoteId,
      vendorCreditId: _vendorCreditId,
      depositId: _depositId,
      payRunId: _payRunId,
      estimateId: _estimateId,
      expenseId: _expenseId,
      purchaseOrderId: _purchaseOrderId,
      reconciled: _reconciled,
      isReconciled: _isReconciled,
      reconciledAt: _reconciledAt,
      reconciledBankLineId: _reconciledBankLineId,
      isCleared: _isCleared,
      clearedAt: _clearedAt,
      reversalOf: _reversalOf,
      reversalEventId: _reversalEventId,
      deletedAt: _deletedAt,
      voidedAt: _voidedAt,
      voidedReason: _voidedReason,
      metadata: _metadata,
      ...txData
    } = tx as Transaction & Record<string, unknown>;
    const cleanLines = tx.lines?.map(({ id: _lineId, baseAmountCents: _base, ...line }) => ({ ...line }));
    const ok = await handleQuickAdd({
      ...(txData as Partial<Transaction>),
      ...(cleanLines ? { lines: cleanLines } : {}),
      status: tx.status === 'reconciled' || tx.status === 'void' ? 'completed' : tx.status,
      type: tx.type === 'reversal' ? 'actual' : tx.type,
      description: `${tx.description || 'Transaction'} (Copy)`,
      date: getLocalDateISO(),
    });
    if (ok) toast.success('Transaction duplicated');
  };

  /** Optimistically applies transaction edits, registers any new dimension labels, and persists with workspace-scoped rollback on failure. */
  const handleUpdateTransaction = async (id: string, updates: Partial<Transaction>): Promise<boolean> => {
    if (!user || !currentWorkspaceId) return false;
    // #107: a reply for this workspace never changes another workspace's list
    const scope = identityScope(currentIdentity, () => useAuthStore.getState().currentWorkspaceId);
    
    const originalTransactions = [...useLedgerStore.getState().transactions];
    const txIndex = originalTransactions.findIndex(t => t.id === id);
    if (txIndex === -1) return false;

    const tx = originalTransactions[txIndex];
    if (updates.date && isPeriodLocked(updates.date)) {
      toast.error("Period freeze active. Modification blocked.");
      return false;
    }

    // Double-Entry Integrity Check for updates
    if (updates.lines) {
      const balance = updates.lines.reduce((sum, l) => sum + (l.amountCents || 0), 0) || 0;
      if (balance !== 0) {
        toast.error("Double-entry violation: Modified lines are unbalanced.");
        return false;
      }
    }

    // Optimistic Update
    const updatedVerification = tx.verification ? {
      ...tx.verification,
      status: 'unverified' as const,
      timestamp: new Date().toISOString()
    } : undefined;

    const updatedTx = { 
      ...tx, 
      ...updates, 
      ...(updatedVerification ? { verification: updatedVerification } : {}),
      updatedAt: new Date().toISOString() 
    };
    const nextTransactions = [...originalTransactions];
    nextTransactions[txIndex] = updatedTx as Transaction;
    setTransactions(nextTransactions);
    setIsSyncing(true);

    try {
      const prevUpdates = updates;
      updates = await ensureTransactionDimensionNodes(updates);
      if (!scope.isCurrent()) return false;
      if (updates !== prevUpdates) {
        const latest = [...useLedgerStore.getState().transactions];
        const idx = latest.findIndex(t => t.id === id);
        if (idx !== -1) {
          latest[idx] = { ...latest[idx], ...updates } as Transaction;
          setTransactions(latest);
        }
      }
      const token = await user?.getIdToken();
      const expectedUpdatedAt = tx.updatedAt;
      const payload = {
        ...tx,
        ...updates,
        ...(updatedVerification ? { verification: updatedVerification } : {}),
        updatedAt: new Date().toISOString()
      };
      const res = await fetch(`/api/v1/transactions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ transaction: payload, expectedUpdatedAt })
      });
      if (!res.ok) {
         const data = await res.json();
         if (res.status === 409 || data.error === 'version_conflict') {
           const err: TransactionConflictError = new Error(data.message || 'This transaction was modified by another user.');
           err.isConflict = true;
           err.currentTransaction = data.currentTransaction;
           throw err;
         }
         throw new Error(data.error || 'Failed to update transaction');
      }
      const savedBody = await res.json().catch(() => null);
      const serverUpdatedAt = savedBody?.data?.updatedAt;
      if (serverUpdatedAt && scope.isCurrent()) {
        setTransactions(
          useLedgerStore.getState().transactions.map(t =>
            t.id === id ? { ...t, updatedAt: serverUpdatedAt } : t,
          ),
        );
      }
    } catch(e) {
      if (!scope.isCurrent()) return false;
      if (isConflictError(e)) {
        toast.error('Version conflict: Transaction modified by another user.', {
          description: 'Your changes were not saved to prevent overwriting someone else\'s updates. Loaded latest version.'
        });
        if (e.currentTransaction) {
          const currentTxs = [...useLedgerStore.getState().transactions];
          const idx = currentTxs.findIndex(t => t.id === id);
          if (idx !== -1) {
            currentTxs[idx] = e.currentTransaction;
            setTransactions(currentTxs);
          }
          return false;
        }
      } else {
        const message = errorMessage(e) || 'Unknown network error';
        toast.error('Could not save your changes.', {
          description: `Please try again. (${message})`
        });
      }
      // roll back only this entry, in the list as it is now (other changes made meanwhile stay)
      setTransactions(useLedgerStore.getState().transactions.map(t => (t.id === id ? tx : t)));
      return false;
    }
    if (!scope.isCurrent()) return true;

    await recordAudit('UPDATE_TRANSACTION', 'transaction', id, updates);
      
      toast.success('Transaction updated', {
        action: {
          label: 'Undo',
          onClick: () => {
            const { updatedAt: _staleUpdatedAt, ...undoSnapshot } = tx;
            void handleUpdateTransaction(id, undoSnapshot);
          }
        }
      });

      // --- Persistent Rule Learning ---
      // If user manually updated the category, check if we should suggest a permanent rule
      if (updates.lines && Array.isArray(updates.lines) && updates.lines.length > 0) {
        const { autoRules } = useLedgerStore.getState();
        const mainLine = updates.lines[0];
        const description = tx.description;
        
        // Push to autonomous cache for immediate "soft" learning across all lines
        updates.lines.forEach((line) => {
          if (line.accountName && line.accountName !== 'Uncategorized' && line.accountName !== 'Manual Review') {
            const searchDesc = line.description || (updates.lines?.length === 1 ? description : undefined);
            if (searchDesc && line.accountId) {
              void recordRulePattern(searchDesc, line.accountId, line.accountName, line.tags, line.dimensions);
            }
          }
        });
        
        const existingRule = Array.isArray(autoRules) ? autoRules.find(r => 
          r.condition.descriptionContains?.toLowerCase() === (description || '').toLowerCase() ||
          r.condition.vendor?.toLowerCase() === (description || '').toLowerCase()
        ) : null;

        if (!existingRule && mainLine.accountName && mainLine.accountName !== 'Uncategorized') {
          toast("Pattern detected", {
            description: `Should I always categorize "${description}" as ${mainLine.accountName}?`,
            action: {
              label: "Create Rule",
              onClick: () => handleAddRule({
                condition: { descriptionContains: description },
                action: { 
                  targetNodeId: mainLine.accountId,
                  targetCategory: mainLine.accountName
                },
                confidence: 1.0,
                isHardened: true
              })
            }
          });
        }
      }
      // -------------------------------
      return true;
  };

  const handleReverseTransaction = async (
    id: string,
    reversalDate: string,
    reason: string,
    replacement?: Partial<Transaction>
  ) => {
    if (!user || !currentWorkspaceId) return null;
    const loader = toast.loading('Executing reverse & correct...');
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/v1/transactions/${id}/reverse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          reversalDate,
          reason,
          replacement,
          workspaceId: currentWorkspaceId
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || 'Failed to reverse transaction');
      }

      const data = await res.json();
      const store = useLedgerStore.getState();
      const currentTxs = store.transactions;
      const updatedTxs = currentTxs.map(t => t.id === id ? { ...t, reversalEventId: data.reversal?.id || 'reversed' } : t);

      const toAdd: Transaction[] = [];
      if (data.reversal) toAdd.push(data.reversal);
      if (data.replacement) toAdd.push(data.replacement);

      store.setTransactions([...toAdd, ...updatedTxs]);

      await recordAudit('TRANSACTION_REVERSED', 'transaction', id, {
        reversalId: data.reversal?.id,
        replacementId: data.replacement?.id,
        reason
      });

      toast.success(replacement ? 'Transaction reversed & corrected successfully' : 'Transaction reversed successfully', { id: loader });
      return data;
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to reverse transaction', { id: loader });
      throw err;
    }
  };

  return { handleVoidTransaction, handleQuickAdd, handleBulkUpdate, handleToggleFlag, handleDuplicateTransaction, handleUpdateTransaction, handleReverseTransaction };
}

export type EntryActions = ReturnType<typeof createEntryActions>;
