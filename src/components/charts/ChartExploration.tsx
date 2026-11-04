import React, { useState } from 'react';
import { hierarchy, treemap, partition } from 'd3-hierarchy';
import { arc } from 'd3-shape';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip } from 'recharts';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useServerChartExploration } from '../../hooks/useServerChartExploration';
import { RangeReportSourceNote } from '../reporting/RangeReportSourceNote';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { formatCurrency } from '../../lib/utils';
import ChartFrame, { ChartTooltip } from './ChartFrame';
import type { ChartRow } from './ChartFrame';
interface Node { id?: string; name: string; value?: number; children?: Node[] }
function expenseTree(rows: ChartRow[]): Node {
  const root: Node = { id: 'root', name: 'Expenses', children: [] };
  for (const row of rows) { if (Number(row.cents) <= 0) continue; let parent = root; for (const part of JSON.parse(String(row.path)) as string[]) { let next = parent.children?.find(node => node.name === part); if (!next) { next = { id: `${parent.id}/${part}`, name: part, children: [] }; parent.children!.push(next); } parent = next; } parent.children!.push({ id: row.id, name: row.label, value: Number(row.cents) }); }
  return root;
}
function ExpenseMap({ rows, radial, currency, focusedCategory }: { rows: ChartRow[]; radial?: boolean; currency?: string; focusedCategory?: string }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const root = hierarchy(expenseTree(rows)).sum(node => node.value || 0).sort((a, b) => (b.value || 0) - (a.value || 0));
  const hoveredNode = root.descendants().find(node => node.data.id === hovered);
  const focused = rows.find(row => row.id === focusedCategory);
  const inspected = hoveredNode ? { label: hoveredNode.ancestors().reverse().map(item => item.data.name).join(' / '), cents: hoveredNode.value || 0 } : focused ? { label: focused.label, cents: Number(focused.cents) } : null;
  const tooltip = inspected && <div className="absolute bottom-0 right-0 pointer-events-none max-w-full"><ChartTooltip active label={inspected.label} currency={currency} payload={[{ name: 'Net expense', dataKey: 'cents', value: inspected.cents }]} /></div>;
  if (!root.value) return <p>No positive net expenses to draw. Signed values remain available in the table.</p>;
  if (radial) {
    const nodes = partition<Node>().size([Math.PI * 2, 120])(root).descendants().filter(node => node.depth > 0);
    const shape = arc<{ x0: number; x1: number; y0: number; y1: number }>().startAngle(node => node.x0).endAngle(node => node.x1).innerRadius(node => node.y0).outerRadius(node => node.y1);
    return <div className="relative w-full h-full"><svg onPointerLeave={() => setHovered(null)} viewBox="-130 -130 260 260" role="img" aria-label="Expense category sunburst; exact values in Table" className="w-full h-full">{nodes.map((node, index) => <path onPointerEnter={() => setHovered(node.data.id || null)} key={node.data.id} d={shape(node) || ''} fill={`hsl(${index * 47 % 360} 55% 45%)`} stroke="var(--panel)"><title>{node.ancestors().reverse().map(item => item.data.name).join(' / ')}: {formatCurrency(node.value, currency)}</title></path>)}</svg>{tooltip}</div>;
  }
  const nodes = treemap<Node>().size([500, 260]).padding(2)(root).leaves();
  return <div className="relative w-full h-full"><svg onPointerLeave={() => setHovered(null)} viewBox="0 0 500 260" role="img" aria-label="Expense category treemap; exact values in Table" className="w-full h-full">{nodes.map((node, index) => <g key={node.data.id}><rect onPointerEnter={() => setHovered(node.data.id || null)} x={node.x0} y={node.y0} width={Math.max(0, node.x1 - node.x0)} height={Math.max(0, node.y1 - node.y0)} fill={`hsl(${index * 47 % 360} 55% 45%)`}><title>{node.ancestors().reverse().map(item => item.data.name).join(' / ')}: {formatCurrency(node.value, currency)}</title></rect></g>)}</svg>{tooltip}</div>;
}
export default function ChartExploration({ months, currency }: { months: string[]; currency?: string }) {
  const uid = useAuthStore(state => state.user?.uid), workspace = useAuthStore(state => state.currentWorkspaceId);
  const { loading } = useLedgerCollections('invoices');
  // a list that failed to load counts as settled (its first read never marks it loaded): the server answers then
  const settled = useDataNeedsStore(state => Boolean(state.loaded.invoices || state.failed.invoices));
  const waiting = loading && !settled;
  // the expense maps need only the accounts and entries; only the payment points wait for the invoices
  const { data, source } = useServerChartExploration(months, true);
  const leaves = data.leaves;
  const rows = leaves.map(leaf => ({ id: leaf.id, label: leaf.label, cents: leaf.cents, path: JSON.stringify(leaf.path) }));
  const points = data.points;
  return <div key={`${uid}:${workspace}`} className="space-y-4"><p className="text-sm text-[var(--muted)]">Expense maps use posted net account amounts and the chart-of-accounts hierarchy for the selected months. Zero/negative net amounts are retained in the table and omitted from area diagrams. Invoice points require a fully paid invoice with a recorded payment date; missing dates and partial payments are excluded.</p><RangeReportSourceNote source={source} testId="chart-exploration-source" what="these charts" />
    <ChartFrame title="Invoice amount vs days to pay" rows={waiting && source !== 'server' ? [] : points} currency={currency} series={[{ key: 'cents', name: 'Invoice amount' }, { key: 'days', name: 'Days to pay', unit: 'days' }]}>{({ rows, hidden }) => hidden.has('days') || hidden.has('cents') ? <p>Show both invoice amount and days to draw the scatter plot.</p> : <ResponsiveContainer width="100%" height="100%"><ScatterChart><XAxis type="number" dataKey="days" name="Days to pay" unit=" days" /><YAxis type="number" dataKey="cents" name="Invoice amount" width={90} tickFormatter={value => formatCurrency(Number(value), currency)} /><Tooltip content={<ChartTooltip currency={currency} />} /><Scatter data={rows} fill="#4f46e5" /></ScatterChart></ResponsiveContainer>}</ChartFrame>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">{[false, true].map(radial => <ChartFrame key={`${workspace}:${radial}`} title={radial ? 'Expenses by category sunburst' : 'Expenses by category treemap'} rows={rows} categories currency={currency} series={[{ key: 'cents', name: 'Net expense' }]}>{({ rows, focusedCategory }) => <ExpenseMap rows={rows} radial={radial} currency={currency} focusedCategory={focusedCategory} />}</ChartFrame>)}</div>
  </div>;
}
