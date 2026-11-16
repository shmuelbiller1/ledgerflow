/** EU-E3: the parent picker for one label value, and the one-click "Parent / Child" conversion. */
import React from 'react';
import { toast } from 'sonner';
import AsyncButton from '../../ui/AsyncButton';
import { useAuthStore } from '../../../stores/useAuthStore';
import { registerDimensionNodeInline } from '../../../lib/dimensionNodeActions';
import { setDimensionNodeParentInline } from '../../../lib/labelTreeActions';
import { descendants, type SlashConversion } from '../../../lib/labelTree';
import { allSettledWrites, attempt, identityScope } from '../../../lib/serverAction';
import type { DimensionNode } from '../../../types';

const sessionScope = () => identityScope(() => useAuthStore.getState().user?.uid, () => useAuthStore.getState().currentWorkspaceId);

export function LabelParentSelect({ dimensionId, node, nodes, canWrite, onChanged }: {
  dimensionId: string; node: DimensionNode; nodes: DimensionNode[]; canWrite: boolean; onChanged: () => void;
}) {
  const own = nodes.filter(n => n.dimensionId === dimensionId);
  if (!canWrite) return <span>{own.find(p => p.id === node.parentId)?.description || '—'}</span>;
  const below = new Set(descendants(nodes, dimensionId, node.id).map(d => d.id));
  const choose = async (parentId: string) => {
    const scope = sessionScope();
    const res = await attempt(() => setDimensionNodeParentInline(dimensionId, node.id, parentId || null));
    if (!scope.isCurrent()) return;
    if (!res.ok) { toast.error(res.error); return; }
    onChanged();
    toast.success(parentId ? 'Parent saved.' : 'Moved to the top level.');
  };
  return (
    <select aria-label={`Parent of ${node.description}`} value={node.parentId || ''} onChange={e => { void choose(e.target.value); }}
      className="min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 text-xs">
      <option value="">None (top level)</option>
      {own.filter(p => p.id !== node.id && p.status !== 'archived' && !below.has(p.id)).map(p => <option key={p.id} value={p.id}>{p.description}</option>)}
    </select>
  );
}

/**
 * Shows the plan first; pressing Convert creates missing parents one after another (each takes the
 * next id), then links and renames every child, and says exactly which ones did not go through.
 */
export function SlashConversionOffer({ dimensionId, plan, onChanged }: { dimensionId: string; plan: SlashConversion[]; onChanged: () => void }) {
  if (!plan.length) return null;
  const convert = async (): Promise<boolean> => {
    const scope = sessionScope();
    const toCreate = [...new Set(plan.filter(p => !p.parentId).map(p => p.parentName))];
    const created = new Map<string, string>();
    const createFailures: string[] = [];
    await toCreate.reduce<Promise<void>>((previous, name) => previous.then(async () => {
      const res = await attempt(() => registerDimensionNodeInline(dimensionId, name));
      if (res.ok) created.set(name, res.value.id); else createFailures.push(`${name}: ${res.error}`);
    }), Promise.resolve());
    if (!scope.isCurrent()) return false;
    const links = plan.filter(p => p.parentId || created.has(p.parentName));
    const { failures } = await allSettledWrites(links, p => setDimensionNodeParentInline(dimensionId, p.nodeId, p.parentId || created.get(p.parentName)!, p.newName));
    if (!scope.isCurrent()) return false;
    onChanged();
    const problems = [...createFailures, ...failures.map(f => `${f.item.from}: ${f.error}`)];
    if (problems.length) { toast.error(`Not converted: ${problems.join('; ')}`); return false; }
    toast.success(`${links.length} value${links.length === 1 ? '' : 's'} now sit under their parent.`);
    return true;
  };
  return (
    <details className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 text-xs">
      <summary className="cursor-pointer min-h-11 flex items-center font-semibold">
        {plan.length} value{plan.length === 1 ? '' : 's'} named like “Parent / Child” — turn them into real parents?
      </summary>
      <ul className="mt-2 space-y-1">
        {plan.map(p => <li key={p.nodeId}><bdi>{p.from}</bdi> → <bdi>{p.newName}</bdi>, under <bdi>{p.parentName}</bdi>{p.parentId ? '' : ' (new)'}</li>)}
      </ul>
      <AsyncButton onClick={convert} className="mt-3 min-h-11 rounded-lg border border-[var(--line)] px-3 font-semibold">Convert these {plan.length}</AsyncButton>
      <p className="mt-2 text-[var(--muted)]">Nothing changes until you press Convert. Entries keep their value ids, so reports and history are not affected.</p>
    </details>
  );
}
