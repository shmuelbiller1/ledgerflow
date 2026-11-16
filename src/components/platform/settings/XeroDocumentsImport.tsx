/**
 * E-28: Settings → Import data → **Xero invoices and bills**.
 *
 * Reads a Xero "Sales invoices" or "Bills" CSV in the browser, matches every contact to an existing
 * customer/vendor and every account code to the chart of accounts, shows what will be created, and
 * saves the documents as **drafts** (`status: 'draft'`, `posted: false`). A draft posts no ledger
 * entries — see src/services/ledgerPost/invoicePosting.ts, which returns before building any line for
 * a draft. Sending, approving and paying stay deliberate steps in Sales / Bills.
 */
import React, { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { useLedgerCollections } from '../../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../../hooks/useEntityOperations';
import { cn, formatCurrency } from '../../../lib/utils';
import { readXeroDocumentsCsv, type XeroDateOrder, type XeroDocumentKind, type XeroDraftDocument } from '../../../lib/xeroDocumentsImport';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { allSettledWrites } from '../../../lib/serverAction';
import { RowTable } from '../../ui/RowTable';

const KIND_LABEL: Record<XeroDocumentKind, string> = { invoices: 'Sales invoices', bills: 'Bills' };

/** What one draft is saved as. Kept structural so a test can assert the exact record. */
export interface XeroDraftPayload {
  number: string;
  customerId?: string;
  customerName?: string;
  vendorId?: string;
  vendorName?: string;
  date: string;
  dueDate: string;
  reference?: string;
  amountCents: number;
  amountPaidCents: number;
  taxAmountCents: number;
  taxVersion: 2;
  lineSumCents: number;
  pricesIncludeTax: false;
  currency: string;
  items: Array<{ id: string; description: string; quantity: number; rateCents: number; amountCents: number; accountId: string }>;
  status: 'draft';
  posted: false;
  metadata: { source: string; importedAt: string };
}

interface Ready extends XeroDraftDocument {
  contactId: string;
  items: Array<{ id: string; description: string; quantity: number; rateCents: number; amountCents: number; accountId: string }>;
}

export interface XeroDocumentsImportProps {
  /** Injected by tests; the screen uses the app's own save path. Returns how many were saved. */
  onSave?: (documents: XeroDraftPayload[]) => Promise<number>;
}

export default function XeroDocumentsImport({ onSave }: XeroDocumentsImportProps) {
  const role = useCurrentRole();
  const canImport = role !== 'viewer';
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const currency = workspace?.currency || 'USD';
  const { addEntity } = useEntityOperations();
  const { loading } = useLedgerCollections('customers', 'vendors', 'invoices', 'bills', 'accounts');

  const customers = useLedgerStore(s => s.customers);
  const vendors = useLedgerStore(s => s.vendors);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const accounts = useLedgerStore(s => s.accounts);

  const [kind, setKind] = useState<XeroDocumentKind>('invoices');
  const [dateOrder, setDateOrder] = useState<XeroDateOrder | ''>('');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof readXeroDocumentsCsv> | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accountByCode = useMemo(() => {
    const map = new Map<string, { id: string }>();
    for (const account of accounts || []) {
      if (account.code) map.set(String(account.code).trim(), { id: account.id });
    }
    return map;
  }, [accounts]);

  const contacts = kind === 'invoices' ? customers : vendors;
  const contactByName = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const contact of contacts || []) {
      const key = String(contact.name || '').trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, { id: contact.id, name: contact.name });
    }
    return map;
  }, [contacts]);

  const existingNumbers = useMemo(
    () => (kind === 'invoices' ? invoices : bills)?.map(doc => String(doc.number || '')).filter(Boolean) || [],
    [kind, invoices, bills],
  );

  /** What would be created, and what stops a document: computed during render, never stored. */
  const preview = useMemo(() => {
    if (!parsed) return { ready: [] as Ready[], payloads: [] as XeroDraftPayload[], blocked: [] as Array<{ number: string; reason: string }> };
    const ready: Ready[] = [];
    const blocked: Array<{ number: string; reason: string }> = [];
    for (const doc of parsed.documents) {
      const contact = contactByName.get(doc.contactName.trim().toLowerCase());
      if (!contact) {
        blocked.push({ number: doc.number, reason: `"${doc.contactName}" is not in ${kind === 'invoices' ? 'Customers' : 'Vendors'}. Import the ${kind === 'invoices' ? 'customer' : 'vendor'} list first (Settings → Import data).` });
        continue;
      }
      const missing = doc.lines.map(line => line.accountCode).filter(code => !accountByCode.has(code));
      if (missing.length) {
        blocked.push({ number: doc.number, reason: `Account code ${[...new Set(missing)].join(', ')} is not in the chart of accounts.` });
        continue;
      }
      ready.push({
        ...doc,
        contactId: contact.id,
        items: doc.lines.map((line, index) => ({
          id: `${doc.number}-${index + 1}`,
          description: line.description,
          quantity: line.quantity,
          rateCents: line.unitAmountCents,
          amountCents: line.netCents,
          accountId: accountByCode.get(line.accountCode)!.id,
        })),
      });
    }
    // The exact record each draft is saved as. `status: 'draft'` and `posted: false` are what keep
    // the ledger untouched: the posting service returns before building a line for a draft.
    const payloads: XeroDraftPayload[] = ready.map(doc => ({
      number: doc.number,
      ...(kind === 'invoices' ? { customerId: doc.contactId, customerName: doc.contactName } : { vendorId: doc.contactId, vendorName: doc.contactName }),
      date: doc.date,
      dueDate: doc.dueDate,
      ...(doc.reference ? { reference: doc.reference } : {}),
      amountCents: doc.totalCents,
      amountPaidCents: 0,
      taxAmountCents: doc.taxCents,
      taxVersion: 2 as const,
      lineSumCents: doc.netCents,
      pricesIncludeTax: false,
      currency,
      items: doc.items,
      status: 'draft' as const,
      posted: false,
      metadata: { source: 'xero-csv', importedAt: new Date().toISOString() },
    }));
    return { ready, payloads, blocked };
  }, [parsed, contactByName, accountByCode, kind, currency]);

  const read = async (file: File) => {
    setError('');
    setSavedCount(null);
    setParsed(null);
    if (!dateOrder) { setError('Choose the date order in the file before uploading it.'); return; }
    try {
      const content = await file.text();
      const result = readXeroDocumentsCsv(content, {
        kind, dateOrder, currency,
        existingNumbers,
      });
      setFileName(file.name);
      setParsed(result);
      if (!result.documents.length) setError('No document in this file can be imported. The reasons are listed below.');
    } catch (err) {
      setFileName(file.name);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const save = async () => {
    if (!preview.payloads.length || !canImport) return;
    setSaving(true);
    setError('');
    try {
      const saved = onSave ? await onSave(preview.payloads) : await saveDrafts(preview.payloads);
      setSavedCount(saved);
      setParsed(null);
      toast.success(`${saved} draft ${saved === 1 ? KIND_LABEL[kind].slice(0, -1).toLowerCase() : KIND_LABEL[kind].toLowerCase()} saved for review. Nothing was sent or posted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Writes every draft, then reports exactly which ones failed (src/lib/serverAction.ts,
   * allSettledWrites). A loop that awaited one write at a time could report "done" for half a
   * batch — and the repo's bug-pattern guard rightly refuses it.
   */
  async function saveDrafts(documents: XeroDraftPayload[]): Promise<number> {
    const { done, failures } = await allSettledWrites(documents, async payload => {
      const ref = await addEntity(kind === 'invoices' ? 'invoices' : 'bills', payload);
      if (!ref) throw new Error(`${payload.number} was not saved`);
      return ref;
    });
    if (failures.length) {
      const numbers = failures.slice(0, 3).map(failure => failure.item.number).join(', ');
      throw new Error(
        `${done.length} of ${documents.length} drafts were saved; ${failures.length} failed (${numbers}${failures.length > 3 ? ', …' : ''}). ` +
        'Nothing was sent or posted. Fix the reason and upload the file again: the drafts already saved are kept and their numbers are skipped as duplicates.',
      );
    }
    return done.length;
  }

  const money = (cents: number) => formatCurrency(cents, currency);
  const totals = preview.ready.reduce((sum, doc) => ({ net: sum.net + doc.netCents, tax: sum.tax + doc.taxCents, total: sum.total + doc.totalCents }), { net: 0, tax: 0, total: 0 });

  return (
    <section className="ledger-card p-6 bg-[var(--surface)] border border-[var(--line)] rounded-2xl space-y-4" aria-labelledby="xero-documents-title">
      <div className="flex items-start gap-3">
        <FileSpreadsheet size={18} aria-hidden="true" className="text-[var(--brass)] mt-0.5" />
        <div>
          <h2 id="xero-documents-title" className="text-sm font-bold text-[var(--text)]">Xero invoices and bills</h2>
          <p className="text-xs text-[var(--muted)]">
            Read a Xero <em>Sales invoices</em> or <em>Bills</em> CSV into <strong>drafts</strong> for review. Nothing is sent,
            approved, paid or posted; a draft makes no ledger entry. Every contact must already be a customer/vendor here, and
            every line must use an account code from your chart of accounts — if not, the document is listed with what is missing
            instead of being guessed.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-[var(--muted)]">Document type
          <select aria-label="Xero document type" value={kind} onChange={e => { setKind(e.target.value as XeroDocumentKind); setParsed(null); setError(''); setSavedCount(null); }} disabled={saving} className="mt-1 w-full min-h-11 px-3 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-sm text-[var(--text)]">
            <option value="invoices">Sales invoices</option>
            <option value="bills">Bills</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-[var(--muted)]">Date order in the file
          <select aria-label="Xero date order" value={dateOrder} onChange={e => { setDateOrder(e.target.value as XeroDateOrder | ''); setParsed(null); setError(''); }} disabled={saving} className="mt-1 w-full min-h-11 px-3 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-sm text-[var(--text)]">
            <option value="">Choose before uploading…</option>
            <option value="dmy">Day / month / year (31/12/2024)</option>
            <option value="mdy">Month / day / year (12/31/2024)</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="Xero CSV file"
          className="hidden"
          disabled={saving || !canImport}
          onChange={e => { const file = e.target.files?.[0]; if (file) void read(file); e.target.value = ''; }}
        />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={saving || !canImport || loading} className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-100 text-zinc-700 rounded-xl text-[11px] font-semibold uppercase tracking-wider hover:bg-zinc-200 disabled:opacity-50">
          <Upload size={14} aria-hidden="true" /> Upload Xero CSV
        </button>
        {loading && <span className="text-[11px] text-[var(--muted)] inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Loading your lists…</span>}
        {!canImport && <span className="text-[11px] text-rose-600">A viewer cannot import documents.</span>}
        {fileName && <span className="text-[11px] text-[var(--muted)]">{fileName}</span>}
      </div>

      {error && <p role="alert" className="text-sm text-rose-600 inline-flex items-start gap-2"><AlertCircle size={15} aria-hidden="true" className="mt-0.5" />{error}</p>}

      {parsed && (
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3" aria-live="polite">
            <p className="text-xs text-[var(--text)]">
              <strong>{preview.ready.length}</strong> draft {preview.ready.length === 1 ? 'document' : 'documents'} ready
              {preview.blocked.length > 0 && <> · <strong>{preview.blocked.length}</strong> blocked</>}
              {parsed.skipped.length > 0 && <> · <strong>{parsed.skipped.length}</strong> skipped</>}
              {' '}· net {money(totals.net)} · tax {money(totals.tax)} · total {money(totals.total)}
            </p>
          </div>

          {preview.ready.length > 0 && (
            <div className="overflow-x-auto">
                            <RowTable
                rowHeaderColumn={false}
                rowClassName="border-t border-[var(--line)]"
                caption={(<>Drafts that will be created</>)}
                rows={preview.ready}
                rowKey={doc => doc.number}
                headRowClassName="text-left text-[var(--muted)]"
                columns={[
                  { header: "Number", className: "py-1 pr-3 font-semibold text-[var(--text)]", cell: (doc) => doc.number },
                  { header: kind === 'invoices' ? 'Customer' : 'Vendor', className: "py-1 pr-3 text-[var(--text)]", cell: (doc) => doc.contactName },
                  { header: "Date", className: "py-1 pr-3", cell: (doc) => doc.date },
                  { header: "Due", className: "py-1 pr-3", cell: (doc) => doc.dueDate },
                  { header: "Lines", align: 'right', className: "py-1 pr-3", cell: (doc) => doc.lines.length },
                  { header: "Net", align: 'right', className: "py-1 pr-3", cell: (doc) => money(doc.netCents) },
                  { header: "Tax", align: 'right', className: "py-1 pr-3", cell: (doc) => money(doc.taxCents) },
                  { header: "Total", align: 'right', className: "py-1 font-semibold text-[var(--text)]", cell: (doc) => money(doc.totalCents) },
                ]}
              />
            </div>
          )}

          {(preview.blocked.length > 0 || parsed.skipped.length > 0) && (
            <ul className="text-xs space-y-1" aria-label="Documents that will not be imported">
              {preview.blocked.map(entry => (
                <li key={`blocked-${entry.number}`} className="text-rose-600"><strong>{entry.number}</strong>: {entry.reason}</li>
              ))}
              {parsed.skipped.map(entry => (
                <li key={`skipped-${entry.number}-${entry.row}`} className="text-[var(--muted)]"><strong>{entry.number}</strong> (row {entry.row}): {entry.reason}</li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !canImport || preview.ready.length === 0}
            className={cn('inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-semibold uppercase tracking-wider',
              'bg-[var(--brass)] text-white hover:opacity-90 disabled:opacity-50')}
          >
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
            Save {preview.ready.length} draft {preview.ready.length === 1 ? 'document' : 'documents'}
          </button>
        </div>
      )}

      {savedCount !== null && (
        <p role="status" className="text-sm text-emerald-700">
          {savedCount} draft {savedCount === 1 ? 'document' : 'documents'} saved. Review {kind === 'invoices' ? 'them in Sales' : 'them in Bills'}, then send or approve — that step posts the ledger.
        </p>
      )}
    </section>
  );
}
