import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { registrationThresholdWatch } from '../../lib/registrationThresholdWatch';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';

interface DimensionSelection { key: string; entity: string; activity: string }

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';

export default function RegistrationThresholdWatchReportView({ endDate = '' }: { endDate?: string }) {
  const accounts = useLedgerStore(state => state.accounts);
  const transactions = useLedgerStore(state => state.transactions);
  const dimensionNodes = useLedgerStore(state => state.dimensionNodes);
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
  const partial = (['accounts', 'transactions'] as const).some(key => truncated[key] || failed[key]) || Boolean(truncated.dimensionNodes);
  const currency = workspace?.currency;

  const report = useMemo(() => valid && !loading ? registrationThresholdWatch({
    accounts: accounts.filter(row => !workspaceId || row.workspaceId === workspaceId),
    transactions: transactions.filter(row => !workspaceId || row.workspaceId === workspaceId),
    profiles: workspace?.taxProfiles,
    dimensionNodes,
    entityDimensionId,
    activityDimensionId,
    asOf,
    baseCurrency: currency,
  }) : null, [accounts, transactions, dimensionNodes, workspaceId, workspace?.taxProfiles, entityDimensionId, activityDimensionId, asOf, currency, valid, loading]);

  const setEntityDimension = (entity: string) => setDimensionSelection({
    key: selectionKey,
    entity,
    activity: selected.activity === entity ? '' : selected.activity,
  });
  const setActivityDimension = (activity: string) => setDimensionSelection({ key: selectionKey, entity: entityDimensionId, activity });
  const money = (cents: number, code?: string) => code ? formatCurrency(cents, code) : `${(cents / 100).toFixed(2)} (base currency unknown)`;

  return <section aria-label="Registration threshold watch" className="p-4 space-y-4 min-w-0">
    <h2 className="text-lg font-semibold">Registration threshold watch</h2>
    <p className="text-sm text-[var(--muted)]">Read-only comparisons of posted revenue-account lines against dated Israel, UK and Canada thresholds and the EU-wide OSS-related place-of-supply threshold. Choose an entity dimension and an activity dimension; country is read from the entity’s Tax profile (or the Books profile for unassigned lines). Only the exact supported activity labels are counted, and threshold currencies are never converted or guessed.</p>
    <p className="text-sm text-[var(--muted)]">This is a sales-history indicator, not a registration decision or tax filing. Statutory scopes include facts Ledgerflow does not infer: for example Israel’s eligibility and turnover basis, HMRC’s next-30-day expectation test, CRA’s worldwide/associated-person scope, and EU OSS establishment and supply-type conditions.</p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1">As of
        <input aria-label="Threshold watch as of date" type="date" className={field} value={asOf} onChange={event => setChosenAsOf(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">Entity dimension
        <select aria-label="Threshold watch entity dimension" className={field} value={entityDimensionId} onChange={event => setEntityDimension(event.target.value)}>
          <option value="">Books profile only (no entity grouping)</option>
          {dimensions.map(dimension => <option key={dimension.id} value={dimension.id}>{dimension.name || dimension.id}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">Activity labels dimension
        <select aria-label="Threshold watch activity dimension" className={field} value={activityDimensionId} onChange={event => setActivityDimension(event.target.value)}>
          <option value="">Choose a dimension…</option>
          {dimensions.filter(dimension => dimension.id !== entityDimensionId).map(dimension => <option key={dimension.id} value={dimension.id}>{dimension.name || dimension.id}</option>)}
        </select>
      </label>
    </div>

    <div className="rounded border border-[var(--line)] p-3 text-sm space-y-1">
      <p className="font-medium">Supported activity labels (use the code or exact display text on posted sales lines)</p>
      <ul className="list-disc pl-5">
        <li><code>il_osek_patur_turnover</code> — Israel osek patur qualifying turnover</li>
        <li><code>uk_vat_taxable_turnover</code> — UK VAT taxable turnover</li>
        <li><code>ca_gst_taxable_supplies</code> — Canada GST/HST taxable supplies</li>
        <li><code>eu_oss_qualifying_b2c_supplies</code> — qualifying EU OSS-related cross-border B2C supplies</li>
      </ul>
      <p>Create these as values in the selected activity dimension (Settings → Dimensions), then assign them to the relevant posted revenue lines. For the EU label, use it only after checking supplier establishment, customer/supply type and goods-dispatch scope.</p>
    </div>

    {loading && <p role="status">Loading posted sales and dimension labels…</p>}
    {!valid && <p role="alert">Choose a valid report as-of date.</p>}
    {partial && <p role="alert">Loaded account, transaction or dimension-label history is incomplete or failed to load. Any comparisons shown are provisional; missing records are not treated as zero.</p>}
    {!activityDimensionId && <p role="note">Choose an activity-label dimension to compare posted sales. No activity is inferred from account names or descriptions.</p>}
    {report && report.entitiesMissingCountry.length > 0 && <p role="alert">No country fact is set in the Tax profile for: {report.entitiesMissingCountry.join(', ')}. Those entities are not assigned a jurisdictional rule.</p>}
    {report && report.unclassifiedRevenueLineCount > 0 && <p role="alert">{report.unclassifiedRevenueLineCount} posted revenue line(s) have no supported activity label and are excluded from threshold comparisons.</p>}
    {report && report.invalidSplitLineCount > 0 && <p role="alert">{report.invalidSplitLineCount} posted revenue line(s) have invalid split-allocation weights and are excluded.</p>}

    {report && report.rows.length > 0 && <ReportTableScroll><table className="w-full text-sm">
      <caption>Posted-sales threshold comparisons as of {asOf}</caption>
      <thead><tr>
        <th scope="col">Entity</th><th scope="col">Threshold / test</th><th scope="col">Period</th>
        <th scope="col">Posted sales</th><th scope="col">Threshold</th><th scope="col">Progress</th><th scope="col">Comparison</th><th scope="col">Official sources</th>
      </tr></thead>
      <tbody>{report.rows.map(row => <tr key={row.id} className="border-t border-[var(--line)] align-top">
        <th scope="row" className="text-left"><bdi>{row.entityName}</bdi><div className="text-xs text-[var(--muted)]">{row.activityLabel}</div></th>
        <td><bdi>{row.rule.name}</bdi><div className="text-xs text-[var(--muted)]">{row.rule.source.authority}</div><div className="text-xs text-[var(--muted)]"><bdi>Effective {row.rule.validFrom}{row.rule.validTo ? ` – ${row.rule.validTo}` : ' onward'}</bdi></div></td>
        <td><bdi>{row.periodLabel}</bdi><div className="text-xs text-[var(--muted)]">{row.periodStart} – {row.periodEnd}</div></td>
        <td className="text-right tabular-nums">{money(row.salesCents, row.baseCurrency)}</td>
        <td className="text-right tabular-nums">{formatCurrency(row.thresholdCents, row.thresholdCurrency)}</td>
        <td className="text-right tabular-nums">{row.progressPercent === null ? 'Not comparable' : `${row.progressPercent.toFixed(1)}%`}</td>
        <td>{row.result === 'currency-mismatch'
          ? `Not compared: ledger base ${row.baseCurrency || 'unknown'}, threshold ${row.thresholdCurrency}`
          : row.result === 'over'
            ? `${money(Math.abs(row.remainingCents || 0), row.baseCurrency)} over — review scope and dates`
            : row.result === 'at'
              ? 'At threshold — review scope and dates'
              : `${money(row.remainingCents || 0, row.baseCurrency)} below`}</td>
        <td className="whitespace-nowrap"><a className="underline" href={row.rule.source.url} target="_blank" rel="noopener noreferrer">Rule source</a>
          {row.rule.effect.kind === 'registration-threshold' && row.rule.effect.guidanceUrl && <> · <a className="underline" href={row.rule.effect.guidanceUrl} target="_blank" rel="noopener noreferrer">Scope guidance</a></>}
        </td>
      </tr>)}</tbody>
    </table></ReportTableScroll>}
    {report && report.rows.length === 0 && !loading && <p>No threshold comparison can be made from the recognized posted sales. Configure an entity country in Tax profiles and assign a supported activity label to revenue lines; unclassified or absent activity is not assumed to be zero.</p>}
    {report?.rows.length ? <details className="text-sm"><summary className="min-h-11 cursor-pointer">Scope and statutory limits</summary><ul className="list-disc pl-5 space-y-1">{report.rows.filter((row, index, rows) => rows.findIndex(candidate => candidate.rule.id === row.rule.id) === index).map(row => <li key={row.rule.id}><bdi>{row.rule.name}:</bdi> {row.rule.effect.kind === 'registration-threshold' ? row.rule.effect.note : ''}</li>)}</ul></details> : null}
  </section>;
}
