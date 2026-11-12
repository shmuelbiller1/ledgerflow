/**
 * E-58 (P1): the accountant export pack. One action gives the accountant the trial balance, the
 * general ledger, A/R, A/P and tax liability by period, as a ZIP of CSV files (UTF-8 byte-order mark,
 * so Excel shows Hebrew and accents) and as a print/PDF pack.
 *
 * The figures come from the existing report code (`src/lib/accountantExportPack.ts`) — this screen
 * only chooses a period, guards against an incomplete browser cache, and offers the files. It does
 * not post, file, or change a rate.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileArchive, Printer, ShieldCheck } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import { LEDGER_COLLECTIONS } from '../../lib/ledgerCollections';
import type { LedgerKey } from '../../lib/ledgerCollections';
import {
  accountantPackFileName, accountantPackZip, buildAccountantPack, packSlug,
} from '../../lib/accountantExportPack';
import type { AccountantPack, AccountantPackSection } from '../../lib/accountantExportPack';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency, getLocalDateISO, workspaceYearMonth } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';

/** A ledger can hold tens of thousands of lines; the screen and the printed pack show this many, the CSV has every row. */
const LEDGER_PREVIEW_ROWS = 500;

const COLLECTIONS: LedgerKey[] = ['customers', 'vendors', 'invoices', 'bills', 'creditNotes', 'vendorCredits'];

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Rows from this workspace (or with no workspace field, as the demo rows have). */
function scoped<T extends { workspaceId?: string }>(rows: T[], workspaceId: string | null): T[] {
  if (!workspaceId) return rows;
  return rows.filter(row => !row.workspaceId || row.workspaceId === workspaceId);
}

