import { runCommand, commandErrorMessage, ServerCommandError } from '../../../lib/runCommand';
import { uiLanguageNow } from '../../../lib/i18n/uiLanguageNow';
import { useState, useRef, useEffect, useLayoutEffect, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { Download, Database, FileSpreadsheet, Archive, AlertCircle, Upload } from 'lucide-react';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { currentIdentity, useAuthStore } from '../../../stores/useAuthStore';
import { useDataNeedsStore } from '../../../stores/useDataNeedsStore';
import { toast } from 'sonner';
import { getLocalDateISO } from '../../../lib/utils';
import { recordBackupCompleted } from '../../../lib/ledgerBackupHealth';
import { isPostable } from '../../../lib/txFilters';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { useDialog } from '../../../hooks/useDialog';
import { saveBlob } from '../../../hooks/useServerExport';
import AsyncButton from '../../ui/AsyncButton';
import WorkspaceExportDialog from './WorkspaceExportDialog';
import WorkspaceArchiveExport from './WorkspaceArchiveExport';
import YearEndArchiveExport from './YearEndArchiveExport';
import IifListExport from './IifListExport';
import { backupChecksum, backupFromWorkspaceArchive, verifiedBackupCollections, type JsonObject } from '../../../lib/workspaceArchive';
import { BRAND } from '../../../config/brand';

interface RestoreFile { name: string; text: string }

const outlineAction = 'min-h-11 hover:bg-[var(--brass-soft)] hover:text-[var(--brass)]';

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function downloadJson(payload: unknown, name: 'backup' | 'partial-export', workspaceId: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  saveBlob(blob, `${BRAND.fileSlug}-${name}-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${getLocalDateISO()}.json`);
}

/** Browser records can be lazy or capped. This is a convenience export, never a restore source. */
async function partialCopy(workspaceId: string) {
  const state = useLedgerStore.getState();
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    workspace: { id: workspaceId },
    transactions: state.transactions,
    accounts: state.accounts,
    projects: state.projects,
    budgets: state.budgets,
    vendors: state.vendors,
    customers: state.customers,
    invoices: state.invoices,
    bills: state.bills,
    inventory: state.inventory,
    assets: state.assets,
    recurringRules: state.recurring,
    employees: state.employees,
    payRuns: state.payRuns,
    taxRates: state.taxRates,
    partners: state.partners,
    reconciliations: state.reconciliations,
    autoRules: state.autoRules,
    metadata: {
      transactionCount: state.transactions.filter(isPostable).length,
      totalCount: state.transactions.length,
      currency: state.baseCurrency || 'USD',
      serverAuthoritative: false,
    },
  };
  return { ...payload, metadata: { ...payload.metadata, checksum: await backupChecksum(payload) } };
}

async function readRestoreFile(file: File, workspaceId: string): Promise<RestoreFile> {
  const archive = /\.zip$/i.test(file.name)
    ? await backupFromWorkspaceArchive(new Uint8Array(await file.arrayBuffer()))
    : null;
  const text = archive ? archive.text : await file.text();
  const payload: unknown = archive ? archive.backup : JSON.parse(text);
  if (!isObject(payload) || !isObject(payload.metadata)) throw new Error('Choose a workspace backup JSON file or ZIP archive.');
  const metadata = payload.metadata;
  if (metadata.serverAuthoritative === false) {
    throw new Error('This partial browser copy cannot be restored. Choose a full server backup.');
  }
  if ((payload.schemaVersion !== 1 && payload.schemaVersion !== '1') || typeof metadata.checksum !== 'string') {
    throw new Error('Invalid backup format: unsupported schema version or missing checksum.');
  }
  if (!archive && metadata.checksum !== await backupChecksum({ ...payload, metadata })) {
    throw new Error('Backup file corrupted: Checksum verification failed.');
  }
  if (!Array.isArray(payload.transactions) || !Array.isArray(payload.accounts)) {
    throw new Error('Backup file invalid: missing core ledger collections.');
  }
  if (payload.workspace !== undefined && (!isObject(payload.workspace) || payload.workspace.id !== workspaceId)) {
    throw new Error('This backup belongs to a different workspace. Switch to the workspace it came from.');
  }
  return { name: file.name, text };
}

