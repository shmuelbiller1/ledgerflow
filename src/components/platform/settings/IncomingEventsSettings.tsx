import { getIdToken } from '../../../firebase';
import { runCommand } from '../../../lib/runCommand';
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Info, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import type { EventSource, EventTone, IncomingEvent } from '../../../lib/incomingEvents';

/**
 * Settings → Incoming events (K-37): what Stripe (online card payments, the plan) and the email
 * provider (delivered, bounced, marked as spam) told LedgerFlow about this workspace, and what came of
 * each — so "the customer says they paid online" or "did the reminder arrive?" has an answer. Read
 * only; owners and accountants.
 */
const TONE_ICON: Record<EventTone, typeof CheckCircle2> = { ok: CheckCircle2, waiting: Clock, problem: AlertTriangle, info: Info };
const TONE_CLASS: Record<EventTone, string> = { ok: 'text-emerald-600', waiting: 'text-amber-600', problem: 'text-rose-600', info: 'text-[var(--muted)]' };
const SOURCES: Array<{ id: EventSource | 'all'; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'stripe', label: 'Online payments' }, { id: 'email', label: 'Email delivery' },
];

export default function IncomingEventsSettings() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const role = useCurrentRole();
  const allowed = role === 'owner' || role === 'accountant';
  const [events, setEvents] = useState<IncomingEvent[] | null>(null);
  const [error, setError] = useState('');
  const [source, setSource] = useState<EventSource | 'all'>('all');
  const [problemsOnly, setProblemsOnly] = useState(false);

  // "Refresh" asks again by bumping this; the request itself runs in the effect (the Schedule page's pattern)
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!workspaceId || !allowed) return;
    let live = true;
    void (async () => {
      try {
        const token = await getIdToken().catch(() => '');
        const data = await runCommand<{ data?: { events?: IncomingEvent[] }; message?: string }>({
          path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/incoming-events`,
          token,
        });
        if (!live) return;
        setEvents(data.data?.events || []);
        setError('');
      } catch (err) {
        if (!live) return;
        setError(err instanceof Error ? err.message : String(err));
        setEvents([]);
      }
    })();
    return () => { live = false; };
  }, [workspaceId, allowed, asked]);

  const shown = useMemo(() => (events || []).filter(e => (source === 'all' || e.source === source) && (!problemsOnly || e.tone === 'problem')), [events, source, problemsOnly]);
  const problems = (events || []).filter(e => e.tone === 'problem').length;

  if (!allowed) return <p className="p-6 text-sm text-[var(--muted)]">Owners and accountants see the incoming events.</p>;

  return (
    <section aria-labelledby="incoming-title" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="incoming-title" className="text-lg font-bold text-[var(--text)]">Incoming events</h2>
          <p className="text-sm text-[var(--muted)]">What Stripe and the email provider told us about this workspace, and what came of it. Newest first.</p>
        </div>
        <button type="button" onClick={() => setAsked(n => n + 1)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[var(--line)] rounded-lg hover:bg-[var(--panel)]">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div role="group" aria-label="Show" className="flex gap-1">
          {SOURCES.map(s => (
            <button key={s.id} type="button" aria-pressed={source === s.id} onClick={() => setSource(s.id)}
              className={`px-3 py-1 rounded-full border font-semibold ${source === s.id ? 'bg-[var(--text)] text-[var(--surface)] border-transparent' : 'border-[var(--line)] text-[var(--muted)]'}`}>{s.label}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 ml-2">
          <input type="checkbox" checked={problemsOnly} onChange={e => setProblemsOnly(e.target.checked)} /> Only problems ({problems})
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {events === null ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{events.length === 0 ? 'Nothing has come in yet. Online invoice payments and email delivery reports show here once they arrive.' : 'Nothing matches.'}</p>
      ) : (
        <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--surface)]">
          {shown.map(e => {
            const Icon = TONE_ICON[e.tone];
            return (
              <li key={`${e.source}-${e.id}`} className="flex items-start gap-3 p-3 text-sm">
                <Icon aria-hidden="true" className={`mt-0.5 w-4 h-4 shrink-0 ${TONE_CLASS[e.tone]}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[var(--text)]">{e.what}{e.detail && <span className="font-normal text-[var(--muted)]"> · <bdi>{e.detail}</bdi></span>}</p>
                  <p className={`text-xs ${e.tone === 'problem' ? 'text-rose-700' : 'text-[var(--muted)]'}`}>{e.outcome}</p>
                </div>
                <time dateTime={e.at} className="text-xs text-[var(--muted)] tabular-nums shrink-0">{e.at ? e.at.slice(0, 16).replace('T', ' ') : ''}</time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
