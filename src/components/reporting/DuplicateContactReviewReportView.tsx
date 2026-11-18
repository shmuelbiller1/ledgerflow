import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { DUPLICATE_CONTACT_CSV_HEADERS, duplicateContactCsvRows, findDuplicateContactCandidates, type DuplicateContactReview, type DuplicateMatchSignal, type ReviewContact } from '../../lib/contactDuplicateReview';
import { normalizeSearchText } from '../../lib/textNormalization';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import type { Customer, Vendor } from '../../types';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const SIGNAL_LABEL: Record<DuplicateMatchSignal, string> = {
  'tax-id': 'Same tax ID',
  email: 'Same email',
  phone: 'Same phone',
  name: 'Same normalized name (weak)',
};

function taxIdOf(contact: Customer | Vendor): string | undefined {
  const metadata = contact.metadata as Record<string, unknown> | undefined;
  for (const key of ['taxId', 'taxNumber', 'vatNumber', 'ein', 'businessNumber']) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** A-135: candidates across customers and vendors; the existing merge workflow stays a separate user decision. */
export default function DuplicateContactReviewReportView() {
  const customers = useLedgerStore(state => state.customers);
  const vendors = useLedgerStore(state => state.vendors);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const { loading } = useLedgerCollections('customers', 'vendors');

  const report = useMemo(() => {
    const contacts: ReviewContact[] = [
      ...customers.filter(contact => !workspaceId || contact.workspaceId === workspaceId).map(contact => ({
        id: contact.id, kind: 'customer' as const, name: contact.name, email: contact.email, phone: contact.phone, taxId: taxIdOf(contact),
      })),
      ...vendors.filter(contact => !workspaceId || contact.workspaceId === workspaceId).map(contact => ({
        id: contact.id, kind: 'vendor' as const, name: contact.name, email: contact.email, phone: contact.phone, taxId: taxIdOf(contact),
      })),
    ];
    return findDuplicateContactCandidates(contacts);
  }, [customers, vendors, workspaceId]);

  const partial = Boolean(truncated.customers || failed.customers || truncated.vendors || failed.vendors);
  return <DuplicateContactReviewPanel report={report} loading={loading} partial={partial} />;
}

export function DuplicateContactReviewPanel({ report, loading = false, partial = false }: {
  report: DuplicateContactReview;
  loading?: boolean;
  partial?: boolean;
}) {
  const reportText = useReportText();
  const [filter, setFilter] = useState<'all' | 'identifier-match' | 'name-only'>('all');
  const [search, setSearch] = useState('');
  const query = normalizeSearchText(search.trim());
  const visible = report.pairs.filter(pair => {
    if (filter !== 'all' && pair.strength !== filter) return false;
    if (!query) return true;
    const haystack = normalizeSearchText([
      pair.left.name, pair.right.name, pair.left.id, pair.right.id,
      pair.left.kind, pair.right.kind, ...pair.signals.map(signal => SIGNAL_LABEL[signal]),
    ].join(' '));
    return haystack.includes(query);
  });

  return <section aria-label={reportText('r.duplicate-contact-review', 'Duplicate contact review')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.duplicate-contact-review', 'Duplicate contact review')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.compare-customer-and-vendor-records-in-this-work', 'Compare customer and vendor records in this workspace for exact tax-ID, email or phone matches, plus normalized-name suggestions. Name-only rows are weak candidates, not proof of identity; review both records and use the existing merge flow only if appropriate. This report never merges or edits a contact, and it does not display the matched identifier values.')}
    </p>

    {loading && <p role="status">{reportText('r.loading-customers-and-vendors', 'Loading customers and vendors…')}</p>}
    {partial && <p role="alert">{reportText('r.the-loaded-customer-or-vendor-list-is-capped-or', 'The loaded customer or vendor list is capped or failed. Duplicate candidates and CSV are provisional until complete contact lists are available.')}</p>}
    {report.ambiguousBuckets > 0 && <p role="alert">{report.ambiguousBuckets} {reportText('r.very-large-shared-value-group-s-were-not-expande', 'very large shared-value group(s) were not expanded into pairwise suggestions; inspect those contact groups directly.')}</p>}
    {report.truncated && <p role="alert">{reportText('r.candidate-output-reached-its-safety-cap-narrow-t', 'Candidate output reached its safety cap. Narrow the workspace data and review the displayed pairs before exporting.')}</p>}

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.match-evidence', 'Match evidence')}
        <select aria-label={reportText('r.match-evidence', 'Match evidence')} className={field} value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
          <option value="all">{reportText('r.all-suggestions', 'All suggestions')}</option>
          <option value="identifier-match">{reportText('r.identifier-match', 'Identifier match')}</option>
          <option value="name-only">{reportText('r.name-only-weak', 'Name only (weak)')}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.find-a-contact', 'Find a contact')}
        <input aria-label={reportText('r.find-a-contact', 'Find a contact')} className={field} value={search} onChange={event => setSearch(event.target.value)} placeholder={reportText('r.name-or-record-id', 'Name or record ID')} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!visible.length || loading || partial || report.truncated}
        onClick={() => downloadCsv('duplicate-contact-review', DUPLICATE_CONTACT_CSV_HEADERS, duplicateContactCsvRows(visible))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    <p className="text-sm"><b>{reportText('r.suggestions-shown', 'Suggestions shown:')}</b> {visible.length} {reportText('r.of', 'of')} {report.pairs.length}</p>
    <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50 align-top"
        caption={(<>{reportText('r.customer-and-vendor-pairs-to-review-no-record-is', 'Customer and vendor pairs to review; no record is changed')}</>)}
        rows={visible}
        rowKey={pair => pair.key}
        captionClassName=""
        tableClassName="w-full text-sm"
        headRowClassName=""
        bodyClassName=""
        columns={[
          { header: reportText('r.first-record', 'First record'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (pair) => (<><bdi>{pair.left.name || reportText('r.no-name-recorded', 'No name recorded')}</bdi><div className="text-xs text-[var(--muted)]">{pair.left.kind} · <code>{pair.left.id}</code></div></>) },
          { header: reportText('r.second-record', 'Second record'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (pair) => (<><bdi>{pair.right.name || reportText('r.no-name-recorded', 'No name recorded')}</bdi><div className="text-xs text-[var(--muted)]">{pair.right.kind} · <code>{pair.right.id}</code></div></>) },
          { header: reportText('r.match-reasons', 'Match reasons'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (pair) => pair.signals.map(signal => SIGNAL_LABEL[signal]).join(' · ') },
          { header: reportText('r.review-strength', 'Review strength'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (pair) => pair.strength === 'name-only' ? 'Weak name suggestion' : 'Identifier match — still review' },
        ]}
      />
      {!loading && !visible.length && <p className="text-sm text-[var(--muted)]">{reportText('r.no-candidate-pair-matches-this-filter-a-match-is', 'No candidate pair matches this filter. A match is not proof that two records are the same person or business.')}</p>}
    </ReportTableScroll>
  </section>;
}
