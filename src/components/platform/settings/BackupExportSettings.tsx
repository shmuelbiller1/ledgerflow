import { runCommand, commandErrorMessage } from '../../../lib/runCommand';
import React, { useState, useRef, useEffect } from 'react';
import { Download, Database, FileSpreadsheet, Archive, AlertCircle, Upload } from 'lucide-react';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useAuthStore } from '../../../stores/useAuthStore';
import { toast } from 'sonner';
import { getLocalDateISO } from '../../../lib/utils';
import { recordBackupCompleted } from '../../../lib/ledgerBackupHealth';
import { isPostable } from '../../../lib/txFilters';
import { useDialog } from '../../../hooks/useDialog';
import WorkspaceExportDialog from './WorkspaceExportDialog';
import WorkspaceArchiveExport from './WorkspaceArchiveExport';
import YearEndArchiveExport from './YearEndArchiveExport';
import IifListExport from './IifListExport';
import { backupFromWorkspaceArchive } from '../../../lib/workspaceArchive';
import { BRAND } from '../../../config/brand';

/** The shape the export endpoint answers: a full archive plus a count of what is in it. */
interface BackupPayload {
  exportedAt?: string;
  metadata?: { transactionCount?: number; totalCount?: number; serverAuthoritative?: boolean; checksum?: string; [key: string]: unknown };
  transactions?: unknown[];
  accounts?: unknown[];
  [key: string]: unknown;
}

/** A verified backup file waiting for the user's explicit confirmation before replacing workspace records. */
interface PendingRestore {
  workspaceId: string;
  fileName: string;
  rawText: string;
  exportedAt: string | null;
  transactionCount: number;
  accountCount: number;
}

const PARTIAL_OFFLINE_WARNING =
  'The server could not be reached, so this file only contains records currently open in this browser tab. It is not a full backup and cannot restore a workspace.';

const PARTIAL_RESTORE_REFUSAL =
  'Partial offline backups only contain what one browser tab had open and cannot restore a workspace. Export a full backup while connected to the server.';

