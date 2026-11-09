import { TransactionColumnGrid } from '../ledger/TransactionColumnGrid';
import { gridTracks, orderedGridTracks } from '../../lib/transactionColumns';
import type { ColumnLayout } from '../../lib/columnLayout';
import React from 'react';
import InlineEdit from '../ui/InlineEdit';
import { categoryChoices, soleCategoryLine, descriptionSuggestions } from '../../lib/accountChoices';
import { amountChange, isDocumentEntry, isHandEntered } from '../../lib/transactionEdits';
import { Transaction } from '../../types';

import { 
  Zap,
  RotateCcw,
  RefreshCcw,
  AlertCircle,
  Columns,
  Copy,
  Lock,
  Edit3,
  BrainCircuit,
  Paperclip
} from 'lucide-react';
import { resolveAccountName, cn, formatDate, formatSignedAmount } from '../../lib/utils';
import { isCashAccount, isInflow } from '../../lib/txFilters';
import { useLedgerStore } from '../../stores/useLedgerStore';
import AsyncButton from '../ui/AsyncButton';
import CategoryWhyPopover from '../common/CategoryWhyPopover';
import { isLockedDate } from '../../lib/periodLock';

function withOccurrenceKeys<T>(items: readonly T[], identity: (item: T) => string) {
  const occurrences = new Map<string, number>();
  return items.map(item => {
    const content = identity(item);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { item, key: JSON.stringify([content, occurrence]) };
  });
}

