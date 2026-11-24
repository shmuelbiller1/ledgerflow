import { runCommand, commandErrorMessage } from '../../lib/runCommand';
import { uiLanguageNow } from '../../lib/i18n/uiLanguageNow';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { TASK_RECORD_TYPES } from '../../lib/tasks';
import type { Watch } from '../../lib/watches';
import type { RecordType } from '../../lib/recordLinks';
import { useRecordChoices } from './recordChoices';

const field = 'px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

async function call(workspaceId: string, path: string, method = 'GET', body?: unknown) {
  return runCommand<WatchesAnswer>({
    path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/tasks/watching${path}`,
    method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
    body,
  });
}

/**
 * Watching records (BG-04) on Tasks: the records I watch, each opening from here, and "Watch" for
 * another. Once a day I am told about any that changed (or were deleted) since I was last told.
 */
/** What the watching routes answer: the list, or the one watch just made. */
interface WatchesAnswer {
  watches?: Watch[];
  watch?: Watch;
}

export default function WatchingPanel() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const uid = useAuthStore(s => s.user?.uid || '');
  const openRecord = useUIStore(s => s.openRecord);
  const workspaceId = workspace?.id || '';
  const [list, setList] = useState<{ key: string; watches?: Watch[]; error?: string } | null>(null);
  const [version, setVersion] = useState(0);
  const [type, setType] = useState<RecordType | ''>('');
  const [id, setId] = useState('');
  const choices = useRecordChoices(type, workspace?.currency || 'USD');
  const listKey = JSON.stringify([workspaceId, uid, version]);
  const watches = list?.key === listKey ? list.watches : undefined;
  const loadError = list?.key === listKey ? list.error : undefined;

  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    call(workspaceId, '').then(data => {
      if (!Array.isArray(data?.watches)) throw new Error('The server returned an invalid watch list.');
      if (live) setList({ key: listKey, watches: data.watches });
    }).catch(err => { if (live) setList({ key: listKey, error: commandErrorMessage(err, uiLanguageNow()) }); });
    return () => { live = false; };
  }, [workspaceId, listKey]);

  if (!workspace) return null;
  const watch = async () => {
    if (!watches || !type || !id) return;
    const label = choices.find(c => c.id === id)?.label || id;
    try {
      const data = await call(workspaceId, '', 'POST', { record: { type, id, label } });
      const created = data.watch;
      if (!created) throw new Error('The watch was saved but the server did not send it back. Reload to see it.');
      if (useAuthStore.getState().currentWorkspaceId !== workspaceId || useAuthStore.getState().user?.uid !== uid) return;
      setList(previous => previous?.key === listKey ? { key: listKey, watches: [created, ...(previous.watches || []).filter(w => w.id !== created.id)] } : previous);
      setType(''); setId('');
      toast.success(`Watching ${label}: you are told once a day when it changes`);
    } catch (err) { toast.error(commandErrorMessage(err, uiLanguageNow())); }
  };
  const stop = async (w: Watch) => {
    try {
      await call(workspaceId, `/${encodeURIComponent(w.id)}`, 'DELETE');
      if (useAuthStore.getState().currentWorkspaceId !== workspaceId || useAuthStore.getState().user?.uid !== uid) return;
      setList(previous => previous?.key === listKey ? { key: listKey, watches: (previous.watches || []).filter(x => x.id !== w.id) } : previous);
    } catch (err) { toast.error(commandErrorMessage(err, uiLanguageNow())); }
  };

  return (
    <details className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-[var(--text)]">Records I watch ({watches ? watches.length : '…'})</summary>
      <p className="mt-2 text-xs text-[var(--muted)]">Once a day you are told about any of these that changed, or was deleted, since you were last told.</p>
      {loadError && <div role="alert" className="mt-2 text-xs text-[var(--neg)]">Could not load watched records: {loadError} <button type="button" className="min-h-11 underline" onClick={() => setVersion(v => v + 1)}>Retry loading watched records</button></div>}
      <ul className="mt-2 divide-y divide-[var(--line)]">
        {watches && watches.length === 0 && <li className="py-2 text-[var(--muted)]">You are not watching anything.</li>}
        {(watches || []).map(w => (
          <li key={w.id} className="py-2 flex items-center justify-between gap-2">
            <button type="button" onClick={() => openRecord({ type: w.record.type, id: w.record.id })} className="text-indigo-600 dark:text-indigo-400 hover:underline"><bdi>{w.record.label}</bdi></button>
            <button type="button" onClick={() => void stop(w)} className="text-xs text-rose-600 hover:underline">Stop watching<span className="sr-only"> {w.record.label}</span></button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[var(--muted)]">Watch
          <select value={type} onChange={e => { setType(e.target.value as RecordType | ''); setId(''); }} className={field}>
            <option value="">Choose a kind…</option>
            {TASK_RECORD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        {type && (
          <label className="flex flex-col gap-1 text-[var(--muted)] flex-1 min-w-60">Which one
            <select value={id} onChange={e => setId(e.target.value)} className={field}>
              <option value="">Choose…</option>
              {choices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        )}
        <button type="button" disabled={!type || !id || !watches} onClick={() => void watch()} className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold text-[var(--text)] disabled:opacity-50">Watch it</button>
      </div>
    </details>
  );
}
