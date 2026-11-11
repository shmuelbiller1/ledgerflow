/**
 * J-8 (Agent #11): Settings → Backup & Export → "Download everything for <year>".
 *
 * A ZIP of that year's CSV exports plus the PDFs of that year's invoices, for a year-end hand-over to
 * an accountant. It is built only from exports that already exist: the checksum-verified server backup
 * (the same source as the workspace archive, never the browser cache), the shared CSV writer, the
 * existing invoice PDF route and the existing stored-ZIP writer. The plan — which files, which rows —
 * is computed by `planYearArchive` in src/lib/yearEndArchive.ts, so the file list can be tested without
 * a browser.
 *
 * Honest limits, said on the screen: the plan is shown before anything downloads; a record with no date
 * is counted, not silently included; failed invoice PDFs are recorded in manifest.json; members, API keys,
 * bank connections and the audit trail are not in the server backup and so are not here either.
 */
import { useEffect, useRef, useState } from 'react';
import { Archive, Download, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { BRAND } from '../../../config/brand';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { getLocalDateISO } from '../../../lib/utils';
import { verifiedBackupCollections, makeStoredZip } from '../../../lib/workspaceArchive';
import type { ZipEntry } from '../../../lib/workspaceArchive';
import {
  buildYearArchiveCsvEntries, fetchInvoicePdf, planYearArchive,
  type YearArchiveFailedPdf, type YearArchivePlan,
} from '../../../lib/yearEndArchive';

const thisYear = () => Number(getLocalDateISO().slice(0, 4));

export default function YearEndArchiveExport() {
  const scope = useAuthStore(s => `${String(s.user?.uid || 'guest')}:${String(s.currentWorkspaceId || 'none')}`);
  return <YearEndArchiveExportBody key={scope} />;
}

function YearEndArchiveExportBody() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const uid = useAuthStore(s => s.user?.uid);
  const isGuest = useAuthStore(s => s.isGuest && !s.user);
  const role = useCurrentRole();
  const [year, setYear] = useState(thisYear);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<YearArchivePlan | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const allowed = !isGuest && role === 'owner' && Boolean(uid && workspaceId);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const stillSameScope = (controller: AbortController, selectedId: string, userUid: string): boolean => {
    if (controller.signal.aborted || abortRef.current !== controller) return false;
    const current = useAuthStore.getState();
    return current.currentWorkspaceId === selectedId && current.user?.uid === userUid;
  };

  /** Reads the verified backup and posts the plan, so the owner sees the file list before downloading. */
  const preview = async () => {
    if (pending.current || !allowed) return;
    const auth = useAuthStore.getState();
    const selectedId = auth.currentWorkspaceId;
    const user = auth.user;
    if (!selectedId || !user) return;
    const requestedYear = year;
    pending.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const token = await user.getIdToken();
      if (!stillSameScope(controller, selectedId, user.uid)) return;
      const response = await fetch(`/api/v1/workspaces/${encodeURIComponent(selectedId)}/export`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      if (!stillSameScope(controller, selectedId, user.uid)) return;
      if (!response.ok) throw new Error('The server backup could not be read, so nothing was planned. No partial archive was made.');
      const payload = await response.json();
      if (!stillSameScope(controller, selectedId, user.uid)) return;
      const collections = await verifiedBackupCollections(payload, selectedId);
      if (!stillSameScope(controller, selectedId, user.uid)) return;
      setPlan(planYearArchive(collections, { year: requestedYear }));
    } catch (failure) {
      if (stillSameScope(controller, selectedId, user.uid)) {
        setError(failure instanceof Error ? failure.message : 'Could not plan the archive.');
      }
    } finally {
      if (abortRef.current === controller) {
        pending.current = false;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  };

  const download = async () => {
    if (pending.current || !allowed || !plan) return;
    const auth = useAuthStore.getState();
    const selectedId = auth.currentWorkspaceId;
    const user = auth.user;
    if (!selectedId || !user) return;
    const requestedYear = year;
    pending.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const token = await user.getIdToken();
      if (!stillSameScope(controller, selectedId, user.uid)) return;
      const response = await fetch(`/api/v1/workspaces/${encodeURIComponent(selectedId)}/export`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      if (!stillSameScope(controller, selectedId, user.uid)) return;
      if (!response.ok) throw new Error('The server backup could not be read. No incomplete archive was downloaded.');
      const payload = await response.json();
      if (!stillSameScope(controller, selectedId, user.uid)) return;
      const collections = await verifiedBackupCollections(payload, selectedId);
      if (!stillSameScope(controller, selectedId, user.uid)) return;
      const current = planYearArchive(collections, { year: requestedYear });

      // Fetch the invoices of the year first so manifest.json truthfully records written and failed PDFs.
      const pdfEntries: ZipEntry[] = [];
      const failedInvoicePdfs: YearArchiveFailedPdf[] = [];
      for (const file of current.files) {
        if (file.kind !== 'pdf' || !file.documentId) continue;
        if (!stillSameScope(controller, selectedId, user.uid)) return;
        const blob = await fetchInvoicePdf(selectedId, file.documentId, token, controller.signal);
        if (!stillSameScope(controller, selectedId, user.uid)) return;
        if (!blob) {
          failedInvoicePdfs.push({
            documentId: file.documentId,
            documentNumber: file.documentNumber || file.documentId,
            path: file.path,
          });
          continue;
        }
        const buffer = await blob.arrayBuffer();
        if (!stillSameScope(controller, selectedId, user.uid)) return;
        // raw bytes: a PDF is binary and must not go through the text encoder
        pdfEntries.push({ path: file.path, bytes: new Uint8Array(buffer) });
      }

      if (!stillSameScope(controller, selectedId, user.uid)) return;
      const csvAndManifestEntries = buildYearArchiveCsvEntries(collections, current, {
        writtenPdfCount: pdfEntries.length,
        failedInvoicePdfs,
      });
      const csvCount = csvAndManifestEntries.length - 1;
      const entries: ZipEntry[] = [...csvAndManifestEntries, ...pdfEntries];

      const blob = makeStoredZip(entries);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${BRAND.fileSlug}-${requestedYear}-archive-${selectedId.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(
        `Archived ${requestedYear}: ${csvCount} CSV file(s) and ${pdfEntries.length} invoice PDF(s).${
          failedInvoicePdfs.length ? ` ${failedInvoicePdfs.length} invoice PDF(s) could not be made and are listed in manifest.json.` : ''
        }`,
      );
    } catch (failure) {
      if (stillSameScope(controller, selectedId, user.uid)) {
        setError(failure instanceof Error ? failure.message : 'Could not build the archive.');
      }
    } finally {
      if (abortRef.current === controller) {
        pending.current = false;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  };

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
      <div className="mb-4 flex items-center gap-3">
        <Archive aria-hidden="true" className="text-teal-600" size={24} />
        <h3 className="font-bold text-[var(--text)]">Everything for a year</h3>
      </div>
      <p className="mb-3 text-sm text-[var(--muted)]">
        One ZIP for a year-end hand-over: that year&rsquo;s transactions, invoices, bills, payments and the other dated
        lists as CSV, plus the PDF of every invoice issued in the year. Built from the verified server backup, not
        from what this browser has loaded.
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="year-archive-year" className="block text-xs font-semibold text-[var(--text)]">Year</label>
          <input id="year-archive-year" type="number" min={1900} max={2200} step={1} value={year}
            onChange={event => {
              abortRef.current?.abort();
              pending.current = false;
              setBusy(false);
              setYear(Number(event.target.value));
              setPlan(null);
            }}
            className="h-11 w-28 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 text-sm text-[var(--text)]" />
        </div>
        <button type="button" onClick={() => void preview()} disabled={!allowed || busy}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--text)] disabled:opacity-40">
          <FileSpreadsheet size={16} aria-hidden="true" /> Show what will be in it
        </button>
        <button type="button" onClick={() => void download()} disabled={!allowed || busy || !plan}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-40">
          <Download size={16} aria-hidden="true" /> {busy ? 'Preparing…' : `Download everything for ${year}`}
        </button>
      </div>

      {error && <p role="alert" className="mb-3 text-xs text-[var(--neg)]">{error}</p>}

      {plan && (
        <div className="space-y-2" aria-live="polite">
          <h4 className="text-xs font-bold text-[var(--text)]">{plan.files.length} file{plan.files.length === 1 ? '' : 's'} planned for {plan.year}</h4>
          <ul className="max-h-56 space-y-0.5 overflow-auto text-xs text-[var(--muted)]">
            {plan.files.map(file => (
              <li key={file.path} className="font-mono">
                {file.path}
                {file.kind === 'csv' && typeof file.rows === 'number' && <> · {file.rows} row{file.rows === 1 ? '' : 's'}</>}
                {file.kind === 'pdf' && <> · invoice PDF</>}
              </li>
            ))}
          </ul>
          {Object.keys(plan.manifest.undatedRecords as Record<string, number>).length > 0 && (
            <p className="text-xs text-[var(--neg)]">
              Some records carry no usable date and are left out of the year files:{' '}
              {Object.entries(plan.manifest.undatedRecords as Record<string, number>).map(([key, count]) => `${count} ${key}`).join(', ')}.
              They are in the full workspace archive.
            </p>
          )}
          <p className="text-xs text-[var(--muted)]">
            Customers, vendors, items and accounts are written whole (they have no document date). Members, API keys,
            bank connections and the audit trail are not in the server backup and so are not here.
          </p>
        </div>
      )}

      {!allowed && <p className="mt-2 text-xs text-[var(--muted)]">Workspace owner sign-in required.</p>}
    </div>
  );
}
