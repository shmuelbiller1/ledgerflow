import { planFor } from '../../../lib/plans';
import React, { useEffect, useState } from 'react';
import { getIdToken } from '../../../firebase';
import { useAuthStore } from '../../../stores/useAuthStore';
import { formatCurrency } from '../../../lib/utils';

import { BRAND_NAME } from '../../../config/brand';

interface Meter {
  used: number;
  limit: number;
}

interface Usage {
  plan: string;
  unlimited: boolean;
  entries?: { used: number; limit: number | null };
  entities?: Meter;
  firmClients?: Meter;
  rentalUnits?: Meter;
  paymentVolumeCents?: Meter & { platformFeeBps?: number };
  seats: Meter;
  storageMb: Meter;
}

/** Near a limit from 80% on, so it is seen before anything is refused. */
export const NEAR_LIMIT = 0.8;

/**
 * Strategy 7 + L-15 on Settings → Billing: shows value-aligned meters (companies/entities,
 * accounting-firm clients, rental units, monthly payment volume, people with access, and document
 * storage), while confirming ledger entries are unlimited unless an explicit API quota is set.
 */
export default function UsagePanel() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    (async () => {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/usage`, {
        headers: { Authorization: `Bearer ${await getIdToken()}` },
      });
      const body = await res.json().catch(() => ({}));
      return res.ok && body.usage ? (body.usage as Usage) : null;
    })()
      .then(u => {
        if (live) setUsage(u);
      })
      .catch(() => {
        if (live) setUsage(null);
      });
    return () => {
      live = false;
    };
  }, [workspaceId]);
  if (!usage) return null;

  const rows: Array<{
    label: string;
    used: number;
    limit: number;
    formatValue?: (n: number) => string;
    refusalNoun: string;
  }> = [];

  if (usage.entries && typeof usage.entries.limit === 'number') {
    rows.push({ label: 'Entries', used: usage.entries.used, limit: usage.entries.limit, refusalNoun: 'entries' });
  }
  if (usage.entities) {
    rows.push({ label: 'Companies / entities', used: usage.entities.used, limit: usage.entities.limit, refusalNoun: 'companies' });
  }
  if (usage.firmClients) {
    rows.push({ label: 'Accounting-firm clients', used: usage.firmClients.used, limit: usage.firmClients.limit, refusalNoun: 'client books' });
  }
  if (usage.rentalUnits) {
    rows.push({ label: 'Rental units', used: usage.rentalUnits.used, limit: usage.rentalUnits.limit, refusalNoun: 'rental units' });
  }
  if (usage.paymentVolumeCents) {
    rows.push({
      label: 'Monthly payment volume',
      used: usage.paymentVolumeCents.used,
      limit: usage.paymentVolumeCents.limit,
      formatValue: cents => formatCurrency(cents, 'USD'),
      refusalNoun: 'included volume',
    });
  }
  rows.push({ label: 'People with access', used: usage.seats.used, limit: usage.seats.limit, refusalNoun: 'people with access' });
  rows.push({
    label: 'Document storage',
    used: usage.storageMb.used,
    limit: usage.storageMb.limit,
    formatValue: n => `${n.toLocaleString()} MB`,
    refusalNoun: 'document storage',
  });

  return (
    <section aria-labelledby="usage-title" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="usage-title" className="text-sm font-bold text-[var(--text)]">
          Usage on the {planFor(usage.plan).name} plan
        </h3>
        {usage.entries && usage.entries.limit === null && (
          <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
            {usage.entries.used.toLocaleString()} entries recorded · Unlimited entries
          </span>
        )}
      </div>
      {usage.unlimited ? (
        <p className="text-xs text-[var(--muted)]">
          Free access (given by {BRAND_NAME}): no limits apply to this workspace.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map(({ label, used, limit, formatValue, refusalNoun }) => {
            const share = limit > 0 ? used / limit : 0;
            const fmt = formatValue || ((n: number) => n.toLocaleString());
            return (
              <li key={label}>
                <div className="flex justify-between gap-2">
                  <span>{label}</span>
                  <span className="font-mono">
                    {fmt(used)} of {fmt(limit)}
                  </span>
                </div>
                <div
                  className="mt-1 h-1.5 rounded bg-[var(--line)]"
                  role="progressbar"
                  aria-label={label}
                  aria-valuemin={0}
                  aria-valuemax={limit}
                  aria-valuenow={used}
                >
                  <div
                    className={`h-1.5 rounded ${
                      share >= 1 ? 'bg-rose-600' : share >= NEAR_LIMIT ? 'bg-amber-500' : 'bg-emerald-600'
                    }`}
                    style={{ width: `${Math.min(100, Math.round(share * 100))}%` }}
                  />
                </div>
                {share >= 1 ? (
                  <p role="alert" className="text-xs text-rose-600">
                    The limit is reached: new {refusalNoun} are refused until the plan changes.
                  </p>
                ) : share >= NEAR_LIMIT ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">Near the limit.</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
