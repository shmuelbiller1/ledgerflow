import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { describeError } from '../../../lib/errorRemedies';
import { RETENTION_LIMITS, retentionFor, type RetentionSettings } from '../../../lib/retentionPolicy';
import { clearDirtyTracking, registerUnsavedWorkGuard } from '../../../lib/pwaUpdateManager';

/**
 * Settings → Security → Data retention (L-08, BJ-05): how long the email log and browser error
 * reports are kept, how long a deleted workspace can be recovered, and legal hold. Owners change
 * it (PUT /api/v1/workspaces/:id/retention); everyone else sees it. The books and the audit
 * trail are always kept while the workspace exists.
 */
export default function RetentionSettingsPanel() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const user = useAuthStore(s => s.user);
  const isOwner = useCurrentRole() === 'owner';
  const saved = retentionFor(workspace);
  const [form, setForm] = useState<RetentionSettings>(saved);
  const [busy, setBusy] = useState(false);
  const dirty = Boolean(workspace) && (Object.keys(saved) as Array<keyof RetentionSettings>).some(k => saved[k] !== form[k]);
  useEffect(() => (dirty ? registerUnsavedWorkGuard(() => true) : undefined), [dirty]);
  if (!workspace) return null;
  const number = (key: 'deletionGraceDays' | 'emailLogDays' | 'errorLogDays') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: Math.round(Number(e.target.value) || 0) });

  const save = async () => {
    if (!user) return;
    if (form.legalHold !== saved.legalHold && !window.confirm(form.legalHold
      ? 'Put this workspace on legal hold? Nothing will be pruned, and if it is deleted it will not be purged until the hold is lifted.'
      : 'Lift the legal hold? Logs past their time will be pruned at the next daily run.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/retention`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.details || body.message || body.error || 'Retention settings were not saved');
      const store = useAuthStore.getState();
      store.setWorkspaces(store.workspaces.map(w => w.id === workspace.id ? { ...w, retention: body.retention } : w));
      clearDirtyTracking();
      toast.success('Retention settings saved');
    } catch (err) {
      const described = describeError(err, 'update');
      toast.error(described.title, { description: described.remedy });
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-28 px-3 py-2 bg-[var(--ink)] border border-[var(--line)] rounded-lg text-sm font-mono disabled:opacity-60';
  return (
    <section aria-labelledby="retention-title" className="p-6 bg-[var(--surface)] border border-[var(--line)] rounded-xl space-y-4">
      <div className="space-y-1">
        <h2 id="retention-title" className="text-base font-black text-[var(--text)] uppercase tracking-tight">Data retention</h2>
        <p className="text-xs text-[var(--muted)] max-w-2xl">
          The books and the audit trail are kept as long as the workspace exists. These settings decide how long the logs around
          them are kept. Bounced and spam-reported email addresses are always remembered, so they are never emailed again.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="ret-grace" className="micro-label">Recovery window after deletion (days)</label>
          <input id="ret-grace" type="number" className={field} disabled={!isOwner}
            min={RETENTION_LIMITS.deletionGraceDays.min} max={RETENTION_LIMITS.deletionGraceDays.max}
            value={form.deletionGraceDays} onChange={number('deletionGraceDays')} />
        </div>
        <div className="space-y-1">
          <label htmlFor="ret-email" className="micro-label">Email send log (days, 0 = forever)</label>
          <input id="ret-email" type="number" className={field} disabled={!isOwner}
            min={0} max={RETENTION_LIMITS.emailLogDays.max}
            value={form.emailLogDays} onChange={number('emailLogDays')} />
        </div>
        <div className="space-y-1">
          <label htmlFor="ret-errors" className="micro-label">Browser error reports (days)</label>
          <input id="ret-errors" type="number" className={field} disabled={!isOwner}
            min={RETENTION_LIMITS.errorLogDays.min} max={RETENTION_LIMITS.errorLogDays.max}
            value={form.errorLogDays} onChange={number('errorLogDays')} />
        </div>
      </div>
      <div className="flex items-start gap-2 text-sm">
        <input id="ret-hold" type="checkbox" className="mt-1" disabled={!isOwner} checked={form.legalHold}
          aria-describedby="ret-hold-help" onChange={e => setForm({ ...form, legalHold: e.target.checked })} />
        <div>
          <label htmlFor="ret-hold" className="font-semibold">Legal hold</label>
          <p id="ret-hold-help" className="text-xs text-[var(--muted)]">For a lawsuit, audit or investigation: nothing is pruned, and the workspace is not purged even if it is deleted.</p>
        </div>
      </div>
      {isOwner ? (
        <button type="button" onClick={save} disabled={busy || !dirty} className="btn-primary">
          {busy ? 'Saving…' : 'Save retention'}
        </button>
      ) : (
        <p className="text-xs text-[var(--muted)]">Only an owner can change these.</p>
      )}
    </section>
  );
}
