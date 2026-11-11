/**
 * E-21: read-only server-backed archive button on Settings → Backup & Export.
 * No browser-cache fallback: a ZIP cannot be described as complete when the
 * workspace's older rows may not be loaded.
 */
import { useEffect, useRef, useState } from 'react';
import { Archive, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { getLocalDateISO } from '../../../lib/utils';
import { buildWorkspaceArchive } from '../../../lib/workspaceArchive';
import { recordBackupCompleted } from '../../../lib/ledgerBackupHealth';
import { BRAND } from '../../../config/brand';

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
  const abortRef = useRef<AbortController | null>(null);
  const pending = useRef(false);

  // The outer keyed component remounts when the user or workspace changes.
  // Cleanup cancels in-flight reads; no stale archive can download afterwards.
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const download = async () => {
    if (pending.current) return;
    const auth = useAuthStore.getState();
    const selectedId = auth.currentWorkspaceId;
    const user = auth.user;
    if (role !== 'owner' || isGuest || !selectedId || !user) {
      setError('Only a signed-in workspace owner may download the verified archive.');
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abortRef.current = controller;
    const scopeValid = () => !controller.signal.aborted
      && useAuthStore.getState().currentWorkspaceId === selectedId
      && useAuthStore.getState().user?.uid === user.uid;
    try {
      const token = await user.getIdToken();
      if (!scopeValid()) return;
      const response = await fetch('/api/v1/workspaces/' + encodeURIComponent(selectedId) + '/export', {
        headers: { Authorization: 'Bearer ' + token },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('The server export failed. No incomplete archive was downloaded.');
      const source: unknown = await response.json();
      if (!scopeValid()) return;
      const archive = await buildWorkspaceArchive(source, selectedId);
      if (!scopeValid()) return;
      const url = URL.createObjectURL(archive.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${BRAND.fileSlug}-archive-` + selectedId.replace(/[^a-zA-Z0-9_-]/g, '_') + '-' + getLocalDateISO() + '.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      recordBackupCompleted(selectedId);
      toast.success('Archived ' + archive.collections.length + ' server-backup collections as JSON and CSV.');
    } catch (err) {
      if (scopeValid()) {
        setError(err instanceof Error ? err.message : 'Could not create the archive.');
      }
    } finally {
      pending.current = false;
      if (scopeValid()) setBusy(false);
    }
  };

  const allowed = !isGuest && role === 'owner' && Boolean(uid && workspaceId);
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
        It holds every record and the settings, and lists each attached file (name, size, checksum) without
        the file itself. Members, API keys, bank connections and the audit trail are not included. Restore it
        with Restore Workspace below. The ZIP contains sensitive financial and payroll records. Store it securely.
        Only a signed-in workspace owner can start this download; no demo or browser-cache fallback.
      </p>
      {error && <p role="alert" className="mb-3 text-xs text-[var(--neg)]">{error}</p>}
      <button type="button" onClick={() => void download()} disabled={!allowed || busy}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-600 disabled:opacity-40">
        <Download size={16} aria-hidden="true" />
        {busy ? 'Preparing verified archive…' : 'Download workspace ZIP archive'}
      </button>
      {!allowed && <p className="mt-2 text-xs text-[var(--muted)]">Workspace owner sign-in required.</p>}
    </div>
  );
}
