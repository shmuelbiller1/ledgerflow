import React, { useState, useId } from 'react';
import { useUIStore } from '../../../stores/useUIStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useTransactionActions } from '../../../hooks/useTransactionActions';
import { db } from '../../../firebase';
import { saveWorkspaceSettings } from '../../../lib/workspaceSettingsSave';
import { doc, updateDoc } from '../../../lib/db/firestore';
import { APP_TABS, SYSTEM_GLOSSARY } from '../../../config/registry';
import { Sliders, Eye, EyeOff, Search, Save, Calendar, Globe, Check, SlidersHorizontal, FolderLock, Plus, Trash2, AlertTriangle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import AsyncButton from '../../ui/AsyncButton';
import { useTimeout } from '../../../hooks/useTimeout';
import { Labelled } from '../../ui/Labelled';

export default function BlueprintSettings() {
  const settingsId = useId();
  const language = useUIStore(state => state.language);
  const hiddenTabs = useUIStore(state => state.hiddenTabs);
  const toggleTabVisibility = useUIStore(state => state.toggleTabVisibility);
  const lexiconOverrides = useUIStore(state => state.lexiconOverrides);
  const setLexiconOverride = useUIStore(state => state.setLexiconOverride);
  useUIStore(state => state.resetLexiconOverrides);

  const currentWorkspaceId = useAuthStore(state => state.currentWorkspaceId);
  const txActions = useTransactionActions();

  // Read lockDate and actions from ledger store
  const lockDate = useLedgerStore(state => state.lockDate);
  const baseCurrency = useLedgerStore(state => state.baseCurrency);
  const setBaseCurrency = useLedgerStore(state => state.setBaseCurrency);

  // Local state for customized inputs
  const [lexiconSearch, setLexiconSearch] = useState('');
  const [selectedLockDate, setSelectedLockDate] = useState(lockDate || '');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValEn, setEditValEn] = useState('');
  const [editValHe, setEditValHe] = useState('');

  // Active workspace & ledger accounts mapping state
  const workspaces = useAuthStore(state => state.workspaces);
  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);
  const accounts = useLedgerStore(state => state.accounts);

  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [newCatName, setNewCatName] = useState('');
  const [newCatAccountId, setNewCatAccountId] = useState('');
  const [, setIsSavingMappings] = useState(false);
  useState(false);
  const { setSafeTimeout } = useTimeout();

  // Sync mappings with workspace document
  React.useEffect(() => {
    if (currentWorkspace) {
      setSafeTimeout(() => setMappings(currentWorkspace.defaultAccountMappings || {}), 0);
    }
  }, [currentWorkspaceId, currentWorkspace, setSafeTimeout]);

  const handleUpdateMappingField = (key: string, value: string) => {
    setMappings(prev => ({ ...prev, [key]: value }));
  };

  const handleRemoveCategoryMapping = (key: string) => {
    setMappings(prev => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
  };

  const handleAddCategoryMapping = () => {
    if (!newCatName.trim()) {
      toast.error('Category Title Required', { description: 'Please specify the category name.' });
      return;
    }
    if (!newCatAccountId) {
      toast.error('Account Required', { description: 'Please select a ledger account.' });
      return;
    }
    const cleanKey = newCatName.trim().toLowerCase();
    setMappings(prev => ({ ...prev, [cleanKey]: newCatAccountId }));
    setNewCatName('');
    setNewCatAccountId('');
    toast.success('Category Mapping Staged', {
      description: `Rule for category "${cleanKey}" staged. Click Save to activate.`
    });
  };

  const handleSaveMappings = async () => {
    if (!currentWorkspaceId) return;
    setIsSavingMappings(true);
    try {
      await saveWorkspaceSettings(currentWorkspaceId, { defaultAccountMappings: mappings });
      toast.success('Ingestion Mappings Active', {
        description: 'Default transaction split and fallback routing channels updated.'
      });
    } catch (err) {
      console.error("Failed to commit default account mappings:", err);
      toast.error('Saving Failed', { description: (err as Error).message || String(err) });
    } finally {
      setIsSavingMappings(false);
    }
  };

  const renderAccountOptions = () => {
    const groups: Record<string, typeof accounts> = {};
    accounts.forEach(acc => {
      const type = acc.type || 'other';
      if (!groups[type]) groups[type] = [];
      groups[type].push(acc);
    });

    return (
      <>
        <option value="">-- Choose Account --</option>
        {Object.keys(groups).map(type => (
          <optgroup key={type} label={type.substring(0, 1).toUpperCase() + type.substring(1) + 's'} className="font-bold text-[10px]">
            {groups[type].map(acc => (
              <option key={acc.id} value={acc.id}>
                {acc.code ? `${acc.code} — ` : ''}{acc.name}
              </option>
            ))}
          </optgroup>
        ))}
      </>
    );
  };

  // Save the custom lock date
  const handleSaveLockDate = async () => {
    if (selectedLockDate) {
      await txActions.handleCloseMonth(selectedLockDate);
    } else {
      // Reopening needs a reason and the right role: it is done in Month-End Close.
      toast.info('To reopen a closed period, use Month-End Close (a reason is required).');
      useUIStore.getState().setActiveTab('month-end-close');
    }
  };

  // Switch workspace currency
  const handleSaveCurrency = async (curr: string) => {
    setBaseCurrency(curr);
    
    if (currentWorkspaceId) {
       try {
         await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
           currency: curr
         });
       } catch (err) {
         console.error("Failed to persist currency:", err);
       }
    }

    // Custom label trick: override the DollarSign default or app symbols
    setLexiconOverride('currencySymbol', 'en', curr === 'ILS' ? '₪' : curr === 'EUR' ? '€' : curr === 'GBP' ? '£' : '$');
    toast.success('Core Currency Recalibrated', {
      description: `Unified ledger values are mapped under ${curr} parameters.`
    });
  };

  // Glossary keys search
  const filteredGlossary = Object.keys(SYSTEM_GLOSSARY).filter(key => 
    key.toLowerCase().includes(lexiconSearch.toLowerCase()) || 
    SYSTEM_GLOSSARY[key].en.toLowerCase().includes(lexiconSearch.toLowerCase()) || 
    (SYSTEM_GLOSSARY[key].he && SYSTEM_GLOSSARY[key].he.toLowerCase().includes(lexiconSearch.toLowerCase()))
  );

  const startEditingGlossary = (key: string) => {
    const enVal = lexiconOverrides[key]?.en || SYSTEM_GLOSSARY[key].en;
    const heVal = lexiconOverrides[key]?.he || SYSTEM_GLOSSARY[key].he || '';
    setEditingKey(key);
    setEditValEn(enVal);
    setEditValHe(heVal);
  };

  const saveGlossaryOverride = (key: string) => {
    setLexiconOverride(key, 'en', editValEn);
    if (SYSTEM_GLOSSARY[key].he) {
      setLexiconOverride(key, 'he', editValHe);
    }
    setEditingKey(null);
    toast.success('Glossary Word Overestimated', {
      description: `"${key}" updated to reflect customized visual terminology.`
    });
  };

  return (
    <div className="space-y-12">
      {/* 1. Global Accounting Controls */}
      <div className="ledger-card p-4 md:p-10 bg-[var(--surface)] border border-[var(--line)] shadow-sm space-y-10">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 bg-zinc-950 text-white rounded-[32px] flex items-center justify-center">
            <SlidersHorizontal aria-hidden="true" size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[var(--text)] tracking-tight uppercase tracking-widest">Base Ledger Variables</h2>
            <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-[0.2em] mt-0.5">Core Accounting Configurations</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          {/* Base Currency Selector */}
          <div role="group" aria-labelledby={`${settingsId}-base-currency`} className="space-y-4">
            <span id={`${settingsId}-base-currency`} className="text-xs font-black uppercase text-[var(--text)] tracking-widest flex items-center gap-2">
              <Globe aria-hidden="true" size={13} className="text-zinc-500" />
              Institutional Base Currency
            </span>
            <p className="text-[11px] text-[var(--muted)] leading-relaxed">
              Standardize ledger currency codes across operational, forensic, and projection matrix layers.
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 bg-[var(--surface)] p-1.5 rounded-[32px] border border-[var(--line)]">
              {['USD', 'EUR', 'GBP', 'ILS', 'JPY', 'CAD'].map(curr => (
                <button
                  key={curr}
                  aria-pressed={baseCurrency === curr}
                  type="button"
                  onClick={() => handleSaveCurrency(curr)}
                  className={`py-3 text-xs font-bold rounded-xl transition-all ${
                    baseCurrency === curr 
                      ? 'bg-zinc-950 text-white shadow-xs' 
                      : 'hover:bg-zinc-100 text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {curr}
                </button>
              ))}
            </div>
          </div>

          {/* Ledger Hard Period Lock */}
          <div className="space-y-4">
            <label htmlFor={`${settingsId}-closing-date`} className="text-xs font-black uppercase text-[var(--text)] tracking-widest flex items-center gap-2">
              <FolderLock aria-hidden="true" size={13} className="text-zinc-500" />
              Accounting closing date
            </label>
            <p className="text-[11px] text-[var(--muted)] leading-relaxed">
              Restrict mutations to pre-dating items. Submitting transactions prior to this date triggers an immediate hard reject.
            </p>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <input
                  id={`${settingsId}-closing-date`}
                  type="date"
                  value={selectedLockDate}
                  onChange={(e) => setSelectedLockDate(e.target.value)}
                  className="w-full bg-[var(--surface)] hover:bg-[var(--ink)] border border-[var(--line)] focus:border-zinc-400 focus:outline-none p-3 pl-10 rounded-[32px] text-xs font-bold tracking-wider"
                />
                <Calendar aria-hidden="true" size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              </div>
              <AsyncButton
                type="button"
                onClick={handleSaveLockDate}
                loadingText="Applying..."
                className="px-6 bg-zinc-950 hover:bg-zinc-850 text-white rounded-[32px] text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all self-stretch"
              >
                <Check aria-hidden="true" size={13} />
                Apply
              </AsyncButton>
            </div>
          </div>
        </div>
      </div>

      {/* Ingestion Pipeline Mappings */}
      <div className="ledger-card p-4 md:p-10 bg-[var(--surface)] border border-[var(--line)] shadow-sm space-y-10 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--line)] pb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-zinc-900 text-white rounded-[32px] flex items-center justify-center shadow-lg shadow-zinc-900/10">
              <Zap aria-hidden="true" size={20} className="text-amber-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text)] tracking-tight uppercase tracking-widest font-display">Rule Ingestion Architecture</h2>
              <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-[0.2em] mt-0.5">Automated Accounts & Fallback Mappings</p>
            </div>
          </div>
          
          <AsyncButton
            type="button"
            onClick={handleSaveMappings}
            loadingText="Syncing..."
            className="px-6 py-3 bg-zinc-950 hover:bg-zinc-850 disabled:bg-zinc-300 text-white rounded-[32px] text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all self-stretch sm:self-auto justify-center"
          >
            <Save aria-hidden="true" size={12} />
            Save Mappings
          </AsyncButton>
        </div>

        {/* Global Warnings if fallbacks are missing */}
        {(!mappings['expense'] || !mappings['asset']) && (
          <div className="p-5 bg-amber-50 rounded-[32px] border border-amber-200 flex items-start gap-3.5">
            <AlertTriangle aria-hidden="true" className="text-amber-600 shrink-0 mt-0.5" size={16} />
            <div className="space-y-1">
              <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wider">Unmapped Fallback Warnings</h3>
              <p className="text-[11px] text-amber-700 leading-relaxed font-semibold uppercase tracking-wide">
                Transactions uploaded via API or scanned via OCR cannot be saved without default fallbacks. Configure Debit Fallback (expense) and Credit Fallback (asset) immediately.
              </p>
            </div>
          </div>
        )}

        {/* Fallback Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Debit Fallback (Expense) */}
          <div className="space-y-3 p-6 bg-[var(--ink)]/50 rounded-[32px] border border-[var(--line)]">
            <label htmlFor={`${settingsId}-debit-fallback`} className="text-xs font-black uppercase text-[var(--text)] tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              Debit Fallback Account (expense)
            </label>
            <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wide">
              The default ledger subaccount selected for transaction debits when the category is unclassified.
            </p>
            <select
              id={`${settingsId}-debit-fallback`}
              value={mappings['expense'] || ''}
              onChange={(e) => handleUpdateMappingField('expense', e.target.value)}
              className="w-full bg-[var(--surface)] border border-[var(--line)] focus:border-zinc-400 focus:outline-none p-3.5 rounded-[32px] text-xs font-bold tracking-wider cursor-pointer"
            >
              {renderAccountOptions()}
            </select>
          </div>

          {/* Credit Fallback (Asset) */}
          <div className="space-y-3 p-6 bg-[var(--ink)]/50 rounded-[32px] border border-[var(--line)]">
            <label htmlFor={`${settingsId}-credit-fallback`} className="text-xs font-black uppercase text-[var(--text)] tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Credit Fallback Account (asset)
            </label>
            <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wide">
              The default ledger asset/cash subaccount selected for credit double-entry offsets in ingestion pipelines.
            </p>
            <select
              id={`${settingsId}-credit-fallback`}
              value={mappings['asset'] || ''}
              onChange={(e) => handleUpdateMappingField('asset', e.target.value)}
              className="w-full bg-[var(--surface)] border border-[var(--line)] focus:border-zinc-400 focus:outline-none p-3.5 rounded-[32px] text-xs font-bold tracking-wider cursor-pointer"
            >
              {renderAccountOptions()}
            </select>
          </div>
        </div>

        {/* Category Specific Overrides */}
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--line)] pb-4">
            <h3 className="text-xs font-black text-[var(--text)] uppercase tracking-widest">Category-Specific Routing Exclusions</h3>
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--muted)]">
              {Object.keys(mappings).filter(k => k !== 'expense' && k !== 'asset').length} rules registered
            </span>
          </div>

          <div className="space-y-4 max-h-64 overflow-y-auto custom-scrollbar p-1">
            {Object.keys(mappings)
              .filter(k => k !== 'expense' && k !== 'asset')
              .map(categoryKey => {
                const mappedAccountId = mappings[categoryKey];
                const matchingAccount = accounts.find(a => a.id === mappedAccountId);
                return (
                  <div key={categoryKey} className="flex items-center justify-between gap-4 p-4 hover:bg-[var(--ink)] border border-[var(--line)] rounded-[32px] transition-all">
                    <div className="flex items-center gap-3">
                      <div className="px-3 py-1.5 bg-zinc-100 text-[var(--text)] rounded-xl text-[10px] font-bold uppercase tracking-wider font-mono">
                        {categoryKey}
                      </div>
                      <div className="flex items-center gap-2 text-xs font-bold text-[var(--muted)]">
                        <span>→</span>
                        <span className="text-[var(--text)] font-display">
                          {matchingAccount ? `${matchingAccount.name} (${matchingAccount.type.toUpperCase()})` : 'Unknown Account'}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      aria-label={`Delete category mapping rule for ${categoryKey}`}
                      onClick={() => handleRemoveCategoryMapping(categoryKey)}
                      className="p-2 text-[var(--muted)] hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all cursor-pointer"
                      title="Delete category mapping rule"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </button>
                  </div>
                );
              })}

            {Object.keys(mappings).filter(k => k !== 'expense' && k !== 'asset').length === 0 && (
              <div className="py-6 text-center text-xs font-bold text-[var(--muted)] uppercase tracking-widest leading-relaxed">
                No category-specific overrides configured. All categories default to general fallbacks.
              </div>
            )}
          </div>

          {/* Add Option Form */}
          <div className="pt-4 border-t border-[var(--line)] grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Labelled labelClassName="text-[9px] font-black text-[var(--muted)] uppercase tracking-wider" label="Category Name (Lower-Case Match)">
                <input
                  type="text"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="e.g. software, rent, utilities"
                  className="w-full bg-[var(--surface)] hover:bg-[var(--ink)] border border-[var(--line)] focus:border-zinc-400 focus:outline-none p-3 rounded-[32px] text-xs font-bold tracking-wider"
                />
              </Labelled>
            </div>
            <div className="space-y-2">
              <Labelled labelClassName="text-[9px] font-black text-[var(--muted)] uppercase tracking-wider" label="Debit Override Account">
                <select
                  value={newCatAccountId}
                  onChange={(e) => setNewCatAccountId(e.target.value)}
                  className="w-full bg-[var(--surface)] hover:bg-[var(--ink)] border border-[var(--line)] focus:border-zinc-400 focus:outline-none p-3 rounded-[32px] text-xs font-bold tracking-wider cursor-pointer"
                >
                  {renderAccountOptions()}
                </select>
              </Labelled>
            </div>
            <button
              type="button"
              onClick={handleAddCategoryMapping}
              className="py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-[32px] text-xs font-medium uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md"
             aria-label="Add Override Rule">
              <Plus aria-hidden="true" size={14} strokeWidth={3} />
              Add Override Rule
            </button>
          </div>
        </div>
      </div>

      {/* 2. Visual Tab Visibility Controller */}
      <div className="ledger-card p-4 md:p-10 bg-[var(--surface)] border border-[var(--line)] shadow-sm space-y-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600 text-white rounded-[32px] flex items-center justify-center shadow-lg shadow-indigo-600/15">
            <Eye aria-hidden="true" size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[var(--text)] tracking-tight uppercase tracking-widest font-display">Workflow Tab Architect</h2>
            <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-[0.2em] mt-0.5">Workspace Navigation Elasticity</p>
          </div>
        </div>

        <p className="text-xs text-[var(--muted)] leading-relaxed max-w-2xl">
          Toggle sidebar layout items on-the-fly. Hiding system items instantly streamlines employee access pipelines, allowing you to fine-tune your custom operations portal.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 h-[350px] overflow-y-auto custom-scrollbar p-1">
          {APP_TABS.map(tab => {
            const isHidden = hiddenTabs.includes(tab.id);
            return (
              <button type="button"
                key={tab.id}
                aria-pressed={!isHidden}
                onClick={() => toggleTabVisibility(tab.id)}
                className={`w-full text-left p-5 rounded-[32px] border transition-all flex items-center justify-between cursor-pointer group ${
                  isHidden 
                    ? 'border-gray-200 bg-gray-50/50 text-[var(--muted)] hover:border-gray-300' 
                    : 'border-[var(--line)] hover:border-indigo-200 bg-[var(--surface)] text-[var(--text)] shadow-xs'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                    isHidden 
                      ? 'bg-gray-100 text-gray-400' 
                      : 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100'
                  }`}>
                    {React.createElement(tab.icon, { size: 16, 'aria-hidden': true })}
                  </div>
                  <div className="text-left">
                    <p className={`text-xs font-black uppercase tracking-wider ${isHidden ? 'line-through text-gray-400' : 'text-[var(--text)]'}`}>
                      {((tab as typeof tab & { name?: string }).label?.[language] || (tab as typeof tab & { name?: string }).label?.['en']) || (tab as typeof tab & { name?: string }).name || tab.id}
                    </p>
                    <p className="text-[9px] text-gray-400 font-mono tracking-tight capitalize mt-0.5">{tab.groupId} module</p>
                  </div>
                </div>

                <div className="flex items-center">
                  {isHidden ? (
                    <div className="p-1.5 rounded-lg bg-gray-100 text-gray-400" title="Hidden Tab">
                      <EyeOff aria-hidden="true" size={13} />
                    </div>
                  ) : (
                    <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600" title="Active Tab">
                      <Eye aria-hidden="true" size={13} />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Text Glossary Customizer */}
      <div className="ledger-card p-4 md:p-10 bg-[var(--surface)] border border-[var(--line)] shadow-sm space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-600 text-white rounded-[32px] flex items-center justify-center shadow-lg shadow-amber-600/15">
              <Sliders aria-hidden="true" size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text)] tracking-tight uppercase tracking-widest">Aesthetic Nomenclature Registry</h2>
              <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-[0.2em] mt-0.5 font-display">System-Wide Glossary Patch Engine</p>
            </div>
          </div>

          <div className="relative">
            <input
              type="text"
              aria-label="Search glossary labels"
              placeholder="Search labels..."
              value={lexiconSearch}
              onChange={(e) => setLexiconSearch(e.target.value)}
              className="bg-[var(--surface)] p-2.5 pl-9 pr-4 text-xs font-bold hover:bg-[var(--ink)] border border-[var(--line)] focus:border-zinc-400 focus:outline-none rounded-xl w-60 tracking-wider"
            />
            <Search aria-hidden="true" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          </div>
        </div>

        <p className="text-xs text-[var(--muted)] leading-relaxed max-w-2xl">
          Quickly edit titles and descriptive terminology throughout the interface. To override labels permanently, modify words directly in the registry fields below.
        </p>

        <div className="max-h-96 overflow-y-auto custom-scrollbar border border-[var(--line)] rounded-[32px] bg-[var(--surface)] divide-y divide-ledger-line">
          {filteredGlossary.map(key => {
            const hasOverride = !!lexiconOverrides[key];
            const isEditing = editingKey === key;
            const originalVal = SYSTEM_GLOSSARY[key];

            return (
              <div key={key} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:bg-[var(--ink)]/50 transition-colors">
                <div className="space-y-1.5 md:max-w-md">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-indigo-600 tracking-tight">{key}</span>
                    {hasOverride && (
                      <span className="text-[8px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider">Overridden</span>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="text-xs space-y-1 text-gray-700">
                      <p><span className="text-gray-400 font-bold mr-1">[EN]</span> {lexiconOverrides[key]?.en || originalVal.en}</p>
                      {originalVal.he && (
                        <p><span className="text-gray-400 font-bold mr-1">[HE]</span> {lexiconOverrides[key]?.he || originalVal.he}</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 self-end md:self-auto">
                  {isEditing ? (
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="text"
                        aria-label={`English override for ${key}`}
                        value={editValEn}
                        onChange={(e) => setEditValEn(e.target.value)}
                        placeholder="English Override..."
                        className="p-2 border border-zinc-300 rounded-xl text-xs font-bold bg-[var(--surface)] focus:outline-none min-w-[150px]"
                      />
                      {originalVal.he && (
                        <input
                          type="text"
                          aria-label={`Hebrew override for ${key}`}
                          value={editValHe}
                          onChange={(e) => setEditValHe(e.target.value)}
                          placeholder="Hebrew Override..."
                          className="p-2 border border-zinc-300 rounded-xl text-xs font-bold bg-[var(--surface)] focus:outline-none min-w-[150px]"
                        />
                      )}
                      <button
                        onClick={() => saveGlossaryOverride(key)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-medium uppercase tracking-wider rounded-xl transition-all"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingKey(null)}
                        className="px-3 py-1.5 border border-gray-300 hover:bg-gray-100 text-gray-600 text-[10px] font-medium uppercase tracking-wider rounded-xl transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEditingGlossary(key)}
                      className="px-4 py-2 border border-[var(--line)] hover:border-zinc-400 bg-[var(--surface)] rounded-xl text-[10px] font-medium uppercase tracking-wider text-[#3d3d3d] transition-all"
                    >
                      Customize Override
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
