/**
 * Agent #11 probe J-2 / QBOMigrationWizard: the QuickBooks Online migration wizard does NOT use the
 * shared CSV reader (src/lib/csv.ts). It hand-rolls one at src/components/migration/QBOMigrationWizard.tsx
 * lines 65–82. This probe copies that block verbatim and runs it against the same inputs the shared
 * reader is tested with, then compares both results.
 */
import { parseCsv } from '../../../src/lib/csv';

// --- verbatim copy of QBOMigrationWizard.tsx:65–82 (only the variable name `json` kept) ---
function wizardCsv(data: string): string[][] {
  const lines = data.split(/\r?\n/);
  return lines.filter(l => l.trim()).map(line => {
    const row: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    return row;
  });
}
// ---------------------------------------------------------------------------------------

const cases: Array<[string, string]> = [
  ['memo with a line break inside quotes',
   'Date,Name,Memo\n2026-01-05,Acme,"first line\nsecond line"\n'],
  ['a doubled quote inside a quoted cell',
   'Date,Name,Memo\n2026-01-05,Acme,"He said ""paid"" today"\n'],
  ['a semicolon (European) export',
   'Date;Name;Memo\n2026-01-05;Acme;paid\n'],
  ['a UTF-8 BOM from Excel',
   '\uFEFFDate,Name\n2026-01-05,Acme\n'],
];

for (const [label, text] of cases) {
  const wizard = wizardCsv(text);
  const shared = parseCsv(text);
  console.log('==', label);
  console.log('   wizard :', JSON.stringify(wizard));
  console.log('   shared :', JSON.stringify(shared));
  console.log('   same   :', JSON.stringify(wizard) === JSON.stringify(shared));
}
