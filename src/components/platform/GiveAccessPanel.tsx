import React, { useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { fetchWithAuth } from './SystemCommandCenterShared';

const LEVELS = [
  { id: 'full', label: 'Full (free, no limits)' },
  { id: 'pro', label: 'Pro plan' },
  { id: 'growth', label: 'Growth plan' },
  { id: 'tester', label: 'Tester (free, no limits)' },
  { id: 'none', label: 'Take access away (Free plan)' },
] as const;

/** ACC-1: give a person access by email; every workspace they own changes, each with an audit line. */
export function GiveAccessPanel() {
  const ids = { email: useId(), level: useId(), admin: useId() };
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState<(typeof LEVELS)[number]['id']>('full');
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  // the answer shown belongs to the latest press only
  const latestRequest = useRef(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const requestId = ++latestRequest.current;
    setBusy(true); setDone(null);
    try {
      const res = await fetchWithAuth('/api/v1/admin/give-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, level, makeAdmin }) });
      const data = await res.json().catch(() => ({}));
      if (requestId !== latestRequest.current) return;
      if (!res.ok) throw new Error(data?.message || 'Access could not be given');
      const names = (data.workspaces as { name: string }[]).map(w => w.name);
      setDone(names.length ? `Done for ${names.join(', ')}${data.madeAdmin ? '; now a platform admin' : ''}.` : `${email} owns no workspace yet${data.madeAdmin ? '; now a platform admin' : ''}.`);
      toast.success('Access updated');
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      toast.error(err instanceof Error ? err.message : 'Access could not be given');
    } finally {
      if (requestId === latestRequest.current) setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} aria-labelledby={`${ids.email}-title`} className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-3">
      <h2 id={`${ids.email}-title`} className="text-sm font-bold text-[var(--text)]">Give access</h2>
      <div className="flex flex-wrap gap-3 items-end">
        <label htmlFor={ids.email} className="text-xs text-[var(--muted)] flex flex-col gap-1">Email
          <input id={ids.email} type="email" required value={email} onChange={e => setEmail(e.target.value)} className="min-h-11 px-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-[var(--text)]" />
        </label>
        <label htmlFor={ids.level} className="text-xs text-[var(--muted)] flex flex-col gap-1">Access
          <select id={ids.level} value={level} onChange={e => setLevel(e.target.value as typeof level)} className="min-h-11 px-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-[var(--text)]">
            {LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <label htmlFor={ids.admin} className="text-xs text-[var(--text)] flex items-center gap-2 min-h-11">
          <input id={ids.admin} type="checkbox" checked={makeAdmin} onChange={e => setMakeAdmin(e.target.checked)} /> Also make a platform admin
        </label>
        <button type="submit" disabled={busy || !email} className="min-h-11 px-4 rounded-lg bg-[var(--text)] text-[var(--ink)] text-xs font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Give access'}</button>
      </div>
      {done && <p role="status" className="text-xs text-[var(--text)]">{done}</p>}
    </form>
  );
}
