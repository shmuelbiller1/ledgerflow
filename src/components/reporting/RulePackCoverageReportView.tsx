import React, { useMemo, useState } from 'react';
import {
  ruleCoverage, ruleCoverageCsvRows, RULE_COVERAGE_CSV_HEADERS, COVERAGE_KINDS, COVERAGE_KIND_LABELS, CORE_COVERAGE_KINDS,
  type CoverageKind,
} from '../../lib/rules/coverage';
import { IL_VAT_SPECIAL_AREAS, ilVatAreaKeyFor, ilVatAreaNames } from '../../lib/tax/ilVat';
import { getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import { byCodeUnit } from '../../lib/codeUnitOrder';

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
  const [asOf, setAsOf] = useState(asOfDate || getLocalDateISO());
  const [country, setCountry] = useState('all');
  const [kind, setKind] = useState<CoverageKind | 'all'>('all');

  const coverage = useMemo(() => ruleCoverage({ asOf }), [asOf]);
  const countries = useMemo(() => [...new Set(coverage.rows.map(row => row.country).filter(Boolean))].sort(byCodeUnit), [coverage]);
  const rows = useMemo(() => coverage.rows.filter(row =>
    (country === 'all' || row.country === country) && (kind === 'all' || (row.kinds[kind] || 0) > 0)), [coverage, country, kind]);
  const shown = useMemo(() => ({ ...coverage, rows }), [coverage, rows]);
  const gaps = coverage.gaps.filter(gap => kind === 'all' || gap.kind === kind);

  return <section aria-label="Tax rule coverage" className="p-4 space-y-4 min-w-0">
    <h2>Tax rule coverage</h2>
    <p className="text-sm text-[var(--muted)]">
      What the tax rule packs say they cover, read from the packs themselves on the date below: every place (a country, or a state or
      province inside one) and, for each kind of rule, how many rules it has. A place that is not listed is a place this lane has not
      written rules for — never a statement that no tax applies there; that place&apos;s own authority governs.
      Rates, thresholds and taxability answers here are all &quot;calculation&quot; content, nothing is filed, accrued or posted from this screen.
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">In force on
        <input aria-label="Rules in force on this date" type="date" className={field} value={asOf} onChange={event => setAsOf(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">Country
        <select aria-label="Country" className={field} value={country} onChange={event => setCountry(event.target.value)}>
          <option value="all">All countries</option>
          {countries.map(code => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">Kind of rule
        <select aria-label="Kind of rule" className={field} value={kind} onChange={event => setKind(event.target.value as CoverageKind | 'all')}>
          <option value="all">Every kind</option>
          {COVERAGE_KINDS.map(k => <option key={k} value={k}>{COVERAGE_KIND_LABELS[k]}</option>)}
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!rows.length}
        onClick={() => downloadCsv(`rule-coverage-${asOf || 'all-dates'}`, RULE_COVERAGE_CSV_HEADERS, ruleCoverageCsvRows(shown))}>Export CSV</button>
    </div>

    <p className="text-sm" data-print-hide>
      {coverage.totals.places} place(s) · {coverage.totals.rules} rule(s) in force{asOf ? ` on ${asOf}` : ''} · {coverage.totals.packs} pack(s)
      {rows.length !== coverage.rows.length ? ` · ${rows.length} shown with these filters` : ''}
    </p>

    {gaps.map(gap => gap.places.length > 0 && <p key={gap.kind} className="text-sm text-[var(--muted)]">
      <b>{COVERAGE_KIND_LABELS[gap.kind]}:</b> {gap.places.length} covered place(s) have no rule of this kind
      {' — '}{gap.places.slice(0, GAP_SHOWN).join(', ')}{gap.places.length > GAP_SHOWN ? ` …and ${gap.places.length - GAP_SHOWN} more (all of them in the CSV)` : ''}
    </p>)}

    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>Rule pack coverage{asOf ? `, rules in force on ${asOf}` : ''}</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left py-1 px-2">Place</th>
            {COVERAGE_KINDS.map(k => <th key={k} scope="col" className="text-right py-1 px-2">{COVERAGE_KIND_LABELS[k]}</th>)}
            <th scope="col" className="text-right py-1 px-2">Rules</th>
            <th scope="col" className="text-left py-1 px-2">Packs</th>
            <th scope="col" className="text-right py-1 px-2">Sources</th>
            <th scope="col" className="text-left py-1 px-2">From</th>
            <th scope="col" className="text-left py-1 px-2">Latest start</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => <tr key={row.place} className="border-b border-[var(--line)]/50">
            <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{row.place}</bdi></th>
            {COVERAGE_KINDS.map(k => <td key={k} className="text-right py-1 px-2 tabular-nums">
              {row.kinds[k] ? row.kinds[k] : <span className="text-[var(--muted)]">—</span>}
            </td>)}
            <td className="text-right py-1 px-2 tabular-nums">{row.rules}</td>
            <td className="py-1 px-2 text-xs text-[var(--muted)]"><bdi>{row.packs.join(', ')}</bdi></td>
            <td className="text-right py-1 px-2 tabular-nums">{row.sources}</td>
            <td className="py-1 px-2">{row.earliestValidFrom}</td>
            <td className="py-1 px-2">{row.latestValidFrom}</td>
          </tr>)}
        </tbody>
      </table>
      {!rows.length && <p className="text-sm text-[var(--muted)]">No rule in the packs matches these filters.</p>}
    </ReportTableScroll>

    <details className="text-sm" data-il-special-areas>
      <summary className="min-h-11 cursor-pointer">Israel: the places outside the ordinary rate (A-99)</summary>
      <p className="text-[var(--muted)]">
        The rows the <code>il-vat</code> pack is built from, and every spelling each row recognises. The same recognition answers
        the line&rsquo;s rate on the invoice, so a book written <bdi>אילת</bdi> and a book written <bdi>Eilat</bdi> are one place here,
        and a place this table does not state stays at the ordinary rate rather than being guessed into a special one. An exemption is
        not a zero rate: in Eilat the resident dealer charges no VAT and has no input credit. Nothing here files, posts or decides an
        eligibility question the law leaves to the authority.
      </p>
      <ul className="list-disc ps-5 space-y-2">
        {IL_VAT_SPECIAL_AREAS.map(row => <li key={row.area}>
          <bdi className="font-semibold">{row.name}</bdi> <bdi className="font-semibold">{row.nameHebrew}</bdi>
          {' — '}{row.treatment === 'zero' ? 'outside the ordinary VAT' : 'the ordinary rate'}
          {`, ${(row.rate * 100).toFixed(row.rate % 1 === 0 ? 0 : 2)}%`}
          {`, in force ${row.validFrom}${row.validTo ? ` – ${row.validTo}` : ' onward'}.`}
          <div className="text-xs">Recognised as {ilVatAreaNames(row).map(name => <code key={name} className="me-2">{name}</code>)}</div>
          <div className="text-xs text-[var(--muted)]"><bdi>{row.note || ''}</bdi></div>
          <div className="text-xs"><a className="underline" href={row.source} target="_blank" rel="noopener noreferrer">{row.sourceAuthority || 'Source'}</a></div>
        </li>)}
      </ul>
      <p className="text-xs text-[var(--muted)]">
        Read the same way this screen reads them on {asOf}: {'אילת, Eilat, eilat, Tel Aviv'.split(', ').map(name => <span key={name} className="me-3"><bdi>{name}</bdi> → <code>{ilVatAreaKeyFor(name) || 'ordinary'}</code></span>)}
      </p>
    </details>

    <p className="text-xs text-[var(--muted)]">
      A rule of the four the queue asks about ({CORE_COVERAGE_KINDS.map(k => COVERAGE_KIND_LABELS[k]).join(', ')}) is counted once per place it names, so a
      state rule is a place inside its country and a pack&apos;s federal rows stay a country row of their own. &quot;Sources&quot; counts the distinct
      authority pages behind that place — a place with one source is one page read, not fifty-one checks.
    </p>
  </section>;
}
