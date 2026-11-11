import React, { useRef, useState } from 'react';
import { CalendarClock, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { db, getIdToken } from '../../../firebase';
import { doc, updateDoc } from '../../../lib/db/firestore';
import {
  MAX_SCHEDULES, SCHEDULED_REPORTS, lastFinishedPeriod, parseRecipients, scheduleProblem,
  type ReportFrequency, type ScheduledReport, type ScheduledReportKind,
} from '../../../lib/scheduledReports';
import { getLocalDateISO } from '../../../lib/utils';
import { workspaceScope } from '../../../lib/serverAction';

/**
 * Settings → Scheduled reports (K-28): a report emailed by itself after each finished week (Monday to
 * Sunday) or month, with the figures in the email and a spreadsheet attached. Owners and accountants
 * add, remove and send one now; the daily job sends the rest, each period once.
 */
const field = 'px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

export default function ScheduledReportsSettings() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaces = useAuthStore(s => s.workspaces);
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const userEmail = useAuthStore(s => s.user?.email) || '';
  const role = useCurrentRole();
  const canChange = role === 'owner' || role === 'accountant';
  const schedules = workspace?.scheduledReports || [];
  const [report, setReport] = useState<ScheduledReportKind>('profit-and-loss');
  const [frequency, setFrequency] = useState<ReportFrequency>('monthly');
  const [recipients, setRecipients] = useState(userEmail);
  const [busy, setBusy] = useState('');
  // R-3: the email the new schedule would send for its last finished period, before saving it
  const latestPreview = useRef('');
  const [preview, setPreview] = useState<{ subject: string; html: string; attachments: string[] } | null>(null);
  // a preview belongs to the report and frequency it was asked for: changing either drops it, and a reply still on its way is ignored
  const dropPreview = () => { latestPreview.current = ''; setPreview(null); };
  const showPreview = async () => {
    if (!workspace?.id) return;
    // a reply for another workspace or report (the user switched while it loaded) is not shown
    const scope = workspaceScope(() => useAuthStore.getState().currentWorkspaceId);
    const asked = `${report}|${frequency}`;
    const isCurrent = () => scope.isCurrent() && latestPreview.current === asked;
    latestPreview.current = asked;
    setBusy('preview');
    try {
      const token = await getIdToken().catch(() => null);
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/report-schedules/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ report, frequency }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.html !== 'string') throw new Error(data.message || 'The preview could not be made');
      if (!isCurrent()) return;
      setPreview({ subject: String(data.subject || ''), html: data.html, attachments: Array.isArray(data.attachments) ? data.attachments.map(String) : [] });
    } catch (err) {
      if (!isCurrent()) return;
      setPreview(null);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const save = async (next: ScheduledReport[], message: string) => {
    if (!workspace?.id) return false;
    setBusy('save');
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), { scheduledReports: next, updatedAt: new Date().toISOString() });
      setWorkspaces(workspaces.map(w => (w.id === workspace.id ? { ...w, scheduledReports: next } : w)));
      toast.success(message);
      return true;
    } catch {
      toast.error('Could not save (owners and accountants can change scheduled reports).');
      return false;
    } finally {
      setBusy('');
    }
  };

  const add = async () => {
    const schedule: ScheduledReport = { id: `sr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, report, frequency, recipients: parseRecipients(recipients) };
    const problem = scheduleProblem(schedule);
    if (problem) { toast.error(problem); return; }
    if (schedules.length >= MAX_SCHEDULES) { toast.error(`At most ${MAX_SCHEDULES} scheduled reports`); return; }
    await save([...schedules, schedule], `${SCHEDULED_REPORTS[report]} will be emailed ${frequency === 'weekly' ? 'every Monday' : 'on the 1st of each month'}`);
  };

  const sendNow = async (s: ScheduledReport) => {
    if (!workspace?.id) return;
    setBusy(s.id);
    try {
      const token = await getIdToken().catch(() => null);
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/report-schedules/${encodeURIComponent(s.id)}/send-now`, {
        method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'The report could not be sent');
      if (data.failed?.length) toast.error(`Sent to ${data.sent}; not sent to ${data.failed.join(', ')}`);
      else toast.success(`Sent to ${data.sent} ${data.sent === 1 ? 'address' : 'addresses'} (${data.period?.label})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const nextLabel = (s: ScheduledReport) => {
    const p = lastFinishedPeriod(s.frequency, getLocalDateISO());
    return s.frequency === 'weekly' ? `weekly, Monday to Sunday (last: ${p.label})` : `monthly (last: ${p.label})`;
  };

  return (
    <section aria-labelledby="scheduled-reports-title" className="space-y-4">
      <div>
        <h2 id="scheduled-reports-title" className="text-lg font-bold text-[var(--text)] flex items-center gap-2"><CalendarClock className="w-5 h-5" aria-hidden="true" /> Scheduled reports</h2>
        <p className="text-sm text-[var(--muted)]">A report emailed by itself after each finished week or month, with a spreadsheet attached. Each period is sent once.</p>
      </div>

      {schedules.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No scheduled reports yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--surface)]">
          {schedules.map(s => (
            <li key={s.id} className="p-3 text-sm flex flex-wrap items-center gap-3">
              <span className="font-semibold text-[var(--text)]">{SCHEDULED_REPORTS[s.report] || s.report}</span>
              <span className="text-xs text-[var(--muted)] flex-1">{nextLabel(s)} · to <bdi>{s.recipients.join(', ')}</bdi></span>
              {canChange && (
                <>
                  <button type="button" disabled={Boolean(busy)} onClick={() => void sendNow(s)} aria-label={`Send ${SCHEDULED_REPORTS[s.report]} now`}
                    className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 disabled:opacity-50">
                    <Send className="w-3.5 h-3.5" aria-hidden="true" /> {busy === s.id ? 'Sending…' : 'Send now'}
                  </button>
                  <button type="button" disabled={Boolean(busy)} onClick={() => void save(schedules.filter(x => x.id !== s.id), `${SCHEDULED_REPORTS[s.report]} is no longer emailed`)}
                    aria-label={`Stop ${SCHEDULED_REPORTS[s.report]} ${s.frequency}`} className="text-[var(--muted)] hover:text-rose-600 disabled:opacity-50">
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canChange ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text)]">Add a scheduled report</h3>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--muted)]">Report</span>
              <select value={report} onChange={e => { dropPreview(); setReport(e.target.value as ScheduledReportKind); }} className={field}>
                {(Object.keys(SCHEDULED_REPORTS) as ScheduledReportKind[]).map(k => <option key={k} value={k}>{SCHEDULED_REPORTS[k]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--muted)]">How often</span>
              <select value={frequency} onChange={e => { dropPreview(); setFrequency(e.target.value === 'weekly' ? 'weekly' : 'monthly'); }} className={field}>
                <option value="monthly">Monthly (on the 1st, for the month before)</option>
                <option value="weekly">Weekly (on Monday, for the week before)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[14rem]">
              <span className="text-xs text-[var(--muted)]">Email to (commas between addresses)</span>
              <input value={recipients} onChange={e => setRecipients(e.target.value)} className={field} dir="ltr" placeholder="you@example.com, accountant@example.com" />
            </label>
            <button type="button" disabled={Boolean(busy)} onClick={() => void showPreview()} className="px-3 py-1.5 rounded border border-[var(--line)] font-semibold disabled:opacity-50">{busy === 'preview' ? 'Making the preview…' : 'Preview'}</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void add()} className="px-3 py-1.5 rounded bg-indigo-600 text-white font-semibold disabled:opacity-50">Add</button>
          </div>
          {preview && (
            <div className="space-y-2" data-testid="schedule-preview">
              <p className="text-sm"><span className="text-[var(--muted)]">Subject:</span> <bdi>{preview.subject}</bdi></p>
              {preview.attachments.length > 0 && <p className="text-xs text-[var(--muted)]">Attached: {preview.attachments.join(', ')}</p>}
              {/* the email body exactly as sent, in a sandbox that runs no script */}
              <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="w-full h-96 rounded border border-[var(--line)] bg-white" />
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)]">Owners and accountants add and change scheduled reports.</p>
      )}
    </section>
  );
}
