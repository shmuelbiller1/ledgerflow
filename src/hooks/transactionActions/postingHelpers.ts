import { resolveAccountRole } from '../../lib/accountUtils';
import { learnedPatternId } from '../../lib/learnedPatterns';
import { normalizeLabel } from '../../lib/dimensionUtils';
import { collection, addDoc as firestoreAddDoc } from '../../lib/db/firestore';
import { localSet } from '../../lib/db/localStore';
import { db } from '../../firebase';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { TransactionLine, ChartAccount } from '../../types';
import { toast } from 'sonner';
import { savedInOtherWorkspace, workspaceChangedSince } from '../../lib/saveWorkspace';
import { guestSession, SAMPLE_WORKSPACE_ID } from '../../lib/db/guestDatabase';
import type { ActionContext, RunRegisteredCommand } from './shared';

/** Shared by several groups: learn a categorisation from an entry, and balance entry lines. (F-05, moved from useTransactionActions.) */
export function createPostingHelpers(ctx: ActionContext, runCommand: RunRegisteredCommand) {
  const { user, currentWorkspaceId, accounts, analyticalPatternCache } = ctx;

  const recordRulePattern = async (description: string, accountId: string, accountName: string, tags?: string[], dimensions?: Record<string, string>) => {
    if (!user || !currentWorkspaceId || !description) return;

    // Do not record rule patterns into archived or inactive accounts
    const currentAccounts = useLedgerStore.getState().accounts;
    const targetAccount = currentAccounts.find(a => a.id === accountId || a.name.toLowerCase() === accountName.toLowerCase());
    if (targetAccount && ((targetAccount as ChartAccount & { archived?: boolean }).archived === true || (targetAccount as ChartAccount & { isArchived?: boolean }).isArchived === true || targetAccount.isActive === false)) {
      return;
    }
    
    // Normalize to extract the core merchant/pattern (strip dates, long numbers, transaction IDs)
    let cleanDesc = normalizeLabel(description);
    cleanDesc = cleanDesc.replace(/[0-9]{3,}/g, ''); // Remove sequence of 3+ numbers
    cleanDesc = cleanDesc.replace(/(?<![0-9])[0-9]+[a-z]+[0-9]+/g, ''); // Remove alphanumeric IDs
    cleanDesc = cleanDesc.replace(/[*#]/g, ''); // Remove common bank delimiters
    cleanDesc = normalizeLabel(cleanDesc);
    
    if (cleanDesc.length < 3) return;

    // N-14: collision-free (Hebrew included), same id as before for plain Latin text
    const patternId = learnedPatternId(cleanDesc);
    
    try {
      const existingPattern = analyticalPatternCache[cleanDesc];
      const newCount = (existingPattern?.count || 0) + 1;
      // what the workspace has seen: the browser's own count in the sample company, the server's afterwards
      let occurrenceCount = newCount;

      // Merge tags and dimensions conservatively
      const combinedTags = Array.from(new Set([...(existingPattern?.tags || []), ...(tags || [])])).slice(0, 5);
      const combinedDimensions = { ...(existingPattern?.dimensions || {}), ...(dimensions || {}) };

      // the count and the merge are the workspace's record, so a live workspace asks the server for them:
      // two tabs filing the same description used to both write "1" from the copy in their own cache
      if (guestSession() || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
        await localSet('rulePatterns', `${currentWorkspaceId}_${patternId}`, {
          uid: user.uid,
          workspaceId: currentWorkspaceId,
          description: cleanDesc,
          accountId,
          accountName,
          tags: combinedTags,
          dimensions: Object.keys(combinedDimensions).length > 0 ? combinedDimensions : undefined,
          count: newCount,
          lastUpdated: new Date().toISOString()
        }, { merge: true });
      } else {
        const learned = await runCommand('autorule.learn', {
          description: cleanDesc,
          accountId,
          accountName,
          tags: combinedTags,
          ...(Object.keys(combinedDimensions).length > 0 ? { dimensions: combinedDimensions } : {}),
        });
        const counted = (learned.pattern as { count?: unknown } | undefined)?.count;
        if (typeof counted === 'number' && Number.isFinite(counted)) occurrenceCount = counted;
      }

      // the pattern is saved in the books it was learnt in; if other books were opened meanwhile, their
      // cache and rules must not take it (PREV-5)
      if (workspaceChangedSince(currentWorkspaceId)) return;

      useLedgerStore.getState().updateAnalyticalMatchCache(
        cleanDesc,
        accountId,
        accountName,
        combinedTags,
        undefined,
        undefined,
        combinedDimensions
      );

      // PROMOTION LOGIC: Auto-create a deterministic rule after 3 occurrences
      if (occurrenceCount >= 3) {
        const { autoRules } = useLedgerStore.getState();
        const hasRule = autoRules.some(r => 
          r.condition.descriptionContains?.toLowerCase() === cleanDesc ||
          r.condition.vendor?.toLowerCase() === cleanDesc
        );

        if (!hasRule) {
          const rule = {
            name: `Autonomous Item Rule: ${cleanDesc}`,
            condition: { descriptionContains: cleanDesc },
            action: { type: 'categorize' as const, targetNodeId: accountId, targetCategory: accountName },
            isActive: true,
          };
          if (guestSession() || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
            await firestoreAddDoc(collection(db, 'autoRules'), {
              ...rule, uid: user.uid, workspaceId: currentWorkspaceId, createdAt: new Date().toISOString(),
            });
          } else {
            await runCommand('autorule.create', { rule });
          }
          if (workspaceChangedSince(currentWorkspaceId)) {
            toast.info(savedInOtherWorkspace(`The rule for "${cleanDesc}"`, currentWorkspaceId));
          } else {
            toast.success(`Sub-ledger rule created for "${cleanDesc}"`, {
              description: `Automated link to ${accountName} established.`
            });
          }
        }
      }
    } catch (e) {
      console.warn("Rule learning deferred", e);
    }
  };

  const balanceTransactionLines = (lines: TransactionLine[], fallbackAmountCents: number): TransactionLine[] => {
    let finalLines = [...lines];

    // If lines are empty but we have an amount, create a default pair
    if (finalLines.length === 0 && fallbackAmountCents !== 0) {
      // Find default asset account
      const assetAccounts = accounts.filter(a => a.type === 'asset');
      const defaultAsset = assetAccounts.find(a => resolveAccountRole(a) === 'cash') || assetAccounts[0] || accounts[0];

      // Find primary category / expense/income account if any
      const defaultCategory = accounts.find(a => a.type === 'expense' || a.type === 'income') || accounts[0];

      if (defaultCategory && defaultAsset) {
        finalLines = [
          {
            accountId: defaultCategory.id,
            accountName: defaultCategory.name,
            amountCents: fallbackAmountCents,
            description: "Category Allocation"
          },
          {
            accountId: defaultAsset.id,
            accountName: defaultAsset.name,
            amountCents: -fallbackAmountCents,
            description: "Asset Settlement"
          }
        ];
      }
      return finalLines;
    }

    // Check sum of existing lines
    const sum = finalLines.reduce((acc, l) => acc + (l.amountCents || 0), 0);
    if (sum === 0) {
      return finalLines;
    }

    // If all lines are on one side (all positive debits or all negative credits),
    // settle against default asset/cash account
    const allPositive = finalLines.length > 0 && finalLines.every(l => (l.amountCents || 0) > 0);
    const allNegative = finalLines.length > 0 && finalLines.every(l => (l.amountCents || 0) < 0);

    if (allPositive || allNegative) {
      const assetAccounts = accounts.filter(a => a.type === 'asset');
      const defaultAsset = assetAccounts.find(a => resolveAccountRole(a) === 'cash') || assetAccounts[0] || accounts[0];

      if (defaultAsset) {
        finalLines.push({
          accountId: defaultAsset.id,
          accountName: defaultAsset.name,
          amountCents: -sum,
          description: allPositive ? "Asset Settlement" : "Category Allocation"
        });
      }
      return finalLines;
    }

    // If lines already contain both debits and credits, but have an imbalance > 1 cent,
    // do NOT silently absorb into a System Offset. Reject/throw to protect ledger integrity.
    if (Math.abs(sum) > 1) {
      throw new Error(`Double-entry balance violation: Transaction lines are out of balance by $${(Math.abs(sum) / 100).toFixed(2)}.`);
    }

    // Minor penny rounding adjustment (<= 1 cent)
    if (Math.abs(sum) > 0) {
      const assetAccounts = accounts.filter(a => a.type === 'asset');
      const defaultAsset = assetAccounts.find(a => resolveAccountRole(a) === 'cash') || assetAccounts[0] || accounts[0];
      if (defaultAsset) {
        finalLines.push({
          accountId: defaultAsset.id,
          accountName: defaultAsset.name,
          amountCents: -sum,
          description: "Rounding Adjustment"
        });
      }
    }

    return finalLines;
  };

  return { recordRulePattern, balanceTransactionLines };
}

export type PostingHelpers = ReturnType<typeof createPostingHelpers>;
