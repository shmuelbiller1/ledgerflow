import { runCommand } from '../../lib/runCommand';
import { isPostable } from '../../lib/txFilters';
import { collection, getDocs, query, where } from '../../lib/db/firestore';
import { db } from '../../firebase';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { Transaction } from '../../types';
import { toast } from 'sonner';
import { parseLocalDate } from '../../lib/utils';
import { DoubleEntryAuditor } from '../../services/auditor';
import { kMeans } from '../../lib/algorithms';
import type { ActionContext } from './shared';
import { errorMessage } from './shared';

/** Integrity tools: repair the chain, and group uncategorised entries (clusters). (F-05, moved from useTransactionActions.) */
export function createIntegrityActions(ctx: ActionContext) {
  const { user, currentWorkspaceId } = ctx;

  const handleBulkRepair = async (repairedTxs: Transaction[]) => {
    if (!user || !currentWorkspaceId) return;
    const loader = toast.loading('Synchronizing re-serialized chain...');
    
    try {
      const batchRepair = repairedTxs.map(tx => ({ id: tx.id, data: { verification: tx.verification } }));
      if (batchRepair.length > 0) {
         // one call, one place that reads the answer: `runCommand` throws with the server's own words
         // instead of a fixed sentence, so a refusal says why
         await runCommand({
            path: '/api/v1/transactions/batch',
            method: 'POST',
            body: { workspaceId: currentWorkspaceId, updates: batchRepair }
         });
      }
      toast.success('Ledger chain cryptographically certified.', { id: loader });
    } catch (error) {
      toast.error('Sync failed: ' + (errorMessage(error) || 'Network error'), { id: loader });
    }
  };

  const handleIntegrityAction = async (action: string, _details?: unknown) => {
    if (!user || !currentWorkspaceId) return;

    if (action === 'repair-chain') {
      const q = query(
        collection(db, 'transactions'), 
        where('workspaceId', '==', currentWorkspaceId),
        where('uid', '==', user.uid)
      );
      const snap = await getDocs(q);
      const txs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));
      const repaired = DoubleEntryAuditor.repairChain(txs);
      await handleBulkRepair(repaired);
    } else if (action === 'prune-range') {
      toast.info('Analyzing orphaned nodes...');
    }
  };

  const handleSmartCluster = async () => {
    if (!user || !currentWorkspaceId) return;
    const loader = toast.loading('Calculating transaction clusters...');
    try {
      const txs = (useLedgerStore.getState().transactions || []).filter(isPostable);
      const uncategorized = txs.filter(t => t.lines?.[0]?.accountId === 'uncategorized');
      
      if (uncategorized.length < 5) {
        toast.info('Insufficient data for statistical clustering.', { id: loader });
        return;
      }

      // Feature Engineering: Normalized Amount and Normalized Time
      const maxAmount = txs.reduce((max, t) => {
        const amt = Math.abs(Math.round((t.totalAmountCents || 0) * (t.exchangeRate || 1)));
        return amt > max ? amt : max;
      }, 0);
      
      const minTime = txs.reduce((min, t) => {
        const time = parseLocalDate(t.date).getTime();
        return time < min ? time : min;
      }, Infinity);
      
      const maxTime = txs.reduce((max, t) => {
        const time = parseLocalDate(t.date).getTime();
        return time > max ? time : max;
      }, 0);
      
      const timeRange = maxTime - minTime || 1;

      const clusterData = uncategorized.map(t => ({
        id: t.id,
        x: Math.abs(Math.round((t.totalAmountCents || 0) * (t.exchangeRate || 1))) / (maxAmount || 1),
        y: (parseLocalDate(t.date).getTime() - minTime) / timeRange
      }));

      const k = Math.min(5, Math.ceil(uncategorized.length / 10));
      const clusters = kMeans(clusterData, k);
      
      toast.success(`Discovered ${k} distinct spending patterns.`, { id: loader });
      return clusters;
    } catch {
      toast.error('Cluster analysis failed.', { id: loader });
    }
  };

  return { handleBulkRepair, handleIntegrityAction, handleSmartCluster };
}

export type IntegrityActions = ReturnType<typeof createIntegrityActions>;
