import React, { useMemo, useState } from 'react';
import { FileArchive, Download, ShieldCheck, ShieldAlert, Briefcase } from 'lucide-react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useDataNeedsStore } from '../../../stores/useDataNeedsStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useLedgerCollections } from '../../../hooks/useLedgerCollections';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { useAccessReview } from '../../../hooks/useAccessReview';
import { buildAuditEvidencePack, evidenceDay, evidencePackFileName } from '../../../lib/auditEvidencePack';
import { verifyAuditHashChain, type HashChainableAuditEntry } from '../../../lib/auditHashChain';
import { buildLenderReadyPackage, lenderPackageFileName } from '../../../lib/lenderReadyPackage';
import { verifiedBackupCollections } from '../../../lib/workspaceArchive';
import { workspaceScope } from '../../../lib/serverAction';
import { getIdToken } from '../../../firebase';
import { localDay } from '../../../lib/accessReview';
import { buildStoredZip } from '../../../lib/zips';
import { LoadingState } from '../../ui/LoadingState';
import type { Bill, ChartAccount, Invoice, Payment, ReconciliationSession, Transaction } from '../../../types';

/**
 * Settings → Security → Audit evidence pack (BJ-02 / C-36). For a chosen period it downloads one
 * ZIP: the audit trail as CSV, the period locks, the approvals (invoices, pay runs, the rules they
 * are checked against) and the access review. Read-only and assembled from records the workspace
 * already holds — nothing is recalculated, posted or changed — and the pack's README states what it
 * cannot see (the 500-entry audit window, another person's authenticator status).
 */

/** The local day, the same day the pack's period filter compares against. */
function today(): string {
  return localDay(new Date());
}
function monthStart(): string {
  return `${today().slice(0, 7)}-01`;
}

/** Local time, so the README's timestamp is the clock the person reading it used. */
function generatedAt(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().replace('Z', '');
}

export default function AuditEvidencePackPanel() {
  const role = useCurrentRole();
  const isGuest = useAuthStore(s => s.isGuest);
  const allowed = !isGuest && (role === 'owner' || role === 'accountant');
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  if (isGuest) return <section aria-labelledby="evidence-pack-title" className="p-6 bg-[var(--surface)] border border-[var(--line)] rounded-2xl space-y-2">
    <h2 id="evidence-pack-title" className="text-base font-black text-[var(--text)]">Audit evidence pack</h2>
    <p className="text-sm text-[var(--muted)]">The demo workspace has no real records to pack. Sign in to a workspace to download its evidence.</p>
  </section>;
  return allowed
    ? <ScopedEvidencePack key={workspaceId} workspaceId={workspaceId} />
    : <section aria-labelledby="evidence-pack-title" className="p-6 bg-[var(--surface)] border border-[var(--line)] rounded-2xl space-y-2">
      <h2 id="evidence-pack-title" className="text-base font-black text-[var(--text)]">Audit evidence pack</h2>
      <p className="text-sm text-[var(--muted)]">Only owners and accountants can download the audit evidence pack. Ask an owner if you need it.</p>
    </section>;
}

