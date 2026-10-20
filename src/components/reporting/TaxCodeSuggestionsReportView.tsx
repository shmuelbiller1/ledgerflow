import React, { useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { suggestTaxCode, unusualTaxCode, type TaxHistoryRow } from '../../lib/tax/taxSuggestions';
import { downloadCsv } from '../../lib/csvExport';
import { getLocalDateISO } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const TAX_CODE_CSV_HEADERS = ['Date', 'Contact', 'Item', 'Entity', 'Tax code', 'Source'] as const;

/** Build history rows from invoices and bills for suggestion learning. */
export function historyFromDocuments(
  invoices: Array<{ date?: string; dueDate: string; taxCodeId?: string; customerId: string; items?: Array<{ itemId?: string }> ; metadata?: Record<string, unknown> }>,
  bills: Array<{ date?: string; dueDate: string; taxCodeId?: string; vendorId: string; splits?: Array<{ itemId?: string }> }>,
  workspaceId: string | null,
): TaxHistoryRow[] {
  const rows: TaxHistoryRow[] = [];
  for (const inv of invoices) {
    if (workspaceId && (inv as unknown as { workspaceId?: string }).workspaceId !== workspaceId) continue;
    const date = (inv.date || inv.dueDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    // Use first item's itemId if present, else no item
    const itemId = inv.items?.[0]?.itemId;
    // Entity from dimensions not stored at doc level in this MVP: leave undefined unless metadata has it
    // We keep entity undefined for general history; specific entity queries still work via fallback.
    const entity = undefined;
    if (inv.taxCodeId) rows.push({ date, taxCodeId: inv.taxCodeId, contactId: inv.customerId, itemId, entity });
  }
  for (const bill of bills) {
    if (workspaceId && (bill as unknown as { workspaceId?: string }).workspaceId !== workspaceId) continue;
    const date = (bill.date || bill.dueDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const itemId = bill.splits?.[0]?.itemId;
    const entity = undefined;
    if (bill.taxCodeId) rows.push({ date, taxCodeId: bill.taxCodeId, contactId: bill.vendorId, itemId, entity });
  }
  // Sort by date ascending for weight calculation stability
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

function csvRows(history: TaxHistoryRow[]): Array<Array<string | number>> {
  return history.map(r => [r.date, r.contactId || '', r.itemId || '', r.entity || '', r.taxCodeId || '', 'invoice/bill']);
}

/**
 * C-120: Tax code suggestions that learn from saved documents.
 * Read-only; shows what the history would suggest and flags unusual codes.
 * Never applied silently; the invoice/bill form remains the place where a code is chosen.
 */
export default function TaxCodeSuggestionsReportView() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const { loading } = useLedgerCollections('invoices', 'bills');

  const history = useMemo(() => historyFromDocuments(invoices as unknown as Parameters<typeof historyFromDocuments>[0], bills as unknown as Parameters<typeof historyFromDocuments>[1], workspaceId || null), [invoices, bills, workspaceId]);

  const [contactId, setContactId] = useState('');
  const [itemId, setItemId] = useState('');
  const [entity, setEntity] = useState('');
  const [today, setToday] = useState(getLocalDateISO());
  const [halfLife, setHalfLife] = useState('180');
  const halfLifeDays = useMemo(() => {
    const n = Number(halfLife);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 180;
  }, [halfLife]);

  const query = useMemo(() => {
    const q: Partial<Pick<TaxHistoryRow, 'contactId' | 'itemId' | 'entity'>> = {};
    if (contactId.trim()) q.contactId = contactId.trim();
    if (itemId.trim()) q.itemId = itemId.trim();
    if (entity.trim()) q.entity = entity.trim();
    return q;
  }, [contactId, itemId, entity]);

  const suggestion = useMemo(() => {
    if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
    if (!query.contactId && !query.itemId && !query.entity) return null;
    try {
      return suggestTaxCode(history, query, today, halfLifeDays);
    } catch {
      return null;
    }
  }, [history, query, today, halfLifeDays]);

  // Unusual check: for a draft row
  const [checkDate, setCheckDate] = useState(getLocalDateISO());
  const [checkTaxCode, setCheckTaxCode] = useState('');
  const unusual = useMemo(() => {
    if (!checkTaxCode.trim() || !checkDate || !/^\d{4}-\d{2}-\d{2}$/.test(checkDate)) return null;
    const row: TaxHistoryRow = { date: checkDate, taxCodeId: checkTaxCode.trim(), contactId: contactId.trim() || undefined, itemId: itemId.trim() || undefined, entity: entity.trim() || undefined };
    if (!row.contactId && !row.itemId && !row.entity) return null;
    try {
      return unusualTaxCode(history, row);
    } catch {
      return null;
    }
  }, [history, checkDate, checkTaxCode, contactId, itemId, entity]);

  const partial = Boolean(truncated.invoices || truncated.bills);

  return <section aria-label="Tax code suggestions" className="p-4 space-y-4 min-w-0">
    <div className="space-y-1">
      <h2>Tax code suggestions from history</h2>
      <p className="text-sm text-[var(--muted)]">
        Learns from tax codes already saved on invoices and bills in this workspace. For the same customer or vendor, item and entity, the most specific past pattern wins; recent documents count more (half-life 180 days by default; corrections are learned as the next document). This is <b>calculation status only</b>: it does not verify a tax decision, choose a rate, or file anything. Suggestions are never applied automatically — a person reviews and accepts them on the invoice or bill form. The reserved invoice/bill editors remain the place where a tax code is chosen; this screen shows what would be suggested.
      </p>
      <p className="text-xs text-[var(--muted)]">
        Source: saved invoices/bills with a taxCodeId (<code>taxCodeId</code>), up to {history.length} history rows from this load. History outside the loaded cap is marked provisional below. No network lookup, no HMRC/VIES, no authority source is claimed.
      </p>
    </div>

    {loading && <p role="status">Loading invoices and bills…</p>}
    {partial && <p role="alert">A loaded invoice or bill list is capped. Suggestion counts and the export are provisional until both lists are complete.</p>}
    {!loading && !history.length && <p role="status" className="text-sm text-[var(--muted)]">No saved invoice or bill in this workspace has a tax code yet. Create an invoice with a tax code to see suggestions here. Example: customer c1 + item i1 with vat18 on 2026-01-05 will make a later query for c1/i1 suggest vat18.</p>}

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <label className="block text-sm">Customer/Vendor ID (contact)
        <input className={field + ' w-full mt-1'} value={contactId} onChange={e => setContactId(e.target.value)} placeholder="e.g. c1" autoComplete="off" />
      </label>
      <label className="block text-sm">Item ID
        <input className={field + ' w-full mt-1'} value={itemId} onChange={e => setItemId(e.target.value)} placeholder="e.g. i1" autoComplete="off" />
      </label>
      <label className="block text-sm">Entity label value
        <input className={field + ' w-full mt-1'} value={entity} onChange={e => setEntity(e.target.value)} placeholder="e.g. il" autoComplete="off" />
      </label>
      <label className="block text-sm">Today (for weighting)
        <input type="date" className={field + ' w-full mt-1'} value={today} onChange={e => setToday(e.target.value)} />
      </label>
      <label className="block text-sm">Half-life (days)
        <input inputMode="numeric" className={field + ' w-full mt-1'} value={halfLife} onChange={e => setHalfLife(e.target.value)} placeholder="180" />
      </label>
      <div className="flex items-end">
        <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!history.length || partial && loading} onClick={() => history.length && downloadCsv(`tax-history-${workspace?.id || 'books'}`, [...TAX_CODE_CSV_HEADERS], csvRows(history))}>Export history CSV</button>
      </div>
    </div>

    <div className="rounded border border-[var(--line)] p-3 space-y-2 bg-[var(--panel)]">
      <h3 className="font-semibold">What would be suggested?</h3>
      {!query.contactId && !query.itemId && !query.entity && <p className="text-sm text-[var(--muted)]">Enter at least one of contact, item or entity to see a suggestion. The most specific match that has history wins: contact+item+entity → contact+item → contact → item → entity.</p>}
      {(query.contactId || query.itemId || query.entity) && !suggestion && !loading && <p className="text-sm">No history for <bdi>{JSON.stringify(query)}</bdi> on or before {today}. Try a contact or item that has a past invoice/bill, or clear filters to the least specific.</p>}
      {suggestion && <div className="text-sm space-y-1">
        <p><b>Suggested code:</b> <code className="px-1 py-0.5 rounded bg-[var(--surface)] border border-[var(--line)]"><bdi>{suggestion.taxCodeId}</bdi></code> · <b>Share:</b> {(suggestion.share * 100).toFixed(0)}% · <b>Based on:</b> {suggestion.basedOn} document(s) · <b>Match:</b> {suggestion.match}</p>
        <p className="text-xs text-[var(--muted)]">Share is the weighted share (0.5 after one half-life) of documents with this code among the matched rows. Based on is the count of matched rows on or before {today}.</p>
      </div>}
    </div>

    <div className="rounded border border-[var(--line)] p-3 space-y-2 bg-[var(--panel)]">
      <h3 className="font-semibold">Is this code unusual?</h3>
      <p className="text-xs text-[var(--muted)]">Checks a draft line against history <i>before</i> it: if the same customer/item/entity got another code in at least 80% of at least 3 earlier documents, it is flagged.</p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="block text-sm">Draft date
          <input type="date" className={field + ' mt-1'} value={checkDate} onChange={e => setCheckDate(e.target.value)} />
        </label>
        <label className="block text-sm">Draft tax code
          <input className={field + ' mt-1'} value={checkTaxCode} onChange={e => setCheckTaxCode(e.target.value)} placeholder="e.g. zero" />
        </label>
      </div>
      {!checkTaxCode.trim() && <p className="text-sm text-[var(--muted)]">Enter a draft code to check.</p>}
      {checkTaxCode.trim() && !unusual && <p className="text-sm">Not flagged as unusual (usual is {suggestion?.taxCodeId || 'none'} with share {suggestion ? `${(suggestion.share*100).toFixed(0)}% on ${suggestion.basedOn}` : 'insufficient history'}; needs 3+ docs and 80% share).</p>}
      {unusual && <p className="text-sm"><span className="font-semibold text-amber-700">Unusual:</span> this draft uses <code>{checkTaxCode.trim()}</code> but the same customer/item/entity usually got <code>{unusual.taxCodeId}</code> ({(unusual.share*100).toFixed(0)}% on {unusual.basedOn} docs, via {unusual.match}). Review whether the unusual code is intended.</p>}
    </div>

    <details className="rounded border border-[var(--line)] p-2">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">How history is built (for review)</summary>
      <p className="text-sm text-[var(--muted)]">Each saved invoice contributes one row per document (date = invoice date or dueDate, taxCodeId from the invoice, contactId = customerId, itemId = first line item, entity = none in this view). Bills do the same with vendorId. The store cap (10,000) keeps recent documents; a capped store makes this screen provisional.</p>
      <ReportTableScroll>
        <table className="w-full text-sm">
          <caption className="sr-only">History rows used for suggestions</caption>
          <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">{TAX_CODE_CSV_HEADERS.map(h => <th key={h} scope="col" className="text-left py-1 px-2">{h}</th>)}</tr></thead>
          <tbody>
            {history.slice(0, 50).map((r, idx) => <tr key={idx} className="border-b border-[var(--line)]/50"><td className="py-1 px-2">{r.date}</td><td className="py-1 px-2"><bdi>{r.contactId}</bdi></td><td className="py-1 px-2"><bdi>{r.itemId || '—'}</bdi></td><td className="py-1 px-2"><bdi>{r.entity || '—'}</bdi></td><td className="py-1 px-2"><code>{r.taxCodeId}</code></td><td className="py-1 px-2 text-xs">invoice/bill</td></tr>)}
          </tbody>
        </table>
      </ReportTableScroll>
      {history.length > 50 && <p className="text-xs text-[var(--muted)]">Showing 50 of {history.length} rows; export for the full list.</p>}
      {!history.length && !loading && <p className="text-sm text-[var(--muted)]">No history rows yet.</p>}
    </details>

    <p className="text-xs text-[var(--muted)]">Capability: <b>Calculation only</b> — help text only, no tax advice. See docs/CAPABILITIES #143-era notes; this report does not post, file or verify a tax treatment.</p>
  </section>;
}
