import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { db } from '../firebase';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from '../lib/db/firestore';
import { dryRunRules, ruleGroupName } from '../lib/rulesEngine';
import { describeError } from '../lib/errorRemedies';
import { useCurrentRole } from './useCurrentRole';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { guestSession, SAMPLE_WORKSPACE_ID } from '../lib/db/guestDatabase';
import { useEntityOperations } from './useEntityOperations';
import type { AutoRule, Transaction } from '../types';

/**
 * Saving automation rules (Settings → Rules, "Create rule" in the transaction list). Rules used to
 * change only the copy in the open page: lost on reload and never seen by the rule engine after
 * it. Every change is now written to the database (autoRules, live), and "apply to existing"
 * saves ordinary changes through /transactions/batch and account/type changes through the
 * authoritative /transactions/recategorize service.
 */

/** Fields of a transaction a rule may change (rulesEngine applyRuleAction), sent when they differ. */
const RULE_FIELDS = ['lines', 'description', 'status', 'tags', 'metadata', 'classId', 'locationId', 'projectId', 'dimensions', 'category'] as const;
const RULE_EDITABLE_FIELDS = ['name', 'groupName', 'groupIsActive', 'condition', 'action', 'confidence', 'isHardened', 'priority', 'isActive', 'stopProcessingOnMatch'] as const satisfies readonly (keyof AutoRule)[];

function commandRuleData(rule: AutoRule): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of RULE_EDITABLE_FIELDS) if (rule[key] !== undefined) data[key] = rule[key];
  return data;
}

export function changedRuleFields(before: Transaction, after: Transaction): Partial<Transaction> {
  const out: Record<string, unknown> = {};
  for (const key of RULE_FIELDS) {
    const a = (before as unknown as Record<string, unknown>)[key];
    const b = (after as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(a) !== JSON.stringify(b) && b !== undefined) out[key] = b;
  }
  return out as Partial<Transaction>;
}

/** A rule as stored: no undefined values (the database keeps JSON). */
function stored(rule: AutoRule): AutoRule {
  return JSON.parse(JSON.stringify(rule)) as AutoRule;
}

const fail = (err: unknown) => {
  const described = describeError(err, 'update');
  toast.error(described.title, { description: described.remedy });
};
const isLocalSampleWorkspace = (workspaceId: string | null | undefined) => Boolean(guestSession()) || workspaceId === SAMPLE_WORKSPACE_ID;

