import React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  AlertTriangle, Crown, Edit2, History, Info, ShieldCheck, ShoppingCart, SlidersHorizontal, Trash2, TrendingDown, TrendingUp,
} from 'lucide-react';
import type { InventoryItem } from '../../types';
import type { StrategicEngine } from '../../services/strategicEngine';
import { cn, formatCurrency } from '../../lib/utils';
import { ConfirmButton } from '../ui/ConfirmButton';
import InlineEdit from '../ui/InlineEdit';
import { formatVariancePct, standardCostReport, validStandardCost } from '../../lib/standardCost';
import { isBundle, bundleSummary } from '../../lib/itemBundles';
import { kitBuildableSummary } from '../../lib/kitAssembly';
import { ItemImageThumb } from './ItemImagePanel';
import { percentWidthStyle } from '../../lib/percentBar';

export type EconomicInventoryItem = ReturnType<typeof StrategicEngine.analyzeUnitEconomics>[number];
export type InventoryRowItem = InventoryItem & Partial<EconomicInventoryItem>;

export interface InventoryColumnDeps {
  workspaceId: string | null;
  items: InventoryItem[];
  categories: string[];
  imageRefresh: Record<string, number>;
  showRuleIntel: boolean;
  canChangeStock: boolean;
  canPostStock: boolean;
  canRevalue: boolean;
  onSaveField: (item: InventoryItem, field: 'name' | 'sku' | 'category' | 'unitPriceCents' | 'unitCostCents' | 'standardCostCents', value: string | number) => Promise<void>;
  onCountItem: (item: InventoryItem, counted: number) => Promise<void>;
  onRevalueItem: (item: InventoryItem) => void;
  onCogsItem: (item: InventoryItem) => void;
  onAdjustItem: (item: InventoryItem) => void;
  onHistoryItem: (item: InventoryItem) => void;
  onEditItem: (item: InventoryItem) => void;
  onDeleteItem: (id: string) => Promise<void>;
}

