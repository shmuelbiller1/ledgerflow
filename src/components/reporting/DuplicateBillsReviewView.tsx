import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { DUPLICATE_BILL_CSV_HEADERS, duplicateBillCsvRows, findDuplicateBills, type DuplicateBillPair, type DuplicateBillReview, type ReviewBill } from '../../lib/duplicateBills';
import { normalizeSearchText } from '../../lib/textNormalization';
import { formatCurrency } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import type { Bill } from '../../types';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';

function toReviewBill(bill: Bill): ReviewBill {
  const metadata = bill.metadata as ReviewBill['metadata'];
  const customerName = (bill as unknown as { vendorName?: string }).vendorName;
  return {
    id: bill.id,
    vendorId: bill.vendorId,
    vendorName: customerName,
    number: bill.number,
    date: bill.date,
    amountCents: bill.amountCents,
    currency: bill.currency,
    status: bill.status,
    metadata,
  };
}

/** A-195: bills that may have been entered twice. Read-only; nothing is merged or deleted here. */
export default function DuplicateBillsReviewView() {
  const bills = useLedgerStore(state => state.bills);
  const vendors = useLedgerStore(state => state.vendors);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('bills', 'vendors');

  const review = useMemo(() => {
    const names = new Map(vendors.map(vendor => [vendor.id, vendor.name]));
    return findDuplicateBills(
      bills
        .filter(bill => !workspaceId || bill.workspaceId === workspaceId)
        .map(bill => {
          const mapped = toReviewBill(bill);
          return { ...mapped, vendorName: mapped.vendorName || names.get(bill.vendorId) };
        }),
    );
  }, [bills, vendors, workspaceId]);

  const partial = Boolean(truncated.bills || failed.bills || truncated.vendors || failed.vendors);
  return <DuplicateBillsReviewPanel review={review} currency={workspace?.currency || 'USD'} loading={loading} partial={partial} />;
}

