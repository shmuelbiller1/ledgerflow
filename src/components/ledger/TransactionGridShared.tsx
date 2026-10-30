import type { ColumnLayout } from '../../lib/columnLayout';
import { orderedGridTracks } from '../../lib/transactionColumns';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Transaction, AnalyticalMetrics } from '../../types';

import { toast } from 'sonner';
import { amountChange, isDocumentEntry, isHandEntered } from '../../lib/transactionEdits';
import { recategorizeLines, soleCategoryLine } from '../../lib/accountChoices';

import { resolveAccountName } from '../../lib/utils';

import { ListChildComponentProps } from 'react-window';

import TransactionRow from '../transactions/TransactionRow';

import { useLedgerStore } from '../../stores/useLedgerStore';

import { useLedgerComputation } from '../../hooks/useLedgerComputation';

import { useTimeout } from '../../hooks/useTimeout';

export const GridEditor = ({
  value,
  onSave,
  onClose,
  type = 'text',
  label
}: {
  value: string | number,
  onSave: (val: string | number) => void,
  onClose: () => void,
  type?: 'text' | 'number' | 'category',
  label: string
}) => {
  const [val, setVal] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setSafeTimeout } = useTimeout();
  const accounts = useLedgerStore(state => state.accounts);

  const suggestions = useMemo(() => {
    if (type !== 'category' || !val || typeof val !== 'string') return [];
    return accounts
      .filter(a => (a.name || '').toLowerCase().includes(val.toLowerCase()))
      .slice(0, 5);
  }, [val, type, accounts]);

  const handleEvaluateAndSave = (input: string | number) => {
    if (type === 'number') {
      try {
        const parsed = parseFloat((input as string).replace(/[^0-9.-]/g, ''));
        if (!isNaN(parsed)) {
          onSave(parsed);
          return;
        }
      } catch {
        // Fallback to saving raw input
      }
    }
    onSave(input);
  };

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="absolute inset-0 z-[100] bg-[#090A0C] border-2 border-emerald-500 shadow-[0_0_40px_rgba(16,185,129,0.3)] flex flex-col px-4 group">
      <div className="flex-1 flex items-center gap-3">
         <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
         <input
          ref={inputRef}
          aria-label={label}
          type="text"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          dir="auto"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleEvaluateAndSave(val);
            if (e.key === 'Escape') onClose();
            if (e.key === 'Tab' && suggestions.length > 0) {
              e.preventDefault();
              handleEvaluateAndSave(suggestions[0].name);
            }
          }}
          onBlur={(_e) => {
             // Delay to allow suggestion click
             setSafeTimeout(() => handleEvaluateAndSave(val), 200);
          }}
          className="w-full bg-transparent border-none outline-none font-mono text-xs font-black text-white uppercase tracking-wider placeholder:text-white/10"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 bg-[#090A0C] border-x-2 border-b-2 border-emerald-500/50 shadow-2xl py-2 z-[110]">
           {suggestions.map((s, _i) => (
             <button
               key={s.id}
               onClick={(e) => {
                 e.stopPropagation();
                 handleEvaluateAndSave(s.name);
               }}
               className="w-full text-left px-4 py-2 hover:bg-[var(--surface)]/5 flex items-center justify-between group/s"
             >
                <span className="text-[10px] font-black text-white/60 uppercase tracking-widest group-hover/s:text-emerald-400">{s.name}</span>
                <span className="text-[8px] font-bold text-white/20 uppercase">TAB</span>
             </button>
           ))}
        </div>
      )}
    </div>
  );
};

export interface VirtualRowProps extends ListChildComponentProps {
  data: {
    transactions: (Transaction & { balanceCents: number })[];
    selectedIds: Set<string>;
    focusedCell: { id: string, field: string, index: number } | null;
    editingCell: { id: string, field: string } | null;
    anomalyMap: Map<string, AnalyticalMetrics['anomalies'][number]>;
    deterministicConflicts: ReturnType<typeof useLedgerComputation>['conflicts'];
    onToggleSelection: (id: string) => void;
    onVoid: (id: string) => void;
    onUpdate?: (id: string, updates: Partial<Transaction>) => void;
    onCreateRule: (tx: Transaction) => void;
    onProjectClick: (projectName: string) => void;
    setSplittingTxId: (id: string | null) => void;
    setFocusedCell: (v: VirtualRowProps['data']['focusedCell']) => void;
    setEditingCell: (v: VirtualRowProps['data']['editingCell']) => void;
    isProMode: boolean;
    isCompactMode: boolean;
    isMobileGrid: boolean;
    isTabletGrid: boolean;
    onToggleFlag: (id: string) => void;
    onDuplicate: (id: string) => void;
    onEditDetails?: (tx: Transaction) => void;
    onReverseAndCorrect?: (tx: Transaction) => void;
    dateFormat: string;
    formatCurrency: (cents: number) => string;
    gridCols: string;
    hiddenColumns: ReadonlySet<string>;
    columnLayout: ColumnLayout;
    searchTerm: string;
  };
}

