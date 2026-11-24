import { planFor } from '../../../lib/plans';
import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { formatCurrency } from '../../../lib/utils';

import { BRAND_NAME } from '../../../config/brand';
import { runCommand } from '../../../lib/runCommand';
import { percentWidthStyle } from '../../../lib/percentBar';

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
  /** SBX-2 Part 7: this month's assistant answers that used an AI model, and their cost. */
  assistant?: { month: string; turns: number; modelTurns: number; costCents: number; limits: { modelTurns: number; costCents: number } | null };
}

/** Near a limit from 80% on, so it is seen before anything is refused. */
export const NEAR_LIMIT = 0.8;

function isUsage(value: unknown): value is Usage {
  if (!value || typeof value !== 'object') return false;
  const u = value as Record<string, unknown>;
  const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const meter = (v: unknown) => !!v && typeof v === 'object' && number((v as Meter).used) && number((v as Meter).limit);
  if (typeof u.plan !== 'string' || typeof u.unlimited !== 'boolean' || !meter(u.seats) || !meter(u.storageMb)) return false;
  if (['entities', 'firmClients', 'rentalUnits', 'paymentVolumeCents'].some(k => u[k] !== undefined && !meter(u[k]))) return false;
  if (u.entries !== undefined) {
    if (!u.entries || typeof u.entries !== 'object') return false;
    const entries = u.entries as { used?: unknown; limit?: unknown };
    if (!number(entries.used) || !(entries.limit === null || number(entries.limit))) return false;
  }
  if (u.assistant !== undefined) {
    if (!u.assistant || typeof u.assistant !== 'object') return false;
    const a = u.assistant as { modelTurns?: unknown; costCents?: unknown; limits?: { modelTurns?: unknown; costCents?: unknown } | null };
    if (!number(a.modelTurns) || !number(a.costCents) || !(a.limits === null || (!!a.limits && number(a.limits.modelTurns) && number(a.limits.costCents)))) return false;
  }
  return true;
}

/**
 * Strategy 7 + L-15 on Settings → Billing: shows value-aligned meters (companies/entities,
 * accounting-firm clients, rental units, monthly payment volume, people with access, and document
 * storage), while confirming ledger entries are unlimited unless an explicit API quota is set.
 */
export default function UsagePanel() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const uid = useAuthStore(s => s.user?.uid);
  const [version, setVersion] = useState(0);
  const key = JSON.stringify([workspaceId, uid, version]);
  const [result, setResult] = useState<{ key: string; usage?: Usage; error?: string } | null>(null);
  useEffect(() => {
    if (!workspaceId || !uid) return;
    let live = true;
    (async () => {
      const body = await runCommand<{ usage?: unknown }>({ path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/usage` });
      if (!isUsage(body?.usage)) throw new Error('The server returned invalid usage data.');
      return body.usage;
    })()
      .then(usage => { if (live) setResult({ key, usage }); })
      .catch(err => { if (live) setResult({ key, error: err instanceof Error ? err.message : 'Usage could not be loaded.' }); });
    return () => { live = false; };
  }, [workspaceId, uid, key]);
  if (!workspaceId || !uid) return null;
  const current = result?.key === key ? result : null;
  if (current?.error) return <section aria-label="Usage"><p role="alert">Could not load usage: {current.error} <button type="button" onClick={() => setVersion(v => v + 1)} className="min-h-11 underline">Retry loading usage</button></p></section>;
  if (!current?.usage) return <section aria-label="Usage"><p role="status">Loading usage…</p></section>;
  const usage = current.usage;

  const rows: Array<{
    label: string;
    used: number;
    limit: number;
    formatValue?: (n: number) => string;
    refusalNoun: string;
    refusal?: string;
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
  if (usage.assistant?.limits) {
    // only answers that needed an AI model count; answers read straight from the books are free
    const refusal = 'The assistant’s AI limit for this month is reached: questions that need AI are refused until next month or a plan change. Answers read straight from your books still work.';
    rows.push({ label: 'Assistant answers using AI (this month)', used: usage.assistant.modelTurns, limit: usage.assistant.limits.modelTurns, refusalNoun: 'AI answers', refusal });
    rows.push({
      label: 'Assistant AI cost (this month)',
      used: Math.ceil(usage.assistant.costCents),
      limit: usage.assistant.limits.costCents,
      formatValue: cents => formatCurrency(cents, 'USD'),
      refusalNoun: 'AI answers',
      refusal,
    });
  }

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
          {rows.map(({ label, used, limit, formatValue, refusalNoun, refusal }) => {
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
                    style={percentWidthStyle(Math.round(share * 100))}
                  />
                </div>
                {share >= 1 ? (
                  <p role="alert" className="text-xs text-rose-600">
                    {refusal ?? `The limit is reached: new ${refusalNoun} are refused until the plan changes.`}
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
