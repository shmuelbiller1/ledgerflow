/**
 * E-18: on-screen, temporary manual review of Israeli payroll withholding.
 * This does not modify posted pay runs or pretend US taxes are Israeli taxes.
 * Historical PayRun has no Israel-specific breakdown: each displayed field
 * must be entered from independently reviewed payroll documentation.
 */
import { useMemo, useState } from 'react';
import type { PayRun } from '../../types';
import { getLocalDateISO, formatCurrency } from '../../lib/utils';
import { israel102Review, type Israel102ReviewRun } from '../../lib/tax/israel102Review';

const INPUTS = [
  { key: 'incomeTax', label: 'Income tax withheld (separate tax reporting)' },
  { key: 'nationalEmployee', label: 'National Insurance — employee' },
  { key: 'nationalEmployer', label: 'National Insurance — employer' },
  { key: 'healthEmployee', label: 'Health insurance — employee' },
] as const;

type FieldKey = typeof INPUTS[number]['key'];
type RunDraft = Partial<Record<FieldKey, string>> & { reviewed?: boolean };

/** Converts typed ILS decimal strings to minor units; never uses floating-point rounding. */
export function exactIlsCents(text: string | undefined): number | undefined {
  if (text === undefined || !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(text.trim())) return undefined;
  const [whole, fraction = ''] = text.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : undefined;
}

