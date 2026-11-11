import { displayDimensionName } from '../../../lib/dimensionUtils';
/**
 * Label roles (DIM-3) in Settings → Dimensions: for each label (Project, Location, Property…), whether it is only
 * informational, fully attributed (every line needs a value) or self-balancing (and each value balances in every
 * entry). Owners and accountants change it; it saves at once. Entries that do not meet a role are listed in Data
 * Health; nothing is refused. The rules are src/lib/labelRoles.ts.
 */
import React, { useState } from 'react';
import { toast } from 'sonner';
import { doc, updateDoc } from '../../../lib/db/firestore';
import { db } from '../../../firebase';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { DEFAULT_WORKSPACE_DIMENSIONS } from '../../../lib/dimensionUtils';
import { LABEL_ROLES, labelRole, withLabelRole, type LabelRole } from '../../../lib/labelRoles';
import type { DimensionDefinition } from '../../../types';

export function LabelRoles({ dimensions, onSaved }: { dimensions: DimensionDefinition[]; onSaved: (saved: DimensionDefinition[]) => void }) {
  const role = useCurrentRole();
  const canChange = role === 'owner' || role === 'accountant';
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const axes = dimensions.filter(d => d.id !== 'category');

  const save = async (axis: DimensionDefinition, next: LabelRole) => {
    if (!workspace) return;
    const saved = workspace.dimensions || DEFAULT_WORKSPACE_DIMENSIONS;
    if (!saved.some(d => d.id === axis.id)) { setError(`Save the labels first, then set the role of ${displayDimensionName(axis)}.`); return; }
    setBusy(axis.id);
    setError('');
    try {
      const updated = withLabelRole(saved, axis.id, next);
      await updateDoc(doc(db, 'workspaces', workspace.id), { dimensions: updated });
      setWorkspaces(useAuthStore.getState().workspaces.map(w => (w.id === workspace.id ? { ...w, dimensions: updated } : w)));
      onSaved(updated);
      toast.success(`${displayDimensionName(axis)} is now ${LABEL_ROLES[next].name.toLowerCase()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <section aria-labelledby="label-roles-title" className="p-6 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] space-y-3">
      <h3 id="label-roles-title" className="text-sm font-bold text-[var(--text)]">Label roles</h3>
      <p className="text-xs text-[var(--muted)]">
        Choose how much each label must add up. Informational labels only describe lines. A fully attributed label must be on every line of every entry. A self-balancing label must also balance for each value, so each property or project has a balance sheet of its own. Entries that do not meet the role are listed in Data Health.
      </p>
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      <ul className="space-y-2">
        {axes.map(axis => (
          <li key={axis.id} className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-semibold text-[var(--text)] min-w-24"><bdi>{displayDimensionName(axis)}</bdi></span>
            {canChange ? (
              <select aria-label={`Role of ${displayDimensionName(axis)}`} value={labelRole(axis)} disabled={busy === axis.id}
                onChange={e => { void save(axis, e.target.value as LabelRole); }}
                className="px-2 py-1 bg-[var(--panel)] border border-[var(--line)] rounded-lg text-[var(--text)]">
                {(Object.keys(LABEL_ROLES) as LabelRole[]).map(r => <option key={r} value={r}>{LABEL_ROLES[r].name}</option>)}
              </select>
            ) : <span>{LABEL_ROLES[labelRole(axis)].name}</span>}
            <span className="text-[var(--muted)]">{LABEL_ROLES[labelRole(axis)].hint}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
