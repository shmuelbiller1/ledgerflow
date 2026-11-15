import { collection, addDoc, updateDoc, deleteDoc, doc, getDocs, query, where } from '../../lib/db/firestore';
import { guestSession, SAMPLE_WORKSPACE_ID } from '../../lib/db/guestDatabase';
import { db } from '../../firebase';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { Transaction, AutoRule, ChartAccount } from '../../types';
import { toast } from 'sonner';
import { parseLocalDate } from '../../lib/utils';
import { AhoCorasick } from '../../lib/algorithms';
import { handleFirestoreError, OperationType } from '../../lib/firebaseUtils';
import type { ActionContext, RunRegisteredCommand } from './shared';

/** Automation rules: add, change, delete and apply to existing entries. (F-05, moved from useTransactionActions.) */
function isActiveRuleContext(actorUid: string, workspaceId: string): boolean {
  const auth = useAuthStore.getState();
  return auth.user?.uid === actorUid && auth.currentWorkspaceId === workspaceId;
}

export function createRuleActions(ctx: ActionContext, runCommand: RunRegisteredCommand) {
  const { user, currentWorkspaceId, setTransactions, accounts, setIsSyncing } = ctx;

  const handleAddRule = async (data: Partial<AutoRule>) => {
    if (!user || !currentWorkspaceId) return;
    const actorUid = user.uid;
    const originWorkspaceId = currentWorkspaceId;
    try {
      const { uid: _uid, workspaceId: _workspaceId, createdAt: _createdAt, hitCount: _hitCount, lastTriggeredAt: _lastTriggeredAt, ...ruleData } = data;
      let saved: AutoRule;
      if (guestSession() || originWorkspaceId === SAMPLE_WORKSPACE_ID) {
        const ref = await addDoc(collection(db, 'autoRules'), {
          ...ruleData, uid: actorUid, workspaceId: originWorkspaceId, createdAt: new Date().toISOString(),
        });
        saved = { ...ruleData, id: ref.id, uid: actorUid, workspaceId: originWorkspaceId, createdAt: new Date().toISOString() } as AutoRule;
      } else {
        const result = await runCommand('autorule.create', { rule: ruleData as Record<string, unknown> });
        saved = result.rule as AutoRule;
      }
      if (!isActiveRuleContext(actorUid, originWorkspaceId)) return;
      const rules = useLedgerStore.getState().autoRules as AutoRule[];
      useLedgerStore.getState().setAutoRules(rules.some(rule => rule.id === saved.id) ? rules.map(rule => rule.id === saved.id ? saved : rule) : [...rules, saved]);
      toast.success('Categorization rule synced');
    } catch (error) {
      if (isActiveRuleContext(actorUid, originWorkspaceId)) {
        toast.error('Failed to save rule', { description: error instanceof Error ? error.message : String(error) });
      }
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!user || !currentWorkspaceId) return;
    const existing = (useLedgerStore.getState().autoRules as AutoRule[]).find(rule => rule.id === id && rule.workspaceId === currentWorkspaceId);
    if (!existing) return;
    try {
      if (guestSession() || currentWorkspaceId === SAMPLE_WORKSPACE_ID) await deleteDoc(doc(db, 'autoRules', id));
      else await runCommand('autorule.delete', { id });
      useLedgerStore.getState().setAutoRules((useLedgerStore.getState().autoRules as AutoRule[]).filter(rule => rule.id !== id));
      toast.success('Rule removed');
    } catch (error) {
      toast.error('Failed to delete rule', { description: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleUpdateRule = async (id: string, updates: Partial<AutoRule>) => {
    if (!user || !currentWorkspaceId) return;
    const existing = (useLedgerStore.getState().autoRules as AutoRule[]).find(rule => rule.id === id && rule.workspaceId === currentWorkspaceId);
    if (!existing) return;
    try {
      const editable = ['name', 'groupName', 'groupIsActive', 'condition', 'action', 'confidence', 'isHardened', 'priority', 'isActive', 'stopProcessingOnMatch'];
      const data = Object.fromEntries(editable.filter(key => (updates as Record<string, unknown>)[key] !== undefined).map(key => [key, (updates as Record<string, unknown>)[key]]));
      if (!Object.keys(data).length) return;
      if (guestSession() || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
        await updateDoc(doc(db, 'autoRules', id), { ...data, updatedAt: new Date().toISOString() });
      } else {
        await runCommand('autorule.update', { id, data });
      }
      useLedgerStore.getState().setAutoRules((useLedgerStore.getState().autoRules as AutoRule[]).map(rule => rule.id === id ? { ...rule, ...data } : rule));
      toast.success('Rule configuration updated');
    } catch (error) {
      if (guestSession() || currentWorkspaceId === SAMPLE_WORKSPACE_ID) handleFirestoreError(error, OperationType.UPDATE, `autoRules/${id}`);
      toast.error('Failed to update rule', { description: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleApplyRules = async (ruleIds: string[]) => {
    if (!user || !currentWorkspaceId) return;
    setIsSyncing(true);
    const loader = toast.loading('Initiating rule execution sequence...');
    
    // Store original state for rollback if needed
    const originalTransactions = [...useLedgerStore.getState().transactions];

    try {
      const qRules = query(
        collection(db, 'autoRules'), 
        where('workspaceId', '==', currentWorkspaceId),
        where('uid', '==', user.uid)
      );
      const rulesSnap = await getDocs(qRules);
      const activeRules = rulesSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as AutoRule))
        .filter(r => ruleIds.includes(r.id));

      if (activeRules.length === 0) {
        toast.info('No active rules found to apply.', { id: loader });
        return;
      }

      // Build search engine
      const patterns = activeRules.flatMap(r => {
        const p: { pattern: string; ruleId: string }[] = [];
        if (r.condition.descriptionContains) p.push({ pattern: r.condition.descriptionContains, ruleId: r.id });
        if (r.condition.vendor) p.push({ pattern: r.condition.vendor, ruleId: r.id });
        return p;
      });
      
      const acSearch = patterns.length > 0 ? new AhoCorasick(patterns) : null;
      if (!acSearch) {
        toast.info('No rule patterns to match.', { id: loader });
        return;
      }

      let count = 0;
      const accountMap = new Map<string | undefined, ChartAccount>(accounts.map(a => [a.id, a]));
      const ruleMap = new Map(activeRules.map(r => [r.id, r]));
      const updatesToPost: { id: string; data: Partial<Transaction> }[] = [];

      const localUpdatedTxs = originalTransactions.map(tx => {
        let matchingRuleId: string | null = null;
        
        // First, use string matching
        const results = acSearch ? acSearch.search(tx.description) : [];
        const candidateRuleIds = results;

        // Also check all active rules to see if they pass purely via numeric/date match without text
        activeRules.forEach(r => {
           const hasTextCond = !!(r.condition.descriptionContains || r.condition.vendor);
           if (!hasTextCond && !candidateRuleIds.includes(r.id)) {
               candidateRuleIds.push(r.id);
           }
        });

        // Evaluate the full matrix for each candidate
        for (const ruleId of candidateRuleIds) {
          const rule = ruleMap.get(ruleId);
          if (!rule) continue;

          let isMatch = true;
          
          if (rule.condition.vendor && !tx.description.toLowerCase().includes(rule.condition.vendor.toLowerCase())) {
              isMatch = false;
          }
          if (rule.condition.descriptionContains && !tx.description.toLowerCase().includes(rule.condition.descriptionContains.toLowerCase())) {
              isMatch = false;
          }

          // Numeric logic
          const amt = Math.abs(tx.totalAmountCents);
          if (rule.condition.amountThreshold && amt < rule.condition.amountThreshold) isMatch = false;
          if (rule.condition.exactAmount && amt !== rule.condition.exactAmount) isMatch = false;
          
          // Date logic
          if (rule.condition.dateRange) {
            const d = parseLocalDate(tx.date);
            const start = parseLocalDate(rule.condition.dateRange.start);
            const end = parseLocalDate(rule.condition.dateRange.end);
            if (d < start || d > end) isMatch = false;
          }

          if (isMatch) {
            matchingRuleId = rule.id;
            break;
          }
        }

        if (matchingRuleId) {
          const matchingRule = ruleMap.get(matchingRuleId);
          const account = accountMap.get(matchingRule?.action.targetNodeId);
          
          const updatedTx = {
            ...tx,
            // Apply target status if flagged for review
            status: matchingRule?.action.flagForReview ? 'flagged' : tx.status,
            // Apply Class & Location
            classId: matchingRule?.action.targetClass || tx.classId,
            locationId: matchingRule?.action.targetLocation || tx.locationId,
            lines: tx.lines.map((line, idx) => {
               if (idx === 0 && account) {
                   return {
                      ...line,
                      accountId: account.id,
                      accountName: account.name
                   };
               }
              if (line.accountId && line.accountId !== "uncategorized" && !accountMap.has(line.accountId)) {
                return { ...line, accountId: "uncategorized", accountName: "Manual Review" };
              }
               return line;
            }),
            updatedAt: new Date().toISOString()
          };
          
          updatesToPost.push({
            id: tx.id,
            data: {
              lines: updatedTx.lines,
              status: updatedTx.status,
              classId: updatedTx.classId,
              locationId: updatedTx.locationId
            }
          });
          count++;
          return updatedTx;
        }
        return tx;
      });

      if (updatesToPost.length > 0) {
        const token = await user.getIdToken();
        const res = await fetch('/api/v1/transactions/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ workspaceId: currentWorkspaceId, updates: updatesToPost })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Server rejected batch rule updates');
        }
      }

      if (count > 0) {
        setTransactions(localUpdatedTxs);
        toast.success(`Rule mapping complete. ${count} transactions identified and updated.`, { id: loader });
      } else {
        toast.info('Scan finished. No matching patterns found.', { id: loader });
      }
    } catch (error) {
      console.error(error);
      setTransactions(originalTransactions); // Rollback
      toast.error('Rule execution aborted.', { id: loader });
    }
  };

  return { handleAddRule, handleDeleteRule, handleUpdateRule, handleApplyRules };
}

export type RuleActions = ReturnType<typeof createRuleActions>;