export const VirtualRow = React.memo(({ index, style, data }: VirtualRowProps) => {
  const tx = data.transactions[index];
  if (!tx) return <div style={style} />;

  const accounts = useLedgerStore.getState().accounts;

  const isEditing = data.editingCell?.id === tx.id;
  const isFocused = data.focusedCell?.id === tx.id;
  const order = orderedGridTracks({ mobile: data.isMobileGrid, tablet: data.isTabletGrid, compact: data.isProMode || data.isCompactMode }, data.hiddenColumns, data.columnLayout).map(([id]) => id);
  const editorStyle = (id: string) => ({ gridColumn: order.indexOf(id) + 1, gridRow: 1 });

  return (
    <div role="presentation"
      data-row-index={index}
      style={style}
      className="relative"
     onClick={() => data.setFocusedCell({ id: tx.id, field: 'description', index })}
      onDoubleClick={() => data.setEditingCell({ id: tx.id, field: 'description' })}
    >
      <TransactionRow
        tx={tx}
        isSelected={data.selectedIds.has(tx.id)}
        isSetA={false}
        isSetB={false}
        isFocused={isFocused}
        isEven={index % 2 === 0}
        focusedField={data.focusedCell?.field || null}
        onToggleSelection={data.onToggleSelection}
        onVoid={data.onVoid}
        onUpdate={data.onUpdate}
        onCreateRule={data.onCreateRule}
        onProjectClick={data.onProjectClick}
        onSplit={(id) => data.setSplittingTxId(id)}
        onToggleFlag={data.onToggleFlag}
        onDuplicate={data.onDuplicate}
        onEditDetails={data.onEditDetails}
        onReverseAndCorrect={data.onReverseAndCorrect}
        formatCurrency={data.formatCurrency}
        isProMode={data.isProMode}
        isCompactMode={data.isCompactMode}
        isMobileGrid={data.isMobileGrid}
        isTabletGrid={data.isTabletGrid}
        dateFormat={data.dateFormat}
        gridColumns={data.gridCols}
        hiddenColumns={data.hiddenColumns}
        columnLayout={data.columnLayout}
        anomaly={data.anomalyMap.get(tx.id)}
        internalConflict={data.deterministicConflicts.get(tx.id)}
        searchTerm={data.searchTerm}
      />
      {isEditing && data.editingCell && (
        <div className="absolute inset-0 pointer-events-none grid" style={{ gridTemplateColumns: data.gridCols }}>
          {data.editingCell.field === 'description' && (
            <div data-editor-column="description" style={editorStyle('description')} className="relative z-[70] pointer-events-auto">
              <GridEditor
                label="Transaction description"
                value={tx.description}
                onSave={(v) => {
                  data.onUpdate?.(tx.id, { description: v as string });
                  data.setEditingCell(null);
                }}
                onClose={() => data.setEditingCell(null)}
              />
            </div>
          )}
          {data.editingCell.field === 'amountCents' && (
            <div data-editor-column="amount" style={editorStyle('amount')} className="relative z-[70] pointer-events-auto">
              <GridEditor
                label="Transaction amount"
                value={tx.totalAmountCents / 100}
                type="number"
                onSave={(v) => {
                  // the server works the total out from the lines: change both lines (L-147); only
                  // entries typed in by hand (I-22), the same rule as editing in the row
                  const next = amountChange(tx, TruthEngine.parseAmountToCents(v || '0'));
                  if (next) data.onUpdate?.(tx.id, next);
                  else if (!isHandEntered(tx)) toast.info('This entry comes from an invoice, bill, payment or bank line: change it there.');
                  else toast.info('Enter an amount above 0. An entry with several lines is changed in the entry itself.');
                  data.setEditingCell(null);
                }}
                onClose={() => data.setEditingCell(null)}
              />
            </div>
          )}
          {data.editingCell.field === 'category' && !data.isMobileGrid && (
            <div data-editor-column="category" style={editorStyle('category')} className="relative z-[70] pointer-events-auto">
              <GridEditor
                label="Transaction account"
                value={resolveAccountName(accounts, (soleCategoryLine(tx, accounts) || tx.lines?.[0])?.accountId, (soleCategoryLine(tx, accounts) || tx.lines?.[0])?.accountName)}
                type="category"
                onSave={(v) => {
                  // only the category side changes; the bank line never does (it changed "line 0",
                  // which could be the bank line; L-182)
                  const target = accounts.find(a => a.name === v || a.id === v);
                  const lines = target && !isDocumentEntry(tx) ? recategorizeLines(tx.lines || [], accounts, { accountId: target.id, accountName: target.name }) : null;
                  if (lines) data.onUpdate?.(tx.id, { lines });
                  else toast.info(!target ? 'Pick an account from the list.' : isDocumentEntry(tx)
                    ? 'This entry comes from an invoice, bill or payment: change it there.'
                    : 'This entry has no single category (a transfer or journal entry): open it to change the accounts.');
                  data.setEditingCell(null);
                }}
                onClose={() => data.setEditingCell(null)}
              />
            </div>
          )}
          {data.editingCell.field === 'project' && !data.isMobileGrid && !data.isTabletGrid && (
            <div data-editor-column="project" style={editorStyle('project')} className="relative z-[70] pointer-events-auto">
              <GridEditor
                label="Transaction project"
                value={tx.project || ''}
                onSave={(v) => {
                  data.onUpdate?.(tx.id, {
                    project: v as string,
                    lines: (tx.lines || []).map(l => ({ ...l, project: v as string }))
                  });
                  data.setEditingCell(null);
                }}
                onClose={() => data.setEditingCell(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
});
