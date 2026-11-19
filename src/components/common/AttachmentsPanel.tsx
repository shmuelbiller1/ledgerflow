import { useDialog } from '../../hooks/useDialog';
import React, { useEffect, useId, useRef, useState } from 'react';
import { Download, Eye, Paperclip, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { type Attachment, type AttachmentTarget, MAX_ATTACHMENT_BYTES, attachmentPreviewKind, formatBytes, mayRemoveAttachment } from '../../lib/attachments';
import { attachFiles, attachSummary, loadAttachments, removeAttachment } from '../../services/attachmentActions';
import { safeConfirm } from '../../lib/utils';
import { safeDownloadDocumentUrl, safeEmbeddedDocumentUrl } from '../../lib/documentUrl';


interface AttachmentsPanelProps {
  target: AttachmentTarget;
  className?: string;
  /** The record's own workspace when it isn't the current one (for example, a support ticket). */
  workspaceId?: string;
}

/**
 * The files kept with a record (K-07): the list (name, size, when), open/download, remove (the
 * person who added it, or owners, accountants and bookkeepers), and "Attach files" for anyone who
 * can write. Files can be dropped or selected; PDFs and common raster images preview in a sandboxed
 * dialog. Each file is saved on its own and only reported as attached once the database has it.
 */
export default function AttachmentsPanel({ target, className = '', workspaceId: forWorkspace }: AttachmentsPanelProps) {
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const workspaceId = forWorkspace || currentWorkspaceId;
  const uid = useAuthStore(s => s.user?.uid);
  const role = useCurrentRole();
  const scopeKey = JSON.stringify([workspaceId, uid || '', role || '', target.collection, target.id, target.scope || '']);

  // Remount all record-specific state on a user, workspace or target change. A late request then
  // belongs to an unmounted panel and cannot paint the next record's files or preview.
  return <AttachmentsPanelContent key={scopeKey} target={target} className={className} workspaceId={workspaceId} uid={uid} role={role} />;
}

function AttachmentsPanelContent({ target, className = '', workspaceId, uid, role }: AttachmentsPanelProps & {
  workspaceId: string;
  uid?: string;
  role?: string;
}) {
  const canAttach = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const inputId = useId();
  const [files, setFiles] = useState<Attachment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(() => new Set());
  const busyRef = useRef(false);
  const removingRef = useRef(new Set<string>());
  const mounted = useRef(true);
  const requestId = useRef(0);

  useEffect(() => () => { mounted.current = false; }, []);

  const { collection: targetCollection, id: targetId, scope: targetScope } = target;
  useEffect(() => {
    let live = true;
    const thisRequest = ++requestId.current;
    if (workspaceId && targetId) {
      void loadAttachments(workspaceId, { collection: targetCollection, id: targetId, scope: targetScope })
        .then(loaded => { if (live && thisRequest === requestId.current) setFiles(loaded); })
        .catch(err => {
          if (!live || thisRequest !== requestId.current) return;
          setLoadError(err instanceof Error ? err.message : String(err));
          // Keep the list unknown; a failed read is not the same as "no files".
          setFiles(null);
        });
    }
    return () => { live = false; };
  }, [workspaceId, targetCollection, targetId, targetScope]);

  const refresh = async () => {
    if (!workspaceId || !targetId) return;
    const thisRequest = ++requestId.current;
    setFiles(null);
    setLoadError('');
    try {
      const loaded = await loadAttachments(workspaceId, { collection: targetCollection, id: targetId, scope: targetScope });
      if (mounted.current && thisRequest === requestId.current) setFiles(loaded);
    } catch (err) {
      if (!mounted.current || thisRequest !== requestId.current) return;
      setLoadError(err instanceof Error ? err.message : String(err));
      setFiles(null);
    }
  };

  const add = async (picked: ArrayLike<File> | null) => {
    const selected = picked ? Array.from(picked) : [];
    if (!selected.length || !uid || !workspaceId || !targetId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await attachFiles(workspaceId, uid, target, selected, () => mounted.current);
      if (!mounted.current) return;
      const { ok, message } = attachSummary(result);
      if (ok) toast.success(message); else toast.error(message);
      if (result.saved.length) setFiles(prev => [...result.saved, ...(prev || [])]);
    } catch (err) {
      if (mounted.current) toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const remove = async (file: Attachment) => {
    if (removingRef.current.has(file.id) || !safeConfirm(`Remove ${file.name} from ${target.label}?`)) return;
    removingRef.current.add(file.id);
    setRemovingIds(new Set(removingRef.current));
    try {
      await removeAttachment(workspaceId, file.id);
      if (!mounted.current) return;
      setFiles(prev => (prev || []).filter(f => f.id !== file.id));
      toast.success(`${file.name} removed`);
    } catch (err) {
      if (mounted.current) toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      removingRef.current.delete(file.id);
      if (mounted.current) setRemovingIds(new Set(removingRef.current));
    }
  };

  const onDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (canAttach && !busy) void add(event.dataTransfer.files);
  };

  const { dialogProps, titleId } = useDialog(() => setPreview(null), Boolean(preview));
  // #915: `previewKind` already refuses anything but a stored PDF/image address; the source is
  // narrowed again here so the dialog can never be handed an unchecked address.
  const previewSrc = preview ? safeEmbeddedDocumentUrl(preview.fileUrl) : null;
  const previewKind = preview ? attachmentPreviewKind(preview) : null;

  return (
    <>
      <section aria-label={`Files of ${target.label}`} className={`space-y-2 ${className}`}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1.5">
            <Paperclip className="w-3.5 h-3.5" aria-hidden="true" /> Files{files && files.length > 0 ? ` (${files.length})` : ''}
          </h3>
          {canAttach && (
            <label htmlFor={inputId} className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
              {busy ? 'Attaching…' : 'Choose files'}
              <input id={inputId} type="file" multiple className="sr-only" aria-label={`Attach files to ${target.label}`}
                onChange={e => { void add(e.target.files); e.target.value = ''; }} />
            </label>
          )}
        </div>
        {canAttach && (
          <div
            role="group"
            data-testid="attachment-dropzone"
            onDragOver={event => { event.preventDefault(); if (!busy) setDragActive(true); }}
            onDragEnter={event => { event.preventDefault(); if (!busy) setDragActive(true); }}
            onDragLeave={event => {
              const related = event.relatedTarget;
              if (related instanceof Node && event.currentTarget.contains(related)) return;
              setDragActive(false);
            }}
            onDrop={onDrop}
            className={`rounded-lg border-2 border-dashed px-3 py-2 text-xs ${dragActive ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30' : 'border-[var(--line)] text-[var(--muted)]'} ${busy ? 'opacity-60' : ''}`}
            aria-label={`Drop files to attach to ${target.label}`}
            aria-busy={busy}
          >
            {dragActive ? `Drop files to attach to ${target.label}` : `Drop files here, or choose files. PDFs, JPEG, PNG and WebP can be previewed. Up to ${formatBytes(MAX_ATTACHMENT_BYTES)} each.`}
          </div>
        )}
        {loadError && <p role="alert" className="text-xs text-rose-600">The files could not be loaded: {loadError} <button type="button" className="underline min-h-11 px-2" onClick={() => void refresh()}>Try again</button></p>}
        {files === null ? (
          <p className="text-xs text-[var(--muted)]">{loadError ? 'The file list is unavailable.' : workspaceId ? 'Loading files…' : 'Files are unavailable without a workspace.'}</p>
        ) : files.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">
            No files yet.{canAttach ? ` Attach a contract, a PDF or a photo (up to ${formatBytes(MAX_ATTACHMENT_BYTES)} each).` : ''}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line)] text-xs">
            {files.map(file => {
              const downloadable = safeDownloadDocumentUrl(file.fileUrl);
              const canPreview = Boolean(attachmentPreviewKind(file));
              const isRemoving = removingIds.has(file.id);
              return (
                <li key={file.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="flex-1 min-w-0 truncate" title={file.name}><bdi>{file.name}</bdi></span>
                  <span className="text-[var(--muted)] tabular-nums shrink-0">{file.sizeBytes ? formatBytes(file.sizeBytes) : ''} · {String(file.createdAt).slice(0, 10)}</span>
                  {canPreview && <button type="button" onClick={() => setPreview(file)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--muted)] hover:text-indigo-600 focus-visible:outline focus-visible:outline-2" aria-label={`Preview ${file.name}`} title="Preview">
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  </button>}
                  {downloadable ? <a href={downloadable} download={file.name} rel="noreferrer" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--muted)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2" aria-label={`Download ${file.name}`}>
                    <Download className="w-4 h-4" aria-hidden="true" />
                  </a> : <span className="text-[var(--muted)]">File link unavailable</span>}
                  {mayRemoveAttachment(role, uid, file) && (
                    <button type="button" disabled={isRemoving} onClick={() => void remove(file)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--muted)] hover:text-rose-600 disabled:opacity-50 focus-visible:outline focus-visible:outline-2" aria-label={`Remove ${file.name}`}>
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {preview && previewKind && previewSrc && (
        <div {...dialogProps} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 sm:p-6">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-2xl">
            <header className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2">
              <h2 id={titleId} className="min-w-0 truncate text-sm font-semibold text-[var(--text)]"><bdi>{preview.name}</bdi></h2>
              <button type="button" onClick={() => setPreview(null)} aria-label="Close file preview" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--muted)] hover:text-[var(--text)]">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </header>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
              {previewKind === 'image'
                ? <img src={previewSrc} alt={preview.name} className="max-h-[78vh] max-w-full object-contain" />
                : <iframe src={previewSrc} title={`Preview ${preview.name}`} sandbox="" className="h-[78vh] w-full border-0 bg-white" />}
            </div>
            <div className="border-t border-[var(--line)] px-4 py-2 text-xs text-[var(--muted)]">
              Preview only; the original file remains attached to this record.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