const HighlightMatch = ({ text, match }: { text: string; match?: string }) => {
  if (!match) return <>{text}</>;
  // #103: the search text is matched literally — characters like [ ( * are not pattern syntax
  const parts = text.split(new RegExp(`(${match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {withOccurrenceKeys(parts, part => part).map(({ item: p, key }) =>
        p.toLowerCase() === match.toLowerCase() ? (
          <mark key={key} className="bg-yellow-200 text-yellow-900 rounded-[2px] px-0.5 font-bold">{p}</mark>
        ) : (
          <span key={key}>{p}</span>
        )
      )}
    </>
  );
};

interface TransactionRowProps {
  tx: Transaction & { balanceCents: number };
  isSelected: boolean;
  isSetA: boolean;
  isSetB: boolean;
  isFocused: boolean;
  isEven: boolean;
  focusedField: string | null;
  onToggleSelection: (id: string) => void;
  onVoid: (id: string) => Promise<void> | void;
  onUpdate?: (id: string, updates: Partial<Transaction>) => void;
  onSelect?: (id: string) => void;
  onCreateRule: (tx: Transaction) => void;
  onProjectClick: (projectName: string) => void;
  onSplit: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onToggleFlag?: (id: string) => void;
  onEditDetails?: (tx: Transaction) => void;
  onReverseAndCorrect?: (tx: Transaction) => void;
  formatCurrency: (cents: number) => string;
  isProMode?: boolean;
  isCompactMode?: boolean;
  isMobileGrid?: boolean;
  isTabletGrid?: boolean;
  dateFormat?: string;
  gridColumns: string;
  /** columns switched off in the Columns menu (category, project, class, location, balance, status) */
  hiddenColumns?: ReadonlySet<string>;
  columnLayout?: ColumnLayout;
  anomaly?: { score: number, reason: string };
  internalConflict?: { type: string, message: string };
  searchTerm?: string;
}

const TransactionRow = React.memo(({
  tx,
  isSelected,
  isSetA,
  isSetB,
  isFocused,
  isEven,
  focusedField,
  onToggleSelection,
  onVoid,
  onUpdate,
  onSelect,
  onCreateRule,
  onProjectClick,
  onSplit,
  onDuplicate,
  onToggleFlag,
  onEditDetails,
  onReverseAndCorrect,
  formatCurrency,
  isProMode = false,
  isCompactMode = false,
  isMobileGrid = false,
  isTabletGrid = false,
  gridColumns,
  hiddenColumns,
  columnLayout,
  anomaly,
  internalConflict,
  searchTerm
}: TransactionRowProps) => {
  const show = (column: string) => !hiddenColumns?.has(column);
  const layout = { mobile: isMobileGrid, tablet: isTabletGrid, compact: Boolean(isProMode || isCompactMode) };
  const naturalOrder = gridTracks(layout, hiddenColumns || new Set()).map(([id]) => id);
  const order = orderedGridTracks(layout, hiddenColumns || new Set(), columnLayout).map(([id]) => id);
  const isPrivacyMode = useLedgerStore(state => state.isPrivacyMode);
  const accounts = useLedgerStore(state => state.accounts);
  const lockDate = useLedgerStore(state => state.lockDate);
  const lockException = useLedgerStore(state => state.lockException);
  const isLocked = (!!tx.date && isLockedDate(tx.date, lockDate, lockException)) || !!tx.isLocked;
  const displayTx = tx;
  // edit in place (I-22): the category of a plain entry, and class / location on every line
  const choices = useLedgerStore(state => categoryChoices(state.accounts, state.transactions));
  const canEditLines = !isLocked && !!onUpdate && tx.status !== 'void' && tx.status !== 'reconciled';
  // an entry from an invoice, bill or payment keeps its accounts (changed through that record)
  const categoryLine = canEditLines && !isDocumentEntry(tx) ? soleCategoryLine(tx, accounts) : undefined;
  const setCategory = (accountId: string | number) => {
    const account = accounts.find(a => a.id === accountId);
    if (!account || !categoryLine) return;
    onUpdate?.(tx.id, { lines: (tx.lines || []).map(l => (l === categoryLine ? { ...l, accountId: account.id, accountName: account.name } : l)) });
  };
  const setOnLines = (field: 'class' | 'location', value: string | number) =>
    onUpdate?.(tx.id, { lines: (tx.lines || []).map(l => ({ ...l, [field]: String(value) || undefined })) });

  // date and amount only on entries typed in by hand (a generated one changes with its invoice,
  // bill, payment or bank line); the amount only with two lines, both change so it stays balanced
  const canEditDate = canEditLines && isHandEntered(tx);
  const canEditAmount = canEditDate && (tx.lines || []).length === 2;
  const descriptions = useLedgerStore(state => descriptionSuggestions(state.transactions));
  const setAmount = (cents: string | number) => {
    const next = amountChange(tx, Number(cents));
    if (next) onUpdate?.(tx.id, next);
  };

  return (
    <div className="flex flex-col w-full h-full relative group/row">
      <TransactionColumnGrid naturalOrder={naturalOrder} order={order} role="presentation"
        onClick={() => onSelect?.(tx.id)}
        className={cn(
          "grid w-full h-full items-center transition-all border-b border-[var(--line)] cursor-pointer relative",
          tx.type === 'reversal' && "bg-rose-50/5",
          tx.type === 'adjustment' && "bg-amber-50/5",
          (anomaly || internalConflict) && "bg-indigo-600/[0.03]",
          isSetA && "bg-amber-50/10",
          isSetB && "bg-emerald-50/10",
          isFocused ? "bg-[var(--brass)]/[0.15]" : (isEven ? "bg-[var(--ink)]" : "bg-[var(--surface)]"),
          isSelected && "bg-[var(--brass)]/[0.2]",
          tx.isFlagged && "bg-amber-500/5",
          "hover:bg-[var(--text)] hover:text-[var(--ink)] group/active"
        )}
        style={{ gridTemplateColumns: gridColumns }}
      >
        <div className={cn("px-4 relative h-full flex items-center justify-center border-r border-[var(--line)]/50", isProMode && "px-2", isCompactMode && "px-1")}>
          {isFocused && <div className="absolute inset-y-0 left-0 w-1 bg-slate-900 shadow-[0_0_10px_rgba(0,0,0,0.2)]" />}
          <input aria-label={`Select transaction ${tx.description}`}
            type="checkbox" 
            checked={isSelected}
            onChange={(e) => { e.stopPropagation(); onToggleSelection(tx.id); }}
            className={cn(
              "w-4 h-4 rounded border-[var(--line)] text-[var(--text)] focus:ring-slate-900/20 cursor-pointer relative z-10 accent-ledger-ink transition-all group-hover/active:border-white/40",
              isCompactMode && "w-3.5 h-3.5"
            )}
          />
        </div>
        <div className={cn(
          "px-4 text-slate-500 font-mono whitespace-nowrap text-[10px] h-full flex items-center border-r border-[var(--line)]/50 transition-colors group-hover/active:text-white/60", 
          isProMode && "px-2 text-[9px]",
          isCompactMode && "px-1 text-[9px]",
          isFocused && focusedField === 'date' && "ring-2 ring-inset ring-indigo-600 bg-indigo-600/5"
        )}>
          <InlineEdit kind="date" value={displayTx.date} label={`Date of ${displayTx.description || 'this entry'}`} canEdit={canEditDate}
            display={displayTx.date ? formatDate(displayTx.date) : 'N/A'} onSave={v => onUpdate?.(tx.id, { date: String(v) })}
            validate={v => (v ? null : 'Enter a date')} />
        </div>
        <div 
          className={cn(
            "px-4 font-bold text-[var(--text)] transition-colors text-xs h-full flex flex-col justify-center relative border-r border-[var(--line)]/50 group-hover/active:text-white", 
            isProMode && "px-2 text-[10px]",
            isFocused && focusedField === 'description' && "ring-2 ring-inset ring-indigo-600 bg-indigo-600/5",
            "overflow-hidden"
          )} 
          dir="auto"
          title={displayTx.description}
        >
          <>
              <div className="text-left w-full min-w-0 font-sans tracking-tight flex items-center gap-1.5">
                <InlineEdit value={displayTx.description} label={`Description of ${displayTx.description || 'this entry'}`}
                  canEdit={!isLocked && !!onUpdate && tx.status !== 'void'} suggestions={descriptions}
                  display={<span className="line-clamp-2 break-words">{<HighlightMatch text={displayTx.description} match={searchTerm} />}</span>}
                  validate={v => (String(v).trim() ? null : 'Enter a description')}
                  onSave={v => onUpdate?.(tx.id, { description: String(v) })} className="leading-tight min-w-0" />
                {displayTx.fileUrls && displayTx.fileUrls.length > 0 && (
                  <span 
                    data-testid="attachment-badge"
                    title={`${displayTx.fileUrls.length} attachment${displayTx.fileUrls.length === 1 ? '' : 's'}`}
                    aria-label={`${displayTx.fileUrls.length} attachment${displayTx.fileUrls.length === 1 ? '' : 's'}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider border bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20 shrink-0 select-none group-hover/active:bg-indigo-500 group-hover/active:text-white group-hover/active:border-white/20"
                  >
                    <Paperclip aria-hidden="true" size={10} className="shrink-0" />
                    <span>{displayTx.fileUrls.length}</span>
                  </span>
                )}
                {isLocked && (
                  <span title="Locked under Absolute Integrity">
                    <Lock aria-hidden="true" className="text-amber-500 inline shrink-0 animate-pulse" size={11} />
                  </span>
                )}
              </div>
              {!isCompactMode && tx.verification?.hash && (
                <span className="text-[9px] text-slate-500 font-mono flex items-center gap-1 transition-colors group-hover/active:text-white/40">
                  <Zap aria-hidden="true" size={9} className={isLocked ? "text-amber-400" : "text-emerald-500"} />
                  {tx.verification.hash.slice(0, 8)} {isLocked && <span className="text-[7px] font-black tracking-widest uppercase bg-amber-400/10 text-amber-500 dark:text-amber-400 px-1.5 py-0.5 border border-amber-400/20 rounded font-sans scale-90 origin-left">SEALED</span>}
                </span>
              )}
          </>
        </div>
        {!isMobileGrid && show('category') && (
          <div className={cn(
            "px-4 h-full flex items-center border-r border-[var(--line)]/50", 
            isProMode && "px-2", 
            isCompactMode && "px-1",
            isFocused && focusedField === 'category' && "ring-2 ring-inset ring-indigo-600 bg-indigo-600/5"
          )}>
            <div className="flex flex-col gap-0.5 w-full min-w-0">
              {(() => {
                // one clear line: the category (the side that is not the bank account); the bank account
                // and any further lines are in the tooltip. Two coloured boxes per entry made rows tall.
                const lines = tx.lines || [];
                const isCash = (accountId: string) => isCashAccount(accounts.find(a => a.id === accountId));
                const shown = categoryLine ?? lines.find(l => !isCash(l.accountId)) ?? lines[0];
                if (!shown) return <span className="text-[var(--faint)]">—</span>;
                const others = lines.filter(l => l !== shown).map(l => resolveAccountName(accounts, l.accountId, l.accountName));
                const name = resolveAccountName(accounts, shown.accountId, shown.accountName);
                return (
                  <div className="flex items-center gap-1 w-full min-w-0" title={others.length ? `${name} · ${others.join(', ')}` : name}>
                    <span dir="auto" className="line-clamp-2 break-words leading-tight min-w-0 flex-1 text-xs font-medium text-[var(--text)]">
                      {shown === categoryLine ? (
                        <InlineEdit kind="select" value={shown.accountId} label={`Category of ${displayTx.description || 'this entry'}`}
                          options={choices.some(c => c.value === shown.accountId) ? choices : [{ value: shown.accountId, label: name }, ...choices]}
                          display={<span className="line-clamp-2 break-words">{<HighlightMatch text={name} match={searchTerm} />}</span>}
                          onSave={setCategory} className="leading-tight min-w-0" />
                      ) : <HighlightMatch text={name} match={searchTerm} />}
                    </span>
                    {lines.length > 2 && <span className="shrink-0 text-[10px] text-[var(--muted)]">+{lines.length - 2}</span>}
                    <span className="shrink-0 inline-flex md:hidden md:group-hover/active:inline-flex md:group-focus-within/active:inline-flex">
                      <CategoryWhyPopover description={displayTx.description} accountName={name} />
                    </span>
                  </div>
                );
              })()}

              {tx.lines?.map(l => l.tags || []).flat().filter((v, i, a) => a.indexOf(v) === i).slice(0, 2).map(tag => (
                <span 
                  key={`tag-${tag}`}
                  dir="auto"
                  className="px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest truncate w-full border transition-all bg-indigo-50 text-indigo-600 border-indigo-200 group-hover/active:bg-indigo-500 group-hover/active:text-white group-hover/active:border-white/20"
                >
                  <HighlightMatch text={tag} match={searchTerm} />
                </span>
              ))}
            </div>
          </div>
        )}
        {!isMobileGrid && !isTabletGrid && show('project') && (
          <div className={cn(
            "px-4 h-full flex items-center border-r border-[var(--line)]/50", 
            isProMode && "px-2",
            isFocused && focusedField === 'project' && "ring-2 ring-inset ring-indigo-600 bg-indigo-600/5"
          )}>
            <div className="flex flex-wrap gap-1 w-full">
              {tx.lines?.find(l => l.project)?.project && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onProjectClick(tx.lines!.find(l => l.project)!.project!);
                  }}
                  dir="auto"
                  className="px-2 py-0.5 bg-[var(--ink)] text-slate-500 rounded text-[9px] font-bold border border-[var(--line)] hover:border-slate-800 transition-colors truncate uppercase group-hover/active:text-white group-hover/active:border-white/20 group-hover/active:bg-[var(--surface)]/10"
                >
                  <HighlightMatch text={tx.lines!.find(l => l.project)!.project!} match={searchTerm} />
                </button>
              )}
            </div>
          </div>
        )}
        {!isMobileGrid && !isTabletGrid && show('class') && (
          <div className={cn(
            "px-4 h-full flex items-center border-r border-[var(--line)]/50", 
            isProMode && "px-2",
            isFocused && focusedField === 'class' && "ring-2 ring-inset ring-indigo-600 bg-indigo-600/5"
          )}>
            <div className="flex flex-wrap gap-1 w-full">
              <InlineEdit value={tx.lines?.find(l => l.class)?.class} label={`Class of ${displayTx.description || 'this entry'}`} canEdit={canEditLines}
                placeholder="—" onSave={v => setOnLines('class', v)}
                display={tx.lines?.find(l => l.class)?.class ? (
                  <span className="px-2 py-0.5 bg-[var(--ink)] text-slate-500 rounded text-[9px] font-bold border border-[var(--line)] truncate uppercase group-hover/active:text-white group-hover/active:border-white/20 group-hover/active:bg-[var(--surface)]/10">
                    <HighlightMatch text={tx.lines!.find(l => l.class)!.class!} match={searchTerm} />
                  </span>
                ) : null} />
            </div>
          </div>
        )}
        {!isMobileGrid && !isTabletGrid && show('location') && (
          <div className={cn(
            "px-4 h-full flex items-center border-r border-[var(--line)]/50", 
            isProMode && "px-2",
            isFocused && focusedField === 'location' && "ring-2 ring-inset ring-indigo-600 bg-indigo-600/5"
          )}>
            <div className="flex flex-wrap gap-1 w-full">
              <InlineEdit value={tx.lines?.find(l => l.location)?.location} label={`Location of ${displayTx.description || 'this entry'}`} canEdit={canEditLines}
                placeholder="—" onSave={v => setOnLines('location', v)}
                display={tx.lines?.find(l => l.location)?.location ? (
                  <span className="px-2 py-0.5 bg-[var(--ink)] text-slate-500 rounded text-[9px] font-bold border border-[var(--line)] truncate uppercase group-hover/active:text-white group-hover/active:border-white/20 group-hover/active:bg-[var(--surface)]/10">
                    <HighlightMatch text={tx.lines!.find(l => l.location)!.location!} match={searchTerm} />
                  </span>
                ) : null} />
            </div>
          </div>
        )}
        <div 
          className={cn(
            "px-3 text-right font-black font-mono transition-colors text-sm h-full flex flex-col justify-center relative overflow-hidden border-r border-[var(--line)]/50 items-end",
            isInflow(tx, accounts)
              ? "text-[var(--pos)] group-hover/active:text-emerald-400"
              : "text-[var(--neg)] group-hover/active:text-rose-400",
            isFocused && focusedField === 'amountCents' && "ring-2 ring-inset ring-indigo-600 bg-indigo-600/5"
          )}
        >
          <span data-testid="tx-amount" className={cn("relative z-10 tabular-nums tracking-tight whitespace-nowrap", isPrivacyMode && "blur-[6px] select-none pointer-events-none opacity-20 transition-all")}>
            {/* sign as well as colour (E-26): money in +, money out − */}
            <InlineEdit kind="money" value={displayTx.totalAmountCents} label={`Amount of ${displayTx.description || 'this entry'}`} canEdit={canEditAmount}
              display={formatSignedAmount(displayTx.totalAmountCents, isInflow(tx, accounts) ? 'in' : 'out')}
              validate={v => (Number(v) > 0 ? null : 'Enter an amount above 0')} onSave={setAmount} inputClassName="text-right w-28" />
          </span>
          {tx.originalCurrency && tx.exchangeRate && (
            <span className={cn("text-[9px] font-sans font-bold uppercase tracking-wider text-[var(--muted)] mt-0.5 truncate whitespace-nowrap", isPrivacyMode && "blur-[6px] select-none pointer-events-none opacity-20 transition-all")}>
              {tx.originalCurrency} @ {tx.exchangeRate.toFixed(4)}
            </span>
          )}
        </div>
        {!isMobileGrid && !isTabletGrid && show('balance') && (
          <div className={cn(
            "px-4 text-right font-bold font-mono text-slate-500 text-[11px] h-full flex items-center justify-end border-r border-[var(--line)]/50 transition-colors group-hover/active:text-white/60 whitespace-nowrap tabular-nums",
            isProMode && "px-2 text-[10px]"
          )}>
            {formatCurrency(tx.balanceCents || 0)}
          </div>
        )}
        {!isMobileGrid && show('status') && (
          <div className={cn(
            "px-4 text-center h-full flex items-center justify-center border-r border-[var(--line)]/50", 
            isProMode && "px-2",
            isFocused && focusedField === 'status' && "ring-2 ring-inset ring-indigo-600 bg-indigo-600/5"
          )}>
            <span className={cn(
              "px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider border transition-all",
              tx.status === 'approved' ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/20 group-hover/active:bg-emerald-500 group-hover:text-white" :
              tx.status === 'flagged' ? "bg-amber-500/10 text-amber-600 border-amber-500/20 group-hover/active:bg-amber-500 group-hover:text-white" :
              tx.status === 'void' ? "bg-rose-500/10 text-rose-600 border-rose-500/20 group-hover/active:bg-rose-500 group-hover:text-white" :
              tx.status === 'draft' ? "bg-[var(--ink)]0/10 text-slate-600 border-slate-500/20 group-hover/active:bg-[var(--ink)]0 group-hover:text-white" :
              "bg-[var(--ink)] text-slate-500 border-[var(--line)] group-hover/active:bg-[var(--surface)]/10 group-hover/active:text-white group-hover/active:border-white/20",
              tx.lines?.some(l => l.isAnalyticalTagged) && "border-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.3)]"
            )}>
              {tx.status || tx.type}
            </span>
          </div>
        )}
        {!isMobileGrid && !isTabletGrid && (
          <div className={cn("px-4 text-right h-full flex items-center justify-end group-hover/active:text-white")}>
            {isLocked ? (
              <div className="flex items-center justify-end gap-1.5">
                <div className="flex items-center gap-1 text-[8px] font-medium uppercase tracking-wider text-[#d97706] bg-amber-50 dark:bg-amber-950/20 px-2 py-1 rounded border border-amber-500/20 shrink-0 select-none">
                  <Lock aria-hidden="true" size={10} className="text-[#d97706]" /> Immutable
                </div>
                {!tx.reversalEventId && tx.type !== 'reversal' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onReverseAndCorrect) {
                        onReverseAndCorrect(tx);
                      } else {
                        onEditDetails?.(tx);
                      }
                    }}
                    className="flex items-center gap-1 px-2 py-1 bg-indigo-600/10 hover:bg-indigo-600 text-indigo-700 hover:text-white dark:text-indigo-400 dark:hover:text-white rounded border border-indigo-500/20 text-[9px] font-bold transition-all shrink-0 cursor-pointer"
                    title="Reverse & Correct (Sanctioned closed-period correction)"
                  >
                    <RefreshCcw aria-hidden="true" size={10} />
                    <span className="hidden sm:inline">Reverse & Correct</span>
                  </button>
                )}
                {tx.reversalEventId && (
                  <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider bg-rose-500/10 text-rose-600 border border-rose-500/20 select-none">
                    Reversed
                  </span>
                )}
              </div>
            ) : (
              <div className={cn(
                "flex items-center justify-end gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity",
                (isProMode || isCompactMode) && "opacity-100"
              )}>
                <button aria-label="Edit Transaction Details"
                  onClick={(e) => { e.stopPropagation(); onEditDetails?.(tx); }}
                  className="p-1 text-[var(--muted)] hover:text-indigo-600 rounded transition-all"
                  title="Edit Transaction Details"
                >
                  <Edit3 aria-hidden="true" size={14} />
                </button>
                <button aria-label="Split Transaction"
                  onClick={(e) => { e.stopPropagation(); onSplit(tx.id); }}
                  className="p-1 text-[var(--muted)] hover:text-indigo-600 rounded transition-all"
                  title="Split Transaction"
                >
                  <Columns aria-hidden="true" size={14} />
                </button>
                <button aria-label="Duplicate Transaction"
                  onClick={(e) => { e.stopPropagation(); onDuplicate?.(tx.id); }}
                  className="p-1 text-[var(--muted)] hover:text-indigo-600 rounded transition-all"
                  title="Duplicate Transaction"
                >
                  <Copy aria-hidden="true" size={14} />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); onCreateRule(tx); }}
                  className="p-1 text-[var(--muted)] hover:text-indigo-600 rounded transition-all cursor-pointer"
                  title="Create Auto-Categorization Rule"
                  aria-label="Create Auto-Categorization Rule"
                >
                  <Zap aria-hidden="true" size={14} />
                </button>
                <button aria-label={tx.isFlagged ? "Unflag transaction" : "Flag for Review"}
                  onClick={(e) => { e.stopPropagation(); onToggleFlag?.(tx.id); }}
                  className={cn(
                    "p-1 rounded transition-all",
                    tx.isFlagged ? "text-amber-500" : "text-[var(--muted)] hover:text-amber-500"
                  )}
                  title="Flag for Review"
                >
                  <AlertCircle aria-hidden="true" size={14} />
                </button>
                <AsyncButton aria-label="Reverse transaction"
                  onClick={(e) => { e.stopPropagation(); return onVoid(tx.id); }}
                  className="p-1 text-[var(--muted)] hover:text-rose-600 rounded transition-all"
                  variant="ghost"
                  size="icon"
                  disabled={tx.type === 'reversal' || !!tx.reversalEventId}
                >
                  <RotateCcw aria-hidden="true" size={14} />
                </AsyncButton>
              </div>
            )}
          </div>
        )}
      </TransactionColumnGrid>
      
      {/* Anomaly Resolution Panel */}
      {anomaly && (
        <div className="bg-indigo-50/50 border-b border-[var(--line)] px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <BrainCircuit aria-hidden="true" className="text-indigo-600" size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-indigo-900">Anomaly Detected</h2>
              <p className="text-xs text-indigo-700/80 mt-0.5">{anomaly.reason}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={(e) => { e.stopPropagation(); onUpdate?.(tx.id, { isFlagged: false }); /* mark reviewed */ }}
              className="px-3 py-1.5 bg-white border border-indigo-200 text-indigo-700 text-xs font-bold rounded-lg hover:bg-indigo-50 transition-colors shadow-sm"
            >
              Mark Reviewed
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onUpdate?.(tx.id, { isFlagged: false }); /* dismiss */ }}
              className="px-3 py-1.5 bg-white border border-indigo-200 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default TransactionRow;
