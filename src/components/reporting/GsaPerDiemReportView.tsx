import React, { useMemo, useState } from 'react';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import { PER_DIEM_ROWS } from '../../lib/tax/expenseRateTables';
import {
  GSA_LOCALITIES_CSV_HEADERS, GSA_PER_DIEM_FILES_URL, gsaLocalitiesCsvRows,
  gsaLocalityLabel, readGsaPerDiemCsv, type GsaPerDiemImport,
} from '../../lib/tax/gsaPerDiemImport';
import ReportTableScroll from './ReportTableScroll';

// GSA rates are US dollars by definition (not the workspace currency), so USD is stated.
const dollars = (cents: number) => formatCurrency(cents, 'USD');

/**
 * A-107: the US federal per diem (GSA) table, read from the GSA's own fiscal-year file.
 * The built-in A-76 table carries the standard CONUS rate; this screen reads the GSA locality
 * file so a trip to a listed locality can be checked against its own rate, and the expense
 * claim's per-diem line can import the same file and suggest the picked locality's rate.
 * Read-only: the import is previewed here, nothing is saved, posted or filed.
 */
export default function GsaPerDiemReportView() {
  const today = getLocalDateISO();
  const [fiscalChoice, setFiscalChoice] = useState('');
  const [read, setRead] = useState<GsaPerDiemImport | null>(null);
  const [fileName, setFileName] = useState('');
  const [problem, setProblem] = useState('');
  const [search, setSearch] = useState('');

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setProblem('');
    setRead(null);
    try {
      const chosen = /^\d{4}$/.test(fiscalChoice.trim()) ? Number(fiscalChoice.trim()) : undefined;
      setRead(readGsaPerDiemCsv(await file.text(), { fiscalYear: chosen }));
      setFileName(file.name);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      setFileName(file.name);
    }
  };

  const builtInStandard = read
    ? PER_DIEM_ROWS.find(r => r.country === 'US' && r.validFrom === `${read.fiscalYear - 1}-10-01`)
    : null;
  const rows = useMemo(() => {
    if (!read) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return read.localities;
    return read.localities.filter(l =>
      gsaLocalityLabel(l).toLowerCase().includes(needle) || l.county.toLowerCase().includes(needle));
  }, [read, search]);

  return <section aria-label="US per diem rates (GSA)" className="p-4 space-y-4 min-w-0">
    <h2>US per diem rates (GSA)</h2>
    <p className="text-sm text-[var(--muted)]">
      The US General Services Administration sets a daily meals-and-incidental (M&amp;IE) allowance for each
      listed locality in the continental United States, per fiscal year (October 1 to September 30). The
      expense claim&apos;s built-in table carries the standard rate for places with no locality of their own;
      download the fiscal year&apos;s <a href={GSA_PER_DIEM_FILES_URL} target="_blank" rel="noopener noreferrer">GSA per diem rates workbook</a>,
      save its rates sheet as CSV and read it here to see each locality&apos;s own rate — then a per-diem line on
      an expense claim can import the same file and take the rate of the locality you pick. The fiscal year
      comes from the file&apos;s rate columns, or from the year you type below; it is never guessed from the
      amounts. Lodging caps are shown beside the allowance and are never added into it. Alaska, Hawaii, the
      territories and foreign per diem are set by other agencies and are not in this file. Nothing here is
      saved or posted — the claim records the rate left in its field.
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">Fiscal year (only when the file does not state it)
        <input aria-label="Fiscal year" inputMode="numeric" className="min-h-11 w-28 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          placeholder="2026" value={fiscalChoice} onChange={e => setFiscalChoice(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">GSA per diem rates CSV
        <input aria-label="GSA per diem rates CSV" type="file" accept=".csv,text/csv"
          className="min-h-11 border rounded px-3 py-2 bg-[var(--panel)] text-[var(--text)]"
          onChange={e => void onFile(e.target.files?.[0])} />
      </label>
      {read && <label className="flex flex-col gap-1 text-sm">Search localities
        <input aria-label="Search localities" className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          placeholder="Houston, Harris…" value={search} onChange={e => setSearch(e.target.value)} />
      </label>}
      {read && <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!rows.length}
        onClick={() => downloadCsv(`gsa-per-diem-fy${read.fiscalYear}`, [...GSA_LOCALITIES_CSV_HEADERS], gsaLocalitiesCsvRows(rows, today))}>Export CSV</button>}
    </div>

    {problem && <p role="alert" className="text-sm">{problem}</p>}
    {read && <div role="status" className="text-sm space-y-1">
      <p>Read <b>{read.localities.length} localities</b> for fiscal year <b>{read.fiscalYear}</b> from {fileName} (read {today}).</p>
      {read.standardMieCents !== null && <p>
        The file&apos;s standard CONUS rate is {dollars(read.standardMieCents)} a day
        {builtInStandard
          ? builtInStandard.dailyCents === read.standardMieCents
            ? <> — it agrees with the built-in expense-claim table for FY{read.fiscalYear}.</>
            : <> — the built-in expense-claim table says {dollars(builtInStandard.dailyCents)} for FY{read.fiscalYear}. The GSA file is the authority; the built-in row should be updated to match it.</>
          : <> — the built-in expense-claim table has no standard row for FY{read.fiscalYear}, so claims for unlisted places type their rate.</>}
      </p>}
    </div>}

    {read && <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>GSA per diem localities, fiscal year {read.fiscalYear} ({rows.length} shown)</caption>
        <thead>
          <tr>
            {['Locality', 'County / location defined', 'M&IE per day', 'Lodging cap per night', 'Seasons'].map(head =>
              <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(l => (
            <tr key={`${l.state}-${l.destination}-${l.county}`} className="border-b border-[var(--line)]/50">
              <th scope="row" className="text-left font-normal py-1 px-2">{gsaLocalityLabel(l)}</th>
              <td className="py-1 px-2">{l.county}</td>
              <td className="py-1 px-2 tabular-nums">{dollars(l.mieCents)}</td>
              <td className="py-1 px-2 tabular-nums">
                {[...new Set(l.seasons.map(s => s.lodgingCents).filter((c): c is number => c !== null))].map(c => dollars(c)).join(' / ') || '—'}
              </td>
              <td className="py-1 px-2">
                {l.seasons.some(s => s.begin)
                  ? l.seasons.map(s => `${s.begin || '…'} to ${s.end || '…'}`).join('; ')
                  : `All of FY${read.fiscalYear}`}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="py-2 px-2">No locality matches — a place with no locality of its own takes the standard rate, it is not given a neighbour&apos;s.</td></tr>}
        </tbody>
      </table>
    </ReportTableScroll>}

    <p className="text-xs text-[var(--muted)]">
      Source: U.S. General Services Administration, per diem files ({GSA_PER_DIEM_FILES_URL}). The first and
      last day of travel are 75% of the M&amp;IE rate. Status: calculation — a reference for the rate a claim
      records, not a decision that a trip is deductible.
    </p>
  </section>;
}
