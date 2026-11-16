import React, { useEffect, useState } from 'react';
import { Blocks } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { runCommand, commandErrorMessage } from '../../../lib/runCommand';
import { isModuleOn, MODULES } from '../../../lib/modules';

/**
 * Settings → Modules (BB-07): which sets of screens this workspace uses. A module turned off leaves
 * the menu and the page search; nothing is deleted, and turning it on again shows everything as it
 * was. Owners and accountants change them (saved by the server, moduleService.ts); others see them.
 */
export default function ModulesSettings() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const role = useCurrentRole();
  const canChange = role === 'owner' || role === 'accountant';
  const [saving, setSaving] = useState<string | null>(null);
  // how many records each module keeps (step 2): a module turned off says it still holds them
  const workspaceId = workspace?.id;
  const [records, setRecords] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    (async () => {
      const data = await runCommand<{ records?: Record<string, number> }>({
        path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/modules/records`,
      });
      return data.records && typeof data.records === 'object' ? data.records : {};
    })().then(r => { if (live) setRecords(r); }).catch(() => { if (live) setRecords({}); });
    return () => { live = false; };
  }, [workspaceId]);
  if (!workspace) return null;

  const change = async (id: string, on: boolean) => {
    setSaving(id);
    try {
      // this route answers `{ error }`, which runCommand reads as well as `message`
      const data = await runCommand<{ modules?: Record<string, boolean> }>({
        path: `/api/v1/workspaces/${encodeURIComponent(workspace.id)}/modules`,
        method: 'PUT',
        body: { modules: { [id]: on } },
      });
      setWorkspaces(useAuthStore.getState().workspaces.map(w => (w.id === workspace.id ? { ...w, modules: data.modules } : w)));
      const name = MODULES.find(m => m.id === id)?.name || id;
      toast.success(on ? `${name} is on: its screens are in the menu` : `${name} is off: its screens left the menu, nothing was deleted`);
    } catch (err) {
      toast.error(commandErrorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  const enabledCount = MODULES.filter(m => isModuleOn(workspace.modules, m.id)).length;

  return (
    <section aria-labelledby="modules-title" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="modules-title" className="text-lg font-bold text-[var(--text)] flex items-center gap-2"><Blocks className="w-5 h-5" aria-hidden="true" /> Modules</h2>
          <p className="text-sm text-[var(--muted)]">Core bookkeeping (Overview, Transactions, Sales, Purchases, Banking, Reconciliation, Reports, Settings) is always active. Optional modules turned off leave the menu and search; nothing in them is deleted, and turning them back on restores every record.</p>
          {!canChange && <p className="text-sm text-[var(--muted)]">Owners and accountants choose the modules.</p>}
        </div>
        <span className="text-xs font-semibold px-3 py-1 rounded-full bg-[var(--panel)] border border-[var(--line)] text-[var(--text)] tabular-nums">
          {enabledCount} of {MODULES.length} active
        </span>
      </div>
      <ul className="rounded-xl border border-[var(--line)] bg-[var(--surface)] divide-y divide-[var(--line)]">
        {MODULES.map(m => {
          const on = isModuleOn(workspace.modules, m.id);
          return (
            <li key={m.id} className="p-4">
              <label className="flex items-start gap-3 text-sm text-[var(--text)]">
                <input type="checkbox" className="mt-1" checked={on} disabled={!canChange || saving !== null} onChange={e => void change(m.id, e.target.checked)} />
                <span>
                  <span className="font-semibold">{m.name}</span>
                  <span className="block text-xs text-[var(--muted)]">{m.about}</span>
                  {!on && (records[m.id] || 0) > 0 && (
                    <span className="block text-xs text-amber-700 dark:text-amber-400">Off, but it still holds {records[m.id]} record{records[m.id] === 1 ? '' : 's'}: turn it on to see them.</span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
