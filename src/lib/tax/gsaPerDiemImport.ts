/**
 * A-107: the US federal per diem (GSA) table import that feeds A-76.
 *
 * A-76's table carries the GSA standard CONUS meals-and-incidental (M&IE) rate only; the listed
 * localities (New York City $92 a day, Houston $80…) live in the GSA's own fiscal-year file.
 * This reads that file — "FY<year> Per Diem Rates" from the GSA per diem files page, saved as
 * CSV — by column name, and turns each locality into a dated PerDiemRow the expense claim can
 * suggest from, with the GSA named as the source on every row.
 *
 * The reading is strict in the house way. The fiscal year must be stated by the file (in its
 * rate-column names, like "FY26 Lodging Rate", or in a fiscal-year column) or chosen by the
 * person importing; it is never guessed from the amounts. A row that cannot be read refuses the
 * whole file with every problem listed — a half-read rate table suggesting the wrong locality's
 * rate is worse than no import. Seasonal rows (one locality, several lodging seasons) must agree
 * on M&IE; lodging stays on the locality for display and is never folded into the daily M&IE
 * allowance, because A-76's rows are meals-and-incidentals only.
 *
 * The file's opening standard-rate row is read separately, so the screen can check it against
 * A-76's built-in standard row for the same fiscal year instead of quietly replacing it.
 * CONUS only: Alaska, Hawaii and the territories are set by the Department of Defense, and
 * foreign per diem by the State Department — those files are not read here. Nothing this file
 * produces posts, files or saves; the claim records the rate the person leaves in the field.
 */
import { parseCsvChecked } from '../csv';
import type { PerDiemRow } from './expenseRateTables';

export const GSA_PER_DIEM_FILES_URL = 'https://www.gsa.gov/travel/plan-a-trip/per-diem-rates/per-diem-files';

export interface GsaSeason {
  /** season start as an ISO day inside the fiscal year, when the file gives one */
  begin?: string;
  end?: string;
  /** the season's daily lodging cap in whole cents, when the file gives one */
  lodgingCents: number | null;
}

export interface GsaLocality {
  fiscalYear: number;
  state: string;
  destination: string;
  county: string;
  /** the locality's daily M&IE allowance in whole cents (the same in every season) */
  mieCents: number;
  seasons: GsaSeason[];
}

export interface GsaPerDiemImport {
  fiscalYear: number;
  localities: GsaLocality[];
  /** the file's own standard CONUS M&IE row, when it carries one — for checking against A-76, not a locality */
  standardMieCents: number | null;
  standardLodgingCents: number | null;
}

