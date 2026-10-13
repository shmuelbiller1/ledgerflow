import React, { useCallback, useEffect, useId, useState } from 'react';
import { Download, Paperclip, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { type Attachment, type AttachmentTarget, MAX_ATTACHMENT_BYTES, formatBytes, mayRemoveAttachment } from '../../lib/attachments';
import { attachFiles, attachSummary, loadAttachments, removeAttachment } from '../../services/attachmentActions';
import { safeConfirm } from '../../lib/utils';

/**
 * The files kept with a record (K-07): the list (name, size, when), open/download, remove (the
 * person who added it, or owners, accountants and bookkeepers), and "Attach files" for anyone who
 * can write. Each file is saved on its own and only reported as attached once the database has it.
 */
/** `workspaceId`: the record's own workspace when it isn't the current one (a platform admin reading a support ticket). */
export default function AttachmentsPanel({ target, className = '', workspaceId: forWorkspace }: { target: AttachmentTarget; className?: string; workspaceId?: string }) {
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const workspaceId = forWorkspace || currentWorkspaceId;
  const uid = useAuthStore(s => s.user?.uid);
  const role = useCurrentRole();
  const canAttach = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const inputId = useId();
  const [files, setFiles] = useState<Attachment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');

  const { collection: targetCollection, id: targetId, scope: targetScope } = target;
  // loads again only when the record changes, not on every render of the form around it
  const refresh = useCallback(async () => {
    if (!workspaceId || !targetId) return;
    try {
      setFiles(await loadAttachments(workspaceId, { collection: targetCollection, id: targetId, scope: targetScope }));
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setFiles([]);
    }
  }, [workspaceId, targetCollection, targetId, targetScope]);
  useEffect(() => { void refresh(); }, [refresh]);

  const add = async (list: FileList | null) => {
    if (!list || !list.length || !uid) return;
    setBusy(true);
    try {
      const result = await attachFiles(workspaceId, uid, target, Array.from(list));
      const { ok, message } = attachSummary(result);
      if (ok) toast.success(message); else toast.error(message);
      if (result.saved.length) setFiles(prev => [...result.saved, ...(prev || [])]);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (file: Attachment) => {
    if (!safeConfirm(`Remove ${file.name} from ${target.label}?`)) return;
    try {
      await removeAttachment(workspaceId, file.id);
      setFiles(prev => (prev || []).filter(f => f.id !== file.id));
      toast.success(`${file.name} removed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section aria-label={`Files of ${target.label}`} className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1.5">
          <Paperclip className="w-3.5 h-3.5" aria-hidden="true" /> Files{files && files.length > 0 ? ` (${files.length})` : ''}
        </h3>
        {canAttach && (
          <label htmlFor={inputId} className={`relative text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            {busy ? 'Attaching…' : 'Attach files'}
            <input id={inputId} type="file" multiple className="sr-only left-0 top-0" aria-label={`Attach files to ${target.label}`}
              onChange={e => { void add(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </div>
      {loadError && <p role="alert" className="text-xs text-rose-600">The files could not be loaded: {loadError}</p>}
      {files === null ? (
        <p className="text-xs text-[var(--muted)]">Loading files…</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">
          No files yet.{canAttach ? ` Attach a contract, a PDF or a photo (up to ${formatBytes(MAX_ATTACHMENT_BYTES)} each).` : ''}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)] text-xs">
          {files.map(file => (
            <li key={file.id} className="flex items-center gap-2 py-1.5">
              <span className="flex-1 min-w-0 truncate" title={file.name}><bdi>{file.name}</bdi></span>
              <span className="text-[var(--muted)] tabular-nums shrink-0">{file.sizeBytes ? formatBytes(file.sizeBytes) : ''} · {String(file.createdAt).slice(0, 10)}</span>
              <a href={file.fileUrl} download={file.name} className="p-1 text-[var(--muted)] hover:text-[var(--text)]" aria-label={`Download ${file.name}`}>
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
              {mayRemoveAttachment(role, uid, file) && (
                <button type="button" onClick={() => void remove(file)} className="p-1 text-[var(--muted)] hover:text-rose-600" aria-label={`Remove ${file.name}`}>
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
