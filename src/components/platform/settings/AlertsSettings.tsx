import React, { useState } from 'react';
import { BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { getIdToken } from '../../../firebase';
import { alertSettingsProblem, DEFAULT_CLOSE_REMINDER_DAY, type AlertSettings } from '../../../lib/bookAlerts';
import { formatCurrency, readAmountCents } from '../../../lib/utils';

/**
 * Settings → Alerts (S-08, S-10, S-11): what the nightly check tells owners and accountants about
 * the books: a reminder to close last month from a chosen day, a budget overspent, and cash below a
 * chosen amount. Each is told once, in the bell (and turned off per person in its settings).
 */
const field = 'px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

export default function AlertsSettings() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaces = useAuthStore(s => s.workspaces);
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const role = useCurrentRole();
  const canChange = role === 'owner' || role === 'accountant';
  const saved = workspace?.alerts || {};
  const currency = workspace?.currency || 'USD';
  const savedDay = saved.closeReminderDay === null ? null : (saved.closeReminderDay ?? DEFAULT_CLOSE_REMINDER_DAY);
  const [remind, setRemind] = useState(savedDay !== null);
  const [day, setDay] = useState(String(savedDay ?? DEFAULT_CLOSE_REMINDER_DAY));
  const [cashOn, setCashOn] = useState(saved.cashLowCents !== undefined && saved.cashLowCents !== null);
  const [cash, setCash] = useState(saved.cashLowCents ? String(saved.cashLowCents / 100) : '');
  const [budgets, setBudgets] = useState(saved.budgetAlerts !== false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!workspace?.id) return;
    const alerts: AlertSettings = {
      closeReminderDay: remind ? Number(day) : null,
      cashLowCents: cashOn ? readAmountCents(cash) ?? Number.NaN : null,
      budgetAlerts: budgets,
    };
    if (cashOn && (!cash.trim() || readAmountCents(cash) === null)) { toast.error('Enter the cash amount to be told about'); return; }
    const problem = alertSettingsProblem(alerts);
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    try {
      const token = await getIdToken().catch(() => null);
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/alerts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(alerts),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'The alerts could not be saved');
      setWorkspaces(workspaces.map(w => (w.id === workspace.id ? { ...w, alerts: data.alerts as AlertSettings } : w)));
      toast.success('Alerts saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const disabled = !canChange || busy;

  return (
    <section aria-labelledby="alerts-title" className="space-y-4">
      <div>
        <h2 id="alerts-title" className="text-lg font-bold text-[var(--text)] flex items-center gap-2"><BellRing className="w-5 h-5" aria-hidden="true" /> Alerts</h2>
        <p className="text-sm text-[var(--muted)]">Checked every night. Owners and accountants are told in the bell, once for each thing.</p>
      </div>

      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] divide-y divide-[var(--line)]">
        <fieldset className="p-4 space-y-2" disabled={disabled}>
          <legend className="sr-only">Close reminder</legend>
          <label className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <input type="checkbox" checked={remind} onChange={e => setRemind(e.target.checked)} />
            Remind us to close last month
          </label>
          {remind && (
            <label className="flex items-center gap-2 text-sm text-[var(--text)] pl-6">
              from day
              <select value={day} onChange={e => setDay(e.target.value)} className={field} aria-label="Day of the month for the close reminder">
                {Array.from({ length: 28 }, (_, i) => String(i + 1)).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              of each month, until it is closed
            </label>
          )}
        </fieldset>

        <fieldset className="p-4 space-y-2" disabled={disabled}>
          <legend className="sr-only">Low cash</legend>
          <label className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <input type="checkbox" checked={cashOn} onChange={e => setCashOn(e.target.checked)} />
            Tell us when cash runs low
          </label>
          {cashOn && (
            <label className="flex flex-wrap items-center gap-2 text-sm text-[var(--text)] pl-6">
              when the bank and cash accounts together hold less than
              <input value={cash} onChange={e => setCash(e.target.value)} inputMode="decimal" className={`${field} w-32`} dir="ltr"
                aria-label={`Low cash amount (${currency})`} placeholder={formatCurrency(500000, currency)} />
              <span className="text-xs text-[var(--muted)]">{currency}</span>
            </label>
          )}
        </fieldset>

        <fieldset className="p-4" disabled={disabled}>
          <legend className="sr-only">Budgets</legend>
          <label className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <input type="checkbox" checked={budgets} onChange={e => setBudgets(e.target.checked)} />
            Tell us when an account goes over its budget
          </label>
          <p className="text-xs text-[var(--muted)] pl-6">For budgets on an account: once its month, quarter or year has spent more than budgeted.</p>
        </fieldset>
      </div>

      {canChange ? (
        <button type="button" disabled={busy} onClick={() => void save()} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">
          {busy ? 'Saving…' : 'Save alerts'}
        </button>
      ) : (
        <p className="text-xs text-[var(--muted)]">Owners and accountants change the alerts.</p>
      )}
    </section>
  );
}
