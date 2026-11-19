import React, { useEffect, useId, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { type Attachment, MAX_ATTACHMENT_BYTES, formatBytes, mayRemoveAttachment } from '../../lib/attachments';
import { ITEM_IMAGE_MIME_TYPES, itemImageProblem, itemImages, latestItemImage } from '../../lib/itemImages';
import { attachFiles, attachSummary, loadAttachments, removeAttachment } from '../../services/attachmentActions';
import { safeConfirm } from '../../lib/utils';
import { safeEmbeddedDocumentUrl } from '../../lib/documentUrl';

/** One optional, non-financial reference image for a saved inventory item. */
export default function ItemImagePanel({
  itemId, itemName, workspaceId, onChange,
}: {
  itemId: string;
  itemName: string;
  workspaceId: string;
  onChange?: () => void;
}) {
  const currentWorkspaceId = useAuthStore(state => state.currentWorkspaceId) || '';
  const isGuest = useAuthStore(state => state.isGuest);
  const uid = useAuthStore(state => state.user?.uid);
  const role = useCurrentRole();
  const canWrite = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const inputId = useId();
  const [loaded, setLoaded] = useState<{ key: string; image?: Attachment; error?: string } | null>(null);
  const [actionError, setActionError] = useState<{ key: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const target = { collection: 'inventory' as const, id: itemId, label: `Item ${itemName}` };
  const isCurrentWorkspace = !isGuest && Boolean(workspaceId) && currentWorkspaceId === workspaceId;
  const loadKey = `${workspaceId}:${itemId}`;
  const loading = isCurrentWorkspace && loaded?.key !== loadKey;
  const image = loaded?.key === loadKey ? loaded.image : undefined;
  const loadError = loaded?.key === loadKey ? loaded.error || '' : '';
  const error = actionError?.key === loadKey ? actionError.message : loadError;
  const reportError = (message: string) => setActionError({ key: loadKey, message });

  useEffect(() => {
    if (!workspaceId || !itemId || !isCurrentWorkspace) return;
    let active = true;
    void loadAttachments(workspaceId, { collection: 'inventory', id: itemId }).then(files => {
      if (active) setLoaded({ key: loadKey, image: latestItemImage(files) });
    }).catch(cause => {
      if (active) setLoaded({ key: loadKey, error: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => { active = false; };
  }, [workspaceId, itemId, isCurrentWorkspace, loadKey]);

  const upload = async (file?: File) => {
    if (!file || busy) return;
    if (!isCurrentWorkspace) { reportError('The selected item is from a different workspace. Reopen it before changing its image.'); return; }
    if (!canWrite || !uid) { reportError('An owner, accountant, or bookkeeper can change item images.'); return; }
    const problem = itemImageProblem(file);
    if (problem) { reportError(problem); return; }

    setBusy(true);
    setActionError(null);
    try {
      const existingImages = itemImages(await loadAttachments(workspaceId, { collection: 'inventory', id: itemId }));
      const result = await attachFiles(workspaceId, uid, target, [file]);
      if (result.saved.length !== 1 || result.refused.length) {
        reportError(attachSummary(result).message || 'The image was not saved.');
        return;
      }
      const next = result.saved[0];
      // The new image is durably saved before the previous one is removed. A failed replacement
      // never leaves the item without its prior image.
      const cleanup = await Promise.allSettled(existingImages.map(oldImage => removeAttachment(workspaceId, oldImage.id)));
      const failedCleanupCount = cleanup.filter(r => r.status === 'rejected').length;
      const replacementWarning = failedCleanupCount
        ? `The new image was saved, but ${failedCleanupCount} older image attachment${failedCleanupCount === 1 ? '' : 's'} could not be removed. The new image is shown; try replacing again or ask a workspace owner to remove them.`
        : '';
      if (useAuthStore.getState().currentWorkspaceId === workspaceId) {
        setLoaded({ key: loadKey, image: next });
        if (replacementWarning) reportError(replacementWarning);
        onChange?.();
        if (replacementWarning) toast.warning('Item image saved; previous image remains attached');
        else toast.success('Item image saved');
      }
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : 'The image could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!image || busy || !isCurrentWorkspace || !mayRemoveAttachment(role, uid, image)) return;
    if (!safeConfirm(`Remove the image from ${itemName}?`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await removeAttachment(workspaceId, image.id);
      setLoaded({ key: loadKey });
      onChange?.();
      toast.success('Item image removed');
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : 'The image could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={`Image of ${itemName}`} className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text)]">Item image</h3>
        <p className="text-xs text-[var(--muted)]">Optional visual reference shown on the inventory list. It does not appear on invoices and never changes stock, price, or tax. JPEG, PNG, or WebP, up to {formatBytes(MAX_ATTACHMENT_BYTES)}.</p>
      </div>
      {isGuest && <p className="text-sm text-[var(--muted)]">Item images are available for saved items in a signed-in workspace.</p>}
      {!isGuest && !isCurrentWorkspace && <p role="alert" className="text-sm text-rose-700">This item belongs to a different workspace. Reopen it from the current workspace to manage its image.</p>}
      {loading ? <p className="text-sm text-[var(--muted)]">Loading item image…</p> : image ? (
        <div className="flex flex-wrap items-center gap-3">
          {safeEmbeddedDocumentUrl(image.fileUrl)
            ? <img src={safeEmbeddedDocumentUrl(image.fileUrl) as string} alt={itemName} className="h-24 w-24 rounded-lg border border-[var(--line)] bg-[var(--panel)] object-contain" />
            : <p role="alert" className="text-xs text-rose-700">This image has an address that is not a stored image or an https link, so it is not shown. Remove it and attach it again.</p>}
          <div className="flex flex-col gap-2">
            <span className="max-w-60 truncate text-xs text-[var(--muted)]" title={image.name}><bdi>{image.name}</bdi></span>
            {canWrite && isCurrentWorkspace && (
              <label htmlFor={inputId} className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-[var(--line)] px-3 text-sm hover:bg-[var(--panel)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2">
                {busy ? 'Saving…' : 'Choose a replacement image'}
              </label>
            )}
            {mayRemoveAttachment(role, uid, image) && isCurrentWorkspace && (
              <button type="button" disabled={busy} onClick={() => void remove()} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--line)] px-3 text-sm hover:bg-[var(--panel)] disabled:opacity-50">
                <Trash2 aria-hidden="true" size={15} /> Remove image
              </button>
            )}
          </div>
        </div>
      ) : canWrite && isCurrentWorkspace ? (
        <label htmlFor={inputId} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-[var(--line)] px-3 text-sm hover:bg-[var(--panel)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2">
          <ImagePlus aria-hidden="true" size={16} /> {busy ? 'Saving image…' : 'Add item image'}
        </label>
      ) : null}
      {!isGuest && isCurrentWorkspace && !canWrite && !image && <p className="text-sm text-[var(--muted)]">Ask an owner, accountant, or bookkeeper to add an item image.</p>}
      {canWrite && isCurrentWorkspace && (
        <input id={inputId} type="file" accept={ITEM_IMAGE_MIME_TYPES.join(',')} className="sr-only" aria-label={`Choose image for ${itemName}`} disabled={busy}
          onChange={event => { void upload(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
      )}
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    </section>
  );
}

/** Loads image bytes only when an inventory row approaches the viewport. */
export function ItemImageThumb({ itemId, itemName, workspaceId, refreshKey = 0 }: {
  itemId: string;
  itemName: string;
  workspaceId: string;
  refreshKey?: number;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const currentWorkspaceId = useAuthStore(state => state.currentWorkspaceId) || '';
  const isGuest = useAuthStore(state => state.isGuest);
  const [loaded, setLoaded] = useState<{ key: string; image?: Attachment } | null>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const loadKey = `${workspaceId}:${itemId}:${refreshKey}`;
  const image = loaded?.key === loadKey ? loaded.image : undefined;

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '120px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || isGuest || !workspaceId || workspaceId !== currentWorkspaceId || !itemId) return;
    let active = true;
    void loadAttachments(workspaceId, { collection: 'inventory', id: itemId }).then(files => {
      if (active) setLoaded({ key: loadKey, image: latestItemImage(files) });
    }).catch(() => {
      if (active) setLoaded({ key: loadKey });
    });
    return () => { active = false; };
  }, [visible, workspaceId, itemId, refreshKey, loadKey, isGuest, currentWorkspaceId]);

  return (
    <span ref={ref} className="inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--line)] bg-[var(--panel)] align-middle">
      {image && safeEmbeddedDocumentUrl(image.fileUrl)
        ? <img src={safeEmbeddedDocumentUrl(image.fileUrl) as string} alt={itemName} loading="lazy" className="h-full w-full object-cover" />
        : <ImagePlus aria-hidden="true" size={16} className="text-[var(--muted)]" />}
    </span>
  );
}