export default function BackupExportSettings() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const identity = useAuthStore(() => currentIdentity());
  const role = useCurrentRole();
  // Discard staged files as well as feedback when switching books, session or role.
  return <BackupExportSettingsBody key={JSON.stringify([workspaceId, identity, role])}
    workspaceId={workspaceId} identity={identity} canRestore={Boolean(identity && workspaceId && role === 'owner')} />;
}

function BackupExportSettingsBody({ workspaceId, identity, canRestore }: {
  workspaceId: string | null; identity: string | null; canRestore: boolean;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  useEffect(() => {
    const open = () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get('exportDialog') === '1') {
        url.searchParams.delete('exportDialog');
        window.history.replaceState(null, '', url);
        setExportOpen(true);
      }
    };
    open();
    window.addEventListener('ledgerflow:open-export', open);
    return () => window.removeEventListener('ledgerflow:open-export', open);
  }, []);
  const workspaceName = useAuthStore(s => s.getCurrentWorkspace()?.name || s.currentWorkspaceId);
  const [exportError, setExportError] = useState('');
  const [reminderNotice, setReminderNotice] = useState('');
  const [offerPartial, setOfferPartial] = useState(false);
  const [reading, setReading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [restoreFile, setRestoreFile] = useState<RestoreFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileReadPending = useRef(false);
  const restorePending = useRef(false);
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const isCurrent = () => active.current && currentIdentity() === identity
    && useAuthStore.getState().currentWorkspaceId === workspaceId;

  const exportJSON = async () => {
    if (!isCurrent()) return;
    setExportError('');
    setReminderNotice('');
    setOfferPartial(false);
    const { user, isGuest } = useAuthStore.getState();
    if (!workspaceId || !user) {
      setExportError('Sign in and open a workspace to download a full backup.');
      setOfferPartial(Boolean(workspaceId && isGuest));
      return;
    }

    let payload: unknown;
    try {
      const token = await user.getIdToken();
      if (!isCurrent()) return;
      payload = await runCommand({ path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/export`, token });
    } catch (error) {
      if (!isCurrent()) return;
      setExportError(commandErrorMessage(error, uiLanguageNow()));
      // Service outages and network failures can offer a different file; an access refusal cannot.
      setOfferPartial(error instanceof ServerCommandError ? error.status >= 500 : error instanceof TypeError);
      return;
    }
    if (!isCurrent()) return;

    try {
      const collections = await verifiedBackupCollections(payload, workspaceId);
      if (!isCurrent()) return;
      if (!collections.transactions || !collections.accounts) throw new Error('The server backup is missing its ledger or accounts.');
      downloadJson(payload, 'backup', workspaceId);
    } catch (error) {
      if (isCurrent()) setExportError(commandErrorMessage(error, uiLanguageNow()));
      return;
    }
    // The browser can start a download, but cannot verify that the file was saved to disk.
    try {
      recordBackupCompleted(workspaceId);
    } catch {
      setReminderNotice('The backup download started, but the reminder could not be updated. Check that you saved the file.');
      return;
    }
    toast.success('Full backup download started. Keep the file somewhere secure.');
  };

  const exportPartial = async () => {
    if (!workspaceId || !offerPartial || !isCurrent()) return;
    if (useDataNeedsStore.getState().loadedWorkspaceId !== workspaceId) {
      setExportError('This workspace’s records are not loaded in this browser.');
      return;
    }
    try {
      const payload = await partialCopy(workspaceId);
      if (!isCurrent()) return;
      downloadJson(payload, 'partial-export', workspaceId);
      toast.warning('Partial copy download started. It cannot restore the workspace.');
    } catch (error) {
      if (isCurrent()) setExportError(`Partial copy could not be downloaded: ${commandErrorMessage(error, uiLanguageNow())}`);
    }
  };

  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = ''; // allow selecting the same file after cancellation or refusal
    if (!file || !workspaceId || !canRestore || !isCurrent() || fileReadPending.current || restoreFile || restorePending.current) return;
    fileReadPending.current = true;
    setReading(true);
    setRestoreError('');
    try {
      const selection = await readRestoreFile(file, workspaceId);
      if (isCurrent()) setRestoreFile(selection);
    } catch (error) {
      if (isCurrent()) setRestoreError(error instanceof SyntaxError ? 'The backup is not readable JSON.' : commandErrorMessage(error, uiLanguageNow()));
    } finally {
      fileReadPending.current = false;
      if (isCurrent()) setReading(false);
    }
  };

  const closeRestore = () => { if (!restorePending.current) setRestoreFile(null); };
  const { dialogProps, titleId } = useDialog(closeRestore, Boolean(restoreFile));

  const confirmRestore = async () => {
    if (!restoreFile || !workspaceId || !canRestore || !isCurrent() || restorePending.current) return;
    restorePending.current = true;
    // Neither action is available once sent. Keep focus inside the modal while waiting.
    dialogProps.ref.current?.focus();
    setRestoring(true);
    let sent = false;
    try {
      const token = await useAuthStore.getState().user?.getIdToken();
      if (!isCurrent()) return;
      if (!token) throw new Error('Sign in again before restoring this workspace.');
      sent = true;
      // Preserve the original JSON (including checksum/signature) of either the JSON file or archive.
      const result = await runCommand({
        path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/restore`,
        method: 'POST', token, rawBody: restoreFile.text,
      });
      if (!isCurrent()) return;
      if (!isObject(result) || result.success !== true) throw new Error('No restore result received.');
      toast.success(typeof result.message === 'string' ? result.message : 'Workspace restored.');
    } catch (error) {
      if (isCurrent()) {
        // The request might have committed even when the answer was lost. Never suggest a blind retry.
        const refused = error instanceof ServerCommandError && error.status >= 400 && error.status < 500;
        setRestoreError(sent && !refused
          ? 'Could not confirm whether the restore finished. Check the workspace before trying again.'
          : commandErrorMessage(error, uiLanguageNow()));
      }
    } finally {
      restorePending.current = false;
      if (isCurrent()) {
        setRestoring(false);
        setRestoreFile(null);
      }
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {exportOpen && <WorkspaceExportDialog onClose={() => setExportOpen(false)} />}
      {restoreFile && createPortal(
        <div {...dialogProps} aria-describedby={`${titleId}-warning`} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 text-[var(--text)] shadow-xl">
            <h2 id={titleId} className="text-lg font-bold">Restore backup?</h2>
            <p className="break-words text-sm">File: <strong><bdi>{restoreFile.name}</bdi></strong></p>
            <p id={`${titleId}-warning`} className="break-words text-sm">
              This restore replaces records in <strong><bdi>{workspaceName}</bdi></strong>.
              Changes made since the backup may be lost. Files attached to records are not restored.
            </p>
            {restoring && <p role="status" className="text-sm text-[var(--muted)]">Wait for the restore result before trying again.</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <AsyncButton type="button" variant="outline" className={outlineAction} disabled={restoring} onClick={closeRestore}>Cancel</AsyncButton>
              <AsyncButton type="button" variant="danger" className="min-h-11 text-[var(--neg)] hover:bg-[var(--surface)] hover:underline" loading={restoring} loadingText="Restoring…" onClick={confirmRestore}>
                Replace workspace records
              </AsyncButton>
            </div>
          </div>
        </div>, document.body,
      )}
      <div className="flex items-center gap-4 border-b border-[var(--line)] pb-6">
        <div className="h-12 w-12 bg-indigo-500/10 text-indigo-500 rounded-xl flex items-center justify-center">
          <Database aria-hidden="true" size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-[var(--text)]">Backup & Export</h2>
          <p className="text-zinc-600 dark:text-zinc-300">Securely export your data for backups, accountants, or migration.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section aria-label="Full Workspace Backup" className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Archive aria-hidden="true" className="text-zinc-400" size={24} />
            <h3 className="font-bold text-[var(--text)]">Full Workspace Backup</h3>
          </div>
          <p className="mb-4 text-sm text-[var(--muted)]">
            Download a snapshot of your books and settings from the server. Keep it somewhere secure;
            it does not include attached file contents or verify your hosting provider’s backups.
          </p>
          <AsyncButton type="button" onClick={exportJSON} loadingText="Preparing backup…"
            className="min-h-11 w-full text-[var(--ink)] hover:bg-[var(--brass)] hover:underline"
            icon={<Download aria-hidden="true" size={16} />}>
            Export JSON Backup
          </AsyncButton>
          {exportError && <p role="alert" className="mt-3 text-sm text-[var(--neg)]">The full backup could not be downloaded. {exportError}</p>}
          {reminderNotice && <p role="status" className="mt-3 text-sm text-[var(--muted)]">{reminderNotice}</p>}
          {offerPartial && (
            <div className="mt-4 space-y-2 border-t border-[var(--line)] pt-3">
              <p className="text-sm text-[var(--muted)]">A partial copy contains only data loaded in this browser. It cannot be restored and does not count as a backup.</p>
              <AsyncButton type="button" variant="outline" onClick={exportPartial} className={`${outlineAction} w-full`}>Download partial copy</AsyncButton>
            </div>
          )}
        </section>

        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <FileSpreadsheet aria-hidden="true" className="text-green-500" size={24} />
            <h3 className="font-bold text-[var(--text)]">Data exports</h3>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6 min-h-[40px]">
            Choose posted ledger lines, complete record fields or one bank account, with period and format controls.
          </p>
          <button 
            onClick={() => setExportOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Download aria-hidden="true" size={16} />
            Choose export
          </button>
        </div>

        <WorkspaceArchiveExport />

        <YearEndArchiveExport />

        <IifListExport />

        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Upload aria-hidden="true" className="text-rose-500" size={24} />
            <h3 className="font-bold text-[var(--text)]">Restore Backup</h3>
          </div>
          <p className="mb-4 text-sm text-[var(--muted)]">
            Choose a full JSON backup or workspace ZIP. The file is checked before you confirm; the
            server then decides whether it can be restored.
          </p>
          <input aria-label="Restore backup file" type="file" ref={fileInputRef} onChange={handleFileSelect}
            accept=".json,.zip" className="hidden" disabled={!canRestore} />
          <AsyncButton type="button" variant="outline" className={`${outlineAction} w-full`}
            disabled={!canRestore} aria-disabled={reading || undefined}
            icon={<Upload aria-hidden="true" size={16} />}
            onClick={event => {
              if (!isCurrent() || fileReadPending.current || restoreFile) return;
              event.currentTarget.focus();
              fileInputRef.current?.click();
            }}>
            {reading ? 'Checking backup…' : 'Restore Workspace'}
          </AsyncButton>
          {!canRestore && <p className="mt-2 text-sm text-[var(--muted)]">Only a signed-in workspace owner can restore a backup.</p>}
          {restoreError && <p role="alert" className="mt-2 text-sm text-[var(--neg)]">{restoreError}</p>}
        </div>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex gap-4">
        <AlertCircle aria-hidden="true" className="text-amber-500 shrink-0 mt-0.5" size={20} />
        <div>
          <h4 className="font-bold text-amber-500 text-sm">Accountant Access & QBO Export</h4>
          <p className="text-sm text-amber-500/80 mt-1">
            Need a direct IIF or QuickBooks-formatted file? The CSV export can be imported into most major accounting systems. A direct QBO integration is coming in Q4.
          </p>
        </div>
      </div>
    </div>
  );
}
