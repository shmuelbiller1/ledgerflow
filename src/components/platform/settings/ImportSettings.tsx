import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, Download, FileUp, History, Loader2, Undo2, Upload } from 'lucide-react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { db, getIdToken } from '../../../firebase';
import { collection, getDocs, limit, orderBy, query, where } from '../../../lib/db/firestore';
import { parseCsvChecked } from '../../../lib/csv';
import { assertReadableText } from '../../../lib/bankCsvRows';
import { parseExcelToRows } from '../../../lib/excelExport';
import { cn, formatCurrency, getLocalDateISO } from '../../../lib/utils';
import {
  IMPORT_DEFINITIONS, IMPORT_KINDS, MAX_IMPORT_ROWS, applyMapping, guessMapping, openingStockCents, prepareImport,
} from '../../../lib/recordImport';
import type { FieldMapping, ImportIssue, ImportKind } from '../../../lib/recordImport';
import { downloadCsv } from '../../../lib/csvExport';
import { normalizeFreshBooksCsv } from '../../../lib/freshBooksImport';
import { normalizeQuickBooksCsv } from '../../../lib/quickBooksCsvImport';
import { normalizeXeroCsv } from '../../../lib/xeroChartContactsImport';
import { normalizeWaveCsv } from '../../../lib/waveImport';
import { normalizeZohoBooksCsv } from '../../../lib/zohoBooksImport';
import { normalizeSage50Csv } from '../../../lib/sage50Import';
import { readIif, type IifReadResult } from '../../../lib/iifImport';
import {
  contactImportDuplicates, googleContactsToContactTable, isGoogleContactsHeader, vCardToContactTable,
  type ContactFileRead,
} from '../../../lib/contactFileImport';
import type { ReviewContact } from '../../../lib/contactDuplicateReview';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useLedgerCollections } from '../../../hooks/useLedgerCollections';
import { reconcileImportCounts } from '../../../lib/importCountReconciliation';
import { cleanupContactImportRows } from '../../../lib/contactImportCleanup';
import { MigrationTrialBalanceProof } from './MigrationTrialBalanceProof';
import ContactImportQualityReview from './ContactImportQualityReview';
import XeroDocumentsImport from './XeroDocumentsImport';
import { inBackground } from '../../../lib/inBackground';

/** PREV-6: a garbled (non-UTF-8) or cut-off CSV is refused whole, with a message. */
const readCsvUpload = (text: string): string[][] => {
  assertReadableText(text);
  return parseCsvChecked(text);
};

type CsvSource = 'generic' | 'freshbooks' | 'quickbooks' | 'iif' | 'xero' | 'wave' | 'zoho' | 'sage';
const normalizeSourceTable = (source: CsvSource, kind: ImportKind, cells: string[][]): string[][] =>
  source === 'freshbooks' ? normalizeFreshBooksCsv(kind, cells) :
  source === 'quickbooks' ? normalizeQuickBooksCsv(kind, cells) :
  source === 'xero' ? normalizeXeroCsv(kind, cells) :
  source === 'wave' ? normalizeWaveCsv(kind, cells) :
  source === 'zoho' ? normalizeZohoBooksCsv(kind, cells) :
  source === 'sage' ? normalizeSage50Csv(kind, cells) : cells;
// E-29: an IIF carries several list sections at once, so the file is read once and its section for
// the chosen kind is used (readIif in src/lib/iifImport.ts).

/**
 * Settings → Import data (K-01): customers, vendors, items or accounts from a CSV or Excel file.
 * The file is read in the browser, columns are matched by header name (changeable), every row is
 * checked with the same rules the server uses (src/lib/recordImport.ts), and the server saves
 * all rows at once or none. Recent imports can be undone.
 */

interface ImportResult {
  batchId: string | null;
  created: number;
  skipped: ImportIssue[];
  openingStockCents: number;
  dryRun: boolean;
}

interface RecentImport {
  batchId: string;
  description: string;
  timestamp: string;
}

const KIND_HELP: Record<ImportKind, string> = {
  customers: 'Name, email, phone, address, tax ID, terms…',
  vendors: 'Name, email, phone, address, category, 1099…',
  items: 'Name, SKU, price, cost, quantity on hand…',
  accounts: 'Name, code, type (asset, bank, income…)',
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || 'The request failed') as Error & { issues?: ImportIssue[] };
    if (Array.isArray(data.details) && data.details.every((d: unknown) => typeof (d as ImportIssue)?.row === 'number')) error.issues = data.details;
    throw error;
  }
  return data as T;
}

