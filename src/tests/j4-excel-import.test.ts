/**
 * J-4 / Issue #905: Excel (.xlsx) import edge cases & bundle isolation.
 *
 * Verifies:
 *  - parseExcelToRows preserves numeric 0 and boolean false instead of dropping them as ''
 *  - parseExcelToRows formats UTC-midnight Excel Date cells as YYYY-MM-DD without local-TZ shift
 *  - parseExcelToRows unwraps richText, hyperlink, cached formula results, uncached formulas, and errors
 *  - parseExcelToRows reads only the first worksheet in multi-sheet workbooks and handles empty ones
 *  - End-to-end XLSX export -> parseExcelToRows -> prepareImport('items') round-trip preserves 0 & text
 *  - exceljs stays dynamically imported inside excelExport.ts (not in the static core bundle)
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { buildReportWorkbook, extractExcelCellValue, parseExcelToRows } from '../lib/excelExport';
import { applyMapping, guessMapping, prepareImport } from '../lib/recordImport';

async function toArrayBuffer(workbook: ExcelJS.Workbook): Promise<ArrayBuffer> {
  const buf = await workbook.xlsx.writeBuffer();
  const u8 = new Uint8Array(buf);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

describe('J-4 / #905 parseExcelToRows edge cases', () => {
  test('preserves 0, false, richText, hyperlinks, UTC dates, formulas, errors, and sparse cells', async () => {
    const wb = new ExcelJS.Workbook();
    const ws1 = wb.addWorksheet('First');
    ws1.addRow(['Date', 'Qty', 'Active', 'Rich', 'Link', 'FormulaZero', 'FormulaBool', 'FormulaDate', 'FormulaErr', 'UncachedFormula', 'Sparse']);
    ws1.addRow([
      new Date(Date.UTC(2026, 2, 1)),
      0,
      false,
      { richText: [{ text: 'Hello ' }, { text: 'World' }] },
      { text: 'Acme Portal', hyperlink: 'https://acme.example' },
      { formula: '1+1', result: 2 },
      { formula: '1=1', result: true },
      { formula: 'DATE(2026,3,15)', result: new Date(Date.UTC(2026, 2, 15)) },
      { formula: '1/0', result: { error: '#DIV/0!' } },
      { formula: 'SUM(A1:A2)' },
      undefined,
    ]);
    ws1.addRow([undefined, 42, true, { richText: [{ text: '=SUM(A1)' }] }, { text: { richText: [{ text: 'Link ' }, { text: 'Rich' }] }, hyperlink: 'https://x.test' }, '', '', '', { error: '#VALUE!' }]);

    // Second sheet must not leak into sheet 1 rows
    const ws2 = wb.addWorksheet('Second');
    ws2.addRow(['ShouldNotAppear']);
    ws2.addRow(['Secret']);

    const rows = await parseExcelToRows(await toArrayBuffer(wb));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[1], [
      '2026-03-01',
      0,
      false,
      'Hello World',
      'Acme Portal',
      2,
      true,
      '2026-03-15',
      '#DIV/0!',
      '',
    ]);
    assert.deepEqual(rows[2], [
      '',
      42,
      true,
      '=SUM(A1)',
      'Link Rich',
      '',
      '',
      '',
      '#VALUE!',
    ]);
    // Cached falsy formula results (e.g. written by Excel/Sheets as <f>1-1</f><v>0</v>)
    assert.equal(extractExcelCellValue({ formula: '1-1', result: 0 }), 0);
    assert.equal(extractExcelCellValue({ formula: '1=2', result: false }), false);
    assert.equal(extractExcelCellValue({ sharedFormula: 'A1', result: 0 }), 0);
    assert.equal(extractExcelCellValue({ sharedFormula: 'A1' }), '');
  });

  test('UTC date stays identical across negative timezone offsets (e.g. America/New_York)', async () => {
    const prevTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Dates');
      ws.addRow(['Date']);
      ws.addRow([new Date(Date.UTC(2026, 0, 1))]);
      ws.addRow([new Date(Date.UTC(2026, 2, 1))]);
      const rows = await parseExcelToRows(await toArrayBuffer(wb));
      assert.equal(rows[1][0], '2026-01-01');
      assert.equal(rows[2][0], '2026-03-01');
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });

  test('handles empty workbook and round-trips buildReportWorkbook richText title rows + numeric zeros into prepareImport', async () => {
    const emptyWb = new ExcelJS.Workbook();
    assert.deepEqual(await parseExcelToRows(await toArrayBuffer(emptyWb)), []);

    const reportWb = await buildReportWorkbook(
      [
        { header: 'Name', key: 'name' },
        { header: 'SKU', key: 'sku' },
        { header: 'Quantity on hand', key: 'qty' },
        { header: 'Sale price', key: 'price' },
      ],
      [{ name: '=Widget Pro', sku: 'W-0', qty: 0, price: 0 }],
    );
    const parsed = await parseExcelToRows(await toArrayBuffer(reportWb as unknown as ExcelJS.Workbook));
    const strRows = parsed.map(r => r.map(c => (c === null || c === undefined ? '' : String(c).trim())));
    const prepared = prepareImport('items', applyMapping('items', strRows.slice(1), guessMapping('items', strRows[0])));
    assert.deepEqual(prepared.errors, []);
    assert.equal(prepared.records[0].data.name, '=Widget Pro');
    assert.equal(prepared.records[0].data.sku, 'W-0');
    assert.equal(prepared.records[0].data.quantityAtHand, 0);
    assert.equal(prepared.records[0].data.unitPriceCents, 0);
  });

  test('exceljs remains lazily loaded and dynamically imported', () => {
    const src = fs.readFileSync('src/lib/excelExport.ts', 'utf8');
    assert.doesNotMatch(src, /^\s*import\s+[^type].*from\s+['"]exceljs['"]/m, 'must not statically import exceljs runtime');
    assert.match(src, /await\s+import\(['"]exceljs['"]\)/, 'exceljs must be loaded via dynamic import()');
  });
});
