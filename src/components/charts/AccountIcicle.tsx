import React, { useMemo, useState } from 'react';
import { hierarchy, partition } from 'd3-hierarchy';
import { accountIcicleTree, type BalanceMember, type AccountBlock } from '../../lib/chartDrillShapes';
import { formatCurrency } from '../../lib/utils';
import { ChartTooltip } from './ChartFrame';

export default function AccountIcicle({ members, currency }: { members: BalanceMember[]; currency?: string }) {
  const tree = useMemo(() => accountIcicleTree(members), [members]);
  const [zoom, setZoom] = useState('root'), [inspect, setInspect] = useState<string>();
  const full = hierarchy(tree);
  const chosen = full.descendants().find(node => node.data.id === zoom) || full;
  const root = hierarchy(chosen.data).sum(node => node.children.length || !node.weight ? 0 : 44 + node.weight / chosen.data.weight * 500);
  const levels = root.height + 1;
  const width = root.value || 500;
  const nodes = partition<AccountBlock>().size([width, levels * 48])(root).descendants();
  const active = nodes.find(node => node.data.id === inspect);
  const breadcrumbs = chosen.ancestors().reverse();
  return <section aria-label="Account balances icicle" className="p-4 border border-[var(--line)] bg-[var(--panel)] text-[var(--text)] rounded-xl space-y-3 min-w-0">
    <h2 className="font-semibold">Account balances icicle</h2>
    <p className="text-sm">Closing balances from the trial balance, in each account's normal direction. Parent totals include direct postings once. Block width uses absolute balances plus a 44px minimum for touch access; signed shares can exceed 100% when balances offset, and are undefined when the parent total is zero. Zero values remain in the table.</p>
    <nav aria-label="Account chart zoom" className="flex flex-wrap gap-2">{breadcrumbs.map(node => <button key={node.data.id} type="button" className="min-h-11 px-3 border rounded" onClick={() => { setZoom(node.data.id); setInspect(undefined); }}><bdi>{node.data.label}</bdi></button>)}</nav>
    {root.value ? <div role="region" aria-label="Account icicle blocks" tabIndex={0} className="overflow-x-auto"><div className="relative" style={{ width, height: levels * 48 }}>{nodes.filter(node => (node.value || 0) > 0).map((node, index) => <button type="button" key={node.data.id} aria-label={`${node.data.label}: ${formatCurrency(node.data.cents, currency)}${node.children?.length ? ', zoom in' : ''}`} onClick={() => { if (node.children?.length) { setZoom(node.data.id); setInspect(undefined); } }} onFocus={() => setInspect(node.data.id)} onBlur={() => setInspect(undefined)} onPointerEnter={() => setInspect(node.data.id)} onPointerLeave={() => setInspect(undefined)} className="absolute min-h-11 border border-[var(--panel)] overflow-hidden text-left px-1 text-xs focus-visible:z-10 focus-visible:outline-2" style={{ left: node.x0, width: node.x1 - node.x0, minWidth: 44, top: node.y0, height: 48, background: `hsl(${index * 47 % 360} 45% 30%)`, color: 'white' }}><bdi>{node.data.label}</bdi></button>)}</div></div> : <p role="status">No non-zero account balances to draw.</p>}
    {active && <ChartTooltip active currency={currency} series={[{ key: 'cents', name: 'Balance' }, { key: 'share', name: 'Share of parent', unit: 'percent' }]} payload={[{ dataKey: 'cents', value: active.data.cents, payload: { id: active.data.id, label: active.data.label } }, ...(active.parent && active.parent.data.cents !== 0 ? [{ dataKey: 'share', value: Number((active.data.cents / active.parent.data.cents * 100).toFixed(1)) }] : [])]} />}
    <details><summary className="min-h-11 cursor-pointer">Account balances table</summary><div role="region" aria-label="Account balances table scroll" tabIndex={0} className="overflow-x-auto"><table className="w-full text-sm"><caption>Signed account balances and parent shares</caption><thead><tr><th scope="col">Account or group</th><th scope="col">Balance</th><th scope="col">Share of parent</th></tr></thead><tbody>{full.descendants().map(node => <tr key={node.data.id}><th scope="row" className="text-left font-normal"><bdi>{node.ancestors().reverse().map(parent => parent.data.label).join(' / ')}</bdi></th><td className="text-right tabular-nums">{formatCurrency(node.data.cents, currency)}</td><td className="text-right">{node.parent && node.parent.data.cents !== 0 ? `${(node.data.cents / node.parent.data.cents * 100).toFixed(1)}%` : '—'}</td></tr>)}</tbody></table></div></details>
  </section>;
}
