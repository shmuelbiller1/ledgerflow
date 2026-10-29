import { resolveAccountRole } from '../../lib/accountUtils';
import { isPostable, lineAmount } from '../../lib/txFilters';
import { collection, doc } from '../../lib/db/firestore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { db } from '../../firebase';
import { Transaction, BankStatementLine } from '../../types';
import { toast } from 'sonner';
import { parseLocalDate } from '../../lib/utils';
import { findGlobalOptimalMatch, MinHash, jaroWinklerSimilarity } from '../../lib/algorithms';
import { handleFirestoreError, OperationType } from '../../lib/firebaseUtils';
import type { ActionContext, ReconcileOperation } from './shared';
import { errorMessage } from './shared';
import type { PostingHelpers } from './postingHelpers';
import { reconcileCreateDefaults, type ReconcileCreateChoice } from '../../lib/bankRules';

/** Bank reconciliation: match, ignore, create from a bank line, undo, automatic matching. (F-05, moved from useTransactionActions.) */
export function createReconcileActions(ctx: ActionContext, posting: PostingHelpers) {
  const { user, currentWorkspaceId, accounts, setIsSyncing } = ctx;
  const { balanceTransactionLines } = posting;

  const handleReconcileMatch = async (bankLineId: string, transactionId: string) => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/v1/transactions/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await user?.getIdToken()}` },
        body: JSON.stringify({ workspaceId: currentWorkspaceId, operations: [
          { type: 'updateBankLine', id: bankLineId, data: { status: 'matched', matchedTransactionId: transactionId } },
          { type: 'updateTransaction', id: transactionId, data: { status: 'reconciled' } }
        ]})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error on match');
      toast.success('Match saved.');
    } catch (error) {
      toast.error('Could not save the match: ' + (errorMessage(error) || 'Network error'));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleReconcileIgnore = async (bankLineId: string) => {
    if (!user || !currentWorkspaceId) return;
    setIsSyncing(true);
    try {
      const res = await fetch('/api/v1/transactions/reconcile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await user?.getIdToken()}` },
          body: JSON.stringify({ 
            workspaceId: currentWorkspaceId, 
            operations: [{ type: 'updateBankLine', id: bankLineId, data: { status: 'ignored' } }] 
          })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error on ignore');
      toast.info('Item ignored');
    } catch (error) {
      toast.error('Action failed: ' + (errorMessage(error) || 'Network error'));
    } finally {
      setIsSyncing(false);
    }
  };

  /**
   * Create an entry from a bank line. EG-9: the bank rules' suggestion stored on the line (account,
   * contact, labels) is the starting point; `choice` is what the person kept or changed on screen.
   */
  const handleReconcileCreate = async (bankLine: BankStatementLine, choice: ReconcileCreateChoice = {}) => {
    if (!user || !currentWorkspaceId) return;
    setIsSyncing(true);
    try {
      const txId = doc(collection(db, 'transactions')).id;
      const prefill = reconcileCreateDefaults(bankLine, accounts);
      // what the person sent wins, also a field they cleared; the account falls back to the pre-filled one
      const chosen: ReconcileCreateChoice = { ...prefill, ...choice, accountId: choice.accountId || prefill.accountId };
      const target = accounts.find(a => a.id === chosen.accountId);
      if (!target) throw new Error('No expense account is available for the new entry.');
      const tags = chosen.tags && chosen.tags.length ? chosen.tags : undefined;
      const dimensions = chosen.dimensions && Object.keys(chosen.dimensions).length ? chosen.dimensions : undefined;

      const rawLines = [{ accountId: target.id, accountName: target.name || 'General Expense', amountCents: bankLine.amountCents, ...(tags ? { tags } : {}), ...(dimensions ? { dimensions } : {}) }];
      const balancedLines = balanceTransactionLines(rawLines, bankLine.amountCents);
      const ruleIds = bankLine.suggestion?.ruleIds;
      const metadata = {
        ...(chosen.contactId ? { contactId: chosen.contactId, ...(chosen.contactKind ? { contactKind: chosen.contactKind } : {}) } : {}),
        ...(ruleIds?.length ? { suggestedByRules: ruleIds } : {}),
      };

      const txData = {
        id: txId,
        uid: user.uid,
        workspaceId: currentWorkspaceId,
        date: bankLine.date,
        description: bankLine.description,
        totalAmountCents: Math.abs(bankLine.amountCents),
        status: 'reconciled',
        type: 'actual',
        createdAt: new Date().toISOString(),
        lines: balancedLines,
        ...(tags ? { tags } : {}),
        ...(chosen.contactName ? { payee: chosen.contactName } : {}),
        ...(Object.keys(metadata).length ? { metadata } : {}),
      };

      const res = await fetch('/api/v1/transactions/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await user?.getIdToken()}` },
        body: JSON.stringify({ workspaceId: currentWorkspaceId, operations: [
          { type: 'createTransaction', id: txId, data: txData },
          { type: 'updateBankLine', id: bankLine.id, data: { status: 'matched', matchedTransactionId: txId } }
        ]})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create the entry');
      toast.success('Entry created and matched.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'bankLines/create');
      toast.error('Could not create the entry: ' + (errorMessage(error) || 'Network error'));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleReconcileUndo = async (bankLineId: string, transactionId?: string) => {
    setIsSyncing(true);
    try {
      const operations: ReconcileOperation[] = [{ type: 'updateBankLine', id: bankLineId, data: { status: 'pending', matchedTransactionId: null } }];
      if (transactionId) {
         operations.push({ type: 'updateTransaction', id: transactionId, data: { status: 'completed' } });
      }
      const res = await fetch('/api/v1/transactions/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await user?.getIdToken()}` },
        body: JSON.stringify({ workspaceId: currentWorkspaceId, operations })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Could not undo the match');
      }
      toast.success('Match undone. The line is back in To review.');
    } catch {
      toast.error('Failed to undo match.');
    } finally {
      setIsSyncing(false);
    }
  };

  /**
   * Matches pending bank lines to open entries with confident scores. It works on the lines and
   * entries shown on the screen (the account filter applies); without them, on everything loaded.
   * It used to reload both from the database filtered to the signed-in person's own records, so
   * lines imported by the server or a teammate were never matched (L-175).
   */
  const handleAutoReconcile = async (scope?: { bankLines: BankStatementLine[]; transactions: Transaction[] }) => {
    if (!user || !currentWorkspaceId) return;
    setIsSyncing(true);
    const loader = toast.loading('Auto-matching…');
    
    try {
      const loaded = useLedgerStore.getState();
      // a line in another currency waits for a person: its amount is not in the books' currency (AF-001)
      const home = (useAuthStore.getState().workspaces.find(w => w.id === currentWorkspaceId) as { currency?: string } | undefined)?.currency || 'USD';
      const bankLines = (scope?.bankLines ?? loaded.bankLines ?? []).filter(l => l.status === 'pending'
        && (!(l as { currency?: string }).currency || String((l as { currency?: string }).currency).toUpperCase() === home.toUpperCase()));
      const transactions = (scope?.transactions ?? loaded.transactions ?? [])
        .filter(t => t.status !== 'reconciled' && t.status !== 'void');
      
      const minHash = new MinHash(64, user?.uid);
      let matchCount = 0;

      // Pre-calculate signatures for transactions
      const txSignatures = transactions.map(tx => ({
        id: tx.id,
        sig: minHash.createSignature(`${tx.description} ${tx.totalAmountCents}`)
      }));

      // 1. Calculate Score Matrix for all possible pairs
      const sourceItems = bankLines.map(bl => {
        const scoreMap = new Map<string, number>();
        const blSig = minHash.createSignature(`${bl.description} ${bl.amountCents}`);
        const blDescClean = (bl.description || '').toLowerCase().replace(/[^a-z0-9 \u0590-\u05FF]/g, '').trim();
        
        transactions.filter(isPostable).forEach((tx, idx) => {
          // Check sign direction:
          const cashLines = tx.lines?.filter(l => {
            const acc = accounts.find(a => a.id === l.accountId);
            return acc && resolveAccountRole(acc) === 'cash';
          }) || [];
          const cashDelta = cashLines.reduce((s, l) => s + lineAmount(l, tx), 0);

          // If transaction has explicit cash lines, cash movement direction MUST match bank line sign!
          if (cashDelta !== 0 && Math.sign(cashDelta) !== Math.sign(bl.amountCents)) {
            return; // Skip incompatible cash directions
          }

          let score = 0;
          
          // Amount Match
          const tTotal = Math.round(Math.abs(tx.totalAmountCents || 0) * (tx.exchangeRate || 1));
          if (Math.abs(bl.amountCents) === tTotal) {
            score += 65;
          }

          // Date Proximity
          const bDate = parseLocalDate(bl.date).getTime();
          const tDate = parseLocalDate(tx.date).getTime();
          const dayDiff = Math.abs(bDate - tDate) / (1000 * 60 * 60 * 24);
          if (dayDiff <= 7) score += (7 - dayDiff) * 3;

          // Description Similarity (Hybrid: MinHash + Jaro-Winkler)
          const txDescClean = (tx.description || '').toLowerCase().replace(/[^a-z0-9 \u0590-\u05FF]/g, '').trim();
          const similarityMinHash = minHash.compare(blSig, txSignatures[idx].sig);
          const similarityJW = jaroWinklerSimilarity(blDescClean, txDescClean, user?.uid);
          
          const combinedSimilarity = (similarityMinHash * 0.3) + (similarityJW * 0.7);
          
          if (combinedSimilarity > 0.3) {
             score += combinedSimilarity * 45;
          }

          // Require a minimum combined similarity threshold (0.35) or higher score to prevent false amount-only matches
          if (score >= 75 && (combinedSimilarity >= 0.35 || dayDiff <= 2)) {
            scoreMap.set(tx.id, score);
          }
        });

        return { id: bl.id, scoreMap };
      });

      // 2. Resolve via Global Optimum Algorithm
      const relevantTargets = new Set<string>();
      sourceItems.forEach(item => {
        for (const key of item.scoreMap.keys()) relevantTargets.add(key);
      });
      const targetIds = Array.from(relevantTargets);
      
      const optimalMatches = findGlobalOptimalMatch(sourceItems, targetIds);
      const batchReconcile: ReconcileOperation[] = [];

      // 3. Apply Matches
      optimalMatches.forEach((txId, blId) => {
        batchReconcile.push(
          { type: 'updateBankLine', id: blId, data: { status: 'matched', matchedTransactionId: txId } },
          { type: 'updateTransaction', id: txId, data: { status: 'reconciled' } }
        );
        matchCount++;
      });

      if (batchReconcile.length > 0) {
         const res = await fetch('/api/v1/transactions/reconcile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await user?.getIdToken()}` },
            body: JSON.stringify({ workspaceId: currentWorkspaceId, operations: batchReconcile })
         });
         const data = await res.json();
         if (!res.ok) throw new Error(data.error || 'Server rejected auto-reconcile operations');
      }

      if (matchCount > 0) {
        toast.success(`Automatic matching complete. ${matchCount} matches applied.`, { id: loader });
      } else {
        toast.info('No confident matches found.', { id: loader });
      }
    } catch (error) {
      toast.error('Could not finish automatic matching: ' + (errorMessage(error) || 'Error occurred'), { id: loader });
    } finally {
      setIsSyncing(false);
    }
  };

  return { handleReconcileMatch, handleReconcileIgnore, handleReconcileCreate, handleReconcileUndo, handleAutoReconcile };
}

export type ReconcileActions = ReturnType<typeof createReconcileActions>;
