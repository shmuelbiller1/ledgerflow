import React, { useMemo, useState } from 'react';
import {
  ruleCoverage, ruleCoverageCsvRows, RULE_COVERAGE_CSV_HEADERS, COVERAGE_KINDS, CORE_COVERAGE_KINDS,
  type CoverageKind,
} from '../../lib/rules/coverage';
import { IL_VAT_SPECIAL_AREAS, ilVatAreaKeyFor, ilVatAreaNames } from '../../lib/tax/ilVat';
import { formatDate, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportSchedule from './ReportSchedule';
import { byCodeUnit } from '../../lib/codeUnitOrder';
import { useReportText, fill } from './useReportText';

/** Code names, form numbers, paths and identifiers shown as-is: they are not words to translate (EU-G1). */
const CODE_NAMES = { c0: 'il-vat', c1: 'Eilat' } as const;

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
/** How many missing places the gaps list spells out before it says "…and N more" (the CSV has them all). */
const GAP_SHOWN = 12;

/**
 * A-111: rule pack coverage. Which places the tax rule packs have rules for, and of which kind —
 * a rate, a taxability answer, a nexus threshold, a registration threshold, a filing rule and the
 * rest of the kinds this lane writes. Read-only: it reads the packs themselves, decides nothing and
 * files nothing.
 */
export default function RulePackCoverageReportView({ asOfDate = '' }: { asOfDate?: string }) {
  const reportText = useReportText();
  const kindName: Record<CoverageKind, string> = {
    'rate': reportText('r.rate', 'Rate'),
    'taxability': reportText('r.coverage-taxability', 'Taxability'),
    'nexus': reportText('r.coverage-nexus', 'Nexus'),
    'registration': reportText('r.registration', 'Registration'),
    'filing': reportText('r.coverage-filing', 'Filing'),
    'marketplace': reportText('r.coverage-marketplace', 'Marketplace'),
    'withholding': reportText('r.coverage-withholding', 'Withholding'),
    'reverse-charge': reportText('r.coverage-reverse-charge', 'Reverse charge'),
    'scheme': reportText('r.coverage-scheme', 'Scheme'),
    'use-tax': reportText('r.coverage-use-tax', 'Use tax'),
    'import-vat': reportText('r.coverage-import-vat', 'Import VAT'),
  };
  const [asOf, setAsOf] = useState(asOfDate || getLocalDateISO());
  const [country, setCountry] = useState('all');
  const [kind, setKind] = useState<CoverageKind | 'all'>('all');

  const coverage = useMemo(() => ruleCoverage({ asOf }), [asOf]);
  const countries = useMemo(() => [...new Set(coverage.rows.map(row => row.country).filter(Boolean))].sort(byCodeUnit), [coverage]);
  const rows = useMemo(() => coverage.rows.filter(row =>
    (country === 'all' || row.country === country) && (kind === 'all' || (row.kinds[kind] || 0) > 0)), [coverage, country, kind]);
  const shown = useMemo(() => ({ ...coverage, rows }), [coverage, rows]);
  const gaps = coverage.gaps.filter(gap => kind === 'all' || gap.kind === kind);

  return <section aria-label={reportText('r.tax-rule-coverage', 'Tax rule coverage')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.tax-rule-coverage', 'Tax rule coverage')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.what-the-tax-rule-packs-say-they-cover-read-from', 'What the tax rule packs say they cover, read from the packs themselves on the date below: every place (a country, or a state or province inside one) and, for each kind of rule, how many rules it has. A place that is not listed is a place this lane has not written rules for — never a statement that no tax applies there; that place\'s own authority governs. Rates, thresholds and taxability answers here are all "calculation" content, nothing is filed, accrued or posted from this screen.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.in-force-on', 'In force on')}
        <input aria-label={reportText('r.rules-in-force-on-this-date', 'Rules in force on this date')} type="date" className={field} value={asOf} onChange={event => setAsOf(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.country', 'Country')}
        <select aria-label={reportText('r.country', 'Country')} className={field} value={country} onChange={event => setCountry(event.target.value)}>
          <option value="all">{reportText('r.all-countries', 'All countries')}</option>
          {countries.map(code => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.kind-of-rule', 'Kind of rule')}
        <select aria-label={reportText('r.kind-of-rule', 'Kind of rule')} className={field} value={kind} onChange={event => setKind(event.target.value as CoverageKind | 'all')}>
          <option value="all">{reportText('r.every-kind', 'Every kind')}</option>
          {COVERAGE_KINDS.map(k => <option key={k} value={k}>{kindName[k]}</option>)}
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!rows.length}
        onClick={() => downloadCsv(`rule-coverage-${asOf || 'all-dates'}`, RULE_COVERAGE_CSV_HEADERS, ruleCoverageCsvRows(shown))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    <p className="text-sm" data-print-hide>
      {coverage.totals.places} {reportText('r.place-s', 'place(s) ·')} {coverage.totals.rules} {reportText('r.rule-s-in-force', 'rule(s) in force')}{asOf ? ` ${fill(reportText('r.on-0', 'on {0}'), { 0: formatDate(asOf) })}` : ''} · {coverage.totals.packs} {reportText('r.pack-s', 'pack(s)')}
      {rows.length !== coverage.rows.length ? ` ${fill(reportText('r.0-shown-with-these-filters', '· {0} shown with these filters'), { 0: rows.length })}` : ''}
    </p>

    {gaps.map(gap => gap.places.length > 0 && <p key={gap.kind} className="text-sm text-[var(--muted)]">
      <b>{kindName[gap.kind]}:</b> {gap.places.length} {reportText('r.covered-place-s-have-no-rule-of-this-kind', 'covered place(s) have no rule of this kind')}
      {' — '}{gap.places.slice(0, GAP_SHOWN).join(', ')}{gap.places.length > GAP_SHOWN ? ` ${fill(reportText('r.and-0-more-all-of-them-in-the-csv', '…and {0} more (all of them in the CSV)'), { 0: gap.places.length - GAP_SHOWN })}` : ''}
    </p>)}

    <ReportSchedule
      columnControls
      allowDisplayedExport
      caption={<>{reportText('r.rule-pack-coverage', 'Rule pack coverage')}{asOf ? fill(reportText('r.rules-in-force-on-0', ', rules in force on {0}'), { 0: formatDate(asOf) }) : ''}</>}
      rowClassName="border-b border-[var(--line)]/50"
      bodyClassName=""
      rows={rows} rowKey={row => row.place}
      columns={[
        { header: reportText('r.place', 'Place'), cell: row => <bdi>{row.place}</bdi> },
        { over: COVERAGE_KINDS, head: k => kindName[k], align: 'right', className: 'tabular-nums', cell: (row, k) => row.kinds[k] ? row.kinds[k] : <span className="text-[var(--muted)]">—</span> },
        { header: reportText('r.rules', 'Rules'), align: 'right', className: 'tabular-nums', cell: row => row.rules },
        { header: reportText('r.packs', 'Packs'), className: 'text-xs text-[var(--muted)]', cell: row => <bdi>{row.packs.join(', ')}</bdi> },
        { header: reportText('r.sources-2', 'Sources'), align: 'right', className: 'tabular-nums', cell: row => row.sources },
        { header: reportText('r.from', 'From'), cell: row => row.earliestValidFrom },
        { header: reportText('r.latest-start', 'Latest start'), cell: row => row.latestValidFrom },
      ]} />

    <details className="text-sm" data-il-special-areas>
      <summary className="min-h-11 cursor-pointer">{reportText('r.israel-the-places-outside-the-ordinary-rate-a-99', 'Israel: the places outside the ordinary rate (A-99)')}</summary>
      <p className="text-[var(--muted)]">
        {reportText('r.the-rows-the', 'The rows the')} <code>{CODE_NAMES.c0}</code> {reportText('r.pack-is-built-from-and-every-spelling-each-row-r', 'pack is built from, and every spelling each row recognises. The same recognition answers the line’s rate on the invoice, so a book written')} <bdi>{reportText('r.x-11', 'אילת')}</bdi> {reportText('r.and-a-book-written', 'and a book written')} <bdi>{CODE_NAMES.c1}</bdi> {reportText('r.are-one-place-here-and-a-place-this-table-does-n', 'are one place here, and a place this table does not state stays at the ordinary rate rather than being guessed into a special one. An exemption is not a zero rate: in Eilat the resident dealer charges no VAT and has no input credit. Nothing here files, posts or decides an eligibility question the law leaves to the authority.')}
      </p>
      <ul className="list-disc ps-5 space-y-2">
        {IL_VAT_SPECIAL_AREAS.map(row => <li key={row.area}>
          <bdi className="font-semibold">{row.name}</bdi> <bdi className="font-semibold">{row.nameHebrew}</bdi>
          {' — '}{row.treatment === 'zero' ? reportText('r.outside-the-ordinary-vat', 'outside the ordinary VAT') : reportText('r.the-ordinary-rate', 'the ordinary rate')}
          {`, ${(row.rate * 100).toFixed(row.rate % 1 === 0 ? 0 : 2)}%`}
          {fill(reportText('r.in-force-0-1', ', in force {0}{1}.'), { 0: row.validFrom, 1: row.validTo ? ` – ${row.validTo}` : ' onward' })}
          <div className="text-xs">{reportText('r.recognised-as', 'Recognised as')} {ilVatAreaNames(row).map(name => <code key={name} className="me-2">{name}</code>)}</div>
          <div className="text-xs text-[var(--muted)]"><bdi>{row.note || ''}</bdi></div>
          <div className="text-xs"><a className="underline" href={row.source} target="_blank" rel="noopener noreferrer">{row.sourceAuthority || reportText('r.source', 'Source')}</a></div>
        </li>)}
      </ul>
      <p className="text-xs text-[var(--muted)]">
        {reportText('r.read-the-same-way-this-screen-reads-them-on', 'Read the same way this screen reads them on')} {asOf}: {'אילת, Eilat, eilat, Tel Aviv'.split(', ').map(name => <span key={name} className="me-3"><bdi>{name}</bdi> → <code>{ilVatAreaKeyFor(name) || reportText('r.ordinary', 'ordinary')}</code></span>)}
      </p>
    </details>

    <p className="text-xs text-[var(--muted)]">
      {reportText('r.a-rule-of-the-four-the-queue-asks-about', 'A rule of the four the queue asks about (')}{CORE_COVERAGE_KINDS.map(k => kindName[k]).join(', ')}{reportText('r.is-counted-once-per-place-it-names-so-a-state-ru', ') is counted once per place it names, so a state rule is a place inside its country and a pack\'s federal rows stay a country row of their own. "Sources" counts the distinct authority pages behind that place — a place with one source is one page read, not fifty-one checks.')}
    </p>
  </section>;
}
