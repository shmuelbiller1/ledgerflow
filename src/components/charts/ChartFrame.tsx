import React, { useMemo, useState } from 'react';
import { formatCurrency } from '../../lib/utils';
import { useChartKind, useChartScope, type ChartKind } from '../../hooks/useChartKind';
import ChartKindPicker from './ChartKindPicker';
import ChartDragBrush from './ChartDragBrush';
export interface ChartRow { id: string; label: string; [key: string]: string | number }
export interface ChartSeries { key: string; name: string; color?: string; unit?: 'money' | 'majorMoney' | 'percent' | 'days' | 'number' }
export interface ChartControls { rows: ChartRow[]; hidden: Set<string>; kind: ChartKind; focusedCategory?: string }
export function ChartTooltip({ active, payload, label, currency, series, shareTotal }: { series?: ChartSeries[]; active?: boolean; label?: string | number; currency?: string; shareTotal?: number; payload?: readonly { name?: string | number; value?: number | string; dataKey?: string | number; payload?: ChartRow }[] }) {
  if (!active || !payload?.length) return null;
  return <div role="tooltip" className="rounded-lg p-3 border border-[var(--line)] bg-[var(--panel)] text-[var(--text)] shadow-lg"><p className="font-semibold"><bdi>{payload[0].payload?.label ?? label}</bdi></p>{payload.map(entry => {
    const definition = series?.find(item => item.key === entry.dataKey);
    const share = shareTotal !== undefined && Number.isFinite(shareTotal) && shareTotal > 0 && entry.value !== undefined && entry.value !== '' && Number.isFinite(Number(entry.value)) ? Number(entry.value) / shareTotal * 100 : null;
    return <p key={`${entry.dataKey}:${entry.name}`}><bdi>{definition?.name ?? entry.name}</bdi>: {formatChartValue(entry.value, definition?.unit ?? (entry.dataKey === 'days' ? 'days' : 'money'), currency)}{share !== null && ` (${share.toFixed(1)}%)`}</p>;
  })}</div>;
}
function formatChartValue(value: unknown, unit: ChartSeries['unit'], currency?: string) {
  if (value === undefined || value === null || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return '—';
  if (unit === 'majorMoney') return Number.isFinite(Number(value)) ? formatCurrency(Math.round(Number(value) * 100), currency) : '—';
  if (unit === 'percent') return Number.isFinite(Number(value)) ? `${value}%` : '—';
  if (unit === 'number') return String(value);
  if (unit === 'days') return `${value} days`;
  return Number.isFinite(Number(value)) ? formatCurrency(Number(value), currency) : '—';
}
interface ChartFrameProps { title: string; rows: ChartRow[]; series: ChartSeries[]; currency?: string; time?: boolean; categories?: boolean; chartId?: string; defaultKind?: ChartKind; selectionRange?: [number, number] | null; onRangeChange?: (range: [number, number]) => void; onRangeReset?: () => void; children: (controls: ChartControls) => React.ReactNode }
export default function ChartFrame(props: ChartFrameProps) {
  const scope = useChartScope(props.chartId || props.title);
  return <ScopedChartFrame key={scope} {...props} preferenceKey={scope} />;
}
function ScopedChartFrame({ title, rows, series, currency, time = false, categories = false, chartId, defaultKind = 'bar', selectionRange, onRangeChange, onRangeReset, children, preferenceKey }: ChartFrameProps & { preferenceKey: string }) {
  const { kind, changeKind, storageError } = useChartKind(preferenceKey, defaultKind);
  const [focusedCategory, setFocusedCategory] = useState<string>();
  const [table, setTable] = useState(false), [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [window, setWindow] = useState<[number, number]>([0, Number.MAX_SAFE_INTEGER]);
  const selection = selectionRange === null ? [0, Number.MAX_SAFE_INTEGER] : selectionRange || window;
  const changeRange = (range: [number, number]) => { setWindow(range); onRangeChange?.(range); };
  const resetRange = () => { setWindow([0, Number.MAX_SAFE_INTEGER]); if (onRangeReset) onRangeReset(); else onRangeChange?.([0, rows.length - 1]); };
  const end = Math.min(selection[1], Math.max(0, rows.length - 1)), start = Math.min(selection[0], end);
  const shown = useMemo(() => rows.slice(start, end + 1).filter(row => !categories || !hidden.has(row.id)), [rows, start, end, categories, hidden]);
  const columns = series.filter(item => !hidden.has(item.key));
  const legends = categories ? rows.map(row => ({ key: row.id, name: row.label })) : series;
  const value = (row: ChartRow, column: ChartSeries) => formatChartValue(row[column.key], column.unit, currency);
  return <section aria-label={title} className="min-w-0 border border-[var(--line)] rounded-xl p-4 bg-[var(--panel)] text-[var(--text)] space-y-3"><h2 className="font-semibold">{title}</h2>
    <div className="flex flex-wrap gap-2"><button type="button" aria-pressed={!table} onClick={() => setTable(false)} className="option-state min-h-11 px-3 border rounded-lg">Chart</button><button type="button" aria-pressed={table} onClick={() => setTable(true)} className="option-state min-h-11 px-3 border rounded-lg">Table</button></div>
    {chartId && <ChartKindPicker title={title} kind={kind} onChange={changeKind} />}
    {chartId && storageError && <p role="status">Chart style changed for this visit; this browser could not save it.</p>}
    <div aria-label={`${title} legend`} className="flex flex-wrap gap-2">{legends.map(item => <button key={item.key} type="button" aria-pressed={!hidden.has(item.key)} onFocus={() => { if (categories) setFocusedCategory(item.key); }} onBlur={() => setFocusedCategory(undefined)} onClick={() => setHidden(previous => { const next = new Set(previous); if (next.has(item.key)) next.delete(item.key); else next.add(item.key); return next; })} className="option-state min-h-11 px-3 border rounded-lg"><bdi>{item.name}</bdi></button>)}</div>
    {time && rows.length > 1 && <fieldset className="space-y-2"><legend>Date range brush</legend>{onRangeChange && <ChartDragBrush title={title} rows={rows} start={start} end={end} onChange={changeRange} />}<label className="block">From: {rows[start]?.label}<input aria-label={`${title} brush start`} type="range" min={0} max={rows.length - 1} value={start} onChange={event => changeRange([Math.min(Number(event.target.value), end), end])} className="block w-full min-h-11" /></label><label className="block">To: {rows[end]?.label}<input aria-label={`${title} brush end`} type="range" min={0} max={rows.length - 1} value={end} onChange={event => changeRange([start, Math.max(start, Number(event.target.value))])} className="block w-full min-h-11" /></label><button type="button" onClick={resetRange} className="min-h-11 underline">Reset zoom</button></fieldset>}
    {shown.length === 0 || columns.length === 0 ? <p role="status">No visible data. Show a series or reset the date range.</p> : table ? <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">{title} data</caption><thead><tr><th scope="col" className="text-left">{time ? 'Date' : 'Record'}</th>{columns.map(column => <th key={column.key} scope="col" className="text-right">{column.name}</th>)}</tr></thead><tbody>{shown.map(row => <tr key={row.id}><th scope="row" className="text-left font-normal"><bdi>{row.label}</bdi></th>{columns.map(column => <td key={column.key} className="text-right tabular-nums">{value(row, column)}</td>)}</tr>)}</tbody></table></div> : <div className="h-72 w-full min-w-0">{children({ rows: shown, hidden, kind, focusedCategory })}</div>}
  </section>;
}
