import { usePartialReportInputs } from '../../hooks/usePartialReportInputs';
import { useReportDates } from './useReportDates';
import React, { useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { suggestTaxCode, unusualTaxCode, type TaxHistoryRow } from '../../lib/tax/taxSuggestions';
import { historyFromDocuments } from './taxCodeSuggestionHistory';
import { downloadCsv } from '../../lib/csvExport';
import { getLocalDateISO } from '../../lib/utils';
import ReportSchedule from './ReportSchedule';
import { useReportText, fill } from './useReportText';

/** Code names, form numbers, paths and identifiers shown as-is: they are not words to translate (EU-G1). */
const CODE_NAMES = { c0: 'taxCodeId', c1: 'e.g. c1', c2: 'e.g. i1', c3: 'e.g. il', c4: 'e.g. zero' } as const;

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const TAX_CODE_CSV_HEADERS = ['Date', 'Contact', 'Item', 'Entity', 'Tax code', 'Source'] as const;

function csvRows(history: TaxHistoryRow[]): Array<Array<string | number>> {
  return history.map(r => [r.date, r.contactId || '', r.itemId || '', r.entity || '', r.taxCodeId || '', 'invoice/bill']);
}

/**
 * C-120: Tax code suggestions that learn from saved documents.
 * Read-only; shows what the history would suggest and flags unusual codes.
 * Never applied silently; the invoice/bill form remains the place where a code is chosen.
 */
export default function TaxCodeSuggestionsReportView() {
  const dates = useReportDates();
  const reportText = useReportText();
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const { loading } = useLedgerCollections('invoices', 'bills');

  const history = useMemo(() => historyFromDocuments(invoices, bills, workspaceId || null), [invoices, bills, workspaceId]);

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

  // A failure must not read as "no history": the two are different answers.
  const { suggestion, suggestionError } = useMemo<{ suggestion: ReturnType<typeof suggestTaxCode> | null; suggestionError: string | null }>(() => {
    if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return { suggestion: null, suggestionError: null };
    if (!query.contactId && !query.itemId && !query.entity) return { suggestion: null, suggestionError: null };
    try {
      return { suggestion: suggestTaxCode(history, query, today, halfLifeDays), suggestionError: null };
    } catch (e) {
      return { suggestion: null, suggestionError: e instanceof Error ? e.message : String(e) };
    }
  }, [history, query, today, halfLifeDays]);

  // Unusual check: for a draft row
  const [checkDate, setCheckDate] = useState(getLocalDateISO());
  const [checkTaxCode, setCheckTaxCode] = useState('');
  const { unusual, unusualError } = useMemo<{ unusual: ReturnType<typeof unusualTaxCode> | null; unusualError: string | null }>(() => {
    if (!checkTaxCode.trim() || !checkDate || !/^\d{4}-\d{2}-\d{2}$/.test(checkDate)) return { unusual: null, unusualError: null };
    const row: TaxHistoryRow = { date: checkDate, taxCodeId: checkTaxCode.trim(), contactId: contactId.trim() || undefined, itemId: itemId.trim() || undefined, entity: entity.trim() || undefined };
    if (!row.contactId && !row.itemId && !row.entity) return { unusual: null, unusualError: null };
    try {
      return { unusual: unusualTaxCode(history, row), unusualError: null };
    } catch (e) {
      return { unusual: null, unusualError: e instanceof Error ? e.message : String(e) };
    }
  }, [history, checkDate, checkTaxCode, contactId, itemId, entity]);

  const partial = usePartialReportInputs(['invoices', 'bills']);

  return <section aria-label={reportText('r.tax-code-suggestions', 'Tax code suggestions')} className="p-4 space-y-4 min-w-0">
    <div className="space-y-1">
      <h2>{reportText('r.tax-code-suggestions-from-history', 'Tax code suggestions from history')}</h2>
      <p className="text-sm text-[var(--muted)]">
        {reportText('r.learns-from-tax-codes-already-saved-on-invoices', 'Learns from tax codes already saved on invoices and bills in this workspace. For the same customer or vendor, item and entity, the most specific past pattern wins; recent documents count more (half-life 180 days by default; corrections are learned as the next document). This is')} <b>{reportText('r.calculation-status-only', 'calculation status only')}</b>{reportText('r.it-does-not-verify-a-tax-decision-choose-a-rate', ': it does not verify a tax decision, choose a rate, or file anything. Suggestions are never applied automatically — a person reviews and accepts them on the invoice or bill form. The reserved invoice/bill editors remain the place where a tax code is chosen; this screen shows what would be suggested.')}
      </p>
      <p className="text-xs text-[var(--muted)]">
        {reportText('r.source-saved-invoices-bills-with-a-taxcodeid', 'Source: saved invoices/bills with a taxCodeId (')}<code>{CODE_NAMES.c0}</code>{reportText('r.up-to-2', '), up to')} {history.length} {reportText('r.history-rows-from-this-load-history-outside-the', 'history rows from this load. History outside the loaded cap is marked provisional below. No network lookup, no HMRC/VIES, no authority source is claimed.')}
      </p>
    </div>

    {loading && <p role="status">{reportText('r.loading-invoices-and-bills', 'Loading invoices and bills…')}</p>}
    {partial && <p role="alert">{reportText('r.a-loaded-invoice-or-bill-list-is-capped-suggesti', 'A loaded invoice or bill list is capped. Suggestion counts and the export are provisional until both lists are complete.')}</p>}
    {!loading && !history.length && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.no-saved-invoice-or-bill-in-this-workspace-has-a', 'No saved invoice or bill in this workspace has a tax code yet. Create an invoice with a tax code to see suggestions here. Example: customer c1 + item i1 with vat18 on 2026-01-05 will make a later query for c1/i1 suggest vat18.')}</p>}

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <label className="block text-sm">{reportText('r.customer-vendor-id-contact', 'Customer/Vendor ID (contact)')}
        <input className={field + ' w-full mt-1'} value={contactId} onChange={e => setContactId(e.target.value)} placeholder={CODE_NAMES.c1} autoComplete="off" />
      </label>
      <label className="block text-sm">{reportText('r.item-id', 'Item ID')}
        <input className={field + ' w-full mt-1'} value={itemId} onChange={e => setItemId(e.target.value)} placeholder={CODE_NAMES.c2} autoComplete="off" />
      </label>
      <label className="block text-sm">{reportText('r.entity-label-value', 'Entity label value')}
        <input className={field + ' w-full mt-1'} value={entity} onChange={e => setEntity(e.target.value)} placeholder={CODE_NAMES.c3} autoComplete="off" />
      </label>
      <label className="block text-sm">{reportText('r.today-for-weighting', 'Today (for weighting)')}
        <input type="date" className={field + ' w-full mt-1'} value={today} onChange={e => setToday(e.target.value)} />
      </label>
      <label className="block text-sm">{reportText('r.half-life-days', 'Half-life (days)')}
        <input inputMode="numeric" className={field + ' w-full mt-1'} value={halfLife} onChange={e => setHalfLife(e.target.value)} placeholder="180" />
      </label>
      <div className="flex items-end">
        <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!history.length || partial && loading} onClick={() => history.length && downloadCsv(`tax-history-${workspace?.id || 'books'}`, [...TAX_CODE_CSV_HEADERS], csvRows(history))}>{reportText('r.export-history-csv', 'Export history CSV')}</button>
      </div>
    </div>

    <div className="rounded border border-[var(--line)] p-3 space-y-2 bg-[var(--panel)]">
      <h3 className="font-semibold">{reportText('r.what-would-be-suggested', 'What would be suggested?')}</h3>
      {!query.contactId && !query.itemId && !query.entity && <p className="text-sm text-[var(--muted)]">{reportText('r.enter-at-least-one-of-contact-item-or-entity-to', 'Enter at least one of contact, item or entity to see a suggestion. The most specific match that has history wins: contact+item+entity → contact+item → contact → item → entity.')}</p>}
      {suggestionError && <p role="alert" className="text-sm text-amber-700">{reportText('r.could-not-compute-a-suggestion', 'Could not compute a suggestion:')} <bdi>{suggestionError}</bdi>{reportText('r.this-is', '. This is')} <b>{reportText('r.not', 'not')}</b> {reportText('r.a-statement-that-there-is-no-history-the-suggest', 'a statement that there is no history — the suggestion was not calculated.')}</p>}
      {(query.contactId || query.itemId || query.entity) && !suggestion && !suggestionError && !loading && !partial && <p className="text-sm">{reportText('r.no-history-for', 'No history for')} <bdi>{JSON.stringify(query)}</bdi> {reportText('r.on-or-before', 'on or before')} {dates.dateText(today)}{reportText('r.try-a-contact-or-item-that-has-a-past-invoice-bi', '. Try a contact or item that has a past invoice/bill, or clear filters to the least specific.')}</p>}
      {suggestion && <div className="text-sm space-y-1">
        <p><b>{reportText('r.suggested-code', 'Suggested code:')}</b> <code className="px-1 py-0.5 rounded bg-[var(--surface)] border border-[var(--line)]"><bdi>{suggestion.taxCodeId}</bdi></code> · <b>{reportText('r.share-2', 'Share:')}</b> {(suggestion.share * 100).toFixed(0)}% · <b>{reportText('r.based-on', 'Based on:')}</b> {suggestion.basedOn} {reportText('r.document-s', 'document(s) ·')} <b>{reportText('r.match', 'Match:')}</b> {suggestion.match}</p>
        <p className="text-xs text-[var(--muted)]">{reportText('r.share-is-the-weighted-share-0-5-after-one-half-l', 'Share is the weighted share (0.5 after one half-life) of documents with this code among the matched rows. Based on is the count of matched rows on or before')} {dates.dateText(today)}.</p>
      </div>}
    </div>

    <div className="rounded border border-[var(--line)] p-3 space-y-2 bg-[var(--panel)]">
      <h3 className="font-semibold">{reportText('r.is-this-code-unusual', 'Is this code unusual?')}</h3>
      <p className="text-xs text-[var(--muted)]">{reportText('r.checks-a-draft-line-against-history', 'Checks a draft line against history')} <i>{reportText('r.before', 'before')}</i> {reportText('r.it-if-the-same-customer-item-entity-got-another', 'it: if the same customer/item/entity got another code in at least 80% of at least 3 earlier documents, it is flagged.')}</p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="block text-sm">{reportText('r.draft-date', 'Draft date')}
          <input type="date" className={field + ' mt-1'} value={checkDate} onChange={e => setCheckDate(e.target.value)} />
        </label>
        <label className="block text-sm">{reportText('r.draft-tax-code', 'Draft tax code')}
          <input className={field + ' mt-1'} value={checkTaxCode} onChange={e => setCheckTaxCode(e.target.value)} placeholder={CODE_NAMES.c4} />
        </label>
      </div>
      {!checkTaxCode.trim() && <p className="text-sm text-[var(--muted)]">{reportText('r.enter-a-draft-code-to-check', 'Enter a draft code to check.')}</p>}
      {unusualError && <p role="alert" className="text-sm text-amber-700">{reportText('r.could-not-check-this-code', 'Could not check this code:')} <bdi>{unusualError}</bdi>{reportText('r.not-a-statement-that-the-code-is-usual', '. Not a statement that the code is usual.')}</p>}
      {checkTaxCode.trim() && !unusual && !unusualError && <p className="text-sm">{reportText('r.not-flagged-as-unusual-usual-is', 'Not flagged as unusual (usual is')} {suggestion?.taxCodeId || reportText('r.none-3', 'none')} {reportText('r.with-share', 'with share')} {suggestion ? fill(reportText('r.0-on-1', '{0}% on {1}'), { 0: (suggestion.share*100).toFixed(0), 1: suggestion.basedOn }) : reportText('r.insufficient-history', 'insufficient history')}{reportText('r.needs-3-docs-and-80-share', '; needs 3+ docs and 80% share).')}</p>}
      {unusual && <p className="text-sm"><span className="font-semibold text-amber-700">{reportText('r.unusual', 'Unusual:')}</span> {reportText('r.this-draft-uses', 'this draft uses')} <code>{checkTaxCode.trim()}</code> {reportText('r.but-the-same-customer-item-entity-usually-got', 'but the same customer/item/entity usually got')} <code>{unusual.taxCodeId}</code> ({(unusual.share*100).toFixed(0)}{reportText('r.on-3', '% on')} {unusual.basedOn} {reportText('r.docs-via', 'docs, via')} {unusual.match}{reportText('r.review-whether-the-unusual-code-is-intended', '). Review whether the unusual code is intended.')}</p>}
    </div>

    <details className="rounded border border-[var(--line)] p-2">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">{reportText('r.how-history-is-built-for-review', 'How history is built (for review)')}</summary>
      <p className="text-sm text-[var(--muted)]">{reportText('r.each-saved-invoice-contributes-one-row-per-docum', 'Each saved invoice contributes one row per document (date = invoice date or dueDate, taxCodeId from the invoice, contactId = customerId, itemId = first line item, entity = none in this view). Bills do the same with vendorId. The store cap (10,000) keeps recent documents; a capped store makes this screen provisional.')}</p>
      <ReportSchedule
        columnControls
        allowDisplayedExport={!partial && !loading}
        caption={reportText('r.history-rows-used-for-suggestions', 'History rows used for suggestions')}
        captionClassName="sr-only"
        headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
        rowClassName="border-b border-[var(--line)]/50"
        bodyClassName=""
        rows={history.slice(0, 50)} rowKey={r => r.sourceKey}
        columns={[
          { header: reportText('r.date-2', 'Date'), cell: r => <time dateTime={r.date}>{dates.dateText(r.date)}</time> },
          { header: reportText('r.contact', 'Contact'), rowHeader: true, cell: r => <bdi>{r.contactId}</bdi> },
          { header: reportText('r.item', 'Item'), cell: r => <bdi>{r.itemId || '—'}</bdi> },
          { header: reportText('r.entity-2', 'Entity'), cell: r => <bdi>{r.entity || '—'}</bdi> },
          { header: reportText('r.schedule-tax-code', 'Tax code'), cell: r => <code>{r.taxCodeId}</code> },
          { header: reportText('r.source', 'Source'), className: 'text-xs', cell: () => reportText('r.invoice-bill', 'invoice/bill') },
        ]} />
      {history.length > 50 && <p className="text-xs text-[var(--muted)]">{reportText('r.showing-50-of', 'Showing 50 of')} {history.length} {reportText('r.rows-export-for-the-full-list', 'rows; export for the full list.')}</p>}
      {!history.length && !loading && !partial && <p className="text-sm text-[var(--muted)]">{reportText('r.no-history-rows-yet', 'No history rows yet.')}</p>}
    </details>

    <p className="text-xs text-[var(--muted)]">{reportText('r.capability', 'Capability:')} <b>{reportText('r.calculation-only', 'Calculation only')}</b> {reportText('r.help-text-only-no-tax-advice-see-docs-capabiliti', '— help text only, no tax advice. See docs/CAPABILITIES #143-era notes; this report does not post, file or verify a tax treatment.')}</p>
  </section>;
}
