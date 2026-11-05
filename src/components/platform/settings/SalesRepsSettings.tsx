import React, { useState } from 'react';
import { UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useLedgerCollections } from '../../../hooks/useLedgerCollections';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { getIdToken } from '../../../firebase';
import { salesRepsProblem, type SalesRep } from '../../../lib/salesReps';

const field = 'px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/** A rep being edited: the percentage as typed. */
interface Draft { id?: string; name: string; percent: string; customerIds: string[] }

const toDraft = (r: SalesRep): Draft => ({ id: r.id, name: r.name, percent: String(r.commissionPercent), customerIds: [...(r.customerIds || [])] });
const fromDraft = (d: Draft) => ({
  ...(d.id ? { id: d.id } : {}), name: d.name,
  commissionPercent: d.percent.trim() === '' ? Number.NaN : Number(d.percent.replace(',', '.')),
  ...(d.customerIds.length ? { customerIds: d.customerIds } : {}),
});

/**
 * Settings → Sales reps (P-13): each rep's commission percentage and the customers they look after
 * (one rep per customer). Commission is worked out from what those customers pay (Reports → Sales
 * commission); nothing is posted. Owners and accountants keep them (saved by the server,
 * salesRepService.ts).
 */
export default function SalesRepsSettings() {
  useLedgerCollections('customers');
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const customers = useLedgerStore(s => s.customers);
  const role = useCurrentRole();
  const canChange = role === 'owner' || role === 'accountant';
  const [editing, setEditing] = useState<{ index: number | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  if (!workspace) return null;
  const reps = workspace.salesReps || [];
  const customerName = (id: string) => (customers || []).find(c => c.id === id)?.name || id;

  const save = async (next: Array<ReturnType<typeof fromDraft> | SalesRep>, done: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/sales-reps`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` }, body: JSON.stringify({ reps: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || 'The sales reps were not saved');
      setWorkspaces(useAuthStore.getState().workspaces.map(w => (w.id === workspace.id ? { ...w, salesReps: data.reps } : w)));
      toast.success(done);
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const draft = editing?.draft;
  const nextReps = (d: Draft) => {
    const list: Array<ReturnType<typeof fromDraft> | SalesRep> = [...reps];
    if (editing?.index === null || editing?.index === undefined) list.push(fromDraft(d)); else list[editing.index] = fromDraft(d);
    return list;
  };
  const problem = draft ? salesRepsProblem(nextReps(draft)) : null;
  const set = (change: Partial<Draft>) => setEditing(e => e && ({ ...e, draft: { ...e.draft, ...change } }));
  const otherRep = (customerId: string) => reps.find((r, i) => i !== editing?.index && (r.customerIds || []).includes(customerId));
  const shownCustomers = (customers || []).filter(c => !search.trim() || c.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100);

  return (
    <section aria-labelledby="sales-reps-title" className="space-y-4">
      <div>
        <h2 id="sales-reps-title" className="text-lg font-bold text-[var(--text)] flex items-center gap-2"><UserCheck className="w-5 h-5" aria-hidden="true" /> Sales reps</h2>
        <p className="text-sm text-[var(--muted)]">Who looks after which customers, and their commission: a percentage of what those customers pay, before tax. The Sales commission report works it out for any period.</p>
        {!canChange && <p className="text-sm text-[var(--muted)]">Owners and accountants keep the sales reps.</p>}
      </div>
      <ul className="rounded-xl border border-[var(--line)] bg-[var(--surface)] divide-y divide-[var(--line)]">
        {reps.length === 0 && <li className="p-4 text-sm text-[var(--muted)]">No sales reps yet.</li>}
        {reps.map((r, index) => (
          <li key={r.id} className="p-4 flex flex-wrap items-start justify-between gap-2 text-sm">
            <div>
              <p className="font-semibold text-[var(--text)]"><bdi>{r.name}</bdi> · {r.commissionPercent}%</p>
              <p className="text-xs text-[var(--muted)]">
                {(r.customerIds || []).length === 0 ? 'no customers yet' : `for ${(r.customerIds || []).slice(0, 3).map(customerName).join(', ')}${(r.customerIds || []).length > 3 ? ` and ${(r.customerIds || []).length - 3} more` : ''}`}
              </p>
            </div>
            {canChange && (
              <div className="flex gap-2 text-xs">
                <button type="button" disabled={busy} onClick={() => setEditing({ index, draft: toDraft(r) })} className="text-indigo-600 dark:text-indigo-400 hover:underline">Change<span className="sr-only"> {r.name}</span></button>
                <button type="button" disabled={busy} onClick={() => void save(reps.filter((_, i) => i !== index), `Sales rep ${r.name} removed`)} className="text-rose-600 hover:underline">Remove<span className="sr-only"> {r.name}</span></button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {canChange && draft && (
        <fieldset disabled={busy} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-3 text-sm">
          <legend className="px-1 font-semibold text-[var(--text)]">{editing?.index === null ? 'New sales rep' : 'Change the sales rep'}</legend>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-[var(--muted)]">Name<input value={draft.name} onChange={e => set({ name: e.target.value })} className={field} /></label>
            <label className="flex flex-col gap-1 text-[var(--muted)]">Commission, %<input inputMode="decimal" value={draft.percent} onChange={e => set({ percent: e.target.value })} className={`${field} w-28`} /></label>
          </div>
          <div role="group" aria-label="Their customers" className="space-y-1">
            <p className="text-xs text-[var(--muted)]">Their customers ({draft.customerIds.length}); a customer has one rep at most:</p>
            <input aria-label="Find a customer" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a customer" className={field} />
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {shownCustomers.map(c => {
                const other = otherRep(c.id);
                return (
                  <label key={c.id} className="flex items-center gap-2 text-[var(--text)]">
                    <input type="checkbox" checked={draft.customerIds.includes(c.id)} onChange={e => set({ customerIds: e.target.checked ? [...draft.customerIds, c.id] : draft.customerIds.filter(x => x !== c.id) })} />
                    <bdi>{c.name}</bdi>{other && <span className="text-xs text-[var(--muted)]">(now <bdi>{other.name}</bdi>)</span>}
                  </label>
                );
              })}
            </div>
          </div>
          {problem && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={Boolean(problem)} onClick={() => void save(nextReps(draft), `Sales rep ${draft.name.trim()} saved`)} className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Save sales rep</button>
            <button type="button" onClick={() => setEditing(null)} className="text-[var(--muted)] hover:underline">Cancel</button>
          </div>
        </fieldset>
      )}
      {canChange && !draft && (
        <button type="button" onClick={() => setEditing({ index: null, draft: { name: '', percent: '', customerIds: [] } })}
          className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-semibold text-[var(--text)] hover:bg-[var(--elevated)]">New sales rep</button>
      )}
    </section>
  );
}