export default function BackupExportSettings() {
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
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [offlineExportWarning, setOfflineExportWarning] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelPendingRestore = () => {
    if (!isRestoring) setPendingRestore(null);
  };
  const { dialogProps: restoreDialogProps, titleId: restoreTitleId } = useDialog(cancelPendingRestore, Boolean(pendingRestore));

  const exportJSON = async () => {
    setIsExporting(true);
    try {
      const authState = useAuthStore.getState();
      const workspaceId = authState.currentWorkspaceId;
      if (!workspaceId) {
        throw new Error("No active workspace selected");
      }

      let payload: BackupPayload | null = null;
      let usedServer = false;

      // 1. Authoritative Server-side complete streaming export
      try {
        const token = await authState.user?.getIdToken();
        payload = await runCommand<BackupPayload>({ path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/export`, token });
        usedServer = true;
      } catch (serverErr) {
        console.warn("Server backup export endpoint unavailable, attempting fallback:", serverErr);
      }

      // 2. Client fallback (e.g. offline or unauthenticated guest mode)
      if (!payload) {
        const state = useLedgerStore.getState();
        payload = {
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
            serverAuthoritative: false
          }
        };

        const payloadString = JSON.stringify(payload);
        const msgBuffer = new TextEncoder().encode(payloadString);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        (payload.metadata as typeof payload.metadata & { checksum?: string }).checksum = hashHex;
      }

      const doc = payload;
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = usedServer
        ? `${BRAND.fileSlug}-backup-${workspaceId}-${getLocalDateISO()}.json`
        : `${BRAND.fileSlug}-partial-offline-backup-${workspaceId}-${getLocalDateISO()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      if (usedServer) {
        setOfflineExportWarning(null);
        recordBackupCompleted(workspaceId);
        toast.success(`Full verified backup exported (${payload.metadata?.transactionCount ?? payload.transactions?.length ?? 0} transactions)`);
      } else {
        // #776: never mark backup health complete for a partial browser-cache snapshot
        setOfflineExportWarning(PARTIAL_OFFLINE_WARNING);
        toast.warning(PARTIAL_OFFLINE_WARNING);
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to export backup: ' + commandErrorMessage(e));
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsRestoring(true);
    try {
      const authState = useAuthStore.getState();
      const workspaceId = authState.currentWorkspaceId;
      if (!workspaceId) {
        throw new Error("No active workspace selected");
      }

      // BK-10: a workspace archive (ZIP) is read back to its backup.json, then restored the same way
      const text = /\.zip$/i.test(file.name)
        ? (await backupFromWorkspaceArchive(new Uint8Array(await file.arrayBuffer()))).text
        : await file.text();
      const payload = JSON.parse(text) as BackupPayload;

      if (!payload.schemaVersion || !payload.metadata || !payload.metadata.checksum) {
        throw new Error("Invalid backup format: Missing schema version or checksum");
      }

      // #776: refuse partial browser-cache files before checksum or confirmation so missing collections are never wiped
      if (payload.metadata.serverAuthoritative === false) {
        throw new Error(PARTIAL_RESTORE_REFUSAL);
      }

      // Verify checksum
      const originalChecksum = payload.metadata.checksum;
      delete payload.metadata.checksum; // Remove checksum to re-hash the exact structure
      
      const payloadString = JSON.stringify(payload);
      const msgBuffer = new TextEncoder().encode(payloadString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const calculatedChecksum = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      if (originalChecksum !== calculatedChecksum) {
        throw new Error("Backup file corrupted: Checksum verification failed.");
      }

      // Restore dry-run/validation
      if (!Array.isArray(payload.transactions) || !Array.isArray(payload.accounts)) {
         throw new Error("Backup file invalid: Missing core ledger collections.");
      }

      setPendingRestore({
        workspaceId,
        fileName: file.name,
        rawText: text,
        exportedAt: typeof payload.exportedAt === 'string' ? payload.exportedAt : null,
        transactionCount: payload.transactions.length,
        accountCount: payload.accounts.length,
      });
    } catch (e) {
      console.error("Restore failed:", e);
      toast.error(`Restore failed: ${commandErrorMessage(e)}`);
    } finally {
      setIsRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const confirmRestore = async () => {
    if (!pendingRestore) return;
    setIsRestoring(true);
    try {
      const authState = useAuthStore.getState();
      const workspaceId = authState.currentWorkspaceId;
      if (!workspaceId || workspaceId !== pendingRestore.workspaceId) {
        throw new Error('The active workspace changed. Choose the backup file again in the workspace you want to restore.');
      }
      const token = await authState.user?.getIdToken();
      // the file's own text is the body: send it as it is, not JSON-encoded a second time
      const result = await runCommand<{ message?: string }>({
        path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/restore`,
        method: 'POST',
        token,
        rawBody: pendingRestore.rawText,
      });
      setPendingRestore(null);
      toast.success(result.message || "Workspace general ledger successfully restored from backup snapshot.");
    } catch (e) {
      console.error("Restore failed:", e);
      toast.error(`Restore failed: ${commandErrorMessage(e)}`);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {exportOpen && <WorkspaceExportDialog onClose={() => setExportOpen(false)} />}
      <div className="flex items-center gap-4 border-b border-[var(--line)] pb-6">
        <div className="h-12 w-12 bg-indigo-500/10 text-indigo-500 rounded-xl flex items-center justify-center">
          <Database aria-hidden="true" size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-[var(--text)]">Backup & Export</h2>
          <p className="text-zinc-500">Securely export your data for backups, accountants, or migration.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Archive aria-hidden="true" className="text-zinc-400" size={24} />
            <h3 className="font-bold text-[var(--text)]">Full Workspace Backup</h3>
          </div>
          <p className="text-sm text-zinc-500 mb-6 min-h-[40px]">
            Download a complete JSON snapshot of all your ledgers, accounts, invoices, and settings.
          </p>
          <button 
            type="button"
            onClick={exportJSON}
            disabled={isExporting}
            className="w-full min-h-11 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Download aria-hidden="true" size={16} />
            Export JSON Backup
          </button>
          {offlineExportWarning && (
            <p role="alert" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              {offlineExportWarning}
            </p>
          )}
        </div>

        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <FileSpreadsheet aria-hidden="true" className="text-green-500" size={24} />
            <h3 className="font-bold text-[var(--text)]">Data exports</h3>
          </div>
          <p className="text-sm text-zinc-500 mb-6 min-h-[40px]">
            Choose posted ledger lines, complete record fields or one bank account, with period and format controls.
          </p>
          <button 
            onClick={() => setExportOpen(true)}
            disabled={isExporting}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors"
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
          <p className="text-sm text-zinc-500 mb-6 min-h-[40px]">
            Restore your workspace from a verified JSON backup file or a workspace archive (ZIP). Validates checksum and schema integrity before importing.
          </p>
          <input aria-label="Restore backup file"
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileSelect}
            accept=".json,.zip" 
            className="hidden" 
          />
          <button 
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRestoring}
            className="w-full min-h-11 flex items-center justify-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Upload aria-hidden="true" size={16} />
            Restore Workspace
          </button>
        </div>
      </div>

      {pendingRestore && (
        <div
          {...restoreDialogProps}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 text-[var(--text)] shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle aria-hidden="true" className="text-rose-600 shrink-0 mt-0.5" size={20} />
              <div className="space-y-1">
                <h3 id={restoreTitleId} className="text-base font-bold text-[var(--text)]">
                  Replace workspace records from backup?
                </h3>
                <p className="text-sm text-[var(--muted)]">
                  Restoring <span className="font-medium text-[var(--text)]"><bdi>{pendingRestore.fileName}</bdi></span> replaces current entries, accounts, and documents in this workspace with the verified snapshot.
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3 text-xs">
              <div>
                <dt className="text-[var(--muted)]">Transactions</dt>
                <dd className="font-mono font-semibold text-[var(--text)] tabular-nums">{pendingRestore.transactionCount}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Accounts</dt>
                <dd className="font-mono font-semibold text-[var(--text)] tabular-nums">{pendingRestore.accountCount}</dd>
              </div>
              {pendingRestore.exportedAt && (
                <div className="col-span-2">
                  <dt className="text-[var(--muted)]">Exported</dt>
                  <dd className="font-mono text-[var(--text)] tabular-nums"><bdi>{pendingRestore.exportedAt.slice(0, 19).replace('T', ' ')} UTC</bdi></dd>
                </div>
              )}
            </dl>
            <p className="text-xs text-[var(--muted)]">
              Download a fresh backup first if you want a copy of changes made since this snapshot.
            </p>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={cancelPendingRestore}
                disabled={isRestoring}
                className="min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--panel)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRestore}
                disabled={isRestoring}
                className="min-h-11 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {isRestoring ? 'Restoring…' : 'Confirm restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4 flex gap-4">
        <AlertCircle aria-hidden="true" className="text-[var(--muted)] shrink-0 mt-0.5" size={20} />
        <div className="space-y-1">
          <h3 className="font-bold text-[var(--text)] text-sm">Backup verification & accountant copies</h3>
          <p className="text-sm text-[var(--muted)]">
            Full JSON backups and workspace ZIP archives include a SHA-256 integrity check that is verified before a restore runs. Download a full backup while online before bulk imports, period close, or restoring an earlier copy. Database-level recovery depends on your hosting environment and is not configured from this screen.
          </p>
          <p className="text-sm text-[var(--muted)]">
            To share records with an accountant or import into desktop accounting software, use Data exports for CSV or Excel files, or the IIF list export above.
          </p>
        </div>
      </div>
    </div>
  );
}