export function IsraelForm102Review({
  payRuns, homeCurrency,
}: {
  payRuns: readonly PayRun[];
  homeCurrency: string;
}) {
  const [month, setMonth] = useState(() => getLocalDateISO().slice(0, 7));
  const [drafts, setDrafts] = useState<Record<string, RunDraft>>({});
  const [expanded, setExpanded] = useState(false);
  const posted = useMemo(() => payRuns.filter(run =>
    run.status === 'processed' && run.date.slice(0, 7) === month
  ), [payRuns, month]);
  const rowInputs = useMemo<Israel102ReviewRun[]>(() => posted.map(run => {
    const draft = drafts[run.id] || {};
    return {
      id: run.id, period: month, status: run.status, currency: homeCurrency,
      employeeCount: run.employeeCount,
      sourceReviewed: draft.reviewed === true,
      incomeTaxWithheldCents: exactIlsCents(draft.incomeTax),
      nationalEmployeeCents: exactIlsCents(draft.nationalEmployee),
      nationalEmployerCents: exactIlsCents(draft.nationalEmployer),
      healthEmployeeCents: exactIlsCents(draft.healthEmployee),
    };
  }), [posted, drafts, homeCurrency, month]);
  const review = useMemo(() => israel102Review(rowInputs, month), [rowInputs, month]);
  const canPreview = homeCurrency.toUpperCase() === 'ILS' && review.canReview;

  const update = (runId: string, field: FieldKey | 'reviewed', value: string | boolean) => {
    setDrafts(previous => ({
      ...previous, [runId]: { ...previous[runId], [field]: value },
    }));
  };
  return (
    <section aria-labelledby="il102-review-title" className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap gap-3 items-start justify-between">
        <div>
          <h2 id="il102-review-title" className="font-semibold text-neutral-900">Israel Form 102 — monthly review only</h2>
          <p className="text-xs text-neutral-600 mt-1 max-w-3xl">
            National Insurance Form 102 covers Israeli-resident employee/employer National Insurance and employee health insurance.
            Income tax withheld is shown separately; it is not part of that National Insurance return.
            No electronic report or tax payment is generated.
          </p>
        </div>
        <button type="button" aria-expanded={expanded} aria-controls="il102-review-body"
          onClick={() => setExpanded(value => !value)}
          className="min-h-11 px-3 rounded-lg border border-neutral-300 text-xs font-semibold">
          {expanded ? 'Close review' : 'Review monthly totals'}
        </button>
      </div>
      {expanded && (
        <div id="il102-review-body" className="space-y-4">
          <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-3">
            This is a temporary, non-persistent worksheet. Posted pay runs currently contain US-style payroll deductions,
            not verified Israeli Form 102 components. Enter each figure from separately checked Israeli payroll records.
            This workspace view may have only part of the pay-run history; never rely on this preview for filing.
          </p>
          <label className="block text-xs font-semibold text-neutral-800" htmlFor="il102-month">
            Payroll month
          </label>
          <input id="il102-month" aria-label="Israeli payroll month" type="month" value={month}
            onChange={event => setMonth(event.target.value)}
            className="min-h-11 rounded-lg border border-neutral-300 px-3 text-sm" />
          {homeCurrency.toUpperCase() !== 'ILS' && (
            <p role="alert" className="text-xs text-red-800">
              This workspace is not denominated in ILS. Entity-level currency and residency evidence are not available on existing pay runs; this preview is disabled.
            </p>
          )}
          {posted.length === 0 && (
            <p className="text-xs text-neutral-600">No processed pay runs were loaded for {month}. No figures can be inferred.</p>
          )}
          {posted.map(run => (
            <fieldset key={run.id} className="rounded-lg border border-neutral-200 p-3 space-y-3">
              <legend className="px-1 font-semibold text-neutral-800">
                <bdi>{run.date}</bdi> — {run.employeeCount} employee occurrence{run.employeeCount === 1 ? '' : 's'}
              </legend>
              <p className="text-xs text-neutral-500">Four exact ILS amounts, taken from independent reviewed payroll documents; blanks are not zero.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {INPUTS.map(field => (
                  <label key={field.key} className="text-xs text-neutral-700 space-y-1">
                    <span className="block">{field.label} (₪)</span>
                    <input type="text" inputMode="decimal"
                      aria-label={field.label + ' for pay run ' + run.date}
                      value={drafts[run.id]?.[field.key] || ''}
                      placeholder="0.00"
                      onChange={event => update(run.id, field.key, event.target.value)}
                      className="block w-full min-h-11 rounded-lg border border-neutral-300 px-3 text-sm font-mono" />
                  </label>
                ))}
              </div>
              <label className="flex gap-2 items-start text-xs text-neutral-700">
                <input type="checkbox" checked={drafts[run.id]?.reviewed === true}
                  onChange={event => update(run.id, 'reviewed', event.target.checked)}
                  className="mt-1 size-4" />
                <span>I checked that these figures are for Israeli-resident salaried employees, in ILS, for this posted run. This does not certify a filing.</span>
              </label>
            </fieldset>
          ))}
          {review.errors.length > 0 && (
            <ul role="alert" className="text-xs text-red-800 list-disc ps-5">
              {review.errors.map(error => <li key={error}>{error}</li>)}
            </ul>
          )}
          {canPreview && (
            <dl aria-label="Israeli monthly payroll review totals" className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg bg-neutral-50 p-3 text-xs">
              <div><dt>Reviewed pay runs</dt><dd className="font-semibold">{review.runCount}</dd></div>
              <div><dt>Employee occurrences (not unique people)</dt><dd className="font-semibold">{review.employeeOccurrences}</dd></div>
              <div><dt>Employee National Insurance</dt><dd className="font-semibold">{formatCurrency(review.nationalEmployeeCents, 'ILS')}</dd></div>
              <div><dt>Employer National Insurance</dt><dd className="font-semibold">{formatCurrency(review.nationalEmployerCents, 'ILS')}</dd></div>
              <div><dt>Employee health insurance</dt><dd className="font-semibold">{formatCurrency(review.healthEmployeeCents, 'ILS')}</dd></div>
              <div><dt>National + health total (review only)</dt><dd className="font-semibold">{formatCurrency(review.nationalAndHealthCents, 'ILS')}</dd></div>
              <div><dt>Income tax withheld (separate reporting)</dt><dd className="font-semibold">{formatCurrency(review.incomeTaxWithheldCents, 'ILS')}</dd></div>
            </dl>
          )}
          <p className="text-xs text-neutral-600">
            Official guidance: <a className="underline" target="_blank" rel="noopener noreferrer"
              href="https://www.gov.il/en/service/socialsecuritypaymentforemployees">National Insurance Form 102</a>.
            This view does not calculate rates, replace employer payroll reporting or create a submission file.
          </p>
        </div>
      )}
    </section>
  );
}
