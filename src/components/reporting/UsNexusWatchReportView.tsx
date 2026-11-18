import React, { useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { usNexusWatch, US_NEXUS_SUPPORTED_STATES, type NexusSaleDocument, type NexusYear, type UsNexusWatch } from '../../lib/tax/usNexusWatch';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import ReportTableScroll from './ReportTableScroll';

import { BRAND_NAME } from '../../config/brand';
import { useReportText, fill } from './useReportText';
const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Only this workspace's rows; a row with no workspace id is a fixture or a shared record. */
const inWorkspace = <T extends { workspaceId?: string }>(rows: T[] | undefined, workspaceId?: string | null) =>
  (rows || []).filter(row => !workspaceId || !row.workspaceId || row.workspaceId === workspaceId);

/**
 * CON-2: the US economic-nexus watch from the posted invoices — each state's sales and number of sales this
 * calendar year and last, against its threshold, with the states at 80% or over first. Read-only: it never says a
 * seller must register, and nothing here files, posts or registers anything.
 */
export default function UsNexusWatchReportView({ asOfDate: pageAsOfDate }: { asOfDate?: string } = {}) {
  const invoices = useLedgerStore(state => state.invoices);
  const creditNotes = useLedgerStore(state => state.creditNotes);
  const customers = useLedgerStore(state => state.customers);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const { loading } = useLedgerCollections('invoices', 'creditNotes', 'customers');
  // the Reports period's end date (a past year, a permalink), with the date field here to change it
  const [asOf, setAsOf] = usePageSyncedState(pageAsOfDate || '', pageAsOfDate || undefined, getLocalDateISO);
  const partial = Boolean(truncated.invoices || truncated.creditNotes || truncated.customers || failed.invoices || failed.creditNotes || failed.customers);

  const watch = useMemo(() => DATE.test(asOf) ? usNexusWatch({
    asOf,
    invoices: inWorkspace(invoices, workspaceId) as NexusSaleDocument[],
    creditNotes: inWorkspace(creditNotes, workspaceId) as NexusSaleDocument[],
    customers: inWorkspace(customers, workspaceId),
    profiles: workspace?.taxProfiles,
    order: [workspace?.dimensions?.find(d => d.isWorld)?.id || 'world'],
    currency: workspace?.currency || 'USD',
  }) : null, [asOf, invoices, creditNotes, customers, workspaceId, workspace]);

  return <UsNexusWatchPanel watch={watch} currency={workspace?.currency || 'USD'} asOf={asOf} onAsOfChange={setAsOf} loading={loading} partial={partial} />;
}

export function UsNexusWatchPanel({ watch, currency = 'USD', asOf, onAsOfChange, loading = false, partial = false }: {
  watch: UsNexusWatch | null;
  currency?: string;
  asOf: string;
  onAsOfChange: (value: string) => void;
  loading?: boolean;
  partial?: boolean;
}) {
  const reportText = useReportText();
  const watched = watch?.states.filter(s => s.warning) || [];
  const entities = new Set(watch?.states.map(s => s.entity)).size;
  const watchedStates = [...new Set(watched.map(s => s.state))];
  return <section aria-label={reportText('r.us-nexus-watch', 'US nexus watch')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.us-nexus-watch', 'US nexus watch')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.each-state-your-customers-are-in-the-sales-befor', 'Each state your customers are in: the sales before sales tax and the number of sales this calendar year and last, against the state’s economic-nexus threshold, from the posted invoices less credit notes, for each selling entity on its own. A sale counts where it went (its own tax place or ship-to state, else the customer’s). A state at 80% of a threshold is flagged before it is crossed. States measure differently (the previous or current year, the last four quarters, marketplace sales), so this is a watch, not a conclusion that you must register: ask your accountant or the state.')} {BRAND_NAME} {reportText('r.has-checked-the-tables-of', 'has checked the tables of')} {US_NEXUS_SUPPORTED_STATES.join(', ')}{reportText('r.other-states-are-shown-not-verified-nothing-here', '; other states are shown “not verified”. Nothing here files, posts or registers anything.')}
    </p>
    <label className="flex flex-col gap-1 text-sm max-w-xs">{reportText('r.as-of-2', 'As of')}
      <input type="date" aria-label={reportText('r.as-of-2', 'As of')} className={field} value={asOf} onChange={event => onAsOfChange(event.target.value)} />
    </label>
    {loading && <p role="status">{reportText('r.loading-the-invoices-credit-notes-and-customers', 'Loading the invoices, credit notes and customers…')}</p>}
    {partial && <p role="alert">{reportText('r.a-loaded-list-is-capped-or-failed-so-the-figures-2', 'A loaded list is capped or failed, so the figures below are provisional until it is complete.')}</p>}
    {!DATE.test(asOf) && <p role="alert">{reportText('r.write-the-date-as-2026-10-20', 'Write the date as 2026-10-20.')}</p>}
    {watch?.problem && <p role="alert" className="text-sm">{watch.problem}</p>}
    {watch && !watch.problem && <p role="status" className="text-sm">
      {watch.states.length
        ? fill(reportText('r.0-state-s-with-sales-1-at-80-of-a-threshold-or-o', '{0} state(s) with sales; {1} at 80% of a threshold or over{2}.'), { 0: new Set(watch.states.map(s => s.state)).size, 1: watchedStates.length, 2: watchedStates.length ? `: ${watchedStates.join(', ')}` : '' })
        : reportText('r.no-posted-sale-to-a-customer-with-a-us-tax-place', 'No posted sale to a customer with a US tax place in these two years.')}
      {watch.unplacedDocuments ? ` ${fill(reportText('r.0-posted-sale-s-have-a-customer-with-no-tax-plac', '{0} posted sale(s) have a customer with no tax place recorded, so they are in no state: add the customer\'s tax place.'), { 0: watch.unplacedDocuments })}` : ''}
      {watch.mixedEntityDocuments ? ` ${fill(reportText('r.0-posted-sale-s-have-lines-for-different-selling', '{0} posted sale(s) have lines for different selling entities, so they are left out rather than split by a guess.'), { 0: watch.mixedEntityDocuments })}` : ''}
      {' '}{reportText('r.invoices-keep-their-customer-s-tax-place-from-th', 'Invoices keep their customer\'s tax place from the day they were issued; older invoices without one are placed by the customer\'s tax place as recorded now.')}
    </p>}
    {watch && watch.states.length > 0 && <ReportTableScroll>
      <table className="w-full text-sm">
        <caption className="text-left font-semibold text-[var(--text)] pb-1">{reportText('r.sales-by-state-against-the-economic-nexus-thresh', 'Sales by state against the economic-nexus thresholds')}</caption>
        <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
          {[...(entities > 1 ? ['Entity'] : []), reportText('r.state', 'State'), reportText('r.status', 'Status'), fill(reportText('r.this-year-to-0', 'This year to {0}'), { 0: watch.asOf }), reportText('r.last-year-2', 'Last year'), reportText('r.threshold', 'Threshold'), reportText('r.permit', 'Permit'), reportText('r.table', 'Table')].map(head =>
            <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}
        </tr></thead>
        <tbody>
          {watch.states.map(s => <tr key={`${s.entity}|${s.state}`} className="border-b border-[var(--line)]/50 align-top">
            {entities > 1 && <td className="py-1 px-2">{s.entityName || (s.entity === 'books' ? reportText('r.the-books', 'The books') : s.entity.split(':').pop())}</td>}
            <th scope="row" className="text-left font-normal py-1 px-2">{s.thisYear?.stateName || s.lastYear?.stateName || s.state}</th>
            <td className="py-1 px-2">{s.noTest ? reportText('r.no-economic-nexus-test-in-this-state', 'No economic-nexus test in this state') : s.crossed ? reportText('r.threshold-crossed-ask-about-registering', 'Threshold crossed: ask about registering') : s.warning ? reportText('r.at-80-or-over-watch', 'At 80% or over: watch') : reportText('r.below-80', 'Below 80%')}</td>
            <td className="py-1 px-2 tabular-nums whitespace-nowrap">{yearText(s.thisYear, currency)}</td>
            <td className="py-1 px-2 tabular-nums whitespace-nowrap">{yearText(s.lastYear, currency)}</td>
            <td className="py-1 px-2">{thresholdText(s.thisYear || s.lastYear, currency)}</td>
            <td className="py-1 px-2">{s.permit ? reportText('r.recorded-2', 'Recorded') : reportText('r.none-recorded', 'None recorded')}</td>
            <td className="py-1 px-2">{s.verified ? reportText('r.checked-2', 'Checked') : reportText('r.not-verified', 'Not verified')}</td>
          </tr>)}
        </tbody>
      </table>
    </ReportTableScroll>}
  </section>;
}

function yearText(year: NexusYear | undefined, currency: string) {
  if (!year) return '—';
  const share = year.ratio === null ? '' : ` (${Math.round(year.ratio * 100)}%)`;
  return `${formatCurrency(year.salesCents, currency)}, ${year.orders} sale(s)${share}`;
}

function thresholdText(year: NexusYear | undefined, currency: string) {
  if (!year) return '—';
  const parts = [
    year.salesThresholdCents !== null ? formatCurrency(year.salesThresholdCents, currency) : '',
    year.transactions !== null ? `${year.transactions} sales` : '',
  ].filter(Boolean);
  if (!parts.length) return 'No economic-nexus test';
  return parts.join(year.test === 'both' ? ' and ' : ' or ');
}
