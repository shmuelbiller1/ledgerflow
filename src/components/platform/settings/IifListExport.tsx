/**
 * E-53: "QuickBooks Desktop lists (IIF)" card on Settings → Backup & Export.
 *
 * The file is built from the **verified server backup** (the same checked payload the ZIP
 * archive uses), never from the browser cache — an export that quietly misses records would
 * hand the accountant a short list. Lists only: accounts, customers, vendors, items.
 * No journals, invoices, bills or payments (an IIF with transaction rows posts money in
 * QuickBooks on import); no balances; the skipped list names what was left out and why.
 */
import { useState } from 'react';
import { Download, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { getLocalDateISO } from '../../../lib/utils';
import { verifiedBackupCollections } from '../../../lib/workspaceArchive';
import { buildIifExport } from '../../../lib/iifExport';
import type { ChartAccount, Customer, InventoryItem, Vendor } from '../../../types';
import { BRAND } from '../../../config/brand';
import { readVerifiedBackup, saveBlob, useServerExport } from '../../../hooks/useServerExport';

export default function IifListExport() {
  const scope = useAuthStore(s => String(s.user?.uid || 'guest') + ':' + String(s.currentWorkspaceId || 'none'));
  return <IifListExportBody key={scope} />;
}

function IifListExportBody() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const uid = useAuthStore(s => s.user?.uid);
  const isGuest = useAuthStore(s => s.isGuest && !s.user);
  const role = useCurrentRole();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastSkipped, setLastSkipped] = useState<Array<{ section: string; name: string; reason: string }>>([]);
  const allowed = !isGuest && role === 'owner' && Boolean(uid && workspaceId);
  const failure = 'The server export failed. No incomplete IIF was downloaded.';

  const { start } = useServerExport({
    allowed, setBusy, setError, failure,
    run: async ({ workspaceId: selectedId, signal, stillHere }) => {
      const source = await readVerifiedBackup(selectedId, signal, failure);
      if (!stillHere()) return;
      // Format, workspace and SHA-256 checksum checked — same gate as the archive (E-21).
      const collections = await verifiedBackupCollections(source, selectedId);
      if (!stillHere()) return;
      // Backup keys follow RESTORE_COLLECTIONS (workspaceRestoreService.ts): the chart of accounts travels
      // under `accounts`, the item catalogue under `inventory`.
      const file = buildIifExport({
        accounts: collections.accounts as ChartAccount[] | undefined,
        customers: collections.customers as Customer[] | undefined,
        vendors: collections.vendors as Vendor[] | undefined,
        items: collections.inventory as InventoryItem[] | undefined,
      });
      saveBlob(
        new Blob([file.text], { type: 'text/plain;charset=utf-8' }),
        `${BRAND.fileSlug}-lists-` + selectedId.replace(/[^a-zA-Z0-9_-]/g, '_') + '-' + getLocalDateISO() + '.iif',
      );
      setLastSkipped(file.skipped);
      toast.success(
        `IIF written: ${file.counts.accounts} accounts, ${file.counts.customers} customers, `
        + `${file.counts.vendors} vendors, ${file.counts.items} items`
        + (file.skipped.length ? ` (${file.skipped.length} records left out — see the list below)` : '') + '.',
      );
    },
  });
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
      <div className="mb-4 flex items-center gap-3">
        <FileDown aria-hidden="true" className="text-emerald-600" size={24} />
        <h3 className="font-bold text-[var(--text)]">QuickBooks Desktop lists (IIF)</h3>
      </div>
      <p className="mb-3 text-sm text-[var(--muted)]">
        One <strong>.iif</strong> file with the chart of accounts, customers, vendors and items, for an
        accountant who still works in QuickBooks Desktop (File &rarr; Utilities &rarr; Import &rarr; IIF Files).
      </p>
      <p className="mb-5 text-xs text-[var(--muted)]">
        Lists only: no journal entries, invoices, bills or payments are ever written to it — an IIF
        with transaction rows posts money in QuickBooks the moment it is imported, and this hand-off
        never posts. Balances and stock quantities are not carried over; item sale price and cost are
        copied as catalogue figures. Archived accounts, nameless records and duplicate names are left
        out and listed below after the download. The file is built from the verified, checksum-protected
        server backup — never from the possibly-incomplete browser cache — and only a signed-in workspace
        owner can start this download. UTF-8; QuickBooks Desktop reads it on the matching language edition
        for non-English names.
      </p>
      {error && <p role="alert" className="mb-3 text-xs text-[var(--neg)]">{error}</p>}
      <button type="button" onClick={() => void start()} disabled={!allowed || busy}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
        <Download size={16} aria-hidden="true" />
        {busy ? 'Preparing verified lists…' : 'Download QuickBooks lists (.iif)'}
      </button>
      {!allowed && <p className="mt-2 text-xs text-[var(--muted)]">Workspace owner sign-in required.</p>}
      {lastSkipped.length > 0 && (
        <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3">
          <p className="mb-1 text-xs font-semibold text-[var(--text)]">
            Left out of the last file ({lastSkipped.length}) — on purpose:
          </p>
          <ul className="space-y-0.5 text-xs text-[var(--muted)]" aria-label="Records left out of the IIF file">
            {lastSkipped
              // identical skip entries (three records sharing one name) collapse to one visible row
              .filter((entry, index, all) => all.findIndex(other => other.section === entry.section && other.name === entry.name && other.reason === entry.reason) === index)
              .map(entry => (
                <li key={`${entry.section}|${entry.name}|${entry.reason}`}><strong>{entry.section}</strong> {entry.name}: {entry.reason}</li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