function SectionPreview({ section, currency }: { section: AccountantPackSection; currency: string }) {
  const cut = section.key === 'general-ledger' && section.rows.length > LEDGER_PREVIEW_ROWS;
  const rows = (cut ? section.rows.slice(0, LEDGER_PREVIEW_ROWS) : section.rows).map((cells, rowNumber) => ({
    id: `${section.key}:${rowNumber}`,
    cells: cells.map((cell, column) => ({ id: `${section.key}:${rowNumber}:${column}`, text: String(cell ?? '') })),
  }));
  return (
    <details open className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4" data-accountant-section={section.key}>
      <summary className="cursor-pointer text-sm font-semibold">
        {section.title} · {section.rows.length.toLocaleString('en-US')} row{section.rows.length === 1 ? '' : 's'} · {section.fileName}
      </summary>
      <ul className="mt-2 list-disc ps-5 text-xs text-[var(--muted)]">
        {section.notes.map(note => <li key={note}>{note}</li>)}
      </ul>
      <ReportTableScroll>
        <table className="mt-3 w-full text-xs">
          <caption className="sr-only">{section.title} ({currency})</caption>
          <thead>
            <tr>{section.headers.map(header => <th key={header} scope="col" className="whitespace-nowrap py-1 pe-3 text-start font-semibold">{header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} className="border-t border-[var(--line)]/60">
                {row.cells.map((cell, column) => (
                  <td key={cell.id} className={column === 0 ? 'py-1 pe-3 text-start' : 'py-1 pe-3 text-end tabular-nums'}>
                    {cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ReportTableScroll>
      {cut && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Showing the first {LEDGER_PREVIEW_ROWS.toLocaleString('en-US')} ledger rows. The CSV file in the ZIP holds all{' '}
          {section.rows.length.toLocaleString('en-US')} rows for the period.
        </p>
      )}
    </details>
  );
}

export default function AccountantExportPackView({ startDate: pageStartDate, endDate: pageEndDate }: { startDate?: string; endDate?: string } = {}) {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const isGuest = useAuthStore(s => s.isGuest && !s.user);
  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  const customers = useLedgerStore(s => s.customers);
  const vendors = useLedgerStore(s => s.vendors);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  const vendorCredits = useLedgerStore(s => s.vendorCredits);
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const failed = useDataNeedsStore(s => s.failed);
  const loaded = useDataNeedsStore(s => s.loaded);
  const loadedWorkspaceId = useDataNeedsStore(s => s.loadedWorkspaceId);
  const { loading } = useLedgerCollections('customers', 'vendors', 'invoices', 'bills', 'creditNotes', 'vendorCredits');

  const thisYear = workspaceYearMonth().year;
  // The Reports page period is the default; typing a date is kept, and the pack remembers the dates
  // it was built from, so no effect has to reset state.
  const [chosen, setChosen] = useState<{ start?: string; end?: string }>({});
  const startDate = chosen.start ?? pageStartDate ?? `${thisYear}-01-01`;
  const endDate = chosen.end ?? pageEndDate ?? getLocalDateISO();
  const setStartDate = (value: string) => setChosen(current => ({ ...current, start: value }));
  const setEndDate = (value: string) => setChosen(current => ({ ...current, end: value }));
  const [includeEmptyAccounts, setIncludeEmptyAccounts] = useState(false);
  // The prepared pack remembers the inputs it was built from; changing any of them makes it stale
  // during render, so an old period's figures can never be downloaded.
  const [prepared, setPrepared] = useState<{
    pack: AccountantPack; startDate: string; endDate: string; includeEmptyAccounts: boolean; workspaceId: string | null;
  } | null>(null);
  const pack = prepared && prepared.startDate === startDate && prepared.endDate === endDate
    && prepared.includeEmptyAccounts === includeEmptyAccounts && prepared.workspaceId === workspaceId ? prepared.pack : null;
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const currency = workspace?.currency || 'USD';
  const validPeriod = /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && startDate <= endDate;
  const capped = useMemo(() => isGuest || loading ? [] : ([...COLLECTIONS, 'transactions', 'accounts'] as LedgerKey[])
    .filter(key => isCollectionCapped(truncated, key) || failed[key] || !loaded[key]), [isGuest, loading, truncated, failed, loaded]);
  const blockers = useMemo(() => [
    ...(isGuest ? ['This is the demo workspace: sign in to a real workspace to download an accountant pack.'] : []),
    ...(!workspaceId ? ['Choose a workspace before preparing a pack.'] : []),
    ...(loading ? ['Waiting for this workspace\'s customers, vendors, invoices and bills to load.'] : []),
    ...(!loading && loadedWorkspaceId !== workspaceId ? ['The loaded lists belong to another workspace; open this workspace again before downloading.'] : []),
    ...(capped.length ? [`The browser list is incomplete or failed to load: ${capped.map(key => LEDGER_COLLECTIONS[key].collection).join(', ')}. Retry the load before downloading.`] : []),
    ...(!validPeriod ? ['Choose a valid period: both dates filled in, the start not after the end.'] : []),
  ], [isGuest, workspaceId, loading, loadedWorkspaceId, capped, validPeriod]);

  const canPrepare = blockers.length === 0 && !preparing;

  const prepare = () => {
    if (!canPrepare) return;
    setPreparing(true);
    setError('');
    setPrepared(null);
    // Let the button's "Preparing…" paint before the ledger walk (the pack reuses the report code).
    window.setTimeout(() => {
      try {
        const built = buildAccountantPack({
          workspaceName: workspace?.name || 'Workspace',
          currency,
          startDate,
          endDate,
          asOfDate: getLocalDateISO(),
          generatedAt: new Date().toISOString(),
          accounts: scoped(accounts, workspaceId),
          transactions: scoped(transactions, workspaceId),
          customers: scoped(customers, workspaceId),
          vendors: scoped(vendors, workspaceId),
          invoices: scoped(invoices, workspaceId),
          bills: scoped(bills, workspaceId),
          creditNotes: scoped(creditNotes, workspaceId),
          vendorCredits: scoped(vendorCredits, workspaceId),
          includeEmptyAccounts,
        });
        if (alive.current) setPrepared({ pack: built, startDate, endDate, includeEmptyAccounts, workspaceId });
      } catch (cause) {
        if (alive.current) setError(cause instanceof Error ? cause.message : 'The pack could not be prepared.');
      } finally {
        if (alive.current) setPreparing(false);
      }
    }, 0);
  };

  const money = (cents: number) => formatCurrency(cents, currency);
  const folder = pack ? `accountant-pack-${packSlug(pack.workspaceName)}-${pack.startDate}-to-${pack.endDate}` : '';

  return (
    <section aria-labelledby="accountant-pack-title" className="p-4 min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <FileArchive aria-hidden="true" className="mt-2 h-6 w-6 text-[var(--brass)]" />
          <div>
            <h2 id="accountant-pack-title" className="text-lg font-semibold">Accountant export pack</h2>
            <p className="text-sm text-[var(--muted)]">
              Trial balance, general ledger, A/R, A/P and tax liability by month for the period you choose, in one ZIP of CSV files and one printable pack.
              Read-only: nothing here posts, files a return or changes a rate.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4" data-print-hide>
        <label className="text-xs font-semibold">
          <span className="mb-1 block">From</span>
          <input aria-label="Pack start date" type="date" value={startDate} onChange={event => setStartDate(event.target.value)}
            className="min-h-11 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-semibold">
          <span className="mb-1 block">To</span>
          <input aria-label="Pack end date" type="date" value={endDate} onChange={event => setEndDate(event.target.value)}
            className="min-h-11 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-sm" />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-xs">
          <input type="checkbox" checked={includeEmptyAccounts} onChange={event => setIncludeEmptyAccounts(event.target.checked)} />
          List accounts with no balance and no movement
        </label>
        <button type="button" onClick={prepare} disabled={!canPrepare}
          className="min-h-11 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-semibold disabled:opacity-40">
          {preparing ? 'Preparing…' : pack ? 'Prepare again' : 'Prepare pack'}
        </button>
      </div>

      {blockers.length > 0 && (
        <ul role="alert" aria-label="Why the pack cannot be prepared" className="list-disc ps-5 text-sm text-[var(--muted)]">
          {blockers.map(message => <li key={message}>{message}</li>)}
        </ul>
      )}
      {preparing && <p role="status" className="text-sm text-[var(--muted)]">Reading the ledger and the documents…</p>}
      {error && <p role="alert" className="text-sm text-[var(--neg)]">{error}</p>}

      {!pack && !preparing && blockers.length === 0 && (
        <p className="text-sm text-[var(--muted)]">
          Choose the period the accountant asked for, then prepare. A/R and A/P show what is still open on the day you prepare the pack;
          the tax section groups the period by calendar month.
        </p>
      )}

      {pack && (
        <>
          <div className="flex flex-wrap gap-3" data-print-hide>
            <button type="button" onClick={() => downloadBlob(accountantPackFileName(pack), accountantPackZip(pack))}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--brass)] px-4 py-2 text-sm font-bold text-black">
              <Download aria-hidden="true" className="h-4 w-4" /> Download CSV pack (ZIP)
            </button>
            <button type="button" onClick={() => window.print()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-semibold">
              <Printer aria-hidden="true" className="h-4 w-4" /> Print / Save as PDF
            </button>
            <p className="basis-full text-xs text-[var(--muted)]">
              The ZIP holds {pack.sections.length + 1} files in <code>{folder}</code>: one CSV per section plus a README with the cross-checks.
              Every CSV starts with a UTF-8 byte-order mark. The PDF is your browser's print dialog → Save as PDF, like the other report packs.
            </p>
          </div>

          <div data-print-root className="space-y-4">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm">
              <h3 className="text-base font-semibold"><bdi dir="auto">{pack.workspaceName}</bdi> · {pack.startDate} – {pack.endDate}</h3>
              <p className="text-xs text-[var(--muted)]">
                Prepared {pack.generatedAt.slice(0, 16).replace('T', ' ')} UTC · A/R and A/P open balances read on {pack.asOfDate} · {currency} · format {pack.format}
              </p>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-[var(--muted)]">Trial balance debits / credits</dt>
                  <dd className="font-semibold tabular-nums">{money(pack.totals.debitCents)} / {money(pack.totals.creditCents)}{pack.totals.debitCents === pack.totals.creditCents ? '' : ' — not equal'}</dd></div>
                <div><dt className="text-xs text-[var(--muted)]">Accounts receivable open</dt><dd className="font-semibold tabular-nums">{money(pack.totals.receivableCents)}</dd></div>
                <div><dt className="text-xs text-[var(--muted)]">Accounts payable open</dt><dd className="font-semibold tabular-nums">{money(pack.totals.payableCents)}</dd></div>
                <div><dt className="text-xs text-[var(--muted)]">Tax liability for the period (negative: to reclaim)</dt><dd className="font-semibold tabular-nums">{money(pack.totals.taxDueCents)}</dd></div>
              </dl>
              <p className="mt-3 inline-flex items-start gap-2 text-xs text-[var(--muted)]">
                <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4" />
                Built from the records loaded for this workspace. If a list reached its limit, the download is blocked above instead of shipping an incomplete pack.
                Review the figures with your accountant; this is not a statutory filing.
              </p>
              {pack.warnings.length > 0 && (
                <ul role="alert" aria-label="Pack warnings" className="mt-3 list-disc ps-5 text-sm text-[var(--neg)]">
                  {pack.warnings.map(warning => <li key={warning}>{warning}</li>)}
                </ul>
              )}
            </div>

            {pack.sections.map(section => (
              <div key={section.key} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2" data-print-hide>
                  <h3 className="text-sm font-semibold">{section.title}</h3>
                  <button type="button" onClick={() => downloadCsv(section.fileName, section.headers, section.rows)}
                    className="min-h-11 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold">
                    Download {section.fileName}
                  </button>
                </div>
                <SectionPreview section={section} currency={currency} />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
