import React, { useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { entityFilings } from '../../lib/tax/entityFilings';
import { factSources } from '../../lib/rules/fromTaxProfiles';
import { getLocalDateISO } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import { downloadCsv } from '../../lib/csvExport';

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

  return <section aria-label="Entity filings calendar" className="p-4 space-y-4 min-w-0">
    <div className="space-y-1">
      <h2>Entity filings calendar</h2>
      <p className="text-sm text-[var(--muted)]">
        For the books and each entity label value, the filings its <i>facts</i> require this year (entity-period rules on <b>31 Dec {year}</b>). Each answer keeps its evidence trail: what is due and why, what is blocked because a fact is only declared, and what is undecided because facts conflict. <b>Read-only; pure.</b> Uses <code>composeFacts</code> + <code>filingPack</code> entity-period rules; no posting, no verification of a registration, no filing.
      </p>
      <p className="text-xs text-[var(--muted)]">As of {today}. Sources carry the official page URL and the pack status (<code>calculation</code> today). The workspace’s tax profiles and labels are the only inputs; a label without a profile inherits the books.</p>
    </div>

    <div className="flex flex-wrap gap-3 items-end p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <label className="block text-sm">Year
        <input type="number" className={field + ' mt-1'} value={year} onChange={e => setYear(Number(e.target.value) || currentFilingYear(getLocalDateISO()))} min={2020} max={2099} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={handleCsv} disabled={Boolean(error)}>Export CSV</button>
      <span className="text-xs text-[var(--muted)]">{entities.length} label(s) + the books → {results.length} entity results · {allRows.length} due · {blocked.length} blocked · {undecided.length} undecided</span>
    </div>

      {error && <p role="alert" className="text-sm text-amber-700">Could not compute the filings for {year}: <bdi>{error}</bdi>. This is a failure to calculate, <b>not</b> an all-clear — do not treat the table as empty because nothing is due.</p>}
      <ReportTableScroll>
      <table className="w-full text-sm">
        <caption className="text-left font-semibold text-[var(--text)] pb-1">Due filings — rule, form, frequency, due date, source, status and because</caption>
        <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">{['Entity', 'Form', 'Frequency', 'Due', 'Source', 'Status', 'Because'].map(h => <th key={h} scope="col" className="text-left py-1 px-2">{h}</th>)}</tr></thead>
        <tbody>
          {allRows.map(r => <tr key={`${r.entity}|${r.form}|${r.due || ''}|${r.frequency || ''}`} className="border-b border-[var(--line)]/50 align-top"><th scope="row" className="text-left font-normal py-1 px-2"><bdi>{r.entity}</bdi></th><td className="py-1 px-2"><bdi>{r.form}</bdi></td><td className="py-1 px-2">{r.frequency || '—'}</td><td className="py-1 px-2 whitespace-nowrap">{r.due || '—'}</td><td className="py-1 px-2"><a href={r.source} target="_blank" rel="noopener noreferrer" className="underline break-all">source</a></td><td className="py-1 px-2">{r.status}</td><td className="py-1 px-2 text-xs max-w-[36ch]">{r.because || '—'}</td></tr>)}
        </tbody>
      </table>
      {!allRows.length && !error && <p className="text-sm text-[var(--muted)]">No due filing for {year} with the current profiles. Add a place/registration or mark a fact verified in Settings → Facts to see due rows; blocked and undecided are listed below.</p>}
    </ReportTableScroll>

    {(blocked.length || undecided.length) ? <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="rounded border border-[var(--line)] p-2">
        <h3 className="font-semibold text-sm">Blocked (unverified fact)</h3>
        {!blocked.length ? <p className="text-sm text-[var(--muted)]">None.</p> : <ul className="text-sm list-disc pl-5">{blocked.map(b => <li key={`${b.entity}|${b.form}|${b.unverified}`}><bdi>{b.entity}</bdi>: {b.form} — needs {b.unverified}</li>)}</ul>}
      </div>
      <div className="rounded border border-[var(--line)] p-2">
        <h3 className="font-semibold text-sm">Undecided (conflicting facts)</h3>
        {!undecided.length ? <p className="text-sm text-[var(--muted)]">None.</p> : <ul className="text-sm list-disc pl-5">{undecided.map(u => <li key={`${u.entity}|${u.form}|${u.conflicting}`}><bdi>{u.entity}</bdi>: {u.form} — conflict {u.conflicting}</li>)}</ul>}
      </div>
    </div> : null}

    <p className="text-xs text-[var(--muted)]">Capability: <b>Calculation only</b> — dated entity-period rules with sources; nothing files, verifies or posts. See PLAN §10; blocked/undecided are shown plainly.</p>
  </section>;
}
