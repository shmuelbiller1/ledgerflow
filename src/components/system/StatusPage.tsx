import React, { useEffect, useState } from 'react';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';

import { BRAND_NAME } from '../../config/brand';
import { runCommand } from '../../lib/runCommand';
/**
 * Public status page at /status (L-17, BO-06, G-14): each part of LedgerFlow and whether it works,
 * from GET /api/v1/public/status. Needs no sign-in, so people can check it when they can't log in.
 */

type ComponentState = 'operational' | 'degraded' | 'down' | 'not_configured';

interface StatusComponent {
  id: string;
  name: string;
  state: ComponentState;
  detail: string;
}

interface SystemStatus {
  state: 'operational' | 'degraded' | 'down';
  checkedAt: string;
  components: StatusComponent[];
}

const STATE_LABEL: Record<ComponentState, string> = {
  operational: 'Working',
  degraded: 'Problems',
  down: 'Not working',
  not_configured: 'Not set up',
};

const STATE_STYLE: Record<ComponentState, string> = {
  operational: 'bg-emerald-100 text-emerald-900',
  degraded: 'bg-amber-100 text-amber-900',
  down: 'bg-red-100 text-red-900',
  not_configured: 'bg-gray-100 text-gray-800',
};

const HEADLINE: Record<SystemStatus['state'], string> = {
  operational: 'No problems reported by available checks',
  degraded: 'Some parts have problems',
  down: 'Service checks report an outage',
};

// These server checks report configuration presence, not provider availability or a successful transaction.
const CONFIGURATION_ONLY = new Set(['signin', 'email', 'payments', 'banks']);
function validStatus(value: unknown): value is SystemStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Partial<SystemStatus>;
  return ['operational', 'degraded', 'down'].includes(String(status.state)) &&
    typeof status.checkedAt === 'string' && Number.isFinite(Date.parse(status.checkedAt)) &&
    Array.isArray(status.components) && status.components.every(c => c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.detail === 'string' && Object.hasOwn(STATE_LABEL, c.state));
}

/** Renders the public system health status page and refreshes health checks while visible. */
export default function StatusPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [check, setCheck] = useState(0);

  useEffect(() => {
    let alive = true;
    const started = performance.now();
    // a public page: no session exists here, and `token: null` says so rather than leaving it to chance
    runCommand<unknown>({ path: '/api/v1/public/status', token: null })
      .then(data => {
        if (!alive) return;
        if (!validStatus(data)) throw new Error('Invalid status response');
        setLatencyMs(Math.max(1, Math.round(performance.now() - started)));
        setStatus(data);
        setUnreachable(false);
      })
      .catch(() => { if (alive) setUnreachable(true); });
    return () => { alive = false; };
  }, [check]);

  // look again every minute while visible/online, and catch up immediately when returning to the tab
  useVisibilityPolling(() => setCheck(n => n + 1), 60_000);

  const overall: SystemStatus['state'] | null = unreachable ? 'down' : status?.state ?? null;
  const workingCount = status?.components.filter(c => c.state === 'operational' && !CONFIGURATION_ONLY.has(c.id)).length ?? 0;
  const checkedCount = status?.components.filter(c => !CONFIGURATION_ONLY.has(c.id)).length ?? 0;

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 py-12 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="space-y-1">
          <p className="text-sm font-semibold text-gray-700">{BRAND_NAME}</p>
          <h1 className="text-2xl font-bold">System status</h1>
          <p className="text-xs text-gray-700">Automatic health check every 60 seconds · No sign-in required</p>
          <p className="text-xs text-gray-700">Sign-in, email, card payments and bank feeds are checked for configuration only, not live provider availability. Scheduled jobs report their most recent recorded run.</p>
        </header>

        <section aria-live="polite" className="bg-white rounded-xl border border-gray-200 p-6">
          {overall === null ? (
            <p className="text-gray-700">Checking…</p>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className={`text-lg font-semibold ${overall === 'operational' ? 'text-emerald-800' : overall === 'degraded' ? 'text-amber-800' : 'text-red-800'}`}>
                  {unreachable ? 'Status is unavailable' : HEADLINE[overall]}
                </p>
                {status && !unreachable && (
                  <p className="text-sm text-gray-700 mt-1">
                    Checked {new Date(status.checkedAt).toLocaleString()}
                    {latencyMs !== null ? ` · ${latencyMs} ms` : ''}
                  </p>
                )}
              </div>
              {status && !unreachable && (
                <span className="text-xs font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-800 tabular-nums">
                  {workingCount}/{checkedCount} checks reporting operational
                </span>
              )}
            </div>
          )}
        </section>

        {status && !unreachable && (
          <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100" aria-label={`Parts of ${BRAND_NAME}`}>
            {status.components.map(c => (
              <li key={c.id} className="flex items-start justify-between gap-4 p-4">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-sm text-gray-700">{c.detail}</p>
                </div>
                <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${STATE_STYLE[c.state]}`}>{CONFIGURATION_ONLY.has(c.id) && c.state === 'operational' ? 'Set up (not live-tested)' : STATE_LABEL[c.state]}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between text-sm text-gray-700">
          <button
            type="button"
            onClick={() => setCheck(n => n + 1)}
            className="underline text-gray-900 font-medium min-h-11 px-2 inline-flex items-center"
          >
            Check again
          </button>
          <a
            href="/"
            className="underline text-gray-900 font-medium min-h-11 px-2 inline-flex items-center"
          >
            Back to {BRAND_NAME}
          </a>
        </div>
      </div>
    </main>
  );
}
