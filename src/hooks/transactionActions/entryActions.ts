import { recategorizeLines } from '../../lib/accountChoices';
import { identityScope } from '../../lib/serverAction';
import { currentIdentity, useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { Transaction, TransactionLine } from '../../types';
import { toast } from 'sonner';
import { savedInOtherWorkspace, workspaceChangedSince } from '../../lib/saveWorkspace';
import { showBudgetWarnings } from '../../lib/budgetWarnings';
import { safeAsync, getLocalDateISO } from '../../lib/utils';
import { OperationType } from '../../lib/firebaseUtils';
import { useBillingStore } from '../../modules/billing/BillingService';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import type { ActionContext, TransactionUpdates, TransactionConflictError } from './shared';
import { UNDO_WINDOW_MS, errorMessage, isConflictError } from './shared';
import type { PostingHelpers } from './postingHelpers';
import type { RuleActions } from './ruleActions';

/** One entry or a selection: add, change, void, reverse, duplicate, flag, bulk changes. (F-05, moved from useTransactionActions.) */
export function createEntryActions(ctx: ActionContext, posting: PostingHelpers, rules: RuleActions) {
  const { user, currentWorkspaceId, setTransactions, accounts, setIsSyncing, recordAudit, isPeriodLocked } = ctx;
  const { recordRulePattern, balanceTransactionLines } = posting;
  const { handleAddRule } = rules;

  const handleVoidTransaction = async (id: string) => {
    const originalTransactions = useLedgerStore.getState().transactions;
    const tx = originalTransactions.find(t => t.id === id);
    if (!tx) return;

    if (isPeriodLocked(tx.date)) {
      toast.error("Security alert: This period is locked for historical integrity.");
      return;
    }

    const [, err] = await safeAsync(
      fetch(`/api/v1/transactions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await user?.getIdToken()}` },
      body: JSON.stringify({ partialUpdate: { status: 'failed', deletedAt: new Date().toISOString() } })
    }),
      OperationType.UPDATE,
      `transactions/${id}`,
      { action: 'VOID_TRANSACTION' }
    );

    if (!err) {
      await recordAudit('VOID_TRANSACTION', 'transaction', id, { description: tx.description });
      toast.success('Transaction voided', {
        duration: UNDO_WINDOW_MS, // I-09: time to change your mind
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              const token = await user?.getIdToken();
              const res = await fetch(`/api/v1/transactions/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ transaction: { ...tx, status: tx.status, deletedAt: tx.deletedAt || null, updatedAt: new Date().toISOString() } })
              });
              if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
              toast.success('Transaction restored');
            } catch (err) {
              // the undo used to fail silently
              toast.error('Could not undo the void', { description: err instanceof Error ? err.message : String(err) });
            }
          }
        }
      });
    } else {
      // No optimistic update rollback needed
      const message = err?.error || 'Unknown network error';
      toast.error('Could not void transaction.', {
        description: `Please try again. (${message})`
      });
      throw err;
    }
  };

  /** Resolves `true` only when the server saved the entry (callers show success on that, #105). */
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
        createdAt: new Date().toISOString()
      };
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
              recordRulePattern(searchDesc, line.accountId || 'unassigned', line.accountName, line.tags, line.dimensions);
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
              ...t.dimensions,
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
                if (oldState) {
                  undoPayload.push({ id, data: oldState });
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
    const tx = useLedgerStore.getState().transactions.find(t => t.id === id);
    if (!tx) return;
    
    await fetch(`/api/v1/transactions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await user?.getIdToken()}` },
      body: JSON.stringify({ partialUpdate: { isFlagged: !tx.isFlagged, updatedAt: new Date().toISOString() } })
    });
    toast.info(tx.isFlagged ? 'Transaction flag removed' : 'Transaction flagged for review');
  };

  const handleDuplicateTransaction = async (id: string) => {
    const tx = useLedgerStore.getState().transactions.find(t => t.id === id);
    if (!tx) return;

    const { id: _, createdAt: __, verification: ___, ...txData } = tx;
    await handleQuickAdd({ 
      ...txData,
      description: `${txData.description} (Copy)`,
      date: getLocalDateISO()
    });
    toast.success('Transaction duplicated');
  };

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

    
    const token = await user?.getIdToken();
    try {
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
          onClick: () => handleUpdateTransaction(id, tx)
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
              recordRulePattern(searchDesc, line.accountId, line.accountName, line.tags, line.dimensions);
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