export function useAutoRules() {
  const user = useAuthStore(s => s.user);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const { runCommand } = useEntityOperations();

  const role = useCurrentRole();
  const canManageRules = role !== 'viewer';
  const pending = useRef(false);
  const [isUpdatingGroup, setIsUpdatingGroup] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const applying = useRef(false);
  const currentContext = useCallback(() => {
    const auth = useAuthStore.getState();
    const workspace = auth.getCurrentWorkspace();
    const currentRole = workspace?.uid === auth.user?.uid ? 'owner' : workspace?.roles?.[auth.user?.uid || ''];
    return !!user && !!workspaceId && auth.user?.uid === user.uid && auth.currentWorkspaceId === workspaceId && (currentRole === 'owner' || currentRole === 'accountant' || currentRole === 'bookkeeper');
  }, [user, workspaceId]);

  // Read all pages, not just the capped browser cache, before changing a whole group.
  const workspaceRules = useCallback(async () => {
    const snapshot = await getDocs(query(collection(db, 'autoRules'), where('workspaceId', '==', workspaceId)));
    return snapshot.docs.map(row => ({ ...row.data(), id: row.id }) as AutoRule).filter(rule => rule.workspaceId === workspaceId);
  }, [workspaceId]);

  const updateGroup = useCallback(async (groupName: string, change: { groupName?: string; groupIsActive?: boolean }) => {
    if (!canManageRules || !currentContext()) throw new Error('Your role cannot edit rules.');
    if (pending.current) throw new Error('A group change is still being saved.');
    const name = change.groupName?.trim();
    if (change.groupName !== undefined && (!name || name.length > 120)) throw new Error('Enter a group name of 1–120 characters.');
    pending.current = true;
    setIsUpdatingGroup(true);
    try {
      const allRules = await workspaceRules();
      if (!currentContext()) throw new Error('The workspace changed; retry in the current workspace.');
      const members = allRules.filter(rule => ruleGroupName(rule) === groupName);
      if (!members.length) throw new Error('This group no longer contains rules.');
      if (name && name !== groupName && allRules.some(rule => ruleGroupName(rule) === name)) throw new Error('That group already exists. Choose another name.');
      const patch = name ? { groupName: name } : { groupIsActive: change.groupIsActive };
      if (isLocalSampleWorkspace(workspaceId)) {
        const batch = writeBatch(db);
        members.forEach(rule => batch.update(doc(db, 'autoRules', rule.id), patch));
        await batch.commit();
      } else {
        await runCommand('autorule.group', {
          groupName,
          ...(name ? { newName: name } : { groupIsActive: change.groupIsActive }),
        });
      }
      if (!currentContext()) return;
      const ids = new Set(members.map(rule => rule.id));
      const cached = useLedgerStore.getState().autoRules as AutoRule[];
      useLedgerStore.getState().setAutoRules(cached.map(rule => ids.has(rule.id) ? { ...rule, ...patch } : rule));
    } finally {
      pending.current = false;
      setIsUpdatingGroup(false);
    }
  }, [canManageRules, currentContext, workspaceRules, runCommand, workspaceId]);

  const setRulePriority = useCallback(async (ruleId: string, priority: number) => {
    if (!currentContext()) throw new Error('Your role cannot edit rules.');
    if (!(useLedgerStore.getState().autoRules as AutoRule[]).some(rule => rule.id === ruleId && rule.workspaceId === workspaceId)) throw new Error('This rule is not in the current workspace.');
    if (!Number.isSafeInteger(priority)) throw new Error('Enter a whole-number priority.');
    if (isLocalSampleWorkspace(workspaceId)) await updateDoc(doc(db, 'autoRules', ruleId), { priority });
    else await runCommand('autorule.update', { id: ruleId, data: { priority } });
    if (!currentContext()) return;
    const rules = useLedgerStore.getState().autoRules as AutoRule[];
    useLedgerStore.getState().setAutoRules(rules.map(rule => rule.id === ruleId ? { ...rule, priority } : rule));
  }, [currentContext, workspaceId, runCommand]);

  /** Create or replace a rule (keeps its creator and workspace when editing). */
  const saveRule = useCallback(async (rule: AutoRule): Promise<boolean> => {
    if (!user || !workspaceId || !currentContext() || pending.current) return false;
    const cachedExisting = (useLedgerStore.getState().autoRules || []).find(r => r.id === rule.id) as AutoRule | undefined;
    if (cachedExisting && cachedExisting.workspaceId !== workspaceId) return false;
    pending.current = true;
    setIsUpdatingGroup(true);
    try {
      const allRules = await workspaceRules();
      const existing = cachedExisting || allRules.find(candidate => candidate.id === rule.id);
      if (existing && existing.workspaceId !== workspaceId) return false;
      const full = stored({ ...rule, workspaceId, uid: existing?.uid || user.uid, createdAt: existing?.createdAt || rule.createdAt || new Date().toISOString() });
      const members = allRules.filter(candidate => ruleGroupName(candidate) === ruleGroupName(full));
      if (!currentContext()) return false;
      full.groupIsActive = !members.some(candidate => candidate.groupIsActive === false);
      let saved = full;
      if (isLocalSampleWorkspace(workspaceId)) {
        await setDoc(doc(db, 'autoRules', full.id), full as never);
      } else {
        const data = commandRuleData(full);
        const result = existing
          ? await runCommand('autorule.update', { id: full.id, data })
          : await runCommand('autorule.create', { rule: { id: full.id, ...data } });
        if (result.rule && typeof result.rule === 'object') saved = result.rule as AutoRule;
      }
      if (!currentContext()) return true;
      const rules = (useLedgerStore.getState().autoRules || []) as AutoRule[];
      const hasCached = rules.some(candidate => candidate.id === full.id);
      useLedgerStore.getState().setAutoRules(hasCached ? rules.map(candidate => candidate.id === full.id ? saved : candidate) : [...rules, saved]);
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      pending.current = false;
      setIsUpdatingGroup(false);
    }
  }, [user, workspaceId, currentContext, workspaceRules, runCommand]);

  const setRuleActive = useCallback(async (ruleId: string, isActive: boolean) => {
    if (!currentContext() || !(useLedgerStore.getState().autoRules as AutoRule[]).some(rule => rule.id === ruleId && rule.workspaceId === workspaceId)) return;
    try {
      if (isLocalSampleWorkspace(workspaceId)) await updateDoc(doc(db, 'autoRules', ruleId), { isActive });
      else await runCommand('autorule.update', { id: ruleId, data: { isActive } });
      if (!currentContext()) return;
      const rules = (useLedgerStore.getState().autoRules || []) as AutoRule[];
      useLedgerStore.getState().setAutoRules(rules.map(r => (r.id === ruleId ? { ...r, isActive } : r)));
    } catch (err) {
      fail(err);
    }
  }, [currentContext, workspaceId, runCommand]);

  const deleteRule = useCallback(async (ruleId: string) => {
    if (!currentContext() || !(useLedgerStore.getState().autoRules as AutoRule[]).some(rule => rule.id === ruleId && rule.workspaceId === workspaceId)) return;
    try {
      if (isLocalSampleWorkspace(workspaceId)) await deleteDoc(doc(db, 'autoRules', ruleId));
      else await runCommand('autorule.delete', { id: ruleId });
      if (!currentContext()) return;
      const rules = (useLedgerStore.getState().autoRules || []) as AutoRule[];
      useLedgerStore.getState().setAutoRules(rules.filter(r => r.id !== ruleId));
    } catch (err) {
      fail(err);
    }
  }, [currentContext, workspaceId, runCommand]);

  /**
   * Run the rules over existing transactions and save what they change, as the dry run shows it.
   * Returns how many transactions were changed (0 when nothing matched or saving failed).
   */
  const applyToExisting = useCallback(async (rules: AutoRule[], transactions: Transaction[]): Promise<number> => {
    if (!user || !workspaceId || !currentContext()) return 0;
    if (applying.current) return 0;
    applying.current = true;
    setApplyError(null);
    try {
      const workspace = useAuthStore.getState().getCurrentWorkspace();
      const dry = dryRunRules(rules, transactions, { workspaceId, accounts: useLedgerStore.getState().accounts, currency: workspace?.currency });
      if (dry.errors.length) throw new Error(dry.errors[0].message);
      const byId = new Map(transactions.map(t => [t.id, t]));
      const lastMatches = new Map(dry.matches.map(match => [match.transactionId, match]));
      const financial = dry.matches.filter(match => match.recategorization);
      const ordinary = dry.matches.filter(match => !match.recategorization);
      if (financial.length && ordinary.length) throw new Error('Apply account/type rules separately from other actions. Select one group or pause the other groups.');
      const changes = [...lastMatches.values()].flatMap(match => match.recategorization ? [match.recategorization] : []);
      if (changes.length > 500) throw new Error('Account/type actions support at most 500 entries per run. Narrow the rule conditions.');
      if (financial.some(match => match.recategorization!.bankAccountId !== lastMatches.get(match.transactionId)?.recategorization?.bankAccountId)) {
        throw new Error('Rules on the same entry must preserve the same bank account.');
      }
      const updates = [...lastMatches.values()]
        .map(m => ({ id: m.transactionId, data: changedRuleFields(byId.get(m.transactionId) || m.txModified, m.txModified) }))
        .filter(u => Object.keys(u.data).length > 0);
      if (!changes.length && !updates.length) return 0;
      const token = await user.getIdToken();
      if (!currentContext()) return 0;
      const res = await fetch(changes.length ? '/api/v1/transactions/recategorize' : '/api/v1/transactions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(changes.length ? { workspaceId, changes } : { workspaceId, updates }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${body.message || body.error || 'The changes were not saved'}${body.entryId ? ` (entry ${body.entryId})` : ''}`);
      if (!currentContext()) return 0;
      if (changes.length && body.changed !== changes.length) throw new Error('The server did not confirm every account change. Refresh before retrying.');
      if (changes.length) {
        // Re-read the accepted records; a preview is not authoritative saved state.
        try {
          const snapshots = await Promise.all(changes.map(change => getDoc(doc(db, 'transactions', change.id))));
          if (!currentContext()) return changes.length;
          const saved = new Map(snapshots.filter(snapshot => snapshot.exists()).map(snapshot => [snapshot.id, { ...snapshot.data(), id: snapshot.id } as Transaction]));
          const cached = useLedgerStore.getState().transactions;
          useLedgerStore.getState().setTransactions(cached.map(tx => saved.get(tx.id)?.workspaceId === workspaceId ? saved.get(tx.id)! : tx));
        } catch {
          toast.info('Account changes were saved. Reload to see the latest entries.');
        }
      }
      const hitUpdates = Object.entries(dry.summary.rulesTriggered).flatMap(([ruleId, hits]) =>
        rules.some(rule => rule.id === ruleId) && hits > 0 ? [{ id: ruleId, hits }] : [],
      );
      if (hitUpdates.length) {
        if (isLocalSampleWorkspace(workspaceId)) {
          const now = new Date().toISOString();
          await Promise.all(hitUpdates.map(({ id, hits }) => {
            const rule = rules.find(candidate => candidate.id === id);
            return rule ? updateDoc(doc(db, 'autoRules', id), { hitCount: (rule.hitCount || 0) + hits, lastTriggeredAt: now }).catch(() => undefined) : undefined;
          }));
        } else {
          try {
            const result = await runCommand('autorule.recordhits', { rules: hitUpdates });
            if (currentContext() && Array.isArray(result.updated)) {
              const changed = new Map((result.updated as Array<{ id: string; hitCount: number; lastTriggeredAt: string }>).map(item => [item.id, item]));
              const cached = useLedgerStore.getState().autoRules as AutoRule[];
              useLedgerStore.getState().setAutoRules(cached.map(rule => changed.has(rule.id) ? { ...rule, ...changed.get(rule.id)! } : rule));
            }
          } catch { /* Match counters are best-effort; transaction writes have already succeeded. */ }
        }
      }
      return changes.length || updates.length;
    } catch (err) {
      if (currentContext()) setApplyError(err instanceof Error ? err.message : 'The changes were not saved.');
      fail(err);
      return 0;
    } finally { applying.current = false; }
  }, [user, workspaceId, currentContext, runCommand]);

  return { saveRule, setRuleActive, deleteRule, applyToExisting, updateGroup, setRulePriority, isUpdatingGroup, applyError };
}