function ScopedEvidencePack({ workspaceId }: { workspaceId: string }) {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const invoices = useLedgerStore(s => s.invoices || []);
  const payRuns = useLedgerStore(s => s.payRuns || []);
  const auditLogs = useLedgerStore(s => s.auditLogs || []);
  const invoicesCapped = useLedgerStore(s => Boolean(s.truncatedCollections?.invoices));
  const payRunsCapped = useLedgerStore(s => Boolean(s.truncatedCollections?.payRuns));
  const { loading } = useLedgerCollections('invoices', 'payRuns', 'auditLogs');
  const failed = useDataNeedsStore(s => s.failed.invoices || s.failed.payRuns);
  const review = useAccessReview(workspaceId);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [lenderBusy, setLenderBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const invalidPeriod = !evidenceDay(from) || !evidenceDay(to) || from > to;
  const chainStatus = useMemo(
    () => verifyAuditHashChain(auditLogs as unknown as HashChainableAuditEntry[]),
    [auditLogs],
  );

  const files = useMemo(() => {
    if (!workspace || invalidPeriod) return [];
    return buildAuditEvidencePack({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        lockDate: workspace.lockDate,
        softLockDate: workspace.softLockDate,
        lockException: workspace.lockException,
        requireTwoStep: workspace.requireTwoStep,
        twoPersonRule: workspace.twoPersonRule,
        payrollApproval: workspace.payrollApproval,
        invoiceApproval: workspace.invoiceApproval,
        currency: workspace.currency,
      },
      period: { from, to },
      generatedAt: generatedAt(),
      auditLogs,
      invoices,
      payRuns,
      accessRows: review.rows,
      auditCapped: review.auditTruncated,
      documentsCapped: { invoices: invoicesCapped, payRuns: payRunsCapped },
    });
  }, [workspace, invalidPeriod, from, to, auditLogs, invoices, payRuns, review.rows, review.auditTruncated, invoicesCapped, payRunsCapped]);

  const download = () => {
    setError(''); setNotice('');
    try {
      if (invalidPeriod) throw new Error('Choose a valid period: the first date must not be after the last.');
      if (!workspace) throw new Error('Open a workspace first.');
      const zip = buildStoredZip(files.map(file => ({ name: file.name, data: new TextEncoder().encode(file.text) })));
      const name = evidencePackFileName(workspace, { from, to });
      // buildStoredZip returns an exactly-sized buffer starting at 0, so it can be handed over whole
      const blob = new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Downloaded ${name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The pack could not be built.');
    }
  };

  const downloadLenderPack = async () => {
    if (lenderBusy) return;
    setError(''); setNotice('');
    if (invalidPeriod) {
      setError('Choose a valid period: the first date must not be after the last.');
      return;
    }
    if (!workspace) {
      setError('Open a workspace first.');
      return;
    }
    const scope = workspaceScope(() => useAuthStore.getState().currentWorkspaceId);
    setLenderBusy(true);
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error('The authoritative server ledger could not be fetched. No partial lender package was built.');
      }
      const collections = await verifiedBackupCollections(await res.json(), workspace.id);
      if (!scope.isCurrent()) return;

      const serverAccounts = ((collections.chartAccounts || collections.accounts || []) as ChartAccount[]);
      const serverTransactions = ((collections.transactions || []) as Transaction[]);
      const serverInvoices = ((collections.invoices || []) as Invoice[]);
      const serverBills = ((collections.bills || []) as Bill[]);
      const serverPayments = ((collections.payments || []) as Payment[]);
      const serverReconciliations = ((collections.reconciliations || []) as ReconciliationSession[]);
      const serverAuditLogs = ((collections.auditLogs || []) as HashChainableAuditEntry[]);

      const lender = buildLenderReadyPackage({
        workspace: {
          id: workspace.id,
          name: workspace.name,
          lockDate: workspace.lockDate,
          softLockDate: workspace.softLockDate,
          lockException: workspace.lockException,
          requireTwoStep: workspace.requireTwoStep,
          twoPersonRule: workspace.twoPersonRule,
          payrollApproval: workspace.payrollApproval,
          invoiceApproval: workspace.invoiceApproval,
          currency: workspace.currency,
        },
        period: { from, to },
        generatedAt: generatedAt(),
        accounts: serverAccounts,
        transactions: serverTransactions,
        invoices: serverInvoices,
        bills: serverBills,
        payments: serverPayments,
        reconciliations: serverReconciliations,
        auditLogs: serverAuditLogs,
      });
      const zip = buildStoredZip(lender.files.map(file => ({ name: file.name, data: new TextEncoder().encode(file.text) })));
      const name = lenderPackageFileName(workspace, { from, to });
      const blob = new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Downloaded ${name}`);
    } catch (err) {
      if (scope.isCurrent()) {
        setError(err instanceof Error ? err.message : 'The lender package could not be built.');
      }
    } finally {
      if (scope.isCurrent()) setLenderBusy(false);
    }
  };

  const busy = !failed && review.status !== 'error' && (loading || review.status === 'loading');
  const blocked = failed
    ? `The documents this pack needs could not be loaded: ${failed}`
    : review.status === 'error' ? review.error : '';

  return (
    <section aria-labelledby="evidence-pack-title" className="p-6 md:p-8 bg-[var(--surface)] border border-[var(--line)] rounded-2xl space-y-5">
      <div className="space-y-1">
        <h2 id="evidence-pack-title" className="text-base font-black text-[var(--text)] flex items-center gap-2">
          <FileArchive aria-hidden="true" size={18} className="text-[var(--brass)]" /> Audit evidence pack
        </h2>
        <p className="text-xs text-[var(--muted)] max-w-2xl">
          One download for a chosen period: the audit trail, the period locks, the approvals and the access review, each as
          its own file, with a README saying what the pack is and what it cannot see. It reports what the records say — it
          does not audit, recalculate or change anything.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-bold text-[var(--muted)]">From
          <input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)}
            className="mt-1 block min-h-11 w-full bg-[var(--ink)] border border-[var(--line)] rounded-xl px-3 text-[var(--text)]" />
        </label>
        <label className="text-xs font-bold text-[var(--muted)]">To
          <input type="date" value={to} min={from} onChange={event => setTo(event.target.value)}
            className="mt-1 block min-h-11 w-full bg-[var(--ink)] border border-[var(--line)] rounded-xl px-3 text-[var(--text)]" />
        </label>
        <button type="button" onClick={download} disabled={invalidPeriod || busy || Boolean(blocked)}
          className="min-h-11 px-4 border border-[var(--line)] rounded-xl text-xs font-bold flex items-center gap-2 disabled:opacity-50">
          <Download aria-hidden="true" size={14} /> Download .zip
        </button>
        <button type="button" onClick={() => void downloadLenderPack()} disabled={invalidPeriod || busy || lenderBusy || Boolean(blocked)}
          className="min-h-11 px-4 border border-emerald-600/50 text-emerald-700 dark:text-emerald-400 rounded-xl text-xs font-bold flex items-center gap-2 disabled:opacity-50">
          <Briefcase aria-hidden="true" size={14} /> {lenderBusy ? 'Fetching full ledger…' : 'Lender-ready package (.zip)'}
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--ink)]">
        {chainStatus.valid ? (
          <>
            <ShieldCheck aria-hidden="true" size={15} className="text-emerald-500 shrink-0" />
            <span className="text-[var(--text)] font-semibold">SHA-256 audit hash-chain verified</span>
            <span className="text-[var(--muted)] font-mono truncate">
              · {chainStatus.chainedCount} chained · head {chainStatus.headHash.slice(0, 12)}…
            </span>
          </>
        ) : (
          <>
            <ShieldAlert aria-hidden="true" size={15} className="text-rose-500 shrink-0" />
            <span className="text-rose-500 font-semibold">Audit chain tampered: {chainStatus.reason}</span>
          </>
        )}
      </div>

      {invalidPeriod && <p role="alert" className="text-sm text-rose-400">Choose a valid period: the first date must not be after the last.</p>}
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      {notice && <p role="status" className="text-sm text-[var(--pos)]">{notice}</p>}
      {busy && <LoadingState what="the records this pack needs" />}

      {!busy && blocked && (
        <div role="alert" className="p-4 border border-rose-500/30 bg-rose-500/5 rounded-xl space-y-2">
          <p className="text-sm text-[var(--text)]">{blocked}</p>
          <button type="button" onClick={() => {
            const needs = useDataNeedsStore.getState();
            needs.retry('invoices'); needs.retry('payRuns');
            review.reload();
          }} className="min-h-11 px-4 border border-[var(--line)] rounded-xl text-xs font-bold">Try again</button>
        </div>
      )}

      {!busy && !blocked && files.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[10px] font-black uppercase tracking-wider text-[var(--muted)]">What the pack will contain</h3>
          <ul className="space-y-1 text-xs">
            {files.map(file => (
              <li key={file.name} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] pb-1">
                <span className="font-bold text-[var(--text)]">{file.name}</span>
                <span className="text-[var(--muted)]">{file.headers.length ? `${file.rows.length} rows · ${file.headers.length} columns` : 'explains the pack and its limits'}</span>
              </li>
            ))}
          </ul>
          {files.slice(1).every(file => file.rows.length === 0) && (
            <p className="text-xs text-[var(--muted)]">Nothing was recorded in this period. The pack still downloads, and each file says so with its header row only — a missing period is evidence too.</p>
          )}
          {(invoicesCapped || payRunsCapped) && (
            <p role="status" className="text-xs text-amber-400">
              This workspace holds more {[invoicesCapped ? 'invoices (10,000)' : '', payRunsCapped ? 'pay runs (1,000)' : ''].filter(Boolean).join(' and ')} than
              the browser loads, so an approval older than the loaded rows may be missing from the pack. It says so in the
              README; nothing here pretends to be the complete history.
            </p>
          )}
          <p className="text-[11px] text-[var(--muted)]">
            The access review file holds the same rows as the access review above it, and the audit file the entries dated
            inside the period. Times are ISO dates; each amount is the document's own figure in the currency named on that
            row — nothing is converted.
          </p>
        </div>
      )}
    </section>
  );
}
