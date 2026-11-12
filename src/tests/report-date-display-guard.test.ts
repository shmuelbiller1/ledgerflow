/**
 * H-8 (AI #10): a report must not print the stored date.
 *
 * A stored date is `2026-10-01`: a storage format, not something a reader in New York, London or
 * Tel Aviv expects, and not what the rows under it say. `src/lib/reportLocale.ts` resolves the
 * reader's choice (Preferences → Date Display Format first, then the workspace's saved locale, then
 * the interface language) and `useReportDates()` applies it.
 *
 * This guard looks only at what a reader actually sees: the text between JSX tags. It flags an
 * interpolation whose whole value is a date-named field — `{startDate}`, `{row.date}`,
 * `{report.asOfDate}` — or a template literal that splices one into a sentence. That is the shape
 * that was shipping (`{startDate} to {endDate}` in a caption, a heading or a pack cover).
 *
 * It deliberately ignores: form controls (`value`/`min`/`max` must keep the ISO date — it is what
 * the form submits), `dateTime=` machine attributes, file names and URLs made from a template
 * literal (`.csv`, `/api/` — data a machine reads and an import has to match), `toLocale*` (already
 * a reader format), comparisons and arithmetic, and calls such as
 * `reportDates.periodText(startDate, endDate)` (the resolver itself).
 *
 * The backlog below is a ratchet: a file may be removed from it (that is the work), never added, and
 * an entry that no longer appears has to be removed in the same commit that fixed it. It is not a
 * claim that these are the only places a stored date reaches a reader — it is what this scan saw
 * when the guard was written (11 Nov 2026, 84 files). Fixing one is a good day for whoever owns that
 * screen; the money, tax and posting sheets are not on the list on purpose (AI #1's lane).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/** Report surfaces where a date is read by a person. */
const SURFACES = ['src/components/reporting', 'src/components/ledger'];

/** Names that hold a stored calendar date rather than a formatted label. */
const DATE_FIELD = /^(?:\w+\.)*(?:\w*(?:[Dd]ate|asOf)\w*)$/;

/** The three headers this change fixed: a regression here fails the guard outright. */
const FIXED = [
  'src/components/ledger/GeneralLedgerView.tsx',
  'src/components/ledger/StatementColumns.tsx',
  'src/components/reporting/reportPack/ReportPackDialog.tsx',
];

/** Everything else this scan still sees, as of 11 Nov 2026. Only ever gets shorter. */
const KNOWN_RAW_DATE_FILES = new Set<string>(JSON.parse(fs.readFileSync(path.join(ROOT, 'src/tests/fixtures/report-date-backlog.json'), 'utf8')));

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) found.push(full);
  }
  return found;
}

function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * A template literal that builds a file name, a URL or a CSV cell is data, not a page: the stored
 * ISO date is exactly what belongs there (Excel reads it, an import matches it).
 */
function isDataTemplate(text: string): boolean {
  return /\.csv|\.json|\.xlsx|https?:|\/api\/|content-disposition/i.test(text);
}

interface Region { text: string; line: number; start: number; end: number }

/** The reader-visible text of a JSX file: what sits between `>` and `<`, plus on-screen templates. */
function visibleText(source: string): Region[] {
  const regions: Region[] = [];
  const lineAt = (offset: number) => source.slice(0, offset).split('\n').length;
  for (const match of source.matchAll(/>([^<>]*)</g)) {
    const text = match[1];
    if (!text.trim()) continue;
    // a `>…<` run that holds statements is code between two JSX tags, not text a reader sees
    if (/=>|;|\bconst\b|\bfunction\b|\breturn\b/.test(text)) continue;
    regions.push({ text, line: lineAt(match.index! + 1), start: match.index!, end: match.index! + match[0].length });
  }
  for (const match of source.matchAll(/`([^`]*)`/g)) {
    const text = match[1];
    if (!/\$\{/.test(text)) continue;
    if (isDataTemplate(match[0])) continue;
    // a template literal inside a `>`…`<` region was already read as text above
    if (regions.some(region => match.index! >= region.start && match.index! <= region.end)) continue;
    regions.push({ text, line: lineAt(match.index!), start: match.index!, end: match.index! + match[0].length });
  }
  return regions;
}

/** The date-named values a region interpolates, in order. */
function rawDates(region: string): string[] {
  const names: string[] = [];
  for (const match of region.matchAll(/\{\s*([A-Za-z_$][\w$.]*)\s*\}/g)) {
    if (DATE_FIELD.test(match[1])) names.push(match[1]);
  }
  for (const match of region.matchAll(/\$\{\s*([A-Za-z_$][\w$.]*)\s*\}/g)) {
    if (DATE_FIELD.test(match[1])) names.push(match[1]);
  }
  return names;
}

test('H-8: the screens fixed here print no stored date, and the rest only shrink', () => {
  const offenders: string[] = [];
  const found = new Set<string>();
  for (const surface of SURFACES) {
    for (const file of walk(path.join(ROOT, surface))) {
      const source = codeOnly(fs.readFileSync(file, 'utf8'));
      const relative = path.relative(ROOT, file);
      for (const region of visibleText(source)) {
        // a sentence that already goes through the resolver or a locale form
        if (/reportDates\.|reportDateText|reportPeriodText|toLocale|formatDate\(/.test(region.text)) continue;
        for (const name of rawDates(region.text)) {
          found.add(relative);
          if (FIXED.includes(relative)) offenders.push(`${relative}:${region.line}: ${name}`);
        }
      }
    }
  }

  assert.deepEqual(
    [...new Set(offenders)],
    [],
    'these fixed screens write a stored ISO date where a reader reads it again '
      + '(use reportDates.periodText(...) / reportDates.dateText(...) from ../reporting/useReportDates):\n'
      + [...new Set(offenders)].join('\n'),
  );

  const added = [...found].filter(file => !KNOWN_RAW_DATE_FILES.has(file));
  assert.deepEqual(added, [], 'these screens newly print a stored ISO date to a reader (H-8):\n' + added.join('\n'));
  const stale = [...KNOWN_RAW_DATE_FILES].filter(file => !found.has(file) && !FIXED.includes(file));
  assert.deepEqual(
    stale,
    [],
    'these screens no longer print a stored date — remove them from '
      + 'src/tests/fixtures/report-date-backlog.json so the ratchet keeps its value:\n' + stale.join('\n'),
  );
});

test("H-8: the shared resolver honours the reader's own date format, not just the locale", () => {
  const helper = fs.readFileSync(path.join(ROOT, 'src/components/reporting/useReportDates.ts'), 'utf8');
  assert.match(helper, /reportLocaleFor\(/);
  assert.match(helper, /dateFormatPref/, "the reader's Date Display Format must win (H-8)");
  assert.match(helper, /reportDateTextFor\(/);
  assert.match(helper, /reportPeriodTextIn\(/);
});

test('H-8: the statement, the ledger sheet and the report pack use the resolver', () => {
  const missing = FIXED.filter(file => !/useReportDates/.test(fs.readFileSync(path.join(ROOT, file), 'utf8')));
  assert.deepEqual(missing, [], 'these headers were printing stored ISO dates (H-8) and must use useReportDates');
});
