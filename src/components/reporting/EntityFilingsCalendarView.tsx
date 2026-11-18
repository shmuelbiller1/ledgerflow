import React, { useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { entityFilings } from '../../lib/tax/entityFilings';
import { factSources } from '../../lib/rules/fromTaxProfiles';
import { getLocalDateISO } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import { downloadCsv } from '../../lib/csvExport';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

/** Code names, paths and URL shapes shown as-is: they are not words to translate (EU-G1). */
const CODE_NAMES = { compose: 'composeFacts', pack: 'filingPack' } as const;

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const CSV_HEADERS = ['Entity', 'Form', 'Frequency', 'Due', 'Source', 'Status', 'Because', 'Kind'] as const;

/** The year the calendar opens on: the local year today, never a stale hard-coded one. */
function currentFilingYear(todayIso: string): number {
  const year = Number(todayIso.slice(0, 4));
  return Number.isInteger(year) && year >= 2020 && year <= 2099 ? year : 2026;
}

/**
 * C-115: Entity filings calendar — what each entity owes for a year, and why.
 * Uses composeFacts + filingPack entity-period rules on Dec 31 of the year.
 */
export default function EntityFilingsCalendarView() {
  const reportText = useReportText();
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const dimensionNodes = useLedgerStore(s => s.dimensionNodes);
  const profiles = useMemo(() => workspace?.taxProfiles || {}, [workspace?.taxProfiles]);
  const [today] = useState(getLocalDateISO());
  const [year, setYear] = useState<number>(() => currentFilingYear(getLocalDateISO()));

  const entities = useMemo(() => {
    const labelKeys = Object.keys(profiles.labels || {});
    // Also offer world/* dimension nodes as entities even if no profile yet
    const nodeKeys = dimensionNodes.map(n => `${n.dimensionId}:${n.id}`);
    return [...new Set([...labelKeys, ...nodeKeys])];
  }, [profiles.labels, dimensionNodes]);

  // We call entityFilings with entities list (without 'books' — it adds it).
  // Reading the profiles is part of the calculation: one unreadable profile must not blank the
  // calendar, and a failure is reported as a failure — an empty table never reads as "nothing is due".
  const { results, error } = useMemo<{ results: ReturnType<typeof entityFilings>; error: string | null }>(() => {
    try {
      return { results: entityFilings(factSources(profiles), entities, year), error: null };
    } catch (e) {
      return { results: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [profiles, entities, year]);

  const allRows = useMemo(() => results.flatMap(r =>
    r.due.map(d => ({ entity: r.entity, kind: 'due' as const, form: d.form, frequency: d.frequency, due: d.due, source: d.source, status: d.status, because: d.because.join('; ') }))
  ), [results]);

  const blocked = useMemo(() => results.flatMap(r => r.blocked.map(b => ({ entity: r.entity, form: b.form, unverified: b.unverified.join(', ') }))), [results]);
  const undecided = useMemo(() => results.flatMap(r => r.undecided.map(u => ({ entity: r.entity, form: u.form, conflicting: u.conflicting.join(', ') }))), [results]);

  const handleCsv = () => {
    const rows = allRows.map(r => [r.entity, r.form, r.frequency || '', r.due || '', r.source, r.status, r.because, 'due']);
    // add blocked/undecided as extra rows
    for (const b of blocked) rows.push([b.entity, b.form, '', '', '', 'blocked', b.unverified, 'blocked']);
    for (const u of undecided) rows.push([u.entity, u.form, '', '', '', 'undecided', u.conflicting, 'undecided']);
    downloadCsv(`entity-filings-${year}`, [...CSV_HEADERS], rows);
  };

  return <section aria-label={reportText('r.entity-filings-calendar', 'Entity filings calendar')} className="p-4 space-y-4 min-w-0">
    <div className="space-y-1">
      <h2>{reportText('r.entity-filings-calendar', 'Entity filings calendar')}</h2>
      <p className="text-sm text-[var(--muted)]">
        {reportText('r.for-the-books-and-each-entity-label-value-the-fi', 'For the books and each entity label value, the filings its')} <i>{reportText('r.facts', 'facts')}</i> {reportText('r.require-this-year-entity-period-rules-on', 'require this year (entity-period rules on')} <b>{reportText('r.31-dec', '31 Dec')} {year}</b>{reportText('r.each-answer-keeps-its-evidence-trail-what-is-due', '). Each answer keeps its evidence trail: what is due and why, what is blocked because a fact is only declared, and what is undecided because facts conflict.')} <b>{reportText('r.read-only-pure', 'Read-only; pure.')}</b> {reportText('r.uses', 'Uses')} <code>{CODE_NAMES.compose}</code> + <code>{CODE_NAMES.pack}</code> {reportText('r.entity-period-rules-no-posting-no-verification-o', 'entity-period rules; no posting, no verification of a registration, no filing.')}
      </p>
      <p className="text-xs text-[var(--muted)]">{reportText('r.as-of-2', 'As of')} {today}{reportText('r.sources-carry-the-official-page-url-and-the-pack', '. Sources carry the official page URL and the pack status (')}<code>{reportText('r.calculation', 'calculation')}</code> {reportText('r.today-the-workspace-s-tax-profiles-and-labels-ar', 'today). The workspace’s tax profiles and labels are the only inputs; a label without a profile inherits the books.')}</p>
    </div>

    <div className="flex flex-wrap gap-3 items-end p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <label className="block text-sm">{reportText('r.year', 'Year')}
        <input type="number" className={field + ' mt-1'} value={year} onChange={e => setYear(Number(e.target.value) || currentFilingYear(getLocalDateISO()))} min={2020} max={2099} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={handleCsv} disabled={Boolean(error)}>{reportText('r.export-csv', 'Export CSV')}</button>
      <span className="text-xs text-[var(--muted)]">{entities.length} {reportText('r.label-s-the-books', 'label(s) + the books →')} {results.length} {reportText('r.entity-results', 'entity results ·')} {allRows.length} {reportText('r.due', 'due ·')} {blocked.length} {reportText('r.blocked', 'blocked ·')} {undecided.length} {reportText('r.undecided', 'undecided')}</span>
    </div>

      {error && <p role="alert" className="text-sm text-amber-700">{reportText('r.could-not-compute-the-filings-for', 'Could not compute the filings for')} {year}: <bdi>{error}</bdi>{reportText('r.this-is-a-failure-to-calculate', '. This is a failure to calculate,')} <b>{reportText('r.not', 'not')}</b> {reportText('r.an-all-clear-do-not-treat-the-table-as-empty-bec', 'an all-clear — do not treat the table as empty because nothing is due.')}</p>}
      <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50 align-top"
        caption={(<>{reportText('r.due-filings-rule-form-frequency-due-date-source', 'Due filings — rule, form, frequency, due date, source, status and because')}</>)}
        rows={allRows}
        rowKey={r => `${r.entity}|${r.form}|${r.due || ''}|${r.frequency || ''}`}
        captionClassName="text-left font-semibold text-[var(--text)] pb-1"
        tableClassName="w-full text-sm"
        headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
        bodyClassName=""
        columns={[
          { header: reportText('r.entity-2', 'Entity'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => <bdi>{r.entity}</bdi> },
          { header: reportText('r.form', 'Form'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => <bdi>{r.form}</bdi> },
          { header: reportText('r.frequency', 'Frequency'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => r.frequency || '—' },
          { header: reportText('r.due-2', 'Due'), className: "py-1 px-2 whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => r.due || '—' },
          { header: reportText('r.source', 'Source'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => <a href={r.source} target="_blank" rel="noopener noreferrer" className="underline break-all">{reportText('r.source-2', 'source')}</a> },
          { header: reportText('r.status', 'Status'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => r.status },
          { header: reportText('r.because', 'Because'), className: "py-1 px-2 text-xs max-w-[36ch]", headClassName: "text-left py-1 px-2", cell: (r) => r.because || '—' },
        ]}
      />
      {!allRows.length && !error && <p className="text-sm text-[var(--muted)]">{reportText('r.no-due-filing-for', 'No due filing for')} {year} {reportText('r.with-the-current-profiles-add-a-place-registrati', 'with the current profiles. Add a place/registration or mark a fact verified in Settings → Facts to see due rows; blocked and undecided are listed below.')}</p>}
    </ReportTableScroll>

    {(blocked.length || undecided.length) ? <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="rounded border border-[var(--line)] p-2">
        <h3 className="font-semibold text-sm">{reportText('r.blocked-unverified-fact', 'Blocked (unverified fact)')}</h3>
        {!blocked.length ? <p className="text-sm text-[var(--muted)]">{reportText('r.none-2', 'None.')}</p> : <ul className="text-sm list-disc pl-5">{blocked.map(b => <li key={`${b.entity}|${b.form}|${b.unverified}`}><bdi>{b.entity}</bdi>: {b.form} {reportText('r.needs', '— needs')} {b.unverified}</li>)}</ul>}
      </div>
      <div className="rounded border border-[var(--line)] p-2">
        <h3 className="font-semibold text-sm">{reportText('r.undecided-conflicting-facts', 'Undecided (conflicting facts)')}</h3>
        {!undecided.length ? <p className="text-sm text-[var(--muted)]">{reportText('r.none-2', 'None.')}</p> : <ul className="text-sm list-disc pl-5">{undecided.map(u => <li key={`${u.entity}|${u.form}|${u.conflicting}`}><bdi>{u.entity}</bdi>: {u.form} {reportText('r.conflict', '— conflict')} {u.conflicting}</li>)}</ul>}
      </div>
    </div> : null}

    <p className="text-xs text-[var(--muted)]">{reportText('r.capability', 'Capability:')} <b>{reportText('r.calculation-only', 'Calculation only')}</b> {reportText('r.dated-entity-period-rules-with-sources-nothing-f', '— dated entity-period rules with sources; nothing files, verifies or posts. See PLAN §10; blocked/undecided are shown plainly.')}</p>
  </section>;
}
