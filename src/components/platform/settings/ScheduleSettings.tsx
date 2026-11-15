import { runCommand, ServerCommandError } from '../../../lib/runCommand';
import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, HelpCircle } from 'lucide-react';
import type { ScheduledJobView, ScheduleView } from '../../../lib/jobSchedule';

/**
 * Settings → Schedule (BB-06): what the daily run takes care of, when it last did it, whether anything
 * in it went wrong, and when it is next due. Read-only, because when jobs run is the installation's
 * schedule (`vercel.json`'s cron) and not a workspace setting — a switch here would promise something
 * the app cannot do. Nothing to fix from this screen either: a job that failed is fixed by what it
 * failed about, which is written next to its name.
 */
const OUTCOME_ICON = { ok: CheckCircle2, failed: AlertTriangle, unknown: HelpCircle } as const;
const OUTCOME_WORD = { ok: 'ran', failed: 'went wrong', unknown: 'not reported' } as const;

function JobRow({ job }: { job: ScheduledJobView }) {
  const Icon = OUTCOME_ICON[job.outcome];
  return (
    <li className="flex items-start gap-3 py-2 border-t border-[var(--line)] first:border-t-0">
      <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${job.outcome === 'ok' ? 'text-emerald-600' : job.outcome === 'failed' ? 'text-rose-600' : 'text-[var(--muted)]'}`} />
      <div className="min-w-0">
        <p className="text-sm font-bold text-[var(--text)]">
          {job.name}
          <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-[var(--muted)]">{OUTCOME_WORD[job.outcome]}</span>
        </p>
        <p className="text-xs text-[var(--muted)]">{job.what}</p>
        {job.detail && <p className={`text-xs ${job.outcome === 'failed' ? 'text-rose-700' : 'text-[var(--muted)]'}`}>{job.detail}</p>}
      </div>
    </li>
  );
}

export default function ScheduleSettings() {
  const [schedule, setSchedule] = useState<ScheduleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const data = await runCommand<{ status?: string; message?: string; schedule?: unknown }>({ path: '/api/v1/schedule' });
        if (!live) return;
        if (data.status !== 'ok') throw new Error(String(data.message || ''), { cause: 'answered-no' });
        setSchedule(data.schedule as ScheduleView);
      } catch (err) {
        // the server's own sentence when it answered, our words when it did not answer at all.
        // A refusal arrives as ServerCommandError carrying that sentence; a dead connection does not.
        const answered = err instanceof ServerCommandError ? err.message : '';
        if (live) setError(answered || 'The schedule could not be read. The jobs may still have run — the record of them is what is missing.');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, []);

  const stateClass = schedule?.state === 'ok'
    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
    : schedule?.state === 'not_configured' || schedule?.state === 'never'
      ? 'border-neutral-300 bg-neutral-50 text-neutral-800'
      : 'border-rose-300 bg-rose-50 text-rose-900';

  return (
    <section aria-labelledby="schedule-title" className="p-6 bg-[var(--surface)] border border-[var(--line)] rounded-xl space-y-4">
      <div className="space-y-1">
        <h2 id="schedule-title" className="text-base font-black text-[var(--text)] uppercase tracking-tight">Schedule</h2>
        <p className="text-xs text-[var(--muted)] max-w-2xl">
          Once a day the server does the work that must not wait for someone to remember it: the drafts of
          recurring documents, the reminders and statements people asked for, the notices, and the clearing
          away of logs past their time. This is what the last run did. It cannot be changed from here, and it
          should not need to be.
        </p>
      </div>

      {loading && <p role="status" className="text-xs text-[var(--muted)]">Reading the last run…</p>}
      {!loading && error && (
        <p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900">{error}</p>
      )}
      {!loading && !error && schedule && (
        <>
          <div className={`rounded-lg border p-3 ${stateClass}`} role="status">
            <p className="text-sm font-bold">{schedule.headline}</p>
            <p className="mt-0.5 text-xs">{schedule.detail}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px]">
              <Clock aria-hidden="true" className="h-3.5 w-3.5" />
              Next run due {schedule.nextRunAt.slice(0, 10)} at {schedule.nextRunAt.slice(11, 16)} UTC
            </p>
          </div>
          <ul className="rounded-lg border border-[var(--line)] bg-[var(--ink)] px-3 py-1">
            {schedule.jobs.map(job => <JobRow key={job.id} job={job} />)}
          </ul>
          {schedule.state === 'not_configured' && (
            <p className="text-[11px] text-[var(--muted)]">
              Whoever runs this installation sets the cron secret; the time of day it runs at is in
              <code className="mx-1 rounded bg-[var(--ink)] px-1 py-0.5 font-mono">vercel.json</code>
              and is the same for every workspace on it.
            </p>
          )}
        </>
      )}
    </section>
  );
}
