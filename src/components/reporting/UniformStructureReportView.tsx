/**
 * E-33: the Uniform Structure file (קובץ אחיד) — INI.TXT and BKMVDATA.TXT, built from the books.
 *
 * The Tax Authority's open format (spec v1.31) is two fixed-width files a registered accounting
 * program produces for a computerized audit. This screen builds both from the recorded journal,
 * chart and documents of one tax year (src/lib/tax/uniformBooksInput.ts assembles,
 * src/lib/tax/uniformStructureWriter.ts writes) and shows exactly what would be written: record
 * counts, per-document-type totals, the journal balance, and every blocker or limitation.
 * Read-only: nothing is filed, posted or paid, and no acceptance is claimed until the file has
 * passed the Tax Authority simulator.
 */
import { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { LEDGER_COLLECTIONS } from '../../lib/ledgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { byCodeUnit } from '../../lib/codeUnitOrder';
import { RowTable } from '../ui/RowTable';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import { useReportText } from './useReportText';
import {
  UNIFORM_RECORD_LAYOUTS,
  UNIFORM_SYSTEM_CONSTANT,
  type UniformRecordLayout,
} from '../../lib/tax/uniformStructure';
import {
  encodeUniformIso88598,
  writeUniformFiles,
  type UniformWriteOptions,
} from '../../lib/tax/uniformStructureWriter';
import { buildUniformBooksInput, ilDealerNumber, uniformDate8 } from '../../lib/tax/uniformBooksInput';

const th = 'font-semibold py-1 px-2';

/** The package version via vite `define`; 'dev' where no vite build substituted it (node tests). */
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** The collections this export reads; all eight must be loaded for the open workspace.
 *  (The keys are also spelled out at the useLedgerCollections call — the collections guard
 *  reads that call literally, not through this constant.) */
const NEEDED_KEYS = ['transactions', 'accounts', 'invoices', 'bills', 'creditNotes', 'vendorCredits', 'payments', 'inventory'] as const;

/** ISO-8859-8 bytes, then the browser download — the same byte stream the simulator reads. */
function downloadUniformText(filename: string, text: string): void {
  const bytes = encodeUniformIso88598(text);
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function UniformStructureReportView({
  layouts = UNIFORM_RECORD_LAYOUTS,
}: { layouts?: readonly UniformRecordLayout[] } = {}) {
  const reportText = useReportText();
  const { loading } = useLedgerCollections('transactions', 'accounts', 'invoices', 'bills', 'creditNotes', 'vendorCredits', 'payments', 'inventory');
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  const vendorCredits = useLedgerStore(s => s.vendorCredits);
  const payments = useLedgerStore(s => s.payments);
  const inventory = useLedgerStore(s => s.inventory);
  const baseCurrency = useLedgerStore(s => s.baseCurrency) || 'ILS';
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const isGuest = useAuthStore(s => s.isGuest && !s.user);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const loaded = useDataNeedsStore(s => s.loaded);
  const failed = useDataNeedsStore(s => s.failed);
  const loadedWorkspaceId = useDataNeedsStore(s => s.loadedWorkspaceId);
  const thisYear = (getLocalDateISO() || new Date().toISOString()).slice(0, 4);
  const [year, setYear] = useState(thisYear);
  const [acknowledgedScope, setAcknowledgedScope] = useState('');

  // The live browser cache may be capped or still belong to the previous workspace — the same
  // scope discipline as the Form 856 screen. Records without a workspaceId (the chart) pass.
  const scoped = useMemo(() => {
    const keep = <T extends { workspaceId?: string }>(rows: readonly T[]): T[] =>
      isGuest ? [...rows] : rows.filter(row => !row.workspaceId || row.workspaceId === currentWorkspaceId);
    return {
      transactions: keep(transactions),
      accounts: keep(accounts),
      invoices: keep(invoices),
      bills: keep(bills),
      creditNotes: keep(creditNotes),
      vendorCredits: keep(vendorCredits),
      payments: keep(payments),
      inventory: keep(inventory),
    };
  }, [transactions, accounts, invoices, bills, creditNotes, vendorCredits, payments, inventory, isGuest, currentWorkspaceId]);

  const years = useMemo(() => {
    const found = new Set<string>([thisYear]);
    const add = (date: string | undefined) => {
      const y = uniformDate8(date).slice(0, 4);
      if (y) found.add(y);
    };
    for (const tx of scoped.transactions) add(tx.date);
    for (const doc of [...scoped.invoices, ...scoped.bills, ...scoped.creditNotes, ...scoped.vendorCredits]) add(doc.date);
    for (const payment of scoped.payments) add(payment.date);
    return [...found].sort(byCodeUnit).reverse();
  }, [scoped, thisYear]);

  const taxId = useMemo(() => ilDealerNumber(workspace?.taxProfiles), [workspace]);
  const addressLine = workspace?.branding?.address;
  const raw = { transactions, accounts, invoices, bills, creditNotes, vendorCredits, payments, inventory };

  const built = useMemo(() => buildUniformBooksInput({
    business: {
      name: workspace?.name || '',
      taxId: taxId || undefined,
      addressLine,
    },
    taxYear: year,
    baseCurrency,
    accounts: scoped.accounts,    transactions: scoped.transactions,
    invoices: scoped.invoices,
    bills: scoped.bills,
    creditNotes: scoped.creditNotes,
    vendorCredits: scoped.vendorCredits,
    payments: scoped.payments,
    inventoryItemCount: scoped.inventory.length,
  }), [workspace?.name, taxId, addressLine, year, baseCurrency, scoped]);

  const out = useMemo(() => {
    const now = new Date();
    const options: UniformWriteOptions = {
      processDate: (getLocalDateISO() || now.toISOString()).slice(0, 10).replace(/-/g, ''),
      processTime: `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`,
      // Field 1004: derived here, fixed for this file — the dealer number plus the period end.
      // Not an authority-issued number (the spec's own wording for this field).
      primaryIdentifier: `${taxId}${year.slice(2)}1231`,
      baseCurrency,
      software: {
        name: 'Ledgerflow',
        version: APP_VERSION,
        vendorName: 'Ledgerflow',
      },
    };
    return writeUniformFiles(built.input, options);
  }, [built, taxId, year, baseCurrency]);

  const scopeKey = `${currentWorkspaceId ?? 'none'}:${year}`;
  // Cap and mixing checks look at the raw cache: the scoped lists are already filtered, so they
  // can neither show a hit cap nor a foreign record.
  const foreign = NEEDED_KEYS.filter(key =>
    !isGuest && (raw[key] as Array<{ workspaceId?: string }>).some(record => record.workspaceId && record.workspaceId !== currentWorkspaceId));
  const sourceBlockers = [
    ...(isGuest ? [reportText('r.uniform-demo-cannot-export', 'Demo data cannot be exported as a Uniform Structure file.')] : []),
    ...(!currentWorkspaceId ? [reportText('r.uniform-choose-workspace', 'Choose a workspace before downloading.')] : []),
    ...(loading || NEEDED_KEYS.some(key => !loaded[key]) || loadedWorkspaceId !== currentWorkspaceId
      ? [reportText('r.uniform-lists-loading', 'The bookkeeping lists have not finished loading for this workspace.')] : []),
    ...(NEEDED_KEYS.filter(key => failed[key]).length > 0
      ? [reportText('r.uniform-lists-failed', 'A bookkeeping list failed to load; refresh and try again.')] : []),
    ...(NEEDED_KEYS
      .filter(key => raw[key].length >= LEDGER_COLLECTIONS[key].cap)
      .map(() => reportText('r.uniform-list-hit-limit', 'A bookkeeping list hit its limit; older records may be missing.'))),
    ...(foreign.length > 0
      ? [reportText('r.uniform-cache-other-workspace', 'The bookkeeping cache contains records from a different workspace.')] : []),
    ...(built.input.journalEntries.length === 0 && built.input.documents.length === 0
      ? [reportText('r.uniform-nothing-to-write', 'No journal entries or documents in this year — there is nothing to write.')] : []),
    ...built.problems,
    ...out.problems,
  ];
  const uniqueBlockers = [...new Set(sourceBlockers)];
  const notes = [...new Set([...built.notes, ...out.notes])];
  const canDownload = uniqueBlockers.length === 0 && out.canDownload && acknowledgedScope === scopeKey;
  const money = (cents: number) => formatCurrency(cents, baseCurrency);

  return (
    <section aria-labelledby="uniform-structure-title" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="uniform-structure-title" className="text-lg font-bold text-[var(--text)] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[var(--muted)]" aria-hidden="true" />
            {reportText('r.uniform-structure-file', 'Uniform Structure File (BKMVDATA + INI)')}
          </h2>
          <p className="text-sm text-[var(--muted)]">
            {reportText('r.uniform-build-two-fixed-width-files', 'Build the Israeli Tax Authority open format (v1.31): INI.TXT and BKMVDATA.TXT, from the recorded journal, chart and documents of one tax year. Read-only: nothing is filed, posted or paid here.')}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label htmlFor="uniform-structure-year" className="text-xs font-semibold text-[var(--muted)]">{reportText('r.year', 'Year')}</label>
          <select id="uniform-structure-year" value={year} onChange={e => setYear(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-sm">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {loading && <LoadingState label={reportText('r.loading', 'Loading…')} rows={3} />}

      <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm" aria-label={reportText('r.uniform-file-not-a-filing', 'File build, not a filing')}>
        <p className="font-semibold">{reportText('r.uniform-file-not-a-filing', 'File build, not a filing')}</p>
        <p className="text-[var(--muted)]">
          {reportText('r.uniform-simulator-disclaimer', 'The file has not been accepted by the Tax Authority simulator, so no acceptance is claimed. Field 1004 is derived from the dealer number and the period, not issued by the authority. Check the figures with an accountant before any use.')}
        </p>
        {uniqueBlockers.length > 0 && (
          <ul className="list-disc ps-5 text-[var(--muted)]" aria-label={reportText('r.uniform-download-blockers', 'File download blockers')}>
            {uniqueBlockers.map(message => <li key={message}>{message}</li>)}
          </ul>
        )}
        {uniqueBlockers.length === 0 && notes.length > 0 && (
          <ul className="list-disc ps-5 text-[var(--muted)]" aria-label={reportText('r.uniform-file-notes', 'File notes')}>
            {notes.map(message => <li key={message}>{message}</li>)}
          </ul>
        )}
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={acknowledgedScope === scopeKey}
            onChange={event => setAcknowledgedScope(event.target.checked ? scopeKey : '')}
            disabled={uniqueBlockers.length > 0 || !out.canDownload} />
          {reportText('r.uniform-acknowledge', 'I understand this file has not passed the Tax Authority simulator and is not filed from here.')}
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!canDownload}
            onClick={() => { if (canDownload) downloadUniformText('INI.TXT', out.iniText); }}
            className="min-h-11 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-semibold disabled:opacity-40">
            {reportText('r.uniform-download-ini', 'Download INI.TXT')}
          </button>
          <button type="button" disabled={!canDownload}
            onClick={() => { if (canDownload) downloadUniformText('BKMVDATA.TXT', out.bkmvdataText); }}
            className="min-h-11 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-semibold disabled:opacity-40">
            {reportText('r.uniform-download-bkmvdata', 'Download BKMVDATA.TXT')}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm" aria-label={reportText('r.uniform-record-counts', 'Records in BKMVDATA.TXT')}>
          <p className="font-semibold">{reportText('r.uniform-record-counts', 'Records in BKMVDATA.TXT')}</p>
          <RowTable
            rowClassName="border-b border-[var(--line)]/50"
            caption={reportText('r.uniform-record-counts', 'Records in BKMVDATA.TXT')}
            rows={out.recordCounts}
            empty={<EmptyState title={reportText('r.uniform-no-records', 'No records yet')} description={reportText('r.uniform-no-records-help', 'Choose a year with recorded bookkeeping to build the file.')} />}
            rowKey={row => row.code}
            captionClassName="sr-only"
            tableClassName="w-full text-sm"
            headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
            bodyClassName=""
            columns={[
              { header: reportText('r.record', 'Record'), className: 'py-1 px-2 font-mono', headClassName: `text-left ${th}`, cell: row => row.code },
              { header: reportText('r.uniform-count', 'Count'), align: 'right', className: 'py-1 px-2 font-mono', headClassName: `text-right ${th}`, cell: row => row.count },
            ]}
          />
          <p className="text-xs text-[var(--muted)]">
            {reportText('r.uniform-total-records', 'Total records')}: <bdi className="font-mono">{out.totalRecords}</bdi>
            {' · '}
            {reportText('r.uniform-journal-balance', 'Journal balance')}: <bdi className="font-mono">{money(out.journalDebitsCents)} = {money(out.journalCreditsCents)}</bdi>
          </p>
        </div>

        <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm" aria-label={reportText('r.uniform-document-totals', 'Documents by type')}>
          <p className="font-semibold">{reportText('r.uniform-document-totals', 'Documents by type')}</p>
          <RowTable
            rowClassName="border-b border-[var(--line)]/50"
            caption={reportText('r.uniform-document-totals', 'Documents by type')}
            rows={out.documentTypeTotals}
            empty={<EmptyState title={reportText('r.uniform-no-documents', 'No documents in this year')} description={reportText('r.uniform-no-documents-help', 'Invoices, bills and credits issued in the chosen year appear here.')} />}
            rowKey={row => row.documentType}
            captionClassName="sr-only"
            tableClassName="w-full text-sm"
            headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
            bodyClassName=""
            columns={[
              { header: reportText('r.uniform-document-type', 'Type'), className: 'py-1 px-2 font-mono', headClassName: `text-left ${th}`, cell: row => row.documentType },
              { header: reportText('r.uniform-count', 'Count'), align: 'right', className: 'py-1 px-2 font-mono', headClassName: `text-right ${th}`, cell: row => row.count },
              { header: reportText('r.uniform-total-incl-vat', 'Total incl. VAT'), align: 'right', className: 'py-1 px-2', headClassName: `text-right ${th}`, cell: row => money(row.totalInclVatCents) },
              { header: reportText('r.uniform-vat-amount', 'VAT'), align: 'right', className: 'py-1 px-2', headClassName: `text-right ${th}`, cell: row => money(row.vatAmountCents) },
            ]}
          />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">{reportText('r.record-layouts', 'Record layouts')}</h3>
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
          <RowTable
            rowClassName="border-b border-[var(--line)]/50"
            caption={reportText('r.record-layouts', 'Record layouts')}
            rows={layouts}
            empty={(
              <EmptyState
                title={reportText('r.uniform-no-layouts', 'Research layouts are unavailable')}
                description={reportText('r.uniform-refresh-layouts', 'Refresh this page. If the layouts are still missing, report the problem. This research screen cannot produce an export.')}
              />
            )}
            rowKey={(row) => row.code}
            captionClassName="text-left font-semibold text-[var(--text)] pb-1"
            tableClassName="w-full text-sm"
            headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
            bodyClassName=""
            columns={[
              { header: reportText('r.record', 'Record'), className: 'py-1 px-2 font-mono', headClassName: `text-left ${th}`, cell: (row) => row.code },
              { header: reportText('r.uniform-width', 'Width'), align: 'right', className: 'py-1 px-2 font-mono', headClassName: `text-right ${th}`, cell: (row) => row.width },
              { header: reportText('r.uniform-fields', 'Fields'), align: 'right', className: 'py-1 px-2 font-mono', headClassName: `text-right ${th}`, cell: (row) => row.fields.length },
            ]}
          />
        </div>
        <p className="text-xs text-[var(--muted)]">
          {reportText('r.system-constant', 'System constant')}: <span className="font-mono">{UNIFORM_SYSTEM_CONSTANT}</span>
        </p>
      </div>
    </section>
  );
}
