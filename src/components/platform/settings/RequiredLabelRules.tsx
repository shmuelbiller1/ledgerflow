/**
 * Required labels (Z-12) in Settings → Dimensions: for each label (Project, Location, Property…),
 * the accounts whose entries must carry it, and the day that applies from. Owners and accountants
 * change it; it saves at once. Nothing is required until an account is added, so simple books see
 * nothing new. Entries missing a label are listed in Data Health; a rule can also refuse, and then
 * the server does not save an entry a person typed without it. The rules are src/lib/requiredLabels.ts.
 */
import React, { useState } from 'react';
import { toast } from 'sonner';
import { doc, updateDoc } from '../../../lib/db/firestore';
import { db } from '../../../firebase';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { DEFAULT_WORKSPACE_DIMENSIONS } from '../../../lib/dimensionUtils';
import { withRequiredOn, type RequiredOn } from '../../../lib/requiredLabels';
import { getLocalDateISO } from '../../../lib/utils';
import type { DimensionDefinition } from '../../../types';

import { BRAND_NAME } from '../../../config/brand';
export function RequiredLabelRules({ dimensions, onSaved }: { dimensions: DimensionDefinition[]; onSaved: (saved: DimensionDefinition[]) => void }) {
  const role = useCurrentRole();
  const canChange = role === 'owner' || role === 'accountant';
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const accounts = useLedgerStore(s => s.accounts || []);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const axes = dimensions.filter(d => d.id !== 'category');
  const accountName = (id: string) => accounts.find(a => a.id === id)?.name || 'an account that no longer exists';

  const save = async (axis: DimensionDefinition, requiredOn: RequiredOn | undefined, done: string) => {
    if (!workspace) return;
    const saved = workspace.dimensions || DEFAULT_WORKSPACE_DIMENSIONS;
    if (!saved.some(d => d.id === axis.id)) { setError(`Save the dimension registry first, then set the rule for ${axis.name}.`); return; }
    setBusy(axis.id);
    setError('');
    try {
      const next = withRequiredOn(saved, axis.id, requiredOn);
      await updateDoc(doc(db, 'workspaces', workspace.id), { dimensions: next });
      setWorkspaces(useAuthStore.getState().workspaces.map(w => (w.id === workspace.id ? { ...w, dimensions: next } : w)));
      onSaved(next);
      toast.success(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <section aria-labelledby="required-labels-title" className="p-6 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] space-y-3">
      <h3 id="required-labels-title" className="text-sm font-bold text-[var(--text)]">Required labels</h3>
      <p className="text-xs text-[var(--muted)]">
        Choose the accounts whose entries must carry a label, e.g. Property on Utilities. Entries from the date chosen on that are missing it are listed in Data Health, and the forms warn before saving. Choose "Refuse" to stop such entries being saved at all (entries {BRAND_NAME} makes itself, such as cost of goods sold, are only listed). Nothing is required until you add an account.
      </p>
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      <ul className="space-y-3">
        {axes.map(axis => {
          const rule = axis.requiredOn;
          const ids = rule?.accountIds || [];
          const choices = accounts.filter(a => !ids.includes(a.id) && !a.isArchived && !a.archived);
          return (
            <li key={axis.id} className="text-xs space-y-1.5">
              <p className="font-semibold text-[var(--text)]">{axis.name}: <span className="font-normal text-[var(--muted)]">{ids.length ? 'required on' : 'not required'}</span></p>
              {ids.length > 0 && (
                <ul aria-label={`Accounts that need ${axis.name}`} className="flex flex-wrap gap-1.5">
                  {ids.map(id => (
                    <li key={id} className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5">
                      {accountName(id)}
                      {canChange && (
                        <button type="button" disabled={busy === axis.id} className="text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
                          onClick={() => void save(axis, { ...rule!, accountIds: ids.filter(x => x !== id) }, `${axis.name} is no longer required on ${accountName(id)}`)}>
                          ×<span className="sr-only"> {axis.name} no longer required on {accountName(id)}</span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canChange && (
                <div className="flex flex-wrap items-center gap-2">
                  <select aria-label={`Require ${axis.name} on an account`} value="" disabled={busy === axis.id}
                    onChange={e => {
                      const id = e.target.value;
                      if (id) void save(axis, { ...rule, accountIds: [...ids, id], since: rule?.since || getLocalDateISO() }, `${axis.name} is now required on ${accountName(id)}`);
                    }}
                    className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1">
                    <option value="">Add an account…</option>
                    {choices.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} ` : ''}{a.name}</option>)}
                  </select>
                  {rule && (
                    <label className="inline-flex items-center gap-1 text-[var(--muted)]">from
                      <input type="date" aria-label={`${axis.name} required from`} value={rule.since} disabled={busy === axis.id}
                        onChange={e => { if (e.target.value) void save(axis, { ...rule, since: e.target.value }, `${axis.name} is required from ${e.target.value}`); }}
                        className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1" />
                    </label>
                  )}
                  {rule && (
                    <label className="inline-flex items-center gap-1 text-[var(--text)]">
                      <input type="checkbox" checked={rule.refuse === true} disabled={busy === axis.id}
                        onChange={e => void save(axis, { ...rule, refuse: e.target.checked }, e.target.checked ? `Entries without ${axis.name} are now refused` : `Entries without ${axis.name} are saved again, and listed`)} />
                      Refuse to save an entry without it
                    </label>
                  )}
                </div>
              )}
              {!canChange && rule && <p className="text-[var(--muted)]">from {rule.since}{rule.refuse ? '; entries without it are not saved' : ''}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
