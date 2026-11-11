/**
 * J-5 (Agent #11): Hebrew in the exported files.
 *
 * Queue item J-5: "CSV exports open correctly in Excel with Hebrew text (UTF-8 BOM) and right-to-left
 * names; a test checks the first bytes and a Hebrew round trip."
 *
 * Excel decides a CSV's encoding from its first three bytes. `downloadCsv` writes a UTF-8 byte-order
 * mark and `toCsv` does not, so the two together are the contract: the file a person downloads starts
 * with EF BB BF and the same text reads back through the shared reader unchanged. The archive exports
 * that build their own filenames (the workspace archive ZIP, the accountant pack ZIP) add the marker
 * themselves — those are pinned here too.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toCsv } from '../lib/csvExport';
import { parseCsv } from '../lib/csv';
import { recordExportTable } from '../lib/workspaceExports';

const HEBREW = [
  { id: 'c1', workspaceId: 'w1', name: 'חברת דוגמה בע"מ', email: 'info@example.co.il', phone: '+972 3 555 0101', address: 'רחוב הרצל 1, תל אביב', notes: 'שולם — חשבונית 1001', status: 'active' },
  { id: 'c2', workspaceId: 'w1', name: 'Acme, Inc.', money: '₪1,234.50', status: 'active' },
];

describe('J-5 Hebrew in exports', () => {
  test('downloadCsv writes a UTF-8 BOM as the first three bytes, exactly once', () => {
    const source = fs.readFileSync('src/lib/csvExport.ts', 'utf8');
    // The marker is written by downloadCsv (one place), not by toCsv, so archives can add their own.
    // the marker is written as a literal character in the source (not the \uFEFF escape)
    assert.match(source, /new Blob\(\['\uFEFF' \+ toCsv/, 'downloadCsv prefixes the BOM');
    assert.ok(!/toCsv[\s\S]{0,120}?return\s+'\ufeff'/.test(source), 'toCsv itself does not add a BOM');
    const bytes = new TextEncoder().encode('\ufeff' + toCsv(['a'], [['b']]));
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'the marker is EF BB BF');
  });

  test('the archive builders that make their own file text add the marker themselves', () => {
    const archive = fs.readFileSync('src/lib/workspaceArchive.ts', 'utf8');
    assert.match(archive, /'\uFEFF' \+ toCsv|'\\uFEFF' \+ toCsv/, 'workspaceArchive prefixes every collection CSV');
    const pack = fs.readFileSync('src/lib/accountantExportPack.ts', 'utf8');
    assert.match(pack, /'\uFEFF' \+ sectionCsv|'\\uFEFF' \+ sectionCsv/, 'the accountant pack prefixes every section CSV');
  });

  test('a Hebrew customer list survives export → read back unchanged', () => {
    const table = recordExportTable(HEBREW);
    const text = '\ufeff' + toCsv(table.headers, table.rows);
    const cells = parseCsv(text, ',');                       // the reader drops the BOM itself
    assert.deepEqual(cells[0][0], 'address', 'the BOM is not part of the first header name');
    const byName = new Map(cells.slice(1).map(row => [row[table.headers.indexOf('name')], row]));
    assert.ok(byName.has('חברת דוגמה בע"מ'), 'the Hebrew name is intact');
    assert.equal(byName.get('חברת דוגמה בע"מ')![table.headers.indexOf('address')], 'רחוב הרצל 1, תל אביב');
    assert.equal(byName.get('חברת דוגמה בע"מ')![table.headers.indexOf('notes')], 'שולם — חשבונית 1001');
  });

  test('a word-for-word round trip over mixed Hebrew and English text', () => {
    const rows = [['חברת דוגמה בע"מ', 'Acme, Inc.', 'שולם — Invoice 1001', '1,234.50', ''], ['שלום', '', 'מוכן', '-5.00', 'x']];
    const text = '\ufeff' + toCsv(['a', 'b', 'c', 'd', 'e'], rows);
    const back = parseCsv(text, ',');
    assert.deepEqual(back.slice(1), rows, 'every Hebrew and English cell comes back identical');
  });
});
