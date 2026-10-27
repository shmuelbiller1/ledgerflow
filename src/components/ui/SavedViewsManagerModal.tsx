import { useDialog } from '../../hooks/useDialog';
import React, { useState, useMemo, useId } from 'react';
import { useSavedViewsStore, computeSavedViewMetrics, SavedView, SavedViewFilter } from '../../stores/useSavedViewsStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, parseAmountToCents, cn } from '../../lib/utils';
import { 
  X, Plus, Star, Check, Trash2, Edit3, Copy, Search, Filter, Eye,
  Wallet, TrendingUp, TrendingDown, Tag, Clock, ShieldAlert, Building, FolderKanban, DollarSign, Sparkles, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { Labelled } from './Labelled';

const AVAILABLE_ICONS = [
  { name: 'Wallet', icon: Wallet, label: 'Wallet / Cash' },
  { name: 'TrendingUp', icon: TrendingUp, label: 'Revenue / Inflow' },
  { name: 'TrendingDown', icon: TrendingDown, label: 'Expense / Outflow' },
  { name: 'Tag', icon: Tag, label: 'Tax / Categories' },
  { name: 'Clock', icon: Clock, label: 'Pending / Time' },
  { name: 'ShieldAlert', icon: ShieldAlert, label: 'Critical / Audit' },
  { name: 'Building', icon: Building, label: 'Bank / Entity' },
  { name: 'FolderKanban', icon: FolderKanban, label: 'Projects' },
  { name: 'DollarSign', icon: DollarSign, label: 'Money / Cashflow' },
  { name: 'Sparkles', icon: Sparkles, label: 'Smart Lens' },
  { name: 'Filter', icon: Filter, label: 'Custom Filter' }
];

const PRESET_COLORS = [
  '#10b981',
  '#3b82f6',
  '#ef4444',
  '#8b5cf6',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#6366f1',
  '#64748b'
];

interface SavedViewsManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SavedViewsManagerModal({ isOpen, onClose }: SavedViewsManagerModalProps) {
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(onClose, isOpen);
  const formId = useId();
  const views = useSavedViewsStore(s => s.views);
  const activeViewId = useSavedViewsStore(s => s.activeViewId);
  const setActiveView = useSavedViewsStore(s => s.setActiveView);
  const addSavedView = useSavedViewsStore(s => s.addSavedView);
  const updateSavedView = useSavedViewsStore(s => s.updateSavedView);
  const deleteSavedView = useSavedViewsStore(s => s.deleteSavedView);
  const toggleDefaultView = useSavedViewsStore(s => s.toggleDefaultView);
  const togglePinView = useSavedViewsStore(s => s.togglePinView);
  const resetToDefaultViews = useSavedViewsStore(s => s.resetToDefaultViews);

  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  useLedgerCollections('bills', 'invoices');

  const [searchQuery, setSearchQuery] = useState('');
  const [editingView, setEditingView] = useState<SavedView | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    icon: string;
    color: string;
    isDefault: boolean;
    isPinned: boolean;
    targetTab: 'transactions' | 'ledger' | 'sales' | 'purchases' | 'reports' | 'all';
    filter: SavedViewFilter;
  }>({
    name: '',
    description: '',
    icon: 'Wallet',
    color: '#3b82f6',
    isDefault: false,
    isPinned: true,
    targetTab: 'all',
    filter: {
      searchTerm: '',
      minAmountCents: undefined,
      maxAmountCents: undefined,
      status: 'all',
      type: 'all',
      isTaxDeductibleOnly: false,
    }
  });

  const filteredViews = useMemo(() => {
    if (!searchQuery.trim()) return views;
    const q = searchQuery.toLowerCase();
    return views.filter(v => 
      v.name.toLowerCase().includes(q) || 
      (v.description || '').toLowerCase().includes(q) ||
      (v.filter.searchTerm || '').toLowerCase().includes(q)
    );
  }, [views, searchQuery]);

  const handleStartCreate = () => {
    setEditingView(null);
    setFormData({
      name: 'New Custom View',
      description: 'Filter rule set tracking specific cash or ledger criteria',
      icon: 'Filter',
      color: '#10b981',
      isDefault: false,
      isPinned: true,
      targetTab: 'all',
      filter: {
        searchTerm: '',
        status: 'all',
        type: 'all'
      }
    });
    setIsCreating(true);
  };

  const handleStartEdit = (view: SavedView) => {
    setEditingView(view);
    setFormData({
      name: view.name,
      description: view.description || '',
      icon: view.icon || 'Filter',
      color: view.color || '#3b82f6',
      isDefault: !!view.isDefault,
      isPinned: !!view.isPinned,
      targetTab: view.targetTab || 'all',
      filter: { ...view.filter }
    });
    setIsCreating(true);
  };

  const handleSaveForm = () => {
    if (!formData.name.trim()) {
      toast.error('Please enter a view name');
      return;
    }

    if (editingView) {
      updateSavedView(editingView.id, {
        name: formData.name.trim(),
        description: formData.description.trim(),
        icon: formData.icon,
        color: formData.color,
        isDefault: formData.isDefault,
        isPinned: formData.isPinned,
        targetTab: formData.targetTab,
        filter: formData.filter
      });
      toast.success(`Updated view "${formData.name}"`);
    } else {
      addSavedView({
        name: formData.name.trim(),
        description: formData.description.trim(),
        icon: formData.icon,
        color: formData.color,
        isDefault: formData.isDefault,
        isPinned: formData.isPinned,
        targetTab: formData.targetTab,
        filter: formData.filter
      });
      toast.success(`Created view "${formData.name}"`);
    }

    setIsCreating(false);
    setEditingView(null);
  };

  const handleDuplicate = (view: SavedView) => {
    addSavedView({
      name: `${view.name} (Copy)`,
      description: view.description,
      icon: view.icon,
      color: view.color,
      isDefault: false,
      isPinned: true,
      targetTab: view.targetTab,
      filter: { ...view.filter }
    });
    toast.success(`Duplicated "${view.name}"`);
  };

  if (!isOpen) return null;

  return (
    <div {...overlayDialogProps} className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-[var(--surface-card)] border border-[var(--line)] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[var(--text)]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)] bg-[var(--surface-elevated)]/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[var(--brass)]/15 border border-[var(--brass)]/30 text-[var(--brass)]">
              <Filter aria-hidden="true" size={20} />
            </div>
            <div>
              <h2 id={overlayTitleId} className="text-lg font-bold">Saved Views & Default Lenses</h2>
              <p className="text-xs text-[var(--muted)]">
                Configure multiple default views, customized search filters, and live monetary balance tracking.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-[var(--muted)] hover:text-[var(--text)] rounded-lg hover:bg-[var(--line)] transition-colors cursor-pointer"
           aria-label="Close saved views dialog">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-6 space-y-6">
          
          {!isCreating && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search aria-hidden="true" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  aria-label="Search saved views"
                  type="text"
                  placeholder="Search saved views..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs bg-[var(--bg)] border border-[var(--line)] rounded-xl text-[var(--text)] focus:outline-none focus:border-[var(--brass)]"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={resetToDefaultViews}
                  className="px-3 py-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] border border-[var(--line)] rounded-xl hover:bg-[var(--line)]/50 transition-all cursor-pointer"
                 aria-label="Reset Presets">
                  Reset Presets
                </button>
                
                <button
                  onClick={handleStartCreate}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[var(--brass)] text-[var(--ink)] rounded-xl hover:opacity-90 shadow-xs transition-all cursor-pointer"
                 aria-label="Create Custom View">
                  <Plus aria-hidden="true" size={15} />
                  <span>Create Custom View</span>
                </button>
              </div>
            </div>
          )}

          {isCreating && (
            <div className="bg-[var(--surface-elevated)] p-5 rounded-2xl border border-[var(--brass)]/40 shadow-xs space-y-5 animate-in fade-in duration-150">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
                <h3 className="text-sm font-bold text-[var(--brass)]">
                  {editingView ? `Edit View: ${editingView.name}` : 'Create New Saved View'}
                </h3>
                <button
                  onClick={() => setIsCreating(false)}
                  className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                <div className="space-y-3">
                  <div>
                    <Labelled labelClassName="block text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-1" label="View Name *">
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g. Operating Liquidity"
                        className="w-full px-3 py-2 text-xs bg-[var(--bg)] border border-[var(--line)] rounded-lg text-[var(--text)] focus:border-[var(--brass)] outline-none"
                      />
                    </Labelled>
                  </div>

                  <div>
                    <Labelled labelClassName="block text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-1" label="Description">
                      <input
                        type="text"
                        value={formData.description}
                        onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Short summary of this filter lens"
                        className="w-full px-3 py-2 text-xs bg-[var(--bg)] border border-[var(--line)] rounded-lg text-[var(--text)] focus:border-[var(--brass)] outline-none"
                      />
                    </Labelled>
                  </div>

                  <div>
                    <div id={`${formId}-icon-color`} className="block text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-1">
                      Icon & Badge Color
                    </div>
                    <div role="group" aria-label="View icon" className="flex flex-wrap gap-2 mb-2">
                      {AVAILABLE_ICONS.map(item => {
                        const IconComp = item.icon;
                        const isSelected = formData.icon === item.name;
                        return (
                          <button
                            key={item.name}
                            type="button"
                            onClick={() => setFormData(prev => ({ ...prev, icon: item.name }))}
                            title={item.label}
                            aria-label={item.label}
                            aria-pressed={isSelected}
                            className={cn(
                              "p-2 rounded-lg border transition-all cursor-pointer",
                              isSelected 
                                ? "bg-[var(--brass)]/20 border-[var(--brass)] text-[var(--brass)] scale-105" 
                                : "bg-[var(--bg)] border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]"
                            )}
                          >
                            <IconComp size={16} />
                          </button>
                        );
                      })}
                    </div>

                    <div role="group" aria-label="Badge color" className="flex items-center gap-2">
                      {PRESET_COLORS.map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, color: c }))}
                          aria-label={`Colour ${c}`}
                          aria-pressed={formData.color === c}
                          className={cn(
                            "w-6 h-6 rounded-full border-2 transition-transform cursor-pointer",
                            formData.color === c ? "border-white scale-110 shadow-xs" : "border-transparent opacity-80 hover:opacity-100"
                          )}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-6 pt-2">
                    <label htmlFor={`${formId}-default`} className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                      <input
                        id={`${formId}-default`}
                        type="checkbox"
                        checked={formData.isDefault}
                        onChange={(e) => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
                        className="rounded border-[var(--line)] text-[var(--brass)] focus:ring-0"
                      />
                      <span>Default View (Allowed Multiple)</span>
                    </label>

                    <label htmlFor={`${formId}-pinned`} className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                      <input
                        id={`${formId}-pinned`}
                        type="checkbox"
                        checked={formData.isPinned}
                        onChange={(e) => setFormData(prev => ({ ...prev, isPinned: e.target.checked }))}
                        className="rounded border-[var(--line)] text-[var(--brass)] focus:ring-0"
                      />
                      <span>Pin to Top View Bar</span>
                    </label>
                  </div>
                </div>

                <div className="space-y-3 bg-[var(--bg)] p-4 rounded-xl border border-[var(--line)]">
                  <h4 className="text-xs font-bold text-[var(--text)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Filter aria-hidden="true" size={13} className="text-[var(--brass)]" />
                    <span>Filter Rules</span>
                  </h4>

                  <div>
                    <Labelled labelClassName="block text-[10px] font-semibold text-[var(--muted)] uppercase mb-1" label="Search Keywords / Term">
                      <input
                        type="text"
                        value={formData.filter.searchTerm || ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          filter: { ...prev.filter, searchTerm: e.target.value }
                        }))}
                        placeholder="e.g. cash, Apple, tax, payroll..."
                        className="w-full px-3 py-1.5 text-xs bg-[var(--surface-card)] border border-[var(--line)] rounded-lg text-[var(--text)] outline-none"
                      />
                    </Labelled>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Labelled labelClassName="block text-[10px] font-semibold text-[var(--muted)] uppercase mb-1" label="Min Amount ($)">
                        <input
                          type="number"
                          value={formData.filter.minAmountCents !== undefined ? formData.filter.minAmountCents / 100 : ''}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            filter: { 
                              ...prev.filter, 
                              minAmountCents: e.target.value ? parseAmountToCents(e.target.value) : undefined 
                            }
                          }))}
                          placeholder="0.00"
                          className="w-full px-3 py-1.5 text-xs bg-[var(--surface-card)] border border-[var(--line)] rounded-lg text-[var(--text)] outline-none"
                        />
                      </Labelled>
                    </div>

                    <div>
                      <Labelled labelClassName="block text-[10px] font-semibold text-[var(--muted)] uppercase mb-1" label="Max Amount ($)">
                        <input
                          type="number"
                          value={formData.filter.maxAmountCents !== undefined ? formData.filter.maxAmountCents / 100 : ''}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            filter: { 
                              ...prev.filter, 
                              maxAmountCents: e.target.value ? parseAmountToCents(e.target.value) : undefined 
                            }
                          }))}
                          placeholder="Unlimited"
                          className="w-full px-3 py-1.5 text-xs bg-[var(--surface-card)] border border-[var(--line)] rounded-lg text-[var(--text)] outline-none"
                        />
                      </Labelled>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Labelled labelClassName="block text-[10px] font-semibold text-[var(--muted)] uppercase mb-1" label="Transaction Type">
                        <select
                          value={formData.filter.type || 'all'}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            filter: { ...prev.filter, type: e.target.value }
                          }))}
                          className="w-full px-3 py-1.5 text-xs bg-[var(--surface-card)] border border-[var(--line)] rounded-lg text-[var(--text)] outline-none"
                        >
                          <option value="all">All Types</option>
                          <option value="income">Income / Revenue (+)</option>
                          <option value="expense">Expense / Outflow (-)</option>
                        </select>
                      </Labelled>
                    </div>

                    <div>
                      <Labelled labelClassName="block text-[10px] font-semibold text-[var(--muted)] uppercase mb-1" label="Status">
                        <select
                          value={formData.filter.status || 'all'}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            filter: { ...prev.filter, status: e.target.value }
                          }))}
                          className="w-full px-3 py-1.5 text-xs bg-[var(--surface-card)] border border-[var(--line)] rounded-lg text-[var(--text)] outline-none"
                        >
                          <option value="all">All Statuses</option>
                          <option value="posted">Posted</option>
                          <option value="pending">Pending</option>
                        </select>
                      </Labelled>
                    </div>
                  </div>

                  <div className="pt-2">
                    <label htmlFor={`${formId}-deductible`} className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[var(--text-secondary)]">
                      <input
                        id={`${formId}-deductible`}
                        type="checkbox"
                        checked={!!formData.filter.isTaxDeductibleOnly}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          filter: { ...prev.filter, isTaxDeductibleOnly: e.target.checked }
                        }))}
                        className="rounded border-[var(--line)] text-[var(--brass)] focus:ring-0"
                      />
                      <span>Only Tax Deductible Items</span>
                    </label>
                  </div>
                </div>

              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--line)]">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-2 text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveForm}
                  className="px-5 py-2 text-xs font-semibold bg-[var(--brass)] text-[var(--ink)] rounded-xl hover:opacity-90 shadow-xs"
                 aria-label="Save View Config">
                  Save View Config
                </button>
              </div>
            </div>
          )}

          {!isCreating && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-[var(--muted)] uppercase tracking-wider px-1">
                <span>Configured Views ({filteredViews.length})</span>
                <span>Live Money Metrics</span>
              </div>

              {filteredViews.length === 0 ? (
                <div className="p-8 text-center bg-[var(--bg)] rounded-2xl border border-[var(--line)] text-[var(--muted)]">
                  <AlertCircle aria-hidden="true" size={24} className="mx-auto mb-2 opacity-50" />
                  <p className="text-xs">No saved views match your search criteria.</p>
                </div>
              ) : (
                filteredViews.map((view) => {
                  const IconComp = AVAILABLE_ICONS.find(i => i.name === view.icon)?.icon || Filter;
                  const metrics = computeSavedViewMetrics(view, transactions, accounts, invoices, bills);
                  const isActive = activeViewId === view.id;

                  return (
                    <div
                      key={view.id}
                      className={cn(
                        "group flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 rounded-xl border transition-all",
                        isActive
                          ? "bg-[var(--brass)]/10 border-[var(--brass)] shadow-xs"
                          : "bg-[var(--surface-elevated)] border-[var(--line)] hover:border-[var(--line-strong)]"
                      )}
                    >
                      <div className="flex items-start gap-3.5 flex-1 min-w-0">
                        <div
                          className="p-2.5 rounded-xl text-white flex items-center justify-center shrink-0 shadow-xs"
                          style={{ backgroundColor: view.color || '#3b82f6' }}
                        >
                          <IconComp size={18} />
                        </div>

                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-[var(--text)] truncate">{view.name}</span>

                            {view.isDefault && (
                              <span className="text-[9px] px-1.5 py-0.5 bg-[var(--brass)]/20 text-[var(--brass)] rounded font-semibold uppercase tracking-wider">
                                Default View
                              </span>
                            )}

                            {view.isPinned && (
                              <span className="text-[9px] px-1.5 py-0.5 bg-amber-400/20 text-amber-400 rounded font-semibold uppercase tracking-wider flex items-center gap-0.5">
                                <Star aria-hidden="true" size={9} className="fill-amber-400" />
                                Pinned
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-[var(--muted)] truncate mt-0.5">
                            {view.description || 'Custom ledger view'}
                          </p>

                          <div className="flex items-center gap-3 mt-2 text-[10px] text-[var(--text-muted)] font-mono">
                            {view.filter.searchTerm && (
                              <span>Query: <strong className="text-[var(--text)]">"{view.filter.searchTerm}"</strong></span>
                            )}
                            {view.filter.minAmountCents !== undefined && (
                              <span>Min: <strong className="text-[var(--text)]">{formatCurrency(view.filter.minAmountCents)}</strong></span>
                            )}
                            {view.filter.type && view.filter.type !== 'all' && (
                              <span>Type: <strong className="text-[var(--text)] uppercase">{view.filter.type}</strong></span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between md:justify-end gap-5 w-full md:w-auto border-t md:border-t-0 pt-3 md:pt-0 border-[var(--line)]">
                        <div className="text-right">
                          <div className="text-base font-bold text-[var(--text)] tracking-tight tabular-nums">
                            {formatCurrency(metrics.totalMoneyCents)}
                          </div>
                          <div className="text-[10px] text-[var(--muted)] flex items-center justify-end gap-2 mt-0.5">
                            <span>{metrics.matchingCount} entries</span>
                            <span>•</span>
                            <span className="text-emerald-500 font-medium tabular-nums">+{formatCurrency(metrics.moneyInCents)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => {
                              setActiveView(view.id);
                              onClose();
                            }}
                            className={cn(
                              "px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1",
                              isActive
                                ? "bg-[var(--brass)] text-[var(--ink)]"
                                : "bg-[var(--bg)] border border-[var(--line)] text-[var(--text)] hover:bg-[var(--line)]/50"
                            )}
                          >
                            <Eye aria-hidden="true" size={12} />
                            <span>{isActive ? 'Active' : 'Apply'}</span>
                          </button>

                          <button
                            onClick={() => toggleDefaultView(view.id)}
                            aria-label={`${view.isDefault ? 'Unset' : 'Set'} ${view.name} as default view`}
                            aria-pressed={view.isDefault}
                            title={view.isDefault ? "Unset as Default" : "Set as Default View"}
                            className={cn(
                              "p-1.5 rounded-lg border text-xs transition-colors cursor-pointer",
                              view.isDefault 
                                ? "bg-[var(--brass)]/20 border-[var(--brass)] text-[var(--brass)]" 
                                : "bg-[var(--bg)] border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]"
                            )}
                          >
                            <Check aria-hidden="true" size={14} />
                          </button>

                          <button
                            onClick={() => togglePinView(view.id)}
                            aria-label={`${view.isPinned ? 'Unpin' : 'Pin'} ${view.name}`}
                            aria-pressed={view.isPinned}
                            title={view.isPinned ? "Unpin from header bar" : "Pin to header bar"}
                            className={cn(
                              "p-1.5 rounded-lg border text-xs transition-colors cursor-pointer",
                              view.isPinned 
                                ? "bg-amber-400/20 border-amber-400/40 text-amber-400" 
                                : "bg-[var(--bg)] border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]"
                            )}
                          >
                            <Star aria-hidden="true" size={14} className={cn(view.isPinned && "fill-amber-400")} />
                          </button>

                          <button
                            onClick={() => handleDuplicate(view)}
                            aria-label={`Duplicate view ${view.name}`}
                            title="Duplicate view"
                            className="p-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
                          >
                            <Copy aria-hidden="true" size={14} />
                          </button>

                          <button
                            onClick={() => handleStartEdit(view)}
                            aria-label={`Edit rules for view ${view.name}`}
                            title="Edit view rules"
                            className="p-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
                          >
                            <Edit3 aria-hidden="true" size={14} />
                          </button>

                          <button
                            onClick={() => {
                              if (confirm(`Delete saved view "${view.name}"?`)) {
                                deleteSavedView(view.id);
                              }
                            }}
                            title="Delete view"
                            aria-label={`Delete view ${view.name}`}
                            className="p-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-[var(--muted)] hover:text-red-400 transition-colors cursor-pointer"
                          >
                            <Trash2 aria-hidden="true" size={14} />
                          </button>
                        </div>

                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

        </div>

        <div className="p-4 border-t border-[var(--line)] bg-[var(--surface-elevated)]/50 flex items-center justify-between text-xs text-[var(--muted)]">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Multiple Default Views Enabled</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 font-semibold bg-[var(--bg)] border border-[var(--line)] text-[var(--text)] rounded-xl hover:bg-[var(--line)]/50 transition-all cursor-pointer"
           aria-label="Close">
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