async function loadRecentImports(workspaceId: string): Promise<RecentImport[]> {
  if (!workspaceId) return [];
  try {
    const snap = await getDocs(query(collection(db, 'auditLogs'), where('workspaceId', '==', workspaceId), where('action', '==', 'records_imported'), orderBy('timestamp', 'desc'), limit(8)));
    return snap.docs.map(d => {
      const data = d.data();
      return { batchId: String(data.entityId || ''), description: String(data.details?.description || 'Import'), timestamp: String(data.timestamp || '') };
    }).filter(r => r.batchId.startsWith('imp_'));
  } catch {
    return [];
  }
}

function downloadSample(kind: ImportKind) {
  downloadCsv(`${kind}-import-template.csv`, IMPORT_DEFINITIONS[kind].fields.map(f => f.label), []);
}

export default function ImportSettings() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const role = useCurrentRole();
  const canImport = role !== 'viewer';
  const canImportAccounts = role === 'owner' || role === 'accountant';

  const [kind, setKind] = useState<ImportKind>('customers');
  const [source, setSource] = useState<CsvSource>('generic');
  const [fileName, setFileName] = useState('');
  const [rawTable, setRawTable] = useState<string[][]>([]);
  const [iif, setIif] = useState<IifReadResult | null>(null);
  // A-182: an address-book file (vCard / Google Contacts CSV) already converted to import columns.
  const [contactFile, setContactFile] = useState<ContactFileRead | null>(null);
  const table = useMemo(
    () => (iif ? iif.tables[kind] : contactFile ? contactFile.table : normalizeSourceTable(source, kind, rawTable)),
    [iif, kind, source, rawTable, contactFile],
  );
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [phoneCountry, setPhoneCountry] = useState('');
  const [acceptEmailSuggestions, setAcceptEmailSuggestions] = useState(false);
  const [acceptPhoneSuggestions, setAcceptPhoneSuggestions] = useState(false);
  const [openingDate, setOpeningDate] = useState(() => getLocalDateISO());
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importCountSnapshot, setImportCountSnapshot] = useState<{ sourceRows: number; preparedRows: number } | null>(null);
  const [serverIssues, setServerIssues] = useState<ImportIssue[]>([]);
  const [recent, setRecent] = useState<RecentImport[]>([]);
  const [recentVersion, setRecentVersion] = useState(0);

  const definition = IMPORT_DEFINITIONS[kind];
  const columns = useMemo(() => (table[0] || []).map((name, position) => ({ name, position })), [table]);
  const mappedRows = useMemo(() => applyMapping(kind, table.slice(1), mapping), [kind, table, mapping]);
  const contactCleanup = useMemo(() => cleanupContactImportRows(kind, mappedRows, phoneCountry, {
    acceptEmailSuggestions,
    acceptPhoneSuggestions,
  }), [kind, mappedRows, phoneCountry, acceptEmailSuggestions, acceptPhoneSuggestions]);
  const rows = contactCleanup.rows;
  const prepared = useMemo(() => prepareImport(kind, rows), [kind, rows]);
  const stockCents = kind === 'items' ? openingStockCents(prepared.records) : 0;
  const issues = serverIssues.length > 0 ? serverIssues : prepared.errors;
  const tooMany = rows.length > MAX_IMPORT_ROWS;
  const countProof = result && importCountSnapshot ? reconcileImportCounts({
    ...importCountSnapshot, created: result.created, skipped: result.skipped.length,
  }) : null;
  const ready = table.length > 1 && prepared.errors.length === 0 && prepared.records.length > 0 && !tooMany;

  // A-182: pre-import duplicate check against the records already in this workspace.
  const { loading: contactsLoading } = useLedgerCollections('customers', 'vendors');
  const storeCustomers = useLedgerStore(s => s.customers);
  const storeVendors = useLedgerStore(s => s.vendors);
  const duplicateCheck = useMemo(() => {
    if ((kind !== 'customers' && kind !== 'vendors') || prepared.records.length === 0) return null;
    const sourceList = kind === 'customers' ? storeCustomers : storeVendors;
    const existing: ReviewContact[] = sourceList
      .filter(c => !workspaceId || (c as { workspaceId?: string }).workspaceId === workspaceId || !(c as { workspaceId?: string }).workspaceId)
      .map(c => ({
        id: c.id,
        kind: kind === 'customers' ? 'customer' : 'vendor',
        name: c.name ?? '',
        email: (c as { email?: string }).email,
        phone: (c as { phone?: string }).phone,
        taxId: (c as { taxId?: string }).taxId,
      }));
    const incoming = prepared.records.map(r => ({
      row: r.row,
      name: String(r.data.name ?? ''),
      email: r.data.email != null ? String(r.data.email) : undefined,
      phone: r.data.phone != null ? String(r.data.phone) : undefined,
      taxId: r.data.taxId != null ? String(r.data.taxId) : undefined,
    }));
    return contactImportDuplicates(kind, incoming, existing);
  }, [kind, prepared, storeCustomers, storeVendors, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    inBackground(loadRecentImports(workspaceId).then(list => { if (!cancelled) setRecent(list); }));
    return () => { cancelled = true; };
  }, [workspaceId, recentVersion]);
  const loadRecent = () => setRecentVersion(v => v + 1);

  const resetResults = () => {
    setCheck(null);
    setResult(null);
    setImportCountSnapshot(null);
    setServerIssues([]);
  };

  const resetContactCleanupAcceptance = () => {
    setAcceptEmailSuggestions(false);
    setAcceptPhoneSuggestions(false);
  };

  const chooseKind = (next: ImportKind) => {
    // A-182: an address book only ever becomes customers or vendors — say so instead of going blank.
    if (contactFile && next !== 'customers' && next !== 'vendors') {
      toast.error('This address-book file imports as customers or vendors. Choose a different file for items or accounts.');
      return;
    }
    setKind(next);
    resetContactCleanupAcceptance();
    const preview = iif ? iif.tables[next] : contactFile ? contactFile.table : normalizeSourceTable(source, next, rawTable);
    setMapping(preview.length ? guessMapping(next, preview[0]) : {});
    resetResults();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    resetResults();
    resetContactCleanupAcceptance();
    setPhoneCountry('');
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.iif') || lower.endsWith('.qbi')) {
        const read = readIif(await file.text());
        setFileName(file.name);
        setIif(read);
        setContactFile(null);
        setRawTable([]);
        setSource('iif');
        const rowsForKind = read.tables[kind];
        setMapping(rowsForKind.length ? guessMapping(kind, rowsForKind[0]) : {});
        if (!read.counts[kind]) toast.error(`This IIF has no ${definition.label.toLowerCase()} section. Choose the type that the file does contain.`);
        return;
      }
      // A-182: a vCard address book (.vcf from a phone, Outlook or Apple Contacts).
      if (lower.endsWith('.vcf')) {
        if (kind !== 'customers' && kind !== 'vendors') {
          toast.error('An address-book file imports as customers or vendors. Choose one of those types first.');
          return;
        }
        const read = vCardToContactTable(await file.text());
        setFileName(file.name);
        setIif(null);
        setContactFile(read);
        setRawTable([]);
        setMapping(guessMapping(kind, read.table[0]));
        if (read.table.length < 2) toast.error(read.problems[0] ?? 'No contacts could be read from this file.');
        return;
      }
      setIif(null);
      const cells = lower.endsWith('.xlsx')
        ? (await parseExcelToRows(await file.arrayBuffer())).map(r => r.map(c => (c === null || c === undefined ? '' : String(c).trim())))
        : readCsvUpload(await file.text());
      if (cells.length < 2) {
        toast.error('The file needs a header row and at least one row of data.');
        return;
      }
      setFileName(file.name);
      setRawTable(cells);
      // A-182: a Google Contacts CSV is recognised by its own column names and reshaped.
      if ((kind === 'customers' || kind === 'vendors') && isGoogleContactsHeader(cells[0] ?? [])) {
        const read = googleContactsToContactTable(cells);
        setContactFile(read);
        setMapping(guessMapping(kind, read.table[0]));
        if (read.table.length < 2) toast.error(read.problems[0] ?? 'No contacts could be read from this file.');
        return;
      }
      setContactFile(null);
      const converted = normalizeSourceTable(source, kind, cells);
      setMapping(guessMapping(kind, converted[0]));
    } catch (err) {
      toast.error(`The file could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const send = async (dryRun: boolean) => {
    setBusy(true);
    setServerIssues([]);
    try {
      const body = { kind, rows, dryRun, ...(stockCents > 0 ? { openingDate } : {}) };
      const res = await post<ImportResult>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/import-records`, body);
      if (dryRun) {
        setCheck(res);
      } else {
        setResult(res);
        setImportCountSnapshot({ sourceRows: rows.length, preparedRows: prepared.records.length });
        setCheck(null);
        setRawTable([]);
        setFileName('');
        toast.success(`Imported ${res.created} ${definition.label.toLowerCase()}${res.skipped.length ? ` (${res.skipped.length} already existed)` : ''}.`);
        loadRecent();
      }
    } catch (err) {
      const issuesFromServer = (err as { issues?: ImportIssue[] }).issues;
      if (issuesFromServer) setServerIssues(issuesFromServer);
      toast.error(err instanceof Error ? err.message : 'The import failed');
    } finally {
      setBusy(false);
    }
  };

  const undo = async (batchId: string) => {
    setBusy(true);
    try {
      const res = await post<{ removed: number; kept: string[] }>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/import-records/${encodeURIComponent(batchId)}/undo`, {});
      toast.success(`Removed ${res.removed} imported record${res.removed === 1 ? '' : 's'}${res.kept.length ? `; kept ${res.kept.length} already in use (${res.kept.slice(0, 3).join(', ')}${res.kept.length > 3 ? '…' : ''})` : ''}.`);
      if (result?.batchId === batchId) setResult(null);
      loadRecent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The import could not be undone');
    } finally {
      setBusy(false);
    }
  };

  if (!canImport) {
    return (
      <div className="ledger-card p-8 bg-[var(--surface)] border border-[var(--line)] rounded-2xl text-sm text-[var(--muted)]">
        Importing data needs the bookkeeper, accountant or owner role.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="ledger-card p-6 md:p-8 bg-[var(--surface)] border border-[var(--line)] shadow-sm rounded-2xl space-y-6" aria-labelledby="import-title">
        <div className="flex items-center gap-4 border-b border-[var(--line)] pb-5">
          <div className="w-12 h-12 bg-[var(--brass-soft)] border border-[var(--brass-line)] text-[var(--brass)] rounded-xl flex items-center justify-center">
            <Upload size={22} aria-hidden="true" />
          </div>
          <div>
            <h2 id="import-title" className="text-xl font-bold text-[var(--text)]">Import data</h2>
            <p className="text-xs text-[var(--muted)]">Bring in customers, vendors, items or your chart of accounts from a spreadsheet (CSV or Excel). Nothing is saved until every row is correct.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs font-bold flex flex-col gap-1">CSV source
            <select aria-label="CSV source" value={source} onChange={e => {
              const next: CsvSource = (['freshbooks', 'quickbooks', 'iif', 'xero', 'wave', 'zoho', 'sage'] as const).includes(e.target.value as never)
                ? e.target.value as CsvSource : 'generic';
              if (next !== 'iif') setIif(null);
              setContactFile(null);
              setPhoneCountry('');
              resetContactCleanupAcceptance();
              setSource(next);
              const converted = normalizeSourceTable(next, kind, rawTable);
              setMapping(converted.length ? guessMapping(kind, converted[0]) : {});
              resetResults();
            }} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-sm">
              <option value="generic">Standard spreadsheet / CSV template</option><option value="freshbooks">FreshBooks CSV</option><option value="quickbooks">QuickBooks Online CSV</option><option value="iif">QuickBooks Desktop IIF</option><option value="xero">Xero CSV (chart or contacts)</option><option value="wave">Wave customers CSV</option><option value="zoho">Zoho Books CSV</option><option value="sage">Sage 50 CSV</option>
            </select>
          </label>
          {source === 'freshbooks' && <p className="text-xs text-[var(--muted)]">Choose a FreshBooks Clients, Vendors, or Items export. We combine name and address columns for preview, then use the normal validated import. No transactions are imported. <a className="underline" href="https://support.freshbooks.com/hc/en-us/articles/360032628152-How-do-I-export-my-data" target="_blank" rel="noopener noreferrer">Export instructions</a>.</p>}
          {source === 'iif' && <p className="text-xs text-[var(--muted)]">Choose the <strong>.iif</strong> file QuickBooks Desktop writes (File → Utilities → Export → Lists). Accounts, customers, vendors and items are read; the file&rsquo;s journals, invoices, bills and payments are <strong>not</strong> imported — a list import never posts. Nothing is guessed: a row with an unknown account type or no name is listed with its line number.</p>}
          {source === 'quickbooks' && <p className="text-xs text-[var(--muted)]">Choose a QuickBooks Online Account List, Customer Contact List, Vendor Contact List, or Products &amp; Services export. Put headers on the first row; review mappings and check before importing. Account balances, existing stock quantities and transactions are not carried over. <a className="underline" href="https://quickbooks.intuit.com/learn-support/en-us/help-article/list-management/export-reports-lists-data-quickbooks-online/L1xleDrLp_US_en_US" target="_blank" rel="noopener noreferrer">QBO export instructions</a>.</p>}
          {source === 'xero' &&<p className="text-xs text-[var(--muted)]">Choose a Xero <strong>Chart of Accounts export</strong> (Accounting → Chart of accounts → Export) as &ldquo;Accounts&rdquo;, or a Xero <strong>contacts</strong> CSV as &ldquo;Customers&rdquo; or &ldquo;Vendors&rdquo; — a Xero contacts file is mixed, and you pick the list. Columns are read by their documented names; required columns missing from a re-arranged file fail the check rather than being guessed. Xero invoice/bill exports use the panel below instead. No balances, YTD figures or transactions are imported. <a className="underline" href="https://central.xero.com/0/article/Export-or-print-your-chart-of-accounts" target="_blank" rel="noopener noreferrer">Xero Central export steps</a>.</p>}
          {source === 'wave' && <p className="text-xs text-[var(--muted)]">Choose the customers CSV Wave exports (Sales &amp; Payments → Customers → Import or Export) as &ldquo;Customers&rdquo;. Wave has no vendor CSV export to key on, and a Wave chart-of-accounts CSV already reads through the standard spreadsheet source — its account-type names are recognised. Wave&rsquo;s accountants&rsquo; download is transactions, never imported here. <a className="underline" href="https://support.waveapps.com/hc/en-us/articles/208623076-Import-a-customer-list" target="_blank" rel="noopener noreferrer">Wave&rsquo;s customer CSV columns</a>.</p>}
          {source === 'zoho' && <p className="text-xs text-[var(--muted)]">Choose a Zoho Books export (Customers, Vendors, Items, or Chart of Accounts). Zoho&rsquo;s export fields are the user&rsquo;s choice, so the reader keys on Zoho&rsquo;s documented field names; an export whose fields don&rsquo;t include a required column fails the check instead of being guessed, and a Zoho-specific account type (for example Payment Clearing Account) is listed as a row to fix, never reclassified. Item prices and purchase rates import as catalogue figures — stock quantities are never staged. <a className="underline" href="https://www.zoho.com/us/books/help/import-export/export.html" target="_blank" rel="noopener noreferrer">Zoho export steps</a>.</p>}
          {source === 'sage' && <p className="text-xs text-[var(--muted)]">Choose a Sage 50 (US) export written by Select Import/Export (CUSTOMER.CSV, VENDOR.CSV, CHART.CSV or ITEM.CSV). The chart&rsquo;s numeric account-type code is translated only through Sage&rsquo;s documented table; codes with no LedgerFlow counterpart (retainage, accumulated depreciation) are left for you to fix in the preview, and the export-only columns (current balance, period totals) are never imported. <a className="underline" href="https://help-sage50.na.sage.com/en-us/2023/Content/Importing_Exporting/Import_Export_Fields/IEFIELDS_Chart_of_Accounts.htm" target="_blank" rel="noopener noreferrer">Sage 50 export field lists</a>.</p>}

          {contactFile && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 space-y-1" role="status">
              <p className="text-xs text-[var(--text)]">
                Address book read: <strong>{contactFile.table.length - 1}</strong> contact{contactFile.table.length === 2 ? '' : 's'}. Extra email addresses and phone numbers were kept in each contact&rsquo;s notes, not dropped.
              </p>
              {contactFile.problems.length > 0 && (
                <ul className="text-xs text-rose-600 space-y-0.5" aria-label="Contacts that were not imported">
                  {contactFile.problems.map(problem => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {iif && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 space-y-1" role="status">
              <p className="text-xs text-[var(--text)]">
                IIF read: <strong>{iif.counts.accounts}</strong> accounts · <strong>{iif.counts.customers}</strong> customers ·{' '}
                <strong>{iif.counts.vendors}</strong> vendors · <strong>{iif.counts.items}</strong> items.
              </p>
              {iif.transactionsRefused > 0 && (
                <p className="text-xs text-amber-700" role="alert">
                  This file also holds <strong>{iif.transactionsRefused}</strong> transaction record{iif.transactionsRefused === 1 ? '' : 's'} (journals, invoices, bills or payments). They were <strong>not</strong> imported: this import moves lists only and never posts.
                </p>
              )}
              {iif.unknownSections.length > 0 && (
                <p className="text-xs text-[var(--muted)]">Not imported (sections this import does not handle): {iif.unknownSections.join(', ')}.</p>
              )}
              {iif.skipped.length > 0 && (
                <ul className="text-xs text-rose-600 space-y-0.5" aria-label="IIF rows that were not imported">
                  {iif.skipped.map(entry => (
                    <li key={`iif-${entry.line}-${entry.type}`}>Line {entry.line} ({entry.type}): {entry.reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <fieldset className="space-y-3">
          <legend className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">1. What are you importing?</legend>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {IMPORT_KINDS.map(k => {
              const disabled = k === 'accounts' && !canImportAccounts;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  disabled={disabled}
                  title={disabled ? 'Only owners and accountants can change the chart of accounts' : undefined}
                  onClick={() => chooseKind(k)}
                  className={cn(
                    'text-left p-4 rounded-xl border transition-colors disabled:opacity-50',
                    kind === k ? 'border-[var(--brass)] bg-[var(--brass-soft)]' : 'border-[var(--line)] bg-[var(--panel)] hover:border-[var(--brass-line)]',
                  )}
                >
                  <span className="block font-bold text-sm text-[var(--text)]">{IMPORT_DEFINITIONS[k].label}</span>
                  <span className="block text-[11px] text-[var(--muted)] mt-1">{KIND_HELP[k]}</span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => downloadSample(kind)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brass)] hover:underline">
            <Download size={14} aria-hidden="true" /> Download an empty {definition.label.toLowerCase()} template
          </button>
        </fieldset>

        <div className="space-y-2">
          <label htmlFor="import-file" className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] block">2. Choose the file</label>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              id="import-file"
              type="file"
              accept=".csv,.txt,.xlsx,.iif,.qbi,.vcf,text/csv,text/vcard"
              onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ''; }}
              className="text-sm text-[var(--text)] file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border file:border-[var(--line)] file:bg-[var(--panel)] file:text-[var(--text)]"
            />
            {fileName && (
              <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <FileUp size={14} aria-hidden="true" /> {fileName} · {table.length - 1} row{table.length === 2 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--muted)]">The first row must be the column names. Up to {MAX_IMPORT_ROWS} rows per file. For customers and vendors you can also choose an address book: a vCard (.vcf) from your phone, Outlook or Apple Contacts, or the CSV Google Contacts exports — names, emails, phones and addresses are matched for you and every contact is still checked before anything is saved.</p>
        </div>

        {table.length > 1 && (
          <fieldset className="space-y-3">
            <legend className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">3. Match the columns</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {definition.fields.map(field => (
                <div key={field.key} className="space-y-1">
                  <label htmlFor={`map-${field.key}`} className="text-xs font-semibold text-[var(--text)]">
                    {field.label}{field.required ? ' *' : ''}
                  </label>
                  <select
                    id={`map-${field.key}`}
                    value={mapping[field.key] ?? -1}
                    onChange={e => {
                      setMapping({ ...mapping, [field.key]: Number(e.target.value) });
                      resetContactCleanupAcceptance();
                      resetResults();
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]"
                  >
                    <option value={-1}>(not in the file)</option>
                    {columns.map(c => <option key={c.position} value={c.position}>{c.name || `Column ${c.position + 1}`}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </fieldset>
        )}

        {table.length > 1 && (
          <div className="space-y-4" aria-live="polite">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">4. Check and import</h3>
            <p className="text-sm text-[var(--text)]">
              <strong>{prepared.records.length}</strong> row{prepared.records.length === 1 ? '' : 's'} ready
              {issues.length > 0 && <>, <strong className="text-[var(--neg)]">{new Set(issues.map(i => i.row)).size}</strong> with problems (fix them in the file and choose it again)</>}.
              {tooMany && <span className="text-[var(--neg)]"> The file has more than {MAX_IMPORT_ROWS} rows; split it.</span>}
            </p>

            {(kind === 'customers' || kind === 'vendors') && prepared.records.length > 0 && (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 space-y-2">
                <h4 className="text-xs font-bold text-[var(--text)]">Duplicate check</h4>
                {contactsLoading || !duplicateCheck ? (
                  <p className="text-xs text-[var(--muted)]">Still loading your existing {kind === 'customers' ? 'customers' : 'vendors'} — the check against them will appear here before you import.</p>
                ) : (
                  <>
                    {duplicateCheck.willSkipTotal === 0 && duplicateCheck.possibleTotal === 0 && (
                      <p className="text-xs text-[var(--muted)]">No row matches an existing {kind === 'customers' ? 'customer' : 'vendor'} by name, email address, phone number or tax ID.</p>
                    )}
                    {duplicateCheck.willSkipTotal > 0 && (
                      <>
                        <p className="text-xs text-[var(--text)]"><strong>{duplicateCheck.willSkipTotal}</strong> row{duplicateCheck.willSkipTotal === 1 ? '' : 's'} {duplicateCheck.willSkipTotal === 1 ? 'has' : 'have'} exactly the same name as a {kind === 'customers' ? 'customer' : 'vendor'} already here, so the import will skip {duplicateCheck.willSkipTotal === 1 ? 'it' : 'them'} — nobody is created twice.</p>
                        <ul className="text-xs text-[var(--muted)] space-y-0.5" aria-label="Rows that will be skipped as duplicates">
                          {duplicateCheck.willSkip.map(d => (
                            <li key={`skip-${d.row}`}>Row {d.row}: &ldquo;{d.name}&rdquo; matches &ldquo;{d.existingName}&rdquo;</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {duplicateCheck.possibleTotal > 0 && (
                      <>
                        <p className="text-xs text-[var(--text)]"><strong>{duplicateCheck.possibleTotal}</strong> row{duplicateCheck.possibleTotal === 1 ? '' : 's'} share{duplicateCheck.possibleTotal === 1 ? 's' : ''} an email address, phone number or tax ID with an existing {kind === 'customers' ? 'customer' : 'vendor'} but the name is different, so importing <strong>will</strong> create a second record. Check {duplicateCheck.possibleTotal === 1 ? 'it' : 'them'} first:</p>
                        <ul className="text-xs text-[var(--muted)] space-y-0.5" aria-label="Rows that look like existing contacts">
                          {duplicateCheck.possible.map(d => (
                            <li key={`possible-${d.row}`}>Row {d.row}: &ldquo;{d.name}&rdquo; looks like &ldquo;{d.existingName}&rdquo; (same {d.signals.map(s => (s === 'tax-id' ? 'tax ID' : s === 'email' ? 'email address' : 'phone number')).join(' and ')})</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {(kind === 'customers' || kind === 'vendors') && (
              <ContactImportQualityReview
                key={`${fileName}:${kind}`}
                kind={kind}
                sourceRows={mappedRows}
                cleanup={contactCleanup}
                phoneCountry={phoneCountry}
                onPhoneCountryChange={country => {
                  setPhoneCountry(country);
                  setAcceptPhoneSuggestions(false);
                  resetResults();
                }}
                acceptEmailSuggestions={acceptEmailSuggestions}
                acceptPhoneSuggestions={acceptPhoneSuggestions}
                onAcceptEmailSuggestionsChange={accepted => { setAcceptEmailSuggestions(accepted); resetResults(); }}
                onAcceptPhoneSuggestionsChange={accepted => { setAcceptPhoneSuggestions(accepted); resetResults(); }}
              />
            )}

            {issues.length > 0 && (
              <div className="max-h-64 overflow-auto border border-[var(--line)] rounded-xl">
                <table className="w-full text-xs">
                  <caption className="sr-only">Rows with problems</caption>
                  <thead className="bg-[var(--panel)] text-[var(--muted)]">
                    <tr><th scope="col" className="text-left px-3 py-2">Row</th><th scope="col" className="text-left px-3 py-2">Problem</th></tr>
                  </thead>
                  <tbody>
                    {issues.slice(0, 200).map(issue => (
                      <tr key={`${issue.row}:${issue.field ?? ''}:${issue.message}`} className="border-t border-[var(--line)]">
                        <td className="px-3 py-1.5 font-mono">{issue.row}</td>
                        <td className="px-3 py-1.5 text-[var(--text)]"><AlertCircle size={12} className="inline mr-1 text-[var(--neg)]" aria-hidden="true" />{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {prepared.records.length > 0 && (
              <div className="overflow-auto border border-[var(--line)] rounded-xl">
                <table className="w-full text-xs">
                  <caption className="sr-only">First rows to import</caption>
                  <thead className="bg-[var(--panel)] text-[var(--muted)]">
                    <tr>
                      <th scope="col" className="text-left px-3 py-2">Row</th>
                      {definition.fields.filter(f => (mapping[f.key] ?? -1) >= 0).map(f => <th scope="col" key={f.key} className="text-left px-3 py-2">{f.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {prepared.records.slice(0, 5).map(record => (
                      <tr key={record.row} className="border-t border-[var(--line)]">
                        <td className="px-3 py-1.5 font-mono">{record.row}</td>
                        {definition.fields.filter(f => (mapping[f.key] ?? -1) >= 0).map(f => {
                          const value = record.data[f.key];
                          const shown = f.type === 'money' && typeof value === 'number' ? formatCurrency(value) : value === undefined ? '' : String(value);
                          return <td key={f.key} className="px-3 py-1.5 text-[var(--text)]">{shown}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {stockCents > 0 && (
              <div className="p-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] space-y-2">
                <p className="text-xs text-[var(--text)]">
                  Opening stock worth <strong>{formatCurrency(stockCents)}</strong> (quantity × cost) will be recorded in the books:
                  Inventory is increased and Opening Balance Equity is credited, on this date.
                </p>
                <label htmlFor="opening-date" className="text-xs font-semibold text-[var(--text)] mr-2">Opening stock date</label>
                <input id="opening-date" type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)} className="px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-sm text-[var(--text)]" />
              </div>
            )}

            {check && (
              <p className="text-sm text-[var(--text)]">
                Check: {check.created} new {definition.label.toLowerCase()} will be added
                {check.skipped.length > 0 && <> and {check.skipped.length} skipped because they already exist ({check.skipped.slice(0, 3).map(s => s.message.replace(/ already exists$/, '')).join(', ')}{check.skipped.length > 3 ? '…' : ''})</>}.
              </p>
            )}

            <div className="flex gap-3 flex-wrap">
              <button type="button" disabled={!ready || busy} onClick={() => send(true)} className="px-4 py-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm font-semibold text-[var(--text)] disabled:opacity-50">
                Check against existing {definition.label.toLowerCase()}
              </button>
              <button type="button" disabled={!ready || busy} onClick={() => send(false)} className="px-4 py-2 rounded-lg bg-[var(--brass)] text-sm font-bold text-black disabled:opacity-50 inline-flex items-center gap-2">
                {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                Import {prepared.records.length} {definition.label.toLowerCase()}
              </button>
            </div>
          </div>
        )}

        {result && (
          <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 space-y-3" aria-labelledby="import-count-proof-title" aria-live="polite">
            <h3 id="import-count-proof-title" className="text-sm font-bold text-[var(--text)]">Import count comparison</h3>
            <p className="text-xs text-[var(--muted)]">Compares submitted spreadsheet records with the server response for this import. It does not check the trial balance, cash, receivables, payables, taxes or saved ledger amounts.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Source record counts and server-reported import counts</caption>
                <thead><tr className="border-b border-[var(--line)]">
                  <th scope="col" className="py-2 text-left">Measurement</th>
                  <th scope="col" className="py-2 text-right">Count</th>
                </tr></thead>
                <tbody className="text-[var(--text)]">
                  {([
                    ['Source data rows', countProof?.sourceRows],
                    ['Validated rows submitted', countProof?.preparedRows],
                    ['Reported as created', countProof?.created],
                    ['Reported as existing (skipped)', countProof?.skipped],
                    ['Submitted rows not accounted for', countProof?.unexplained],
                  ] as Array<[string, number | undefined]>).map(([label, value]) => (
                    <tr key={label} className="border-b border-[var(--line)]">
                      <th scope="row" className="py-2 text-left font-normal">{label}</th>
                      <td className="py-2 text-right tabular-nums font-mono">{value === undefined ? 'Not available' : value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs font-semibold text-[var(--text)]" role="status">
              {countProof?.status === 'counts-explained' ? 'Counts explained by the server response — financial reconciliation not verified.' :
                countProof?.status === 'review-required' ? 'Count differences need review. Do not treat this as a verified migration.' :
                'Import comparison unavailable. Do not treat this as a verified migration.'}
            </p>
          </section>
        )}

        {result && result.batchId && (
          <div className="p-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] flex items-start justify-between gap-4 flex-wrap" role="status">
            <div className="text-sm text-[var(--text)]">
              <CheckCircle2 size={16} className="inline mr-1.5 text-[var(--pos)]" aria-hidden="true" />
              Imported {result.created} {definition.label.toLowerCase()}.
              {result.skipped.length > 0 && <> Skipped {result.skipped.length} that already existed.</>}
              {result.openingStockCents > 0 && <> Opening stock of {formatCurrency(result.openingStockCents)} recorded.</>}
            </div>
            <button type="button" disabled={busy} onClick={() => undo(String(result.batchId))} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brass)] hover:underline disabled:opacity-50">
              <Undo2 size={14} aria-hidden="true" /> Undo this import
            </button>
          </div>
        )}
      </section>

      <XeroDocumentsImport />

      <MigrationTrialBalanceProof key={workspaceId} workspaceId={workspaceId} />

      {recent.length > 0 && (
        <section className="ledger-card p-6 bg-[var(--surface)] border border-[var(--line)] rounded-2xl space-y-3" aria-labelledby="recent-imports">
          <h2 id="recent-imports" className="text-sm font-bold text-[var(--text)] inline-flex items-center gap-2"><History size={16} aria-hidden="true" /> Recent imports</h2>
          <p className="text-[11px] text-[var(--muted)]">Undo removes the imported records nothing uses yet; records already on invoices, bills or ledger entries are kept.</p>
          <ul className="divide-y divide-[var(--line)]">
            {recent.map(r => (
              <li key={r.batchId} className="py-2 flex items-center justify-between gap-4 text-sm">
                <span className="text-[var(--text)]">{r.description}<span className="block text-[11px] text-[var(--muted)]">{r.timestamp.slice(0, 16).replace('T', ' ')}</span></span>
                <button type="button" disabled={busy} onClick={() => undo(r.batchId)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brass)] hover:underline disabled:opacity-50">
                  <Undo2 size={14} aria-hidden="true" /> Undo
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
