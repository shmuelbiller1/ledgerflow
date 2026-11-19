import { runCommand, commandErrorMessage } from '../../lib/runCommand';
import { uiLanguageNow } from '../../lib/i18n/uiLanguageNow';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency } from '../../lib/utils';
import type { TimeRates } from '../../lib/timeEntries';

type Kind = 'people' | 'customers' | 'projects';
const KIND_LABEL: Record<Kind, string> = { projects: 'A project', customers: 'A customer', people: 'A person' };
const field = 'px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/**
 * Hourly rates (V-04) on Time, for owners and accountants: by project, customer and person; for an
 * entry the first that applies is used (its own, then its project's, its customer's, its person's).
 */
export default function TimeRatesPanel({ workspaceId, rates, onSaved, people }: { workspaceId: string; rates: TimeRates; onSaved: (rates: TimeRates) => void; people: Array<{ uid: string; email?: string; role: string }> }) {
  useLedgerCollections('customers', 'projects');
  const customers = useLedgerStore(s => s.customers);
  const projects = useLedgerStore(s => s.projects);
  const [kind, setKind] = useState<Kind>('projects');
  const [id, setId] = useState('');
  const [amount, setAmount] = useState('');
  const names: Record<Kind, Array<{ id: string; name: string }>> = {
    projects: (projects || []).map(p => ({ id: p.id, name: p.name })),
    customers: (customers || []).map(c => ({ id: c.id, name: c.name })),
    people: people.map(p => ({ id: p.uid, name: p.email || `A teammate (${p.role})` })),
  };
  const nameOf = (k: Kind, key: string) => names[k].find(n => n.id === key)?.name || key;
  const save = async (next: TimeRates) => {
    try {
      const data = await runCommand<{ rates?: TimeRates }>({ path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/time/rates`, method: 'PUT', body: { rates: next } });
      onSaved(data.rates ?? next);
      setId(''); setAmount('');
    } catch (err) { toast.error(commandErrorMessage(err, uiLanguageNow())); }
  };
  const cents = Math.round(Number(amount.replace(',', '.')) * 100);
  const set = () => save({ ...rates, [kind]: { ...(rates[kind] || {}), [id]: cents } });
  const drop = (k: Kind, key: string) => { const { [key]: _gone, ...rest } = rates[k] || {}; void save({ ...rates, [k]: rest }); };

  return (
    <details className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-[var(--text)]">Hourly rates</summary>
      <p className="mt-2 text-xs text-[var(--muted)]">For each entry the first that applies is used: a project's, then a customer's, then a person's.</p>
      <ul className="mt-2 space-y-1">
        {(['projects', 'customers', 'people'] as Kind[]).flatMap(k => Object.entries(rates[k] || {}).map(([key, value]) => (
          <li key={`${k}-${key}`} className="flex items-center justify-between gap-2">
            <span>{KIND_LABEL[k]}: <bdi>{nameOf(k, key)}</bdi> · {formatCurrency(value)} an hour</span>
            <button type="button" onClick={() => drop(k, key)} className="text-xs text-rose-600 hover:underline">Remove<span className="sr-only"> the rate of {nameOf(k, key)}</span></button>
          </li>
        )))}
      </ul>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[var(--muted)]">For
          <select value={kind} onChange={e => { setKind(e.target.value as Kind); setId(''); }} className={field}>
            {(['projects', 'customers', 'people'] as Kind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">Which
          <select value={id} onChange={e => setId(e.target.value)} className={field}>
            <option value="">Choose…</option>
            {names[kind].map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">An hour<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className={`${field} w-28`} /></label>
        <button type="button" disabled={!id || !(cents >= 0) || amount.trim() === ''} onClick={() => void set()} className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold text-[var(--text)] disabled:opacity-50">Set the rate</button>
      </div>
    </details>
  );
}
