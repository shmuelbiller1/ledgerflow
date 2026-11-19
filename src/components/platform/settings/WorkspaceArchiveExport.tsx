/**
 * E-21: read-only server-backed archive button on Settings → Backup & Export.
 * No browser-cache fallback: a ZIP cannot be described as complete when the
 * workspace's older rows may not be loaded.
 */
import { useState } from 'react';
import { Archive, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { getLocalDateISO } from '../../../lib/utils';
import { buildWorkspaceArchive } from '../../../lib/workspaceArchive';
import { recordBackupCompleted } from '../../../lib/ledgerBackupHealth';
import { BRAND } from '../../../config/brand';
import { readVerifiedBackup, saveBlob, useServerExport } from '../../../hooks/useServerExport';

export default function WorkspaceArchiveExport() {
  const scope = useAuthStore(s => String(s.user?.uid || 'guest') + ':' + String(s.currentWorkspaceId || 'none'));
  return <WorkspaceArchiveExportBody key={scope} />;
}

function WorkspaceArchiveExportBody() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const uid = useAuthStore(s => s.user?.uid);
  const isGuest = useAuthStore(s => s.isGuest && !s.user);
  const role = useCurrentRole();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reminderFailed, setReminderFailed] = useState(false);
  const allowed = !isGuest && role === 'owner' && Boolean(uid && workspaceId);
  const failure = 'The server export failed. No incomplete archive was downloaded.';

  const { start } = useServerExport({
    allowed, setBusy, setError, failure,
    run: async ({ workspaceId: selectedId, signal, stillHere }) => {
      setReminderFailed(false);
      const source = await readVerifiedBackup(selectedId, signal, failure);
      if (!stillHere()) return;
      const archive = await buildWorkspaceArchive(source, selectedId);
      if (!stillHere()) return;
      saveBlob(archive.blob, `${BRAND.fileSlug}-archive-` + selectedId.replace(/[^a-zA-Z0-9_-]/g, '_') + '-' + getLocalDateISO() + '.zip');
      // The download has already started. A storage error only affects the local reminder.
      try {
        recordBackupCompleted(selectedId);
      } catch {
        setReminderFailed(true);
        return;
      }
      toast.success('Workspace ZIP download started. Keep the file somewhere secure.');
    },
  });
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
      <div className="mb-4 flex items-center gap-3">
        <Archive aria-hidden="true" className="text-indigo-500" size={24} />
        <h3 className="font-bold text-[var(--text)]">Workspace archive (ZIP)</h3>
      </div>
      <p className="mb-3 text-sm text-[var(--muted)]">
        One ZIP with the verified server backup, a manifest, and JSON and CSV copies of every collection
        in that backup, including empty collections. CSV keeps nested values in a Record JSON column.
      </p>
      <p className="mb-5 text-xs text-[var(--muted)]">
        The archive lists attached files (names and sizes), not their contents.
        Members, API keys, bank connections and the audit trail are not included. Restore it
        with Restore Workspace below. The ZIP contains sensitive financial and payroll records. Store it securely.
        Only a signed-in workspace owner can start this download; no demo or browser-cache fallback.
      </p>
      {error && <p role="alert" className="mb-3 text-xs text-[var(--neg)]">{error}</p>}
      {reminderFailed && <p role="status" className="mb-3 text-sm text-[var(--muted)]">
        The ZIP download started, but the reminder could not be updated. Check that you saved the file.
      </p>}
      <button type="button" onClick={() => void start()} disabled={!allowed || busy}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-600 disabled:opacity-40">
        <Download size={16} aria-hidden="true" />
        {busy ? 'Preparing verified archive…' : 'Download workspace ZIP archive'}
      </button>
      {!allowed && <p className="mt-2 text-xs text-[var(--muted)]">Workspace owner sign-in required.</p>}
    </div>
  );
}