export function DuplicateBillsReviewPanel({ review, currency = 'USD', loading = false, partial = false }: {
  review: DuplicateBillReview;
  currency?: string;
  loading?: boolean;
  partial?: boolean;
}) {
  const reportText = useReportText();
  const [strength, setStrength] = useState<'all' | 'documented' | 'date-window'>('all');
  const [search, setSearch] = useState('');
  const query = normalizeSearchText(search.trim());
  const evidence = (pair: DuplicateBillPair) => pair.signals.map(signal =>
    signal === 'same-document-number' ? 'Same document number'
      : signal === 'same-reference' ? 'Same order reference'
        : signal === 'same-day' ? 'Same day' : 'Within 3 days').join(' · ');
  const visible = review.pairs.filter(pair => {
    if (strength !== 'all' && pair.strength !== strength) return false;
    if (!query) return true;
    return normalizeSearchText([pair.left.vendor, pair.left.number, pair.left.id, pair.right.number, pair.right.id, evidence(pair)].join(' ')).includes(query);
  });

  return <section aria-label={reportText('r.duplicate-bill-review', 'Duplicate bill review')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.duplicate-bill-review', 'Duplicate bill review')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.purchase-bills-from-the-same-vendor-in-the-same', 'Purchase bills from the same vendor, in the same currency, for exactly the same amount, dated within three days of each other. A pair sharing a document number or an order reference is stronger evidence than a date window alone. Two real deliveries can look like this, so every row is a question to check, not a finding: this screen never edits, merges or deletes a bill, and it never converts another currency.')}
    </p>

    {loading && <p role="status">{reportText('r.loading-bills', 'Loading bills…')}</p>}
    {partial && <p role="alert">{reportText('r.the-loaded-bill-or-vendor-list-is-capped-or-fail', 'The loaded bill or vendor list is capped or failed, so the pairs and the export are provisional.')}</p>}
    {review.ambiguousGroups > 0 && <p role="alert">{review.ambiguousGroups} {reportText('r.group-s-of-more-than-25-bills-share-one-vendor-a', 'group(s) of more than 25 bills share one vendor, amount and currency; they were not expanded into pairs — look at that vendor\'s bills directly.')}</p>}
    {review.truncated && <p role="alert">{reportText('r.the-safety-cap-of', 'The safety cap of')} {review.pairs.length} {reportText('r.pairs-was-reached-narrow-the-period-or-the-vendo', 'pairs was reached. Narrow the period or the vendor before exporting.')}</p>}
    {(review.excludedBills > 0 || review.withoutVendor > 0) && <p className="text-sm text-[var(--muted)]">
      {reportText('r.left-out', 'Left out:')} {review.excludedBills} {reportText('r.void-cancelled-or-rejected-bill-s-and', 'void, cancelled or rejected bill(s) and')} {review.withoutVendor} {reportText('r.bill-s-with-no-vendor', 'bill(s) with no vendor.')}
    </p>}

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.evidence', 'Evidence')}
        <select aria-label={reportText('r.evidence', 'Evidence')} className={field} value={strength} onChange={event => setStrength(event.target.value as typeof strength)}>
          <option value="all">{reportText('r.all-suggestions', 'All suggestions')}</option>
          <option value="documented">{reportText('r.shared-document-evidence', 'Shared document evidence')}</option>
          <option value="date-window">{reportText('r.date-window-only', 'Date window only')}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.find-a-bill-or-vendor', 'Find a bill or vendor')}
        <input aria-label={reportText('r.find-a-bill-or-vendor', 'Find a bill or vendor')} className={field} value={search} onChange={event => setSearch(event.target.value)} placeholder={reportText('r.number-vendor-or-bill-id', 'Number, vendor or bill id')} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!visible.length || loading || partial || review.truncated}
        onClick={() => downloadCsv('duplicate-bill-review', DUPLICATE_BILL_CSV_HEADERS, duplicateBillCsvRows(visible))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    <p className="text-sm"><b>{reportText('r.pairs-shown', 'Pairs shown:')}</b> {visible.length} {reportText('r.of', 'of')} {review.pairs.length}</p>
    <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50 align-top"
        caption={(<>{reportText('r.bill-pairs-to-check-no-bill-is-changed-by-this-r', 'Bill pairs to check; no bill is changed by this report')}</>)}
        rows={visible}
        rowKey={pair => pair.key}
        captionClassName="text-left font-semibold text-[var(--text)] pb-1"
        tableClassName="w-full text-sm"
        headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
        bodyClassName=""
        columns={[
          { header: reportText('r.vendor', 'Vendor'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (pair) => (<><bdi>{pair.left.vendor}</bdi>
              <div className="text-xs text-[var(--muted)]">{pair.strength === 'documented' ? reportText('r.shared-document-evidence', 'Shared document evidence') : reportText('r.date-window-only-review', 'Date window only — review')}</div></>) },
          { header: reportText('r.first-bill', 'First bill'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (pair) => (<><bdi>{pair.left.number}</bdi><div className="text-xs text-[var(--muted)]">{pair.left.date} · {pair.left.status}</div></>) },
          { header: reportText('r.second-bill', 'Second bill'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (pair) => (<><bdi>{pair.right.number}</bdi><div className="text-xs text-[var(--muted)]">{pair.right.date} · {pair.right.status}</div></>) },
          { header: reportText('r.amount', 'Amount'), className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (pair) => formatCurrency(pair.amountCents, currency) },
          { header: reportText('r.days-apart', 'Days apart'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (pair) => pair.daysApart },
          { header: reportText('r.evidence', 'Evidence'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (pair) => evidence(pair) },
        ]}
      />
      {!loading && !visible.length && <p className="text-sm text-[var(--muted)]">{reportText('r.no-pair-matches-that-does-not-prove-there-is-no', 'No pair matches. That does not prove there is no duplicate — only that nothing matched this vendor, amount and three-day window.')}</p>}
    </ReportTableScroll>
  </section>;
}
