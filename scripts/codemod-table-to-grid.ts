/**
 * Codemod survey: which of the raw `<table>` screens can move onto the shared grid mechanically.
 *
 * `rawTables` is 184. The rule the rebuild keeps is "the shared grid is the only list", and the honest
 * question before converting any of them is **which ones are actually the same edit**. A report that
 * renders a header row and a `rows.map()` body is; a table with editable cells, row spans, or a
 * virtualised body is not, and pretending otherwise is how a codemod destroys a screen.
 *
 * So this script does not convert. It reads every table and sorts it into three buckets, which is the
 * measurement the checklist needs before the work can be planned at all:
 *
 *  - **mechanical** — a `<thead>` of `<th>`s and a `<tbody>` whose rows are one `map`. Columns come out
 *    of the header cells; each body cell is one column. The target shape is the one
 *    `BankClearanceReportView` already has.
 *  - **by hand** — a map body, but something in it a script would guess wrong: an input or a button in
 *    a cell, a `rowSpan`/`colSpan`, a nested table, a `dangerouslySetInnerHTML`.
 *  - **stays** — no single map body (a virtualiser, a keyed fragment list, a CSS grid pretending to be a
 *    table). Moving these would delete behaviour, so they are named in `raw-table-decisions.test.ts`
 *    rather than converted.
 *
 *     npx tsx scripts/codemod-table-to-grid.ts            # the buckets
 *     npx tsx scripts/codemod-table-to-grid.ts --files    # and which file is in which
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'src/components');

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

export type TableVerdict = 'mechanical' | 'by hand' | 'stays';

export interface TableFinding {
  file: string;
  line: number;
  verdict: TableVerdict;
  reason: string;
  columns?: number;
  rowsMapped?: boolean;
}

/** The `<table …>…</table>` starting at `index`, brace-aware enough for JSX text. */
function tableSource(source: string, index: number): string {
  const end = source.indexOf('</table>', index);
  return end === -1 ? source.slice(index) : source.slice(index, end + '</table>'.length);
}

export function classifyTables(file: string, source: string): TableFinding[] {
  const findings: TableFinding[] = [];
  let from = 0;
  while (true) {
    const at = source.indexOf('<table', from);
    if (at === -1) break;
    from = at + 6;
    const table = tableSource(source, at);
    const line = source.slice(0, at).split('\n').length;
    const columns = (table.match(/<th\b/g) || []).length;
    const rowsMapped = /<tbody[\s\S]*?\.map\(/.test(table);

    const hardStops = [
      [/<table[\s\S]*<table/, 'a table inside a table'],
      [/rowSpan=/, 'rowSpan'],
      [/colSpan=/, 'colSpan'],
      [/dangerouslySetInnerHTML/, 'raw HTML in a cell'],
      [/<input\b|<select\b|<textarea\b/, 'an editable cell'],
      [/useVirtualizer|Virtualizer/, 'a virtualised body'],
    ] as [RegExp, string][];
    const stop = hardStops.find(([pattern]) => pattern.test(table));
    if (stop) {
      findings.push({ file, line, verdict: 'stays', reason: stop[1], columns, rowsMapped });
      continue;
    }
    if (!/<thead/.test(table)) {
      findings.push({ file, line, verdict: 'stays', reason: 'no header row to take column names from', columns, rowsMapped });
      continue;
    }
    if (!rowsMapped) {
      findings.push({ file, line, verdict: 'stays', reason: 'rows are not one map, so a column-per-cell rewrite would guess', columns, rowsMapped });
      continue;
    }
    const needsHand = [
      [/<button\b/, 'a button in a cell (the grid needs a cell renderer, not a clone)'],
      [/onClick=/, 'a click handler on a row or cell'],
      [/<tfoot/, 'a footer with totals (the grid has `totals`)'],
      [/\{\.\.\./, 'spread props inside the table'],
    ] as [RegExp, string][];
    const hand = needsHand.find(([pattern]) => pattern.test(table));
    findings.push({
      file, line, columns, rowsMapped,
      verdict: hand ? 'by hand' : 'mechanical',
      reason: hand ? hand[1] : `${columns} header cells and one mapped body`,
    });
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = walk(ROOT).flatMap(file => classifyTables(path.relative(process.cwd(), file), fs.readFileSync(file, 'utf8')));
  const counts = { mechanical: 0, 'by hand': 0, stays: 0 } as Record<TableVerdict, number>;
  for (const finding of findings) counts[finding.verdict]++;
  console.log(`${findings.length} raw tables in ${new Set(findings.map(f => f.file)).size} files`);
  for (const verdict of ['mechanical', 'by hand', 'stays'] as TableVerdict[]) {
    console.log(`  ${String(counts[verdict]).padStart(3)}  ${verdict}`);
  }
  if (process.argv.includes('--files')) {
    for (const verdict of ['mechanical', 'by hand', 'stays'] as TableVerdict[]) {
      console.log(`\n=== ${verdict}`);
      const byFile = new Map<string, TableFinding[]>();
      for (const finding of findings.filter(item => item.verdict === verdict)) {
        if (!byFile.has(finding.file)) byFile.set(finding.file, []);
        byFile.get(finding.file)!.push(finding);
      }
      for (const [file, list] of byFile) console.log(`${String(list.length).padStart(2)}  ${file}  (${list[0].reason})`);
    }
  }
}
