import { useDialog } from '../../../hooks/useDialog';
import React, { useState, useMemo, useId } from 'react';
import { AutoRule, Transaction } from '../../../types';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { isCashAccount } from '../../../lib/txFilters';
import { hasFinancialRuleAction, hasOrdinaryRuleAction, disabledRuleGroups, dryRunRules, sortRulesByPriority, evaluateRuleCondition } from '../../../lib/rulesEngine';
import { useTimeout } from '../../../hooks/useTimeout';
import { aiService } from '../../../services/aiService';
import { AutoRuleSchema } from '../../../schemas';
import { useAutoRules } from '../../../hooks/useAutoRules';
import { RulesSettingsView } from './RulesSettingsView';
function withOccurrenceKeys<T>(items: T[], keyForItem: (item: T) => string) {
  const occurrences = new Map<string, number>();
  return items.map(item => {
    const contentKey = keyForItem(item);
    const occurrence = occurrences.get(contentKey) ?? 0;
    occurrences.set(contentKey, occurrence + 1);
    return { item, key: JSON.stringify([contentKey, occurrence]) };
  });
}

function useRulesSettingsModel() {
  const formId = useId();
  const currentRole = useCurrentRole();
  const canEditRules = currentRole !== 'viewer';
  const canBuildRules = currentRole === 'owner' || currentRole === 'accountant';

  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const isGuest = useAuthStore(s => s.isGuest);
  const cachedRules = useLedgerStore(s => (s.autoRules || []) as AutoRule[]);
  const autoRules = useMemo(() => cachedRules.filter(rule => isGuest || rule.workspaceId === workspaceId), [cachedRules, workspaceId, isGuest]);
  const { saveRule, setRuleActive, deleteRule, applyToExisting, updateGroup, setRulePriority, isUpdatingGroup, applyError } = useAutoRules();
  const cachedTransactions = useLedgerStore(s => s.transactions);
  const transactions = useMemo(() => cachedTransactions.filter(tx => isGuest || tx.workspaceId === workspaceId), [cachedTransactions, workspaceId, isGuest]);
  useLedgerStore(s => s.setTransactions);
  const getCurrentWorkspace = useAuthStore(s => s.getCurrentWorkspace);
  const user = useAuthStore(s => s.user);
  const currentWorkspace = getCurrentWorkspace();

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreatingRule, setIsCreatingRule] = useState(false);
  const { dialogProps: overlay2DialogProps, titleId: overlay2TitleId } = useDialog(() => setIsCreatingRule(false), isCreatingRule);
  const [editingRule, setEditingRule] = useState<AutoRule | null>(null);

  // AI Rule Builder State
  const [aiSentence, setAiSentence] = useState('');
  const [isGeneratingAiRule, setIsGeneratingAiRule] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<{ rule: AutoRule; affectedCount: number } | null>(null);

  // Dry run & Test state
  const [dryRunResult, setDryRunResult] = useState<ReturnType<typeof dryRunRules> | null>(null);
  const [isTestingRule, setIsTestingRule] = useState(false);
  const { dialogProps: overlay1DialogProps, titleId: overlay1TitleId } = useDialog(() => setIsTestingRule(false), !!(isTestingRule && dryRunResult));
  const [isApplyingExisting, setIsApplyingExisting] = useState(false);
  const [applySuccessMessage, setApplySuccessMessage] = useState<string | null>(null);
  const { setSafeTimeout } = useTimeout();

  // Form state
  const [formName, setFormName] = useState('');
  const [formGroup, setFormGroup] = useState('General');
  const [formPriority, setFormPriority] = useState('10');
  const [formDescContains, setFormDescContains] = useState('');
  const [formVendor, setFormVendor] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formAmountThreshold, setFormAmountThreshold] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [draftActionPreview, setDraftActionPreview] = useState<ReturnType<typeof dryRunRules> | null>(null);
  const [formTargetAccountId, setFormTargetAccountId] = useState('');
  const [formBankAccountId, setFormBankAccountId] = useState('');
  const [formTransactionKind, setFormTransactionKind] = useState<'' | 'expense' | 'transfer'>('');
  const accounts = useLedgerStore(s => s.accounts);
  const chartAccounts = useMemo(() => accounts.filter(account => account.workspaceId === workspaceId && !account.isArchived && !account.archived), [accounts, workspaceId]);
  const bankAccounts = useMemo(() => chartAccounts.filter(isCashAccount), [chartAccounts]);
  const ruleContext = { workspaceId: workspaceId || '', accounts: chartAccounts, currency: currentWorkspace?.currency };
  const [formTargetCategory, setFormTargetCategory] = useState('');
  const [formTargetClass, setFormTargetClass] = useState('');
  const [formTargetLocation, setFormTargetLocation] = useState('');
  const [formAddTags, setFormAddTags] = useState('');
  const [formDescPrefix, setFormDescPrefix] = useState('');
  const [formFlagForReview, setFormFlagForReview] = useState(false);
  const [formStopOnMatch, setFormStopOnMatch] = useState(false);
  const [singleRuleTestResult, setSingleRuleTestResult] = useState<Transaction[] | null>(null);

  const disabledGroups = useMemo(() => disabledRuleGroups(autoRules), [autoRules]);
  const [groupError, setGroupError] = useState<string | null>(null);
  const handleToggleGroup = async (name: string) => {
    setGroupError(null);
    try { await updateGroup(name, { groupIsActive: disabledGroups.has(name) }); }
    catch (error) { setGroupError(error instanceof Error ? error.message : 'The group was not saved.'); }
  };
  const handleRenameGroup = async (name: string, next: string | number) => {
    await updateGroup(name, { groupName: String(next) });
    if (selectedGroup === name) setSelectedGroup(String(next).trim());
  };

  const sortedRules = useMemo(() => {
    return sortRulesByPriority(autoRules);
  }, [autoRules]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    autoRules.forEach(r => {
      if (r.groupName) set.add(r.groupName);
      else set.add('General');
    });
    return Array.from(set);
  }, [autoRules]);

  const filteredRules = useMemo(() => {
    return sortedRules.filter(r => {
      if (selectedGroup !== null) {
        const group = r.groupName || 'General';
        if (group !== selectedGroup) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const name = (r.name || r.id).toLowerCase();
        const desc = (r.condition.descriptionContains || '').toLowerCase();
        const vendor = (r.condition.vendor || '').toLowerCase();
        if (!name.includes(q) && !desc.includes(q) && !vendor.includes(q)) return false;
      }
      return true;
    });
  }, [sortedRules, selectedGroup, searchQuery]);

  const handleToggleActive = (ruleId: string) => {
    const rule = autoRules.find(r => r.id === ruleId);
    if (rule) void setRuleActive(ruleId, rule.isActive === false);
  };

  const handleDeleteRule = (ruleId: string) => {
    void deleteRule(ruleId);
  };

  const handleDuplicateRule = (rule: AutoRule) => {
    const newRule: AutoRule = {
      ...rule,
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: `${rule.name || 'Rule'} (Copy)`,
      hitCount: 0,
      createdAt: new Date().toISOString()
    };
    void saveRule(newRule);
  };

  const openCreateModal = () => {
    if (!canEditRules) return;
    setFormError(null); setDraftActionPreview(null);
    setEditingRule(null);
    setFormName('');
    setFormGroup('General');
    setFormPriority(String(autoRules.length * 10 + 10));
    setFormDescContains('');
    setFormVendor('');
    setFormCategory('');
    setFormAmountThreshold('');
    setFormTargetAccountId(''); setFormBankAccountId(''); setFormTransactionKind('');
    setFormTargetCategory('');
    setFormTargetClass('');
    setFormTargetLocation('');
    setFormAddTags('');
    setFormDescPrefix('');
    setFormFlagForReview(false);
    setFormStopOnMatch(false);
    setSingleRuleTestResult(null);
    setIsCreatingRule(true);
  };

  const openEditModal = (rule: AutoRule) => {
    if (!canEditRules) return;
    setFormError(null); setDraftActionPreview(null);
    setEditingRule(rule);
    setFormName(rule.name || '');
    setFormGroup(rule.groupName || 'General');
    setFormPriority(String(rule.priority ?? 100));
    setFormDescContains(rule.condition.descriptionContains || '');
    setFormVendor(rule.condition.vendor || '');
    setFormCategory(rule.condition.category || '');
    setFormAmountThreshold(rule.condition.amountThreshold ? String(rule.condition.amountThreshold) : '');
    setFormTargetAccountId(rule.action.targetAccountId || '');
    setFormBankAccountId(rule.action.bankAccountId || '');
    setFormTransactionKind(rule.action.targetTransactionKind || '');
    setFormTargetCategory(rule.action.targetCategory || '');
    setFormTargetClass(rule.action.targetClass || '');
    setFormTargetLocation(rule.action.targetLocation || '');
    setFormAddTags(rule.action.addTags?.join(', ') || rule.action.targetTags?.join(', ') || '');
    setFormDescPrefix(rule.action.descriptionPrefix || '');
    setFormFlagForReview(rule.action.flagForReview || false);
    setFormStopOnMatch(rule.stopProcessingOnMatch || false);
    setSingleRuleTestResult(null);
    setIsCreatingRule(true);
  };

  const handleSaveRule = async () => {
    if (!canEditRules || !formPriority.trim() || !Number.isSafeInteger(Number(formPriority))) return;
    const tags = formAddTags.split(',').map(t => t.trim()).filter(Boolean);
    const amountThresh = formAmountThreshold ? Number.parseFloat(formAmountThreshold) : undefined;

    const ruleData: AutoRule = {
      ...editingRule,
      id: editingRule ? editingRule.id : `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      uid: editingRule?.uid || user?.uid || '',
      workspaceId: currentWorkspace?.id || '',
      name: formName || `Rule: ${formDescContains || formVendor || 'Untitled'}`,
      groupName: formGroup || 'General',
      priority: Number(formPriority),
      isActive: editingRule?.isActive ?? true,
      stopProcessingOnMatch: formStopOnMatch,
      confidence: 1.0,
      isHardened: true,
      hitCount: editingRule?.hitCount || 0,
      createdAt: editingRule?.createdAt || new Date().toISOString(),
      condition: {
        ...editingRule?.condition,
        descriptionContains: formDescContains || undefined,
        vendor: formVendor || undefined,
        category: formCategory || undefined,
        amountThreshold: Number.isNaN(amountThresh as number) ? undefined : amountThresh
      },
      action: {
        ...editingRule?.action,
        targetAccountId: formTargetAccountId || undefined,
        bankAccountId: formBankAccountId || undefined,
        targetTransactionKind: formTransactionKind || undefined,
        targetCategory: formTargetCategory || undefined,
        targetClass: formTargetClass || undefined,
        targetLocation: formTargetLocation || undefined,
        addTags: tags.length > 0 ? tags : undefined,
        descriptionPrefix: formDescPrefix || undefined,
        flagForReview: formFlagForReview || undefined
      }
    };

    if (hasFinancialRuleAction(ruleData)) {
      if (hasOrdinaryRuleAction(ruleData)) { setFormError('Keep account/type actions in a separate rule from tagging and other actions.'); return; }
      if (formTargetAccountId && !chartAccounts.some(account => account.id === formTargetAccountId)) { setFormError('Choose an active account from this workspace chart.'); return; }
      if (formBankAccountId && !bankAccounts.some(account => account.id === formBankAccountId)) { setFormError('Choose an existing bank/cash account to preserve.'); return; }
    }
    setFormError(null);
    if (await saveRule(ruleData)) setIsCreatingRule(false);
  };

  const handleTestSingleRule = () => {
    const tags = formAddTags.split(',').map(t => t.trim()).filter(Boolean);
    const amountThresh = formAmountThreshold ? Number.parseFloat(formAmountThreshold) : undefined;

    const tempRule: AutoRule = {
      id: 'test-rule',
      uid: 'test',
      name: formName || 'Test Rule',
      confidence: 1,
      isHardened: true,
      createdAt: new Date().toISOString(),
      condition: {
        descriptionContains: formDescContains || undefined,
        vendor: formVendor || undefined,
        category: formCategory || undefined,
        amountThreshold: Number.isNaN(amountThresh as number) ? undefined : amountThresh
      },
      action: {
        targetAccountId: formTargetAccountId || undefined,
        bankAccountId: formBankAccountId || undefined,
        targetTransactionKind: formTransactionKind || undefined,
        targetCategory: formTargetCategory || undefined,
        targetClass: formTargetClass || undefined,
        targetLocation: formTargetLocation || undefined,
        addTags: tags.length > 0 ? tags : undefined,
        descriptionPrefix: formDescPrefix || undefined,
        flagForReview: formFlagForReview || undefined
      }
    };

    setDraftActionPreview(dryRunRules([tempRule], transactions, ruleContext));
    const matches = transactions.filter(t => evaluateRuleCondition(tempRule, t));
    setSingleRuleTestResult(matches);
  };

  const handleGenerateAiRule = async () => {
    if (!aiSentence.trim()) return;
    setIsGeneratingAiRule(true);
    setAiError(null);
    try {
      const accountsList = useLedgerStore.getState().accounts;
      const categories = Array.from(new Set(accountsList.map(a => a.category).filter(Boolean)));
      const accountNames = accountsList.map(a => a.name).filter(Boolean);
      const result = await aiService.process('build-auto-rule', { 
        sentence: aiSentence,
        categories,
        accounts: accountNames
      });
      const rawRule = result?.rule || result;
      const validated = AutoRuleSchema.safeParse({
        ...rawRule,
        id: `rule_ai_${Date.now()}`,
        workspaceId: currentWorkspace?.id || 'default',
        createdBy: 'ai',
        name: rawRule?.name || `AI Rule: ${aiSentence.slice(0, 30)}`
      });

      if (!validated.success) {
        setAiError('AI generated an invalid rule structure.');
        setIsGeneratingAiRule(false);
        return;
      }

      const generatedRule = validated.data as AutoRule;
      const dryRunRes = dryRunRules([generatedRule], transactions, ruleContext);

      setAiPreview({
        rule: generatedRule,
        affectedCount: dryRunRes.summary.totalMatched
      });
    } catch (err) {
      setAiError(err instanceof Error && err.message ? err.message : 'Failed to generate AI rule');
    } finally {
      setIsGeneratingAiRule(false);
    }
  };

  const handleSaveAiRule = async (activate: boolean) => {
    if (!aiPreview) return;
    const ruleToSave: AutoRule = {
      ...aiPreview.rule,
      isActive: activate
    };
    if (!(await saveRule(ruleToSave))) return;
    setAiPreview(null);
    setAiSentence('');
  };

  const handleRunDryRun = () => {
    const result = dryRunRules(selectedGroup === null ? autoRules : autoRules.filter(rule => (rule.groupName || 'General') === selectedGroup), transactions, ruleContext);
    setDryRunResult(result);
    setIsTestingRule(true);
  };

  const handleApplyToExisting = async () => {
    setIsApplyingExisting(true);
    try {
      const modified = await applyToExisting(selectedGroup === null ? autoRules : autoRules.filter(rule => (rule.groupName || 'General') === selectedGroup), transactions);
      if (modified === 0) return;
      setApplySuccessMessage(`Applied the rules to ${modified} transactions (saved).`);
      setIsTestingRule(false);
      setSafeTimeout(() => setApplySuccessMessage(null), 5000);
    } finally {
      setIsApplyingExisting(false);
    }
  };

  return { formError, draftActionPreview, formTargetAccountId, setFormTargetAccountId, formBankAccountId, setFormBankAccountId, formTransactionKind, setFormTransactionKind, chartAccounts, bankAccounts, applyError, canEditRules, disabledGroups, groupError, handleToggleGroup, handleRenameGroup, setRulePriority, isUpdatingGroup, formPriority, setFormPriority, withOccurrenceKeys, formId, currentRole, canBuildRules, autoRules, selectedGroup, setSelectedGroup, searchQuery, setSearchQuery, isCreatingRule, setIsCreatingRule, overlay2DialogProps, overlay2TitleId, editingRule, aiSentence, setAiSentence, isGeneratingAiRule, aiError, aiPreview, setAiPreview, dryRunResult, isTestingRule, setIsTestingRule, overlay1DialogProps, overlay1TitleId, isApplyingExisting, applySuccessMessage, setApplySuccessMessage, formName, setFormName, formGroup, setFormGroup, formDescContains, setFormDescContains, formVendor, setFormVendor, formCategory, setFormCategory, formAmountThreshold, setFormAmountThreshold, formTargetCategory, setFormTargetCategory, formTargetClass, setFormTargetClass, formTargetLocation, setFormTargetLocation, formAddTags, setFormAddTags, formFlagForReview, setFormFlagForReview, formStopOnMatch, setFormStopOnMatch, singleRuleTestResult, groups, filteredRules, handleToggleActive, handleDeleteRule, handleDuplicateRule, openCreateModal, openEditModal, handleSaveRule, handleTestSingleRule, handleGenerateAiRule, handleSaveAiRule, handleRunDryRun, handleApplyToExisting };
}

export type RulesSettingsModel = NonNullable<ReturnType<typeof useRulesSettingsModel>>;

export const RulesSettings: React.FC = () => {
  const userId = useAuthStore(state => state.user?.uid);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  return <RulesSettingsContent key={JSON.stringify([userId, workspaceId])} />;
};

const RulesSettingsContent: React.FC = () => {
  const model = useRulesSettingsModel();
  return <RulesSettingsView {...model} />;
};

export default RulesSettings;
