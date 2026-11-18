import React, { useMemo, useState } from 'react';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { downloadCsv } from '../../lib/csvExport';
import { getLocalDateISO } from '../../lib/utils';
import {
  warrantyCandidates,
  warrantyRecordForCandidate,
  warrantyRecordsFromMetadata,
  warrantyStatus,
  type WarrantyCandidate,
  type WarrantyRecord,
} from '../../lib/warehouseRecords';
import type { Customer, InventoryItem, Invoice } from '../../types';
import InlineEdit from '../ui/InlineEdit';
import ReportTableScroll from './ReportTableScroll';
import { useReportText, fill } from './useReportText';

const field = 'min-h-11 min-w-0 max-w-full border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const CSV_HEADERS = ['Customer', 'Invoice', 'Invoice date', 'Item', 'SKU', 'Serial number', 'Warranty end date', 'Status', 'Last updated', 'Updated by'];
type WarrantyFilter = 'under warranty' | 'all' | 'expired' | 'not set';

export default function WarrantyRegisterPanel() {
  const reportText = useReportText();
  const customers = useLedgerStore(state => state.customers) as Customer[];
  const invoices = useLedgerStore(state => state.invoices) as Invoice[];
  const inventory = useLedgerStore(state => state.inventory) as InventoryItem[];
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const user = useAuthStore(state => state.user);
  const isGuest = useAuthStore(state => state.isGuest);
  const role = useCurrentRole();
  const { loading } = useLedgerCollections('customers', 'invoices', 'inventory');
  const { runCommand } = useEntityOperations();
  const [filter, setFilter] = useState<WarrantyFilter>('under warranty');
  const [query, setQuery] = useState('');

  const scopedCustomers = useMemo(() => customers.filter(customer => Boolean(workspaceId) && customer.workspaceId === workspaceId), [customers, workspaceId]);
  const scopedInvoices = useMemo(() => invoices.filter(invoice => Boolean(workspaceId) && invoice.workspaceId === workspaceId), [invoices, workspaceId]);
  const scopedItems = useMemo(() => inventory.filter(item => Boolean(workspaceId) && item.workspaceId === workspaceId), [inventory, workspaceId]);
  const candidates = useMemo(() => warrantyCandidates(scopedInvoices, scopedCustomers, scopedItems, workspaceId || ''), [scopedInvoices, scopedCustomers, scopedItems, workspaceId]);
  const recordsByCustomer = useMemo(() => new Map(scopedCustomers.map(customer => [
    customer.id,
    warrantyRecordsFromMetadata(customer.metadata, customer.id, workspaceId || undefined),
  ])), [scopedCustomers, workspaceId]);
  const today = getLocalDateISO();
  const canEdit = Boolean(user && !isGuest && ['owner', 'accountant', 'bookkeeper'].includes(role) && workspaceId && !loading);
  const partial = Boolean(
    truncated.customers || failed.customers || truncated.invoices || failed.invoices || truncated.inventory || failed.inventory,
  );

  const rows = useMemo(() => candidates.map(candidate => {
    const records = recordsByCustomer.get(candidate.customerId) || [];
    const warranty = warrantyRecordForCandidate(records, candidate);
    return { candidate, warranty, endDate: warranty?.endDate || '' };
  }).filter(row => {
    const status = warrantyStatus(row.endDate, today);
    if (filter !== 'all' && status !== filter) return false;
    const term = query.trim().toLocaleLowerCase();
    if (!term) return true;
    const haystack = `${row.candidate.customerName} ${row.candidate.invoiceNumber} ${row.candidate.itemName} ${row.candidate.sku} ${row.candidate.serial}`.toLocaleLowerCase();
    return haystack.includes(term);
  }), [candidates, recordsByCustomer, today, filter, query]);

  const saveEndDate = async (candidate: WarrantyCandidate, next: string | number) => {
    const customer = scopedCustomers.find(record => record.id === candidate.customerId);
    if (!customer || !workspaceId || !user) throw new Error('The customer record or workspace session is not available.');
    if (!canEdit) throw new Error('A workspace editor is required to change a warranty date.');
    if (loading || partial) throw new Error('Warranty dates are read-only while a required list is loading, capped, or failed.');
    await runCommand('warranty.update', {
      candidate: {
        id: candidate.id,
        workspaceId: candidate.workspaceId,
        customerId: candidate.customerId,
        invoiceId: candidate.invoiceId,
        invoiceLineId: candidate.invoiceLineId,
        itemId: candidate.itemId,
        serial: candidate.serial,
      },
      endDate: String(next),
    }, `Warranty end date saved for ${candidate.serial}.`);
  };

  const csvRows = rows.map(({ candidate, warranty, endDate }) => [
    candidate.customerName, candidate.invoiceNumber, candidate.invoiceDate, candidate.itemName,
    candidate.sku, candidate.serial, endDate, warrantyStatus(endDate, today),
    warranty?.updatedAt || '', warranty?.updatedByName || '',
  ]);
  const allWarrantyRecords = scopedCustomers.flatMap(customer =>
    warrantyRecordsFromMetadata(customer.metadata, customer.id, workspaceId || undefined),
  );

  return <section aria-label={reportText('r.warranty-register', 'Warranty register')} className="space-y-4 min-w-0">
    <div>
      <h3 className="text-lg font-semibold">{reportText('r.warranty-register', 'Warranty register')}</h3>
      <p className="text-sm text-[var(--muted)]">{reportText('r.serials-come-from-the-serial-numbers-recorded-on', 'Serials come from the serial numbers recorded on issued invoice lines. Add the manufacturer or supplier’s warranty end date for each serial; this screen does not infer coverage, create a warranty term, change stock, or affect an invoice. Date edits are recorded with the previous value, time and user.')}</p>
    </div>
    {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-invoices-inventory-and-customers', 'Loading invoices, inventory and customers…')}</p>}
    {partial && <p role="alert" className="text-sm text-[var(--warning,#b45309)]">{reportText('r.at-least-one-source-list-is-capped-or-failed-thi', 'At least one source list is capped or failed. This register may be incomplete; warranty date edits and full exports are disabled until the lists are complete.')}</p>}
    {allWarrantyRecords.length > 0 && <p className="text-xs text-[var(--muted)]">{allWarrantyRecords.length} {reportText('r.warranty-record-s-saved-on-customer-records-only', 'warranty record(s) saved on customer records; only records for loaded, issued invoice serials appear below.')}</p>}

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">{reportText('r.show', 'Show')}
        <select aria-label={reportText('r.warranty-status-filter', 'Warranty status filter')} className={field} value={filter} onChange={event => setFilter(event.target.value as WarrantyFilter)}>
          <option value="under warranty">{reportText('r.under-warranty', 'Under warranty')}</option>
          <option value="all">{reportText('r.all-issued-invoice-serials', 'All issued invoice serials')}</option>
          <option value="expired">{reportText('r.expired', 'Expired')}</option>
          <option value="not set">{reportText('r.end-date-not-set', 'End date not set')}</option>
        </select>
      </label>
      <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">{reportText('r.find-customer-item-serial-or-invoice', 'Find customer, item, serial or invoice')}
        <input aria-label={reportText('r.find-warranty-record', 'Find warranty record')} type="search" className={field} value={query} onChange={event => setQuery(event.target.value)} placeholder={reportText('r.search-warranty-register', 'Search warranty register')} />
      </label>
      <span className="text-sm text-[var(--muted)]">{rows.length} {reportText('r.of', 'of')} {candidates.length} {reportText('r.serial-s', 'serial(s)')}</span>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)] disabled:opacity-50" disabled={loading || partial || !rows.length}
        onClick={() => downloadCsv(`warranty-register-${today}`, CSV_HEADERS, csvRows)}>{reportText('r.export-warranty-csv', 'Export warranty CSV')}</button>
    </div>

    {!candidates.length && !loading && <p className="text-sm text-[var(--muted)]">{reportText('r.no-serial-numbers-are-recorded-on-loaded-issued', 'No serial numbers are recorded on loaded issued invoice lines. Warranty reporting depends on serial capture when the invoice is prepared; no coverage is inferred here.')}</p>}

    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>{reportText('r.items-by-customer-from-issued-invoice-serials-wa', 'Items by customer from issued invoice serials — warranty status as of')} {today}</caption>
        <thead><tr>
          <th scope="col" className="text-left py-2 px-2">{reportText('r.customer', 'Customer')}</th>
          <th scope="col" className="text-left py-2 px-2">{reportText('r.invoice-2', 'Invoice')}</th>
          <th scope="col" className="text-left py-2 px-2">{reportText('r.item', 'Item')}</th>
          <th scope="col" className="text-left py-2 px-2">{reportText('r.serial', 'Serial')}</th>
          <th scope="col" className="text-left py-2 px-2">{reportText('r.warranty-end-date', 'Warranty end date')}</th>
          <th scope="col" className="text-left py-2 px-2">{reportText('r.status', 'Status')}</th>
        </tr></thead>
        <tbody>{rows.map(({ candidate, warranty, endDate }) => <WarrantyRow key={candidate.id}
          candidate={candidate} warranty={warranty} endDate={endDate} today={today} canEdit={canEdit && !partial} onSave={saveEndDate} />)}</tbody>
      </table>
      {candidates.length > 0 && !rows.length && <p className="p-3 text-sm text-[var(--muted)]">{reportText('r.no-serials-match-this-warranty-filter-and-search', 'No serials match this warranty filter and search.')}</p>}
    </ReportTableScroll>
  </section>;
}

