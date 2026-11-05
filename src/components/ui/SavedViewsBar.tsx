import React, { useState } from 'react';
import { useSavedViewsStore, computeSavedViewMetrics } from '../../stores/useSavedViewsStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency } from '../../lib/utils';
import { 
  Wallet, TrendingUp, TrendingDown, Tag, Clock, ShieldAlert, 
  Building, FolderKanban, DollarSign, Sparkles, Filter, Plus, Star, SlidersHorizontal
} from 'lucide-react';
import { cn } from '../../lib/utils';
import SavedViewsManagerModal from './SavedViewsManagerModal';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { focusOnMount } from '../../lib/focusOnMount';

const ICON_MAP: Record<string, React.ElementType> = {
  Wallet,
  TrendingUp,
  TrendingDown,
  Tag,
  Clock,
  ShieldAlert,
  Building,
  FolderKanban,
  DollarSign,
  Sparkles,
  Filter
};

interface SavedViewsBarProps {
  currentSearchTerm?: string;
  onOpenAdvancedSearch?: () => void;
  className?: string;
}

export default function SavedViewsBar({ currentSearchTerm, className }: SavedViewsBarProps) {
  const views = useSavedViewsStore(s => s.views);
  const activeViewId = useSavedViewsStore(s => s.activeViewId);
  const setActiveView = useSavedViewsStore(s => s.setActiveView);
  const togglePinView = useSavedViewsStore(s => s.togglePinView);
  const addSavedView = useSavedViewsStore(s => s.addSavedView);

  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  useLedgerCollections('bills', 'invoices');

  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [isSavePromptOpen, setIsSavePromptOpen] = useState(false);
  const [newViewName, setNewViewName] = useState('');

  const displayViews = views.filter(v => v.isPinned || v.isDefault);

  const handleQuickSaveCurrent = () => {
    if (!newViewName.trim()) return;
    addSavedView({
      name: newViewName.trim(),
      description: `Custom search view for "${currentSearchTerm || 'filtered view'}"`,
      icon: 'Filter',
      color: '#3b82f6',
      isPinned: true,
      isDefault: false,
      filter: {
        searchTerm: currentSearchTerm || ''
      }
    });
    setNewViewName('');
    setIsSavePromptOpen(false);
  };

  return (
    <div className={cn("w-full bg-[var(--surface-card)] border border-[var(--line)] rounded-xl p-3 shadow-xs transition-all", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        
        {/* Left: View Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 max-w-full">
          <div className="flex items-center gap-1 pr-2 border-r border-[var(--line)] shrink-0">
            <Filter aria-hidden="true" size={14} className="text-[var(--muted)]" />
            <span className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">Views</span>
          </div>

          {displayViews.map((view) => {
            const IconComponent = ICON_MAP[view.icon || 'Filter'] || Filter;
            const metrics = computeSavedViewMetrics(view, transactions, accounts, invoices, bills);
            const isActive = activeViewId === view.id;

            return (
              <div
                key={view.id}
                className={cn(
                  "group relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 border select-none",
                  isActive
                    ? "bg-[var(--brass)]/15 border-[var(--brass)] text-[var(--text)] shadow-xs font-semibold scale-[1.02]"
                    : "bg-[var(--surface-elevated)] border-[var(--line)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)]"
                )}
              >
                <button
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setActiveView(isActive ? null : view.id)}
                  className="flex items-center gap-2 text-left cursor-pointer"
                >
                  <div 
                    className="p-1 rounded-md text-white flex items-center justify-center shrink-0"
                    style={{ backgroundColor: view.color || '#3b82f6' }}
                  >
                    <IconComponent size={12} />
                  </div>

                  <div className="flex flex-col text-left">
                    <div className="flex items-center gap-1.5 leading-none">
                      <span className="truncate max-w-[130px]">{view.name}</span>
                      {view.isDefault && (
                        <span className="text-[9px] px-1 py-0.2 bg-[var(--brass)]/20 text-[var(--brass)] rounded font-semibold uppercase tracking-wider">
                          Default
                        </span>
                      )}
                    </div>

                    <span className="text-[10px] font-bold mt-0.5 text-[var(--text-secondary)] tabular-nums">
                      {formatCurrency(metrics.totalMoneyCents)}
                      <span className="text-[9px] font-normal text-[var(--muted)] ml-1">
                        ({metrics.matchingCount})
                      </span>
                    </span>
                  </div>
                </button>

                <button aria-label={view.isPinned ? "Unpin view" : "Pin view"}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePinView(view.id);
                  }}
                  title={view.isPinned ? "Unpin view" : "Pin view"}
                  className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 p-0.5 text-[var(--muted)] hover:text-amber-400 transition-opacity"
                >
                  <Star aria-hidden="true" size={12} className={cn(view.isPinned && "fill-amber-400 text-amber-400 opacity-100")} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {currentSearchTerm && !isSavePromptOpen && (
            <button
              onClick={() => setIsSavePromptOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-[var(--brass)]/10 text-[var(--brass)] hover:bg-[var(--brass)]/20 rounded-lg border border-[var(--brass)]/30 transition-all cursor-pointer"
            >
              <Plus aria-hidden="true" size={13} />
              <span>Save Active Search</span>
            </button>
          )}

          {isSavePromptOpen && (
            <div className="flex items-center gap-1.5 bg-[var(--surface-elevated)] p-1 rounded-lg border border-[var(--brass)] shadow-xs animate-in fade-in duration-150">
              <input aria-label="View Name"
                type="text"
                placeholder="View Name..."
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleQuickSaveCurrent()}
                className="px-2 py-1 text-xs bg-[var(--bg)] border border-[var(--line)] rounded text-[var(--text)] outline-none w-32 focus:border-[var(--brass)]"
                ref={focusOnMount}
              />
              <button
                onClick={handleQuickSaveCurrent}
                className="px-2 py-1 text-xs font-semibold bg-[var(--brass)] text-[var(--ink)] rounded hover:opacity-90"
               aria-label="Save">
                Save
              </button>
              <button
                onClick={() => setIsSavePromptOpen(false)}
                className="px-1.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
              >
                ✕
              </button>
            </div>
          )}

          <button
            onClick={() => setIsManagerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--line)]/50 rounded-lg border border-[var(--line)] transition-all cursor-pointer"
          >
            <SlidersHorizontal aria-hidden="true" size={13} />
            <span>Manage All Views ({views.length})</span>
          </button>
        </div>
      </div>

      {isManagerOpen && (
        <SavedViewsManagerModal
          isOpen={isManagerOpen}
          onClose={() => setIsManagerOpen(false)}
        />
      )}
    </div>
  );
}
