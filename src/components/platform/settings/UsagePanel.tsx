import { planFor } from '../../../lib/plans';
import React, { useEffect, useState } from 'react';
import { getIdToken } from '../../../firebase';
import { useAuthStore } from '../../../stores/useAuthStore';

interface Usage { plan: string; unlimited: boolean; entries: { used: number; limit: number }; seats: { used: number; limit: number }; storageMb: { used: number; limit: number } }

/** Near a limit from 80% on, so it is seen before anything is refused. */
export const NEAR_LIMIT = 0.8;

/**
 * Usage (L-15) on Settings → Billing: what this workspace uses against its plan (entries, people with
 * access, document storage), counted by the server the same way the limits are checked, so nothing is
 * refused without having been shown here first.
 */
export default function UsagePanel() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    (async () => {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/usage`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const body = await res.json().catch(() => ({}));
      return res.ok && body.usage ? body.usage as Usage : null;
    })().then(u => { if (live) setUsage(u); }).catch(() => { if (live) setUsage(null); });
    return () => { live = false; };
  }, [workspaceId]);
  if (!usage) return null;
  const rows: Array<[string, { used: number; limit: number }, string]> = [['Entries', usage.entries, ''], ['People with access', usage.seats, ''], ['Document storage', usage.storageMb, ' MB']];
  return (
    <section aria-labelledby="usage-title" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-2">
      <h3 id="usage-title" className="text-sm font-bold text-[var(--text)]">Usage on the {planFor(usage.plan).name} plan</h3>
      {usage.unlimited ? <p className="text-xs text-[var(--muted)]">Free access (given by LedgerFlow): no limits apply to this workspace.</p> : (
        <ul className="space-y-2 text-sm">
          {rows.map(([label, { used, limit }, unit]) => {
            const share = limit > 0 ? used / limit : 0;
            return (
              <li key={label}>
                <div className="flex justify-between gap-2"><span>{label}</span><span className="font-mono">{used.toLocaleString()}{unit} of {limit.toLocaleString()}{unit}</span></div>
                <div className="mt-1 h-1.5 rounded bg-[var(--line)]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
                  <div className={`h-1.5 rounded ${share >= 1 ? 'bg-rose-600' : share >= NEAR_LIMIT ? 'bg-amber-500' : 'bg-emerald-600'}`} style={{ width: `${Math.min(100, Math.round(share * 100))}%` }} />
                </div>
                {share >= 1 ? <p role="alert" className="text-xs text-rose-600">The limit is reached: new {label.toLowerCase()} are refused until the plan changes.</p>
                  : share >= NEAR_LIMIT ? <p className="text-xs text-amber-700 dark:text-amber-400">Near the limit.</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