export function buildInventoryColumns(deps: InventoryColumnDeps): ColumnDef<InventoryRowItem, unknown>[] {
  const {
    workspaceId, items, categories, imageRefresh, showRuleIntel, canChangeStock, canPostStock, canRevalue,
    onSaveField, onCountItem, onRevalueItem, onCogsItem, onAdjustItem, onHistoryItem, onEditItem, onDeleteItem,
  } = deps;

  return [
    {
      accessorKey: 'name',
      header: 'Item / SKU',
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex min-w-0 items-center gap-3">
            <ItemImageThumb itemId={item.id} itemName={item.name} workspaceId={item.workspaceId || workspaceId || ''} refreshKey={imageRefresh[item.id] || 0} />
            <div className="min-w-0">
              <InlineEdit
                value={item.name}
                label={`Name of ${item.name}`}
                canEdit={canChangeStock}
                validate={v => (String(v) ? null : 'An item needs a name')}
                onSave={v => onSaveField(item, 'name', v)}
                className="text-sm font-black text-[var(--text)] block"
              />
              {isBundle(item) && (
                <p className="text-[10px] text-[var(--muted)] font-semibold" title={bundleSummary(item, items)}>
                  Bundle · {bundleSummary(item, items)}{item.assembleOnDemand ? ` · ${kitBuildableSummary(item, items)}` : ''}
                </p>
              )}
              <InlineEdit
                value={item.sku}
                label={`SKU of ${item.name}`}
                placeholder="Add SKU"
                canEdit={canChangeStock}
                onSave={v => onSaveField(item, 'sku', v)}
                className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest block"
              />
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'category',
      header: 'Category',
      cell: ({ row }) => {
        const item = row.original;
        return (
          <InlineEdit
            value={item.category}
            label={`Category of ${item.name}`}
            placeholder="General"
            canEdit={canChangeStock}
            suggestions={categories}
            onSave={v => onSaveField(item, 'category', v)}
            className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded text-[10px] font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300"
          />
        );
      },
    },
    {
      accessorKey: 'quantityAtHand',
      header: 'Stock Level',
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex items-center gap-2">
            <InlineEdit
              kind="number"
              value={item.quantityAtHand}
              label={`Quantity of ${item.name} (recorded as a stock count)`}
              canEdit={canPostStock}
              validate={v => (Number(v) >= 0 ? null : 'Stock cannot be below zero')}
              onSave={v => onCountItem(item, Number(v))}
              className={cn('text-sm font-black font-mono tabular-nums', item.quantityAtHand <= item.reorderPoint ? 'text-rose-600' : 'text-[var(--text)]')}
            />
            {item.quantityAtHand <= item.reorderPoint && (
              <AlertTriangle aria-hidden="true" size={14} className="text-rose-500 animate-pulse" />
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'unitCostCents',
      header: showRuleIntel ? 'Rule True Cost' : 'Unit Cost',
      cell: ({ row }) => {
        const item = row.original;
        if (showRuleIntel && item.landedCostStructure) {
          const trueCost = item.trueCostCents ?? item.unitCostCents;
          const integrity = item.integrityScore ?? 0;
          return (
            <div className={cn(!item.isAnalysisAccurate && 'opacity-30 grayscale')}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className={cn('text-sm font-black font-mono tabular-nums', item.anomaly ? 'text-rose-600' : 'text-[var(--text)]')}>
                  {formatCurrency(trueCost)}
                </span>
                {integrity > 75 && <ShieldCheck aria-hidden="true" size={12} className="text-emerald-500" />}
                {item.anomaly && <AlertTriangle aria-hidden="true" size={10} className="text-rose-500" />}
                {!item.isAnalysisAccurate && <Info aria-hidden="true" size={10} className="text-zinc-400" />}
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="text-[8px] text-zinc-400 font-bold uppercase tracking-tighter tabular-nums">
                  Base (Pack): {formatCurrency(item.landedCostStructure.base)}
                </p>
                {item.unitsPerPackage && item.unitsPerPackage > 1 && (
                  <p className="text-[9px] font-black text-emerald-600 uppercase tracking-tighter tabular-nums">
                    {formatCurrency(Math.round(trueCost / item.unitsPerPackage))} / {item.measurementUnit || 'unit'}
                  </p>
                )}
                <p className={cn('text-[8px] font-bold uppercase tracking-tighter tabular-nums', item.landedCostStructure.direct > 0 ? 'text-indigo-600' : 'text-zinc-300')}>
                  Direct: +{formatCurrency(item.landedCostStructure.direct)}
                </p>
                <p className="text-[8px] text-zinc-400 font-bold uppercase tracking-tighter tabular-nums">
                  Indirect: +{formatCurrency(item.landedCostStructure.indirect)}
                </p>
              </div>
            </div>
          );
        }
        return (
          <div className="flex flex-col">
            <InlineEdit
              kind="money"
              value={item.unitCostCents}
              display={formatCurrency(item.unitCostCents)}
              label={`Unit cost of ${item.name}`}
              canEdit={canChangeStock && !(item.quantityAtHand > 0)}
              onSave={v => onSaveField(item, 'unitCostCents', v)}
              className="text-sm font-bold text-zinc-500 font-mono tabular-nums"
            />
            {item.itemType !== 'service' && !item.bundleParts?.length && (
              <span className="flex flex-wrap items-center gap-1 text-[10px] text-zinc-500">
                <span>Standard</span>
                <InlineEdit
                  kind="money"
                  value={item.standardCostCents}
                  display={item.standardCostCents === undefined ? undefined : formatCurrency(item.standardCostCents)}
                  placeholder="Set standard"
                  label={`Standard cost of ${item.name}`}
                  canEdit={canChangeStock}
                  validate={v => (validStandardCost(v) === null ? 'A standard cost is zero or more' : null)}
                  onSave={v => onSaveField(item, 'standardCostCents', v)}
                  className="font-mono tabular-nums"
                />
                {validStandardCost(item.standardCostCents) !== null && (() => {
                  const sRow = standardCostReport([item]).rows[0];
                  return sRow ? (
                    <span
                      className={cn('tabular-nums', sRow.varianceUnitCents > 0 ? 'text-rose-600' : sRow.varianceUnitCents < 0 ? 'text-emerald-700' : '')}
                      title="Actual cost against the standard: above it costs more than planned"
                    >
                      {formatVariancePct(sRow.variancePct)}
                    </span>
                  ) : null;
                })()}
              </span>
            )}
            {item.quantityAtHand > 0 && canRevalue && (
              <button type="button" onClick={() => onRevalueItem(item)} className="min-h-11 self-start text-[10px] font-semibold text-emerald-700 hover:underline">
                Revalue {item.name}
              </button>
            )}
            {item.unitsPerPackage && item.unitsPerPackage > 1 && (
              <span className="text-[10px] font-black text-emerald-600 tracking-widest mt-0.5 uppercase tabular-nums">
                {formatCurrency(Math.round(item.unitCostCents / item.unitsPerPackage))} / {item.measurementUnit || 'unit'}
              </span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'unitPriceCents',
      header: showRuleIntel ? 'Net Margin %' : 'Unit Price',
      cell: ({ row }) => {
        const item = row.original;
        if (showRuleIntel && item.arbitrage) {
          const integrity = item.integrityScore ?? 0;
          const trajectory = item.trajectory ?? 0;
          return (
            <div className={cn('flex flex-col gap-1.5', !item.isAnalysisAccurate && 'opacity-30')}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Efficiency</span>
                  {item.isCoreDriver && <Crown aria-hidden="true" size={8} className="text-amber-500" />}
                  {item.anomaly && <AlertTriangle aria-hidden="true" size={8} className="text-rose-500 animate-pulse" />}
                  {trajectory > 0 && <TrendingUp aria-hidden="true" size={8} className="text-rose-500" />}
                  {trajectory < 0 && <TrendingDown aria-hidden="true" size={8} className="text-emerald-500" />}
                </div>
                {item.arbitrage.saving > 0 && item.isAnalysisAccurate && (
                  <span className="text-[8px] font-black text-emerald-600 animate-pulse bg-emerald-50 px-1 rounded tabular-nums">
                    -{formatCurrency(item.arbitrage.saving)} Saving
                  </span>
                )}
              </div>
              <div className={cn(
                'p-2 rounded-lg border transition-all',
                item.arbitrage.saving > 0 ? 'bg-emerald-50/50 border-emerald-100' : item.anomaly ? 'bg-rose-50/50 border-rose-100' : 'bg-zinc-100/50 border-[var(--line)]/50',
              )}>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[9px] font-bold text-zinc-500 truncate max-w-[80px]">{item.arbitrage.bestVendor}</span>
                  <span className="text-xs font-black text-[var(--text)] font-mono italic tabular-nums">
                    {item.arbitrage.bestPrice > 0 ? formatCurrency(item.arbitrage.bestPrice) : '---'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <div className="h-1 flex-1 bg-zinc-100 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full transition-all duration-1000', integrity > 75 ? 'bg-emerald-500' : integrity > 40 ? 'bg-amber-500' : 'bg-zinc-300')}
                    style={percentWidthStyle(integrity)}
                  />
                </div>
                <span className="text-[8px] font-black text-zinc-400 uppercase">{item.confidence}</span>
              </div>
              <div className="flex items-center justify-between mt-1 pt-1 border-t border-[var(--line)]">
                <div className="flex flex-col">
                  <span className="text-[7px] font-bold text-zinc-400 uppercase">Strategic Value</span>
                  <span className="text-[9px] font-black text-[var(--text)] font-mono">{(item.strategicValue ?? 0).toFixed(1)}</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[7px] font-bold text-zinc-400 uppercase">EOQ</span>
                  <span className="text-[9px] font-black text-indigo-600 font-mono">{(item.eoq ?? 0) > 0 ? item.eoq : '---'} units</span>
                </div>
                <div className="text-right">
                  <span className="text-[7px] font-bold text-zinc-400 uppercase">Maturity</span>
                  <div className="flex items-center gap-1">
                    <div className="w-12 h-1 bg-zinc-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-600 transition-all duration-1000" style={percentWidthStyle(item.maturityIndex ?? 0)} />
                    </div>
                    <span className="text-[8px] font-black font-mono">{item.maturityIndex ?? 0}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        }
        return (
          <div className="flex flex-col">
            <InlineEdit
              kind="money"
              value={item.unitPriceCents}
              display={formatCurrency(item.unitPriceCents)}
              label={`Price of ${item.name}`}
              canEdit={canChangeStock}
              onSave={v => onSaveField(item, 'unitPriceCents', v)}
              className="text-sm font-black text-emerald-600 font-mono tabular-nums"
            />
            {item.unitsPerPackage && item.unitsPerPackage > 1 && (
              <span className="text-[10px] font-bold text-amber-600 tracking-widest mt-0.5 uppercase tabular-nums">
                {formatCurrency(Math.round(item.unitPriceCents / item.unitsPerPackage))} / {item.measurementUnit || 'unit'}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'actions',
      enableSorting: false,
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex items-center justify-end gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
            {item.quantityAtHand > 0 && (
              <button
                type="button"
                onClick={() => onCogsItem(item)}
                title="Recognize COGS / Record Sale"
                className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg border border-emerald-200 text-xs font-semibold flex items-center gap-1.5 transition-all"
              >
                <ShoppingCart aria-hidden="true" size={12} />
                <span className="hidden lg:inline">COGS</span>
              </button>
            )}
            {canChangeStock && (
              <button
                type="button"
                aria-label={`Adjust stock of ${item.name}`}
                title="Adjust stock"
                disabled={!canPostStock}
                onClick={() => { if (canPostStock) onAdjustItem(item); }}
                className="p-2 hover:bg-[var(--surface)] rounded-xl border border-transparent hover:border-[var(--line)] transition-all"
              >
                <SlidersHorizontal aria-hidden="true" size={14} className="text-[var(--muted)]" />
              </button>
            )}
            <button
              type="button"
              aria-label={`Stock history of ${item.name}`}
              title="Stock history"
              onClick={() => onHistoryItem(item)}
              className="p-2 hover:bg-[var(--surface)] rounded-xl border border-transparent hover:border-[var(--line)] transition-all"
            >
              <History aria-hidden="true" size={14} className="text-[var(--muted)]" />
            </button>
            <button
              type="button"
              aria-label={`Edit item ${item.name}`}
              onClick={() => onEditItem(item)}
              className="p-2 hover:bg-[var(--surface)] rounded-xl border border-transparent hover:border-[var(--line)] transition-all"
            >
              <Edit2 aria-hidden="true" size={14} className="text-zinc-400" />
            </button>
            <ConfirmButton
              aria-label={`Delete ${item.name}`}
              onConfirm={async () => onDeleteItem(item.id)}
              confirmMessage="Are you sure you want to delete this inventory item?"
              className="p-2 hover:bg-rose-50 rounded-xl border border-transparent hover:border-rose-100 transition-all text-rose-400"
            >
              <Trash2 aria-hidden="true" size={14} />
            </ConfirmButton>
          </div>
        );
      },
    },
  ];
}
