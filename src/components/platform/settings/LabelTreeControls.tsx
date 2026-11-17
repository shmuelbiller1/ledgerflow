/** EU-E3: the parent picker for one label value, and the one-click "Parent / Child" conversion. */
import React, { useState } from 'react';
import { toast } from 'sonner';
import AsyncButton from '../../ui/AsyncButton';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { registerDimensionNodeInline } from '../../../lib/dimensionNodeActions';
import { setDimensionNodeParentInline } from '../../../lib/labelTreeActions';
import { descendants, slashConversionSkipped, type SlashConversion } from '../../../lib/labelTree';
import { allSettledWrites, attempt, identityScope } from '../../../lib/serverAction';
import type { DimensionNode } from '../../../types';

const sessionScope = () => identityScope(() => useAuthStore.getState().user?.uid, () => useAuthStore.getState().currentWorkspaceId);

export function LabelParentSelect({ dimensionId, node, nodes, canWrite, onChanged }: {
  dimensionId: string; node: DimensionNode; nodes: DimensionNode[]; canWrite: boolean; onChanged: () => void;
}) {
  // the full list of choices is built only for the picker being used: one per row for every value
  // would be (values × values) options on a large label
  const [open, setOpen] = useState(false);
  const current = node.parentId ? nodes.find(p => p.id === node.parentId && p.dimensionId === dimensionId) : undefined;
  if (!canWrite) return <span>{current?.description || '—'}</span>;
  const choices = (): DimensionNode[] => {
    if (!open) return current ? [current] : [];
    const below = new Set(descendants(nodes, dimensionId, node.id).map(d => d.id));
    // the current parent stays shown even when archived, so the link is visible and can be cleared
    return nodes.filter(p => p.dimensionId === dimensionId && p.id !== node.id && !below.has(p.id) && (p.status !== 'archived' || p.id === node.parentId));
  };
  const choose = async (parentId: string) => {
    const scope = sessionScope();
    const res = await attempt(() => setDimensionNodeParentInline(dimensionId, node.id, parentId || null));
    if (!scope.isCurrent()) return;
    if (!res.ok) { toast.error(res.error); return; }
    onChanged();
    toast.success(parentId ? 'Parent saved.' : 'Moved to the top level.');
  };
  return (
    <select aria-label={`Parent of ${node.description}`} value={node.parentId || ''} onFocus={() => setOpen(true)} onPointerDown={() => setOpen(true)}
      onChange={e => { void choose(e.target.value); }}
      className="min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 text-xs">
      <option value="">None (top level)</option>
      {choices().map(p => (
        <option key={p.id} value={p.id} disabled={p.status === 'archived'}>{p.description}{p.status === 'archived' ? ' (archived)' : ''}</option>
      ))}
    </select>
  );
}

/**
 * Shows the plan first; pressing Convert creates missing parents one after another (each takes the
 * next id), then links and renames every child, and says exactly which ones did not go through.
 */
export function SlashConversionOffer({ dimensionId, plan, onChanged }: { dimensionId: string; plan: SlashConversion[]; onChanged: () => void }) {
  const nodes = useLedgerStore(st => st.dimensionNodes);
  const skipped = slashConversionSkipped(nodes, dimensionId);
  if (!plan.length && !skipped.length) return null;
  const keyOf = (s: string) => s.normalize('NFC').trim().toLowerCase();
  const convert = async (): Promise<boolean> => {
    // refused before anything is created: with a partial label list a "missing" parent may exist
    if (useLedgerStore.getState().truncatedCollections.dimensionNodes) {
      toast.error('This workspace has more label values than were loaded, so parents can\'t be changed here yet.');
      return false;
    }
    const scope = sessionScope();
    const toCreateByKey = new Map<string, string>();
    for (const p of plan) {
      if (!p.parentId && !toCreateByKey.has(keyOf(p.parentName))) {
        toCreateByKey.set(keyOf(p.parentName), p.parentName);
      }
    }
    const created = new Map<string, string>();
    const createFailures: string[] = [];
    await [...toCreateByKey.entries()].reduce<Promise<void>>((previous, [parentKey, name]) => previous.then(async () => {
      if (!scope.isCurrent()) return; // stale: the workspace changed, create nothing in the new one
      const res = await attempt(() => registerDimensionNodeInline(dimensionId, name));
      if (res.ok) created.set(parentKey, res.value.id); else createFailures.push(`${name}: ${res.error}`);
    }), Promise.resolve());
    if (!scope.isCurrent()) return false;
    const links = plan.filter(p => p.parentId || created.has(keyOf(p.parentName)));
    const { failures } = await allSettledWrites(links, p => setDimensionNodeParentInline(dimensionId, p.nodeId, p.parentId || created.get(keyOf(p.parentName))!, p.newName));
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
        {plan.length > 0
          ? `${plan.length} value${plan.length === 1 ? '' : 's'} named like “Parent / Child” — turn them into real parents?`
          : `${skipped.length} “Parent / Child” value${skipped.length === 1 ? '' : 's'} need unique names before converting`}
      </summary>
      {plan.length > 0 && (
        <>
          <ul className="mt-2 space-y-1">
            {plan.map(p => <li key={p.nodeId}><bdi>{p.from}</bdi> → <bdi>{p.newName}</bdi>, under <bdi>{p.parentName}</bdi>{p.parentId ? '' : ' (new)'}</li>)}
          </ul>
          <AsyncButton onClick={convert} className="mt-3 min-h-11 rounded-lg border border-[var(--line)] px-3 font-semibold">Convert these {plan.length}</AsyncButton>
        </>
      )}
      {skipped.length > 0 && (
        <ul className="mt-2 space-y-1 text-[var(--muted)]">
          {skipped.map(s => <li key={s.nodeId}>Skipped <bdi>{s.from}</bdi>: {s.reason}.</li>)}
        </ul>
      )}
      <p className="mt-2 text-[var(--muted)]">Nothing changes until you press Convert. Entries keep their value ids, so reports and history are not affected.</p>
    </details>
  );
}