function WarrantyRow({
  candidate, warranty, endDate, today, canEdit, onSave,
}: {
  candidate: WarrantyCandidate;
  warranty: WarrantyRecord | null;
  endDate: string;
  today: string;
  canEdit: boolean;
  onSave: (candidate: WarrantyCandidate, next: string | number) => Promise<unknown>;
}) {
  const reportText = useReportText();
  const status = warrantyStatus(endDate, today);
  return <tr className="border-b border-[var(--line)]/50">
    <th scope="row" className="text-left font-normal py-2 px-2">{candidate.customerName}</th>
    <td className="py-2 px-2">{candidate.invoiceNumber}<span className="block text-xs text-[var(--muted)]">{candidate.invoiceDate || reportText('r.date-not-recorded', 'date not recorded')}</span></td>
    <td className="py-2 px-2">{candidate.itemName}<span className="block text-xs text-[var(--muted)]">{candidate.sku || reportText('r.no-sku', 'No SKU')}</span></td>
    <td className="py-2 px-2"><bdi>{candidate.serial}</bdi></td>
    <td className="py-2 px-2 min-w-48">
      {candidate.customerLoaded
        ? <InlineEdit kind="date" label={fill(reportText('r.warranty-end-date-for-0-sold-to-1', 'Warranty end date for {0} sold to {1}'), { 0: candidate.serial, 1: candidate.customerName })} value={endDate}
          placeholder={reportText('r.add-end-date', 'Add end date')} canEdit={canEdit} onSave={next => onSave(candidate, next)} />
        : <span className="text-[var(--muted)]">{reportText('r.customer-record-not-loaded', 'Customer record not loaded')}</span>}
      {warranty && <span className="block text-xs text-[var(--muted)]">{reportText('r.updated', 'Updated')} {new Date(warranty.updatedAt).toLocaleDateString()} {reportText('r.by-2', 'by')} {warranty.updatedByName || warranty.updatedByUid}</span>}
    </td>
    <td className="py-2 px-2">{status === 'under warranty' ? reportText('r.under-warranty', 'Under warranty') : status === 'expired' ? reportText('r.expired', 'Expired') : reportText('r.end-date-not-set', 'End date not set')}</td>
  </tr>;
}
