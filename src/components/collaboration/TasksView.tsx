import React, { useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { getIdToken } from '../../firebase';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { formatDate, getLocalDateISO } from '../../lib/utils';
import { useRecordChoices } from './recordChoices';
import WatchingPanel from './WatchingPanel';
import { EmptyState } from '../ui/EmptyState';
import { isLate, MAX_TASK_NOTE, MAX_TASK_TITLE, sortTasks, TASK_RECORD_TYPES, taskProblem, type Task } from '../../lib/tasks';
import type { RecordType } from '../../lib/recordLinks';

interface Person { uid: string; role: string; email?: string }
type Show = 'mine' | 'open' | 'done';
const field = 'px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

async function call(workspaceId: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/tasks${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'That did not work');
  return data;
}


/**
 * Tasks (BG-02 assign a record, BG-03 task list): what each person in the workspace has to do, the
 * late ones flagged. Owners, accountants and bookkeepers give a task to anyone here, optionally
 * about one record, which opens from the list. The person given it is told; ticking it done tells
 * whoever made it (src/lib/tasks.ts, src/server/services/taskService.ts).
 */
export default function TasksView() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const uid = useAuthStore(s => s.user?.uid) || '';
  const role = useCurrentRole();
  const openRecord = useUIStore(s => s.openRecord);
  const canGive = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [failed, setFailed] = useState('');
  const [show, setShow] = useState<Show>('mine');
  const [draft, setDraft] = useState({ title: '', note: '', assignee: '', due: '', recordType: '' as RecordType | '', recordId: '' });
  const [busy, setBusy] = useState(false);
  const workspaceId = workspace?.id || '';
  const choices = useRecordChoices(draft.recordType, workspace?.currency || 'USD');
  const today = getLocalDateISO();

  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    call(workspaceId, '')
      .then(data => { if (live) { setTasks(data.tasks || []); setPeople(data.people || []); setFailed(''); } })
      .catch(err => { if (live) setFailed(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [workspaceId]);

  if (!workspace) return <div className="p-6 md:p-8"><h1 className="text-2xl font-bold text-[var(--text)]">Tasks</h1><p className="text-sm text-[var(--muted)]">Open a workspace to see its tasks: what each person has to do, given by owners, accountants and bookkeepers.</p></div>;
  const nameOf = (id: string) => (id === uid ? 'you' : people.find(p => p.uid === id)?.email || `a teammate (${id.slice(0, 6)})`);
  const record = draft.recordType && draft.recordId ? { type: draft.recordType, id: draft.recordId, label: choices.find(c => c.id === draft.recordId)?.label || draft.recordId } : undefined;
  const input = { title: draft.title, assignee: draft.assignee || uid, ...(draft.note.trim() ? { note: draft.note } : {}), ...(draft.due ? { due: draft.due } : {}), ...(record ? { record } : {}) };
  const problem = taskProblem(input);
  const all = sortTasks(tasks || []);
  const shown = all.filter(t => (show === 'mine' ? t.status === 'open' && t.assignee === uid : t.status === show));

  const give = async () => {
    setBusy(true);
    try {
      const data = await call(workspaceId, '', 'POST', input);
      setTasks(list => [...(list || []), data.task]);
      setDraft({ title: '', note: '', assignee: '', due: '', recordType: '', recordId: '' });
      toast.success(input.assignee === uid ? 'Task added to your list' : `Task given to ${nameOf(input.assignee)}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };
  const change = async (task: Task, status: 'open' | 'done') => {
    try {
      const data = await call(workspaceId, `/${encodeURIComponent(task.id)}`, 'PATCH', { status });
      setTasks(list => (list || []).map(t => (t.id === task.id ? data.task : t)));
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
  };
  const remove = async (task: Task) => {
    try {
      await call(workspaceId, `/${encodeURIComponent(task.id)}`, 'DELETE');
      setTasks(list => (list || []).filter(t => t.id !== task.id));
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
  };
  const count = (s: Show) => all.filter(t => (s === 'mine' ? t.status === 'open' && t.assignee === uid : t.status === s)).length;
  const LABELS: Record<Show, string> = { mine: 'For me', open: 'All open', done: 'Done' };

  return (
    <div className="h-full overflow-auto p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2"><ListChecks className="w-6 h-6" aria-hidden="true" /> Tasks</h1>
          <p className="text-sm text-[var(--muted)]">What each person here has to do, optionally about an invoice, bill, entry, account or item. The person is told; when it is done, whoever gave it is told.</p>
        </header>
        {canGive && (
          <fieldset disabled={busy} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-3 text-sm">
            <legend className="px-1 font-semibold text-[var(--text)]">New task</legend>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-[var(--muted)] flex-1 min-w-60">What is to be done<input value={draft.title} maxLength={MAX_TASK_TITLE} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} className={field} /></label>
              <label className="flex flex-col gap-1 text-[var(--muted)]">Who does it
                <select value={draft.assignee || uid} onChange={e => setDraft(d => ({ ...d, assignee: e.target.value }))} className={field}>
                  {[...people].sort((a, b) => (a.uid === uid ? -1 : b.uid === uid ? 1 : nameOf(a.uid).localeCompare(nameOf(b.uid)))).map(p => <option key={p.uid} value={p.uid}>{p.uid === uid ? 'Me' : nameOf(p.uid)} ({p.role})</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[var(--muted)]">By<input type="date" value={draft.due} onChange={e => setDraft(d => ({ ...d, due: e.target.value }))} className={field} /></label>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-[var(--muted)]">About
                <select value={draft.recordType} onChange={e => setDraft(d => ({ ...d, recordType: e.target.value as RecordType | '', recordId: '' }))} className={field}>
                  <option value="">Nothing in particular</option>
                  {TASK_RECORD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              {draft.recordType && (
                <label className="flex flex-col gap-1 text-[var(--muted)] flex-1 min-w-60">Which one
                  <select value={draft.recordId} onChange={e => setDraft(d => ({ ...d, recordId: e.target.value }))} className={field}>
                    <option value="">Choose…</option>
                    {choices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
              )}
            </div>
            <label className="flex flex-col gap-1 text-[var(--muted)]">Note (optional)<textarea rows={2} placeholder="Write @name (their email before the @) to tell someone else too" maxLength={MAX_TASK_NOTE} value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} className={field} /></label>
            {draft.title && problem && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
            <button type="button" disabled={Boolean(problem) || (Boolean(draft.recordType) && !draft.recordId)} onClick={() => void give()} className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Give the task</button>
          </fieldset>
        )}
        <WatchingPanel />
        <div role="group" aria-label="Show tasks" className="flex flex-wrap gap-2">
          {(['mine', 'open', 'done'] as Show[]).map(s => (
            <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)}
              className={`px-3 py-1.5 rounded-lg border text-sm ${show === s ? 'border-indigo-500 bg-indigo-500/10 text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)]'}`}>{LABELS[s]} ({count(s)})</button>
          ))}
        </div>
        {failed && <p role="alert" className="text-sm text-rose-600">{failed}</p>}
        {!tasks && !failed && <p role="status" className="text-sm text-[var(--muted)]">Loading…</p>}
        {tasks && (
          <ul className="rounded-xl border border-[var(--line)] bg-[var(--surface)] divide-y divide-[var(--line)]">
            {shown.length === 0 && (
              <li>
                <EmptyState
                  title={show === 'mine' ? 'Nothing for you to do' : show === 'open' ? 'No open tasks' : 'No finished tasks yet'}
                  description="A task asks someone in the workspace to do something, optionally about a record. Give one with the form above and it appears here."
                />
              </li>
            )}
            {shown.map(t => (
              <li key={t.id} className="p-4 flex flex-wrap items-start gap-3 text-sm">
                <input type="checkbox" checked={t.status === 'done'} aria-label={`${t.status === 'done' ? 'Open again' : 'Done'}: ${t.title}`}
                  disabled={!(role === 'owner' || t.assignee === uid || t.createdBy === uid)} onChange={e => void change(t, e.target.checked ? 'done' : 'open')} className="mt-1" />
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-[var(--text)] ${t.status === 'done' ? 'line-through' : ''}`}><bdi>{t.title}</bdi></p>
                  <p className="text-xs text-[var(--muted)]">
                    For {nameOf(t.assignee)} · from {t.createdBy === uid ? 'you' : t.createdByEmail || nameOf(t.createdBy)}
                    {t.due ? <> · <span className={isLate(t, today) ? 'font-semibold text-rose-600' : ''}>{isLate(t, today) ? 'late, was due' : 'by'} {formatDate(t.due)}</span></> : ''}
                    {t.status === 'done' && t.doneAt ? ` · done ${formatDate(t.doneAt.slice(0, 10))}` : ''}
                  </p>
                  {t.record && <button type="button" onClick={() => openRecord({ type: t.record!.type, id: t.record!.id })} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"><bdi>{t.record.label}</bdi></button>}
                  {t.note && <p className="mt-1 whitespace-pre-line text-xs text-[var(--text)]"><bdi>{t.note}</bdi></p>}
                </div>
                {(role === 'owner' || t.createdBy === uid) && <button type="button" onClick={() => void remove(t)} className="text-xs text-rose-600 hover:underline">Remove<span className="sr-only"> {t.title}</span></button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