const norm = (cell: unknown) => String(cell ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const findColumn = (header: string[], test: (name: string) => boolean) => header.findIndex(name => test(norm(name)));

function moneyCents(cell: string, what: string, row: number): number {
  const cleaned = cell.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error(`Row ${row}: the ${what} "${cell.trim()}" is not a dollar amount`);
  const cents = Math.round(Number(cleaned) * 100);
  if (cents <= 0 || cents > 1_000_000) throw new Error(`Row ${row}: the ${what} "${cell.trim()}" is outside $0.01–$10,000 — check the file is the GSA per diem rates file`);
  return cents;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "October 1" / "Feb 28" / "10/1" inside fiscal year Y (Oct 1 Y−1 … Sep 30 Y) as an ISO day. */
function seasonDay(cell: string, fiscalYear: number, row: number): string {
  const text = cell.trim().toLowerCase();
  let month = 0;
  let day = 0;
  const numeric = /^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/.exec(text);
  if (numeric) { month = Number(numeric[1]); day = Number(numeric[2]); } else {
    const named = /^([a-z]+)\s+(\d{1,2})$/.exec(text);
    if (named) {
      month = MONTHS.findIndex(m => m.startsWith(named[1])) + 1;
      day = Number(named[2]);
    }
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Row ${row}: the season date "${cell.trim()}" is not a month and day like "October 1"`);
  }
  const year = month >= 10 ? fiscalYear - 1 : fiscalYear;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) {
    throw new Error(`Row ${row}: the season date "${cell.trim()}" is not a real day in fiscal year ${fiscalYear}`);
  }
  return iso;
}

function fiscalYearFromHeader(header: string[]): number | null {
  for (const name of header) {
    const m = /\bfy\s?(\d{4}|\d{2})\b/i.exec(String(name ?? ''));
    if (m) {
      const year = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
      if (year >= 2000 && year <= 2100) return year;
    }
  }
  return null;
}

/**
 * Reads the GSA fiscal-year per diem CSV (the "FY<year> Per Diem Rates" workbook saved as CSV).
 * Throws one Error listing every problem found (row numbers are the file's own, header = row 1
 * of the header's line) and imports nothing. `fiscalYear` is the person's chosen year for a file
 * whose columns do not state it; a stated year that disagrees with the chosen one is refused.
 */
export function readGsaPerDiemCsv(content: string, options: { fiscalYear?: number } = {}): GsaPerDiemImport {
  if (String(content ?? '').length > 12_000_000) throw new Error('The file is over the 12 MB import limit. The GSA per diem rates workbook is well under 1 MB — the ZIP code file for developers is not read here.');
  const rows = parseCsvChecked(String(content ?? ''));
  if (rows.length > 50_001) throw new Error('The file has over 50,000 rows — the GSA per diem rates file lists a few hundred localities. The ZIP code file for developers is not read here.');

  let headerAt = -1;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const names = rows[i].map(norm);
    if (names.some(n => n === 'state') && names.some(n => n.includes('destination') || n === 'city')) { headerAt = i; break; }
  }
  if (headerAt < 0) {
    throw new Error(`No header row with State and Destination columns was found in the first rows. Download the "FY Per Diem Rates" workbook from the GSA per diem files page (${GSA_PER_DIEM_FILES_URL}) and save its rates sheet as CSV.`);
  }
  const header = rows[headerAt].map(cell => String(cell ?? ''));
  const stateCol = findColumn(header, n => n === 'state');
  const destinationCol = findColumn(header, n => n.includes('destination') || n === 'city');
  const countyCol = findColumn(header, n => n.includes('county'));
  const seasonBeginCol = findColumn(header, n => n.includes('season') && (n.includes('begin') || n.includes('start')));
  const seasonEndCol = findColumn(header, n => n.includes('season') && n.includes('end'));
  const lodgingCol = findColumn(header, n => n.includes('lodging'));
  const mieCol = findColumn(header, n => n.includes('m&ie') || n.includes('mie') || n.includes('meals'));
  const fyCol = findColumn(header, n => n === 'fy' || n.includes('fiscal year'));
  if (mieCol < 0) throw new Error('No meals-and-incidental (M&IE) rate column was found. The GSA rates file names it like "FY26 MIE Rate" — check the rates sheet was the one saved as CSV.');
  if (countyCol < 0) throw new Error('No County / Location Defined column was found — the county is what makes a locality unambiguous, so the file is not read without it.');

  const statedYear = fiscalYearFromHeader(header);
  const chosenYear = options.fiscalYear && Number.isInteger(options.fiscalYear) ? options.fiscalYear : null;
  if (statedYear && chosenYear && statedYear !== chosenYear) {
    throw new Error(`The file's rate columns say fiscal year ${statedYear}, not ${chosenYear}. Import it as FY${statedYear} or choose the matching GSA file.`);
  }

  const problems: string[] = [];
  const fileYears = new Set<number>();
  if (statedYear) fileYears.add(statedYear);
  const byKey = new Map<string, GsaLocality>();
  let standardMieCents: number | null = null;
  let standardLodgingCents: number | null = null;

  for (let i = headerAt + 1; i < rows.length; i++) {
    const rowNo = i + 1;
    const cells = rows[i].map(cell => String(cell ?? ''));
    const cell = (col: number) => (col >= 0 ? (cells[col] ?? '') : '');
    if (cells.every(c => !c.trim())) continue;
    try {
      if (fyCol >= 0 && cell(fyCol).trim()) {
        const y = Number(cell(fyCol).trim());
        if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error(`Row ${rowNo}: the fiscal year "${cell(fyCol).trim()}" is not a year like 2026`);
        fileYears.add(y);
      }
      const destination = cell(destinationCol).trim();
      const state = cell(stateCol).trim().toUpperCase();
      const mieCents = moneyCents(cell(mieCol), 'M&IE rate', rowNo);
      const lodgingCents = lodgingCol >= 0 && cell(lodgingCol).trim() ? moneyCents(cell(lodgingCol), 'lodging rate', rowNo) : null;
      if (!state && /standard/i.test(destination)) {
        if (standardMieCents !== null && standardMieCents !== mieCents) throw new Error(`Row ${rowNo}: a second standard-rate row gives a different M&IE — the file is not read`);
        standardMieCents = mieCents;
        standardLodgingCents = lodgingCents;
        continue;
      }
      if (!/^[A-Z]{2}$/.test(state)) throw new Error(`Row ${rowNo}: the state "${cell(stateCol).trim()}" is not a two-letter state code`);
      if (!destination) throw new Error(`Row ${rowNo}: the destination is empty`);
      const county = cell(countyCol).trim();
      if (!county) throw new Error(`Row ${rowNo}: ${destination}, ${state} has no county / location defined`);
      const fiscalYear = statedYear || chosenYear || [...fileYears][0] || 0;
      const season: GsaSeason = { lodgingCents };
      if (seasonBeginCol >= 0 && cell(seasonBeginCol).trim()) season.begin = seasonDay(cell(seasonBeginCol), fiscalYear, rowNo);
      if (seasonEndCol >= 0 && cell(seasonEndCol).trim()) season.end = seasonDay(cell(seasonEndCol), fiscalYear, rowNo);
      const key = `${state}|${destination.toLowerCase()}|${county.toLowerCase()}`;
      const existing = byKey.get(key);
      if (existing) {
        if (existing.mieCents !== mieCents) {
          throw new Error(`Row ${rowNo}: ${destination}, ${state} has two different M&IE rates ($${(existing.mieCents / 100).toFixed(2)} and $${(mieCents / 100).toFixed(2)}) — the GSA file sets one M&IE per locality, so the file is not read`);
        }
        existing.seasons.push(season);
      } else {
        byKey.set(key, { fiscalYear, state, destination, county, mieCents, seasons: [season] });
      }
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
      if (problems.length >= 20) break;
    }
  }

  const fiscalYear = statedYear || chosenYear || ([...fileYears].length === 1 ? [...fileYears][0] : null);
  if (!fiscalYear) {
    throw new Error(fileYears.size > 1
      ? `The file mixes fiscal years (${[...fileYears].sort().join(', ')}). Import one fiscal year's GSA file at a time.`
      : 'The file does not say which fiscal year its rates are for (its rate columns carry no FY year and there is no fiscal-year column). Choose the fiscal year on the import screen — the year is never guessed from the amounts.');
  }
  if (problems.length) {
    throw new Error(`Nothing was imported. ${problems.length === 20 ? 'The first 20 problems: ' : ''}${problems.join('; ')}`);
  }
  const localities = [...byKey.values()]
    .map(l => ({ ...l, fiscalYear }))
    .sort((a, b) => a.state.localeCompare(b.state) || a.destination.localeCompare(b.destination));
  if (!localities.length) throw new Error('The file has no locality rows below its header.');
  return { fiscalYear, localities, standardMieCents, standardLodgingCents };
}

/** "Houston, TX" — the text the claim's locality picker shows and matches exactly. */
export function gsaLocalityLabel(locality: GsaLocality): string {
  return `${locality.destination}, ${locality.state}`;
}

/** The locality behind an exactly picked "Destination, ST" label (case-insensitive), or null. */
export function findGsaLocality(localities: GsaLocality[], label: string): GsaLocality | null {
  const wanted = String(label ?? '').trim().toLowerCase();
  if (!wanted) return null;
  return localities.find(l => gsaLocalityLabel(l).toLowerCase() === wanted) || null;
}

/**
 * The imported localities as A-76 rows: one per locality, in force for its whole fiscal year
 * (Oct 1 to Sep 30), M&IE only. `retrieved` is the day the person imported the file, printed by
 * the claim beside the suggestion like every other table's read day.
 */
export function gsaLocalitiesToPerDiemRows(localities: GsaLocality[], retrieved: string): PerDiemRow[] {
  return localities.map(l => {
    const lodging = l.seasons.map(s => s.lodgingCents).filter((c): c is number => c !== null);
    const lodgingNote = lodging.length
      ? ` Lodging is separate (cap $${(Math.min(...lodging) / 100).toFixed(0)}${Math.max(...lodging) !== Math.min(...lodging) ? `–$${(Math.max(...lodging) / 100).toFixed(0)} by season` : ''} a night).`
      : ' Lodging is separate.';
    return {
      country: 'US',
      area: `${gsaLocalityLabel(l)} locality, meals and incidental expenses (M&IE)`,
      currency: 'USD',
      dailyCents: l.mieCents,
      validFrom: `${l.fiscalYear - 1}-10-01`,
      validTo: `${l.fiscalYear}-09-30`,
      source: { authority: 'U.S. General Services Administration', url: GSA_PER_DIEM_FILES_URL, retrieved, status: 'calculation' },
      note: `FY${l.fiscalYear} locality (${l.county}) read from the GSA per diem rates file.${lodgingNote} The first and last day of travel are 75% ($${((l.mieCents * 3 / 4) / 100).toFixed(2)}).`,
    };
  });
}

export const GSA_LOCALITIES_CSV_HEADERS = ['Fiscal year', 'State', 'Destination', 'County / location defined', 'M&IE per day', 'Lodging cap per night', 'Source', 'Source read'] as const;

export function gsaLocalitiesCsvRows(localities: GsaLocality[], retrieved: string): string[][] {
  return localities.map(l => {
    const lodging = l.seasons.map(s => s.lodgingCents).filter((c): c is number => c !== null);
    return [
      String(l.fiscalYear), l.state, l.destination, l.county,
      (l.mieCents / 100).toFixed(2),
      lodging.length ? [...new Set(lodging)].map(c => (c / 100).toFixed(2)).join(' / ') : '',
      `U.S. General Services Administration, ${GSA_PER_DIEM_FILES_URL}`, retrieved,
    ];
  });
}
