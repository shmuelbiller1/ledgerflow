import React, { useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { db } from '../../firebase';
import { doc, updateDoc } from '../../lib/db/firestore';
import { REPORT_NOTE_MAX, reportNoteKey, withReportNote } from '../../lib/reportNotes';

/**
 * R-4: the note for this report and period, above the report and in its print / PDF. Owners, accountants and
 * bookkeepers write it; everyone who can see the report reads it.
 */
export default function ReportNote({ report, startDate, endDate }: { report: string; startDate: string; endDate: string }) {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaces = useAuthStore(s => s.workspaces);
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const role = useCurrentRole();
  const canWrite = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const key = reportNoteKey(report, startDate, endDate);
  const saved = workspace?.reportNotes?.[key] || '';
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!workspace?.id) return;
    const next = withReportNote(workspace.reportNotes, key, text);
    if ('problem' in next) { toast.error(next.problem); return; }
    setBusy(true);
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), { reportNotes: next.notes, updatedAt: new Date().toISOString() });
      setWorkspaces(workspaces.map(w => (w.id === workspace.id ? { ...w, reportNotes: next.notes } : w)));
      setEditing(false);
      toast.success(text.trim() ? 'Note saved' : 'Note removed');
    } catch {
      toast.error('Could not save the note');
    } finally {
      setBusy(false);
    }
  };

  if (!saved && !canWrite) return null;
  return (
    <section aria-label="Report note" data-testid="report-note" className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm">
      {editing ? (
        <div className="space-y-2" data-print-hide>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--muted)]">Note for this report and period</span>
            <textarea value={text} maxLength={REPORT_NOTE_MAX} onChange={e => setText(e.target.value)} rows={2} className="w-full rounded border border-[var(--line)] bg-[var(--panel)] p-2 text-[var(--text)]" placeholder="e.g. Rent was paid late this month" />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void save()} className="min-h-11 px-3 rounded bg-indigo-600 text-white font-semibold disabled:opacity-50">Save note</button>
            <button type="button" disabled={busy} onClick={() => { setText(saved); setEditing(false); }} className="min-h-11 px-3 rounded border border-[var(--line)]">Cancel</button>
          </div>
        </div>
      ) : saved ? (
        <div className="flex flex-wrap items-start gap-2">
          <p className="flex-1 whitespace-pre-wrap"><span className="font-semibold">Note: </span><bdi>{saved}</bdi></p>
          {canWrite && <button type="button" data-print-hide onClick={() => { setText(saved); setEditing(true); }} className="min-h-11 px-2 text-xs underline">Edit note</button>}
        </div>
      ) : (
        <button type="button" data-print-hide onClick={() => { setText(''); setEditing(true); }} className="min-h-11 text-xs underline text-[var(--muted)]">Add a note for this period</button>
      )}
    </section>
  );
}
