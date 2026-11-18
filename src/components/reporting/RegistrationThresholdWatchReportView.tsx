import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useServerRegistrationThreshold } from '../../hooks/useServerRegistrationThreshold';
import { RangeReportSourceNote } from './RangeReportSourceNote';
import { IL_OSEK_PATUR_CEILINGS } from '../../lib/tax/ilOsekPaturThresholds';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

/** Code names, form numbers, paths and identifiers shown as-is: they are not words to translate (EU-G1). */
const CODE_NAMES = { c0: 'il_osek_patur_turnover', c1: 'uk_vat_taxable_turnover', c2: 'ca_gst_taxable_supplies', c3: 'eu_oss_qualifying_b2c_supplies' } as const;

interface DimensionSelection { key: string; entity: string; activity: string }

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';

export default function RegistrationThresholdWatchReportView({ endDate = '' }: { endDate?: string }) {
  const reportText = useReportText();
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const userId = useAuthStore(state => state.user?.uid);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('accounts', 'transactions');

  const dimensions = workspace?.dimensions || [];
  const defaultEntity = dimensions.find(dimension => dimension.isWorld)?.id
    || dimensions.find(dimension => /entity/i.test(dimension.name || ''))?.id
    || '';
  const defaultActivity = dimensions.find(dimension => dimension.id !== defaultEntity &&
    (dimension.id.toLowerCase() === 'activity' || /activities|activity/i.test(dimension.name || '')))?.id || '';
  const selectionKey = `${userId || 'guest'}:${workspaceId || 'none'}`;
  const [dimensionSelection, setDimensionSelection] = useState<DimensionSelection | null>(null);
  const selected = dimensionSelection?.key === selectionKey ? dimensionSelection : { key: selectionKey, entity: defaultEntity, activity: defaultActivity };
  const entityDimensionId = dimensions.some(dimension => dimension.id === selected.entity) ? selected.entity : '';
  const activityDimensionId = dimensions.some(dimension => dimension.id === selected.activity && dimension.id !== entityDimensionId) ? selected.activity : '';
  const [chosenAsOf, setChosenAsOf] = useState<string | null>(null);
  const asOf = chosenAsOf ?? (endDate || getLocalDateISO());
  const valid = validCustomReportPeriod({ startDate: asOf, endDate: asOf });

  const currency = workspace?.currency;

  // A list that failed to load counts as settled (its first read never marks it loaded): the server answers then.
  const settled = useDataNeedsStore(state => (['accounts', 'transactions'] as const).every(key => state.loaded[key] || Boolean(state.failed[key])));
  const waiting = loading && !settled;
  const input = useMemo(() => (valid && !waiting ? {
    profiles: workspace?.taxProfiles, entityDimensionId, activityDimensionId, asOf, baseCurrency: currency,
  } : null), [workspace?.taxProfiles, entityDimensionId, activityDimensionId, asOf, currency, valid, waiting]);
  const { report, source } = useServerRegistrationThreshold(input);
  // A capped entry list stays provisional even when it seems to cover the windows: an edit that moves a loaded entry
  // before them leaves the cap unrefilled, so in-window entries can be missing (CodeRabbit on #507).
  const partial = source !== 'server' && (Boolean(truncated.dimensionNodes) || (['accounts', 'transactions'] as const).some(key => isCollectionCapped(truncated, key) || failed[key]));

  const setEntityDimension = (entity: string) => setDimensionSelection({
    key: selectionKey,
    entity,
    activity: selected.activity === entity ? '' : selected.activity,
  });
  const setActivityDimension = (activity: string) => setDimensionSelection({ key: selectionKey, entity: entityDimensionId, activity });
  const money = (cents: number, code?: string) => code ? formatCurrency(cents, code) : `${(cents / 100).toFixed(2)} (base currency unknown)`;

  return <section aria-label={reportText('r.registration-threshold-watch', 'Registration threshold watch')} className="p-4 space-y-4 min-w-0">
    <h2 className="text-lg font-semibold">{reportText('r.registration-threshold-watch', 'Registration threshold watch')}</h2>
    <p className="text-sm text-[var(--muted)]">{reportText('r.read-only-comparisons-of-posted-revenue-account', 'Read-only comparisons of posted revenue-account lines against dated Israel, UK and Canada thresholds and the EU-wide OSS-related place-of-supply threshold. Choose an entity dimension and an activity dimension; country is read from the entity’s Tax profile (or the Books profile for unassigned lines). Only the exact supported activity labels are counted, and threshold currencies are never converted or guessed.')}</p>
    <p className="text-sm text-[var(--muted)]">{reportText('r.this-is-a-sales-history-indicator-not-a-registra', 'This is a sales-history indicator, not a registration decision or tax filing. Statutory scopes include facts Ledgerflow does not infer: for example Israel’s eligibility and turnover basis, HMRC’s next-30-day expectation test, CRA’s worldwide/associated-person scope, and EU OSS establishment and supply-type conditions.')}</p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1">{reportText('r.as-of-2', 'As of')}
        <input aria-label={reportText('r.threshold-watch-as-of-date', 'Threshold watch as of date')} type="date" className={field} value={asOf} onChange={event => setChosenAsOf(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">{reportText('r.entity-dimension', 'Entity dimension')}
        <select aria-label={reportText('r.threshold-watch-entity-dimension', 'Threshold watch entity dimension')} className={field} value={entityDimensionId} onChange={event => setEntityDimension(event.target.value)}>
          <option value="">{reportText('r.books-profile-only-no-entity-grouping', 'Books profile only (no entity grouping)')}</option>
          {dimensions.map(dimension => <option key={dimension.id} value={dimension.id}>{dimension.name || dimension.id}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">{reportText('r.activity-labels-dimension', 'Activity labels dimension')}
        <select aria-label={reportText('r.threshold-watch-activity-dimension', 'Threshold watch activity dimension')} className={field} value={activityDimensionId} onChange={event => setActivityDimension(event.target.value)}>
          <option value="">{reportText('r.choose-a-dimension', 'Choose a dimension…')}</option>
          {dimensions.filter(dimension => dimension.id !== entityDimensionId).map(dimension => <option key={dimension.id} value={dimension.id}>{dimension.name || dimension.id}</option>)}
        </select>
      </label>
    </div>

    <div className="rounded border border-[var(--line)] p-3 text-sm space-y-1">
      <p className="font-medium">{reportText('r.supported-activity-labels-use-the-code-or-exact', 'Supported activity labels (use the code or exact display text on posted sales lines)')}</p>
      <ul className="list-disc pl-5">
        <li><code>{CODE_NAMES.c0}</code> {reportText('r.israel-osek-patur-qualifying-turnover', '— Israel osek patur qualifying turnover')}</li>
        <li><code>{CODE_NAMES.c1}</code> {reportText('r.uk-vat-taxable-turnover', '— UK VAT taxable turnover')}</li>
        <li><code>{CODE_NAMES.c2}</code> {reportText('r.canada-gst-hst-taxable-supplies', '— Canada GST/HST taxable supplies')}</li>
        <li><code>{CODE_NAMES.c3}</code> {reportText('r.qualifying-eu-oss-related-cross-border-b2c-suppl', '— qualifying EU OSS-related cross-border B2C supplies')}</li>
      </ul>
      <p>{reportText('r.create-these-as-values-in-the-selected-activity', 'Create these as values in the selected activity dimension (Settings → Labels), then assign them to the relevant posted revenue lines. For the EU label, use it only after checking supplier establishment, customer/supply type and goods-dispatch scope.')}</p>
    </div>

    {waiting && <p role="status">{reportText('r.loading-posted-sales-and-dimension-labels', 'Loading posted sales and dimension labels…')}</p>}
    {!valid && <p role="alert">{reportText('r.choose-a-valid-report-as-of-date', 'Choose a valid report as-of date.')}</p>}
    {partial && <p role="alert">{reportText('r.loaded-account-transaction-or-dimension-label-hi', 'Loaded account, transaction or dimension-label history is incomplete or failed to load. Any comparisons shown are provisional; missing records are not treated as zero.')}</p>}
    {!activityDimensionId && <p role="note">{reportText('r.choose-an-activity-label-dimension-to-compare-po', 'Choose an activity-label dimension to compare posted sales. No activity is inferred from account names or descriptions.')}</p>}
    <RangeReportSourceNote source={source} testId="registration-threshold-source" what={reportText('r.these-comparisons', 'these comparisons')} />
    {report && report.entitiesMissingCountry.length > 0 && <p role="alert">{reportText('r.no-country-fact-is-set-in-the-tax-profile-for', 'No country fact is set in the Tax profile for:')} {report.entitiesMissingCountry.join(', ')}{reportText('r.those-entities-are-not-assigned-a-jurisdictional', '. Those entities are not assigned a jurisdictional rule.')}</p>}
    {report && report.unclassifiedRevenueLineCount > 0 && <p role="alert">{report.unclassifiedRevenueLineCount} {reportText('r.posted-revenue-line-s-have-no-supported-activity', 'posted revenue line(s) have no supported activity label and are excluded from threshold comparisons.')}</p>}
    {report && report.invalidSplitLineCount > 0 && <p role="alert">{report.invalidSplitLineCount} {reportText('r.posted-revenue-line-s-have-invalid-split-allocat', 'posted revenue line(s) have invalid split-allocation weights and are excluded.')}</p>}

    {report && report.rows.length > 0 && <ReportTableScroll><RowTable
      rowClassName="border-t border-[var(--line)] align-top"
      caption={(<>{reportText('r.posted-sales-threshold-comparisons-as-of', 'Posted-sales threshold comparisons as of')} {asOf}</>)}
      rows={report.rows}
      rowKey={row => row.id}
      captionClassName=""
      tableClassName="w-full text-sm"
      headRowClassName=""
      bodyClassName=""
      columns={[
        { header: reportText('r.entity-2', 'Entity'), className: "text-left", headClassName: "", cell: (row) => (<><bdi>{row.entityName}</bdi><div className="text-xs text-[var(--muted)]">{row.activityLabel}</div></>) },
        { header: reportText('r.threshold-test', 'Threshold / test'), headClassName: "", cell: (row) => (<><bdi>{row.rule.name}</bdi><div className="text-xs text-[var(--muted)]">{row.rule.source.authority}</div><div className="text-xs text-[var(--muted)]"><bdi>{reportText('r.effective', 'Effective')} {row.rule.validFrom}{row.rule.validTo ? ` – ${row.rule.validTo}` : ` ${reportText('r.onward', 'onward')}`}</bdi></div></>) },
        { header: reportText('r.col-period', 'Period'), headClassName: "", cell: (row) => (<><bdi>{row.periodLabel}</bdi><div className="text-xs text-[var(--muted)]">{row.periodStart} – {row.periodEnd}</div></>) },
        { header: reportText('r.posted-sales', 'Posted sales'), className: "text-right tabular-nums", headClassName: "", cell: (row) => money(row.salesCents, row.baseCurrency) },
        { header: reportText('r.threshold', 'Threshold'), className: "text-right tabular-nums", headClassName: "", cell: (row) => formatCurrency(row.thresholdCents, row.thresholdCurrency) },
        { header: reportText('r.progress', 'Progress'), className: "text-right tabular-nums", headClassName: "", cell: (row) => row.progressPercent === null ? 'Not comparable' : `${row.progressPercent.toFixed(1)}%` },
        { header: reportText('r.comparison', 'Comparison'), headClassName: "", cell: (row) => row.result === 'currency-mismatch'
          ? `Not compared: ledger base ${row.baseCurrency || 'unknown'}, threshold ${row.thresholdCurrency}`
          : row.result === 'over'
            ? `${money(Math.abs(row.remainingCents || 0), row.baseCurrency)} over — review scope and dates`
            : row.result === 'at'
              ? 'At threshold — review scope and dates'
              : `${money(row.remainingCents || 0, row.baseCurrency)} below` },
        { header: reportText('r.official-sources', 'Official sources'), className: "whitespace-nowrap", headClassName: "", cell: (row) => (<><a className="underline" href={row.rule.source.url} target="_blank" rel="noopener noreferrer">{reportText('r.rule-source', 'Rule source')}</a>
          {row.rule.effect.kind === 'registration-threshold' && row.rule.effect.guidanceUrl && <> · <a className="underline" href={row.rule.effect.guidanceUrl} target="_blank" rel="noopener noreferrer">{reportText('r.scope-guidance', 'Scope guidance')}</a></>}</>) },
      ]}
    /></ReportTableScroll>}
    {report && report.rows.length === 0 && !waiting && <p>{reportText('r.no-threshold-comparison-can-be-made-from-the-rec', 'No threshold comparison can be made from the recognized posted sales. Configure an entity country in Tax profiles and assign a supported activity label to revenue lines; unclassified or absent activity is not assumed to be zero.')}</p>}
    <details className="text-sm" data-osek-patur-history>
      <summary className="min-h-11 cursor-pointer">{reportText('r.israel-the-osek-patur-ceiling-year-by-year-a-100', 'Israel: the osek patur ceiling, year by year (A-100)')}</summary>
      <p className="text-[var(--muted)]">
        {reportText('r.every-year-this-table-answers-for-with-the-day-i', 'Every year this table answers for, with the day its figure starts (1 January, the VAT Law’s indexation date) and the page it was read from. The ceiling is the comparison only: “does not exceed” means a year at the figure is inside it, and eligibility also turns on the occupation list in Regulation 13, the prior-year / expected-turnover basis, equipment sales left out of “מחזור עסקאות”, and every business the person runs — none of which this list can see. A year that is not listed is unknown, never zero, and the three years the comparison above uses are built from these rows rather than typed twice.')}
      </p>
      <ReportTableScroll>
      <RowTable
        rowClassName="border-t border-[var(--line)] align-top"
        caption={(<>{reportText('r.osek-patur-annual-turnover-ceiling-by-tax-year', 'Osek patur annual turnover ceiling by tax year (₪)')}</>)}
        rows={IL_OSEK_PATUR_CEILINGS}
        rowKey={row => row.year}
        captionClassName=""
        tableClassName="w-full text-sm"
        headRowClassName=""
        bodyClassName=""
        columns={[
          { header: reportText('r.tax-year', 'Tax year'), className: "text-left font-normal", headClassName: "text-left", cell: (row) => row.year },
          { header: reportText('r.ceiling', 'Ceiling'), className: "text-right tabular-nums", headClassName: "text-left", cell: (row) => formatCurrency(row.ceilingCents, 'ILS') },
          { header: reportText('r.from', 'From'), headClassName: "text-left", cell: (row) => row.validFrom },
          { header: reportText('r.until', 'Until'), headClassName: "text-left", cell: (row) => row.validTo || 'open — the Authority sets each year' },
          { header: reportText('r.how-the-year-s-figure-came-about', 'How the year\'s figure came about'), headClassName: "text-left", cell: (row) => row.basis === 'indexed' ? 'indexed to the consumer price index on 1 January' : row.basis === 'statute' ? 'fixed in the definition of "עוסק פטור"' : 'the published figure did not move for that January' },
          { header: reportText('r.read-from', 'Read from'), headClassName: "text-left", cell: (row) => (<><a className="underline" href={row.source.url} target="_blank" rel="noopener noreferrer">{row.source.authority}</a>
            {row.corroboratedBy ? <> · <a className="underline" href={row.corroboratedBy} target="_blank" rel="noopener noreferrer">{reportText('r.also-cited', 'also cited')}</a></> : null}
            <div className="text-xs text-[var(--muted)]"><bdi>{row.note}</bdi></div></>) },
        ]}
      />
      </ReportTableScroll>
    </details>

    {report?.rows.length ? <details className="text-sm"><summary className="min-h-11 cursor-pointer">{reportText('r.scope-and-statutory-limits', 'Scope and statutory limits')}</summary><ul className="list-disc pl-5 space-y-1">{report.rows.filter((row, index, rows) => rows.findIndex(candidate => candidate.rule.id === row.rule.id) === index).map(row => <li key={row.rule.id}><bdi>{row.rule.name}:</bdi> {row.rule.effect.kind === 'registration-threshold' ? row.rule.effect.note : ''}</li>)}</ul></details> : null}
  </section>;
}
