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
 * is counted, not silently included; members, API keys, bank connections and the audit trail are not in
 * the server backup and so are not here either.
 */
import { useEffect, useRef, useState } from 'react';
import { Archive, Download, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { getLocalDateISO } from '../../../lib/utils';
import { BRAND } from '../../../config/brand';
import { verifiedBackupCollections, makeStoredZip } from '../../../lib/workspaceArchive';
import type { ZipEntry } from '../../../lib/workspaceArchive';
import { buildYearArchiveCsvEntries, pdfRetryDelayMs, planYearArchive, withPdfOutcome, type YearArchivePlan } from '../../../lib/yearEndArchive';

/** Waits, or returns false at once when the work is cancelled. */
const pause = (ms: number, signal: AbortSignal) => new Promise<boolean>(resolve => {
  if (signal.aborted) { resolve(false); return; }
  const done = () => { clearTimeout(timer); resolve(false); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', done); resolve(true); }, ms);
  signal.addEventListener('abort', done, { once: true });
});

/**
 * The invoice PDF, from the route the invoice screen itself uses (src/services/documentDownloads.ts).
 * The server makes only a few PDFs a minute; "too many requests" means wait and ask again, not "no PDF".
 */
async function fetchInvoicePdf(workspaceId: string, documentId: string, getToken: () => Promise<string>, signal: AbortSignal, onWait: () => void): Promise<Blob | null> {
  const query = new URLSearchParams({ workspaceId });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // a fresh sign-in token for every request: a long archive can outlive the one it started with
    const token = await getToken();
    const response = await fetch(
      `/api/v1/documents/invoice/${encodeURIComponent(documentId)}/pdf?${query.toString()}`,
      { headers: { Authorization: `Bearer ${token}` }, signal },
    );
    if (response.ok) return response.blob();
    if (response.status !== 429) return null;
    onWait();
    if (!(await pause(pdfRetryDelayMs(response.headers), signal))) return null;
  }
  return null;
}

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
  const [progress, setProgress] = useState('');
  const [plan, setPlan] = useState<YearArchivePlan | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const allowed = !isGuest && role === 'owner' && Boolean(uid && workspaceId);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  /** Reads the verified backup and posts the plan, so the owner sees the file list before downloading. */
  const preview = async () => {
    if (pending.current || !allowed) return;
    const auth = useAuthStore.getState();
    const selectedId = auth.currentWorkspaceId;
    const user = auth.user;
    if (!selectedId || !user) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/v1/workspaces/${encodeURIComponent(selectedId)}/export`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      if (!response.ok) throw new Error('The server backup could not be read, so nothing was planned. No partial archive was made.');
      const collections = await verifiedBackupCollections(await response.json(), selectedId);
      setPlan(planYearArchive(collections, { year }));
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not plan the archive.');
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const download = async () => {
    if (pending.current || !allowed || !plan) return;
    const auth = useAuthStore.getState();
    const selectedId = auth.currentWorkspaceId;
    const user = auth.user;
    if (!selectedId || !user) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/v1/workspaces/${encodeURIComponent(selectedId)}/export`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      if (!response.ok) throw new Error('The server backup could not be read. No incomplete archive was downloaded.');
      const collections = await verifiedBackupCollections(await response.json(), selectedId);
      const current = planYearArchive(collections, { year });
      let entries: ZipEntry[] = buildYearArchiveCsvEntries(collections, current);

      // the invoices of the year, as the same PDF the invoice screen prints
      let pdfs = 0;
      const failed: string[] = [];
      const pdfTotal = current.files.filter(file => file.kind === 'pdf' && file.documentId).length;
      for (const file of current.files) {
        if (file.kind !== 'pdf' || !file.documentId) continue;
        if (controller.signal.aborted) return;
        const at = `Invoice PDF ${pdfs + failed.length + 1} of ${pdfTotal}`;
        setProgress(`${at}…`);
        const blob = await fetchInvoicePdf(selectedId, file.documentId, () => user.getIdToken(), controller.signal,
          () => setProgress(`${at}: the server makes about 10 PDFs a minute, waiting to continue…`));
        if (!blob) { failed.push(file.documentNumber || file.documentId); continue; }
        // raw bytes: a PDF is binary and must not go through the text encoder
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (controller.signal.aborted) return;
        entries.push({ path: file.path, bytes });
        pdfs += 1;
      }
      // the workspace changed or the screen closed while the files were read: download nothing
      if (controller.signal.aborted) return;
      entries = withPdfOutcome(entries, current, pdfs, failed);

      const blob = makeStoredZip(entries);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${BRAND.fileSlug}-${year}-archive-${selectedId.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(`Archived ${year}: ${entries.length - 1 - pdfs} CSV file(s) and ${pdfs} invoice PDF(s).${failed.length ? ` ${failed.length} invoice PDF(s) could not be made and are listed in manifest.json.` : ''}`);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not build the archive.');
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) { setBusy(false); setProgress(''); }
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
            onChange={event => { setYear(Number(event.target.value)); setPlan(null); }}
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
      {progress && <p role="status" className="mb-3 text-xs text-[var(--muted)]">{progress}</p>}

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
