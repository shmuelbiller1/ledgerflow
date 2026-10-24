/**
 * A-107: the GSA per diem table import for A-76. The fixture mirrors the GSA FY2026 master
 * rates file's shape (seasonal locality rows) with figures the GSA published for FY2026:
 * the standard CONUS M&IE is $68 (Bulletin FTR 26-01) and Houston's locality M&IE is $80.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  findGsaLocality, gsaLocalitiesCsvRows, gsaLocalitiesToPerDiemRows, readGsaPerDiemCsv,
} from '../lib/tax/gsaPerDiemImport';
import { PER_DIEM_ROWS, perDiemRateFor } from '../lib/tax/expenseRateTables';

const FY26 = [
  'State,Destination,County / Location Defined,Season Begin,Season End,FY26 Lodging Rate,FY26 MIE',
  ',"Standard CONUS rate applies to all counties not specifically listed. Cities not listed may be located in a listed county.",,,,110,68',
  'AL,Mobile,Mobile,,,128,80',
  'AL,Gulf Shores,Baldwin,October 1,February 28,118,80',
  'AL,Gulf Shores,Baldwin,March 1,May 31,152,80',
  'AL,Gulf Shores,Baldwin,June 1,September 30,198,80',
  'TX,Houston,"Montgomery / Fort Bend / Harris",,,128,80',
  'NY,New York City,"Bronx, Kings, New York, Queens, Richmond",October 1,December 31,342,92',
  'NY,New York City,"Bronx, Kings, New York, Queens, Richmond",January 1,February 28,179,92',
].join('\n');

describe('A-107 GSA per diem import', () => {
  test('reads localities by column name: seasons merge, the standard row is kept apart, FY from the rate columns', () => {
    const read = readGsaPerDiemCsv(FY26);
    assert.equal(read.fiscalYear, 2026);
    assert.equal(read.standardMieCents, 6_800, 'the file standard M&IE is read for checking against A-76');
    assert.equal(read.standardLodgingCents, 11_000);
    assert.equal(read.localities.length, 4);
    const houston = findGsaLocality(read.localities, 'Houston, TX')!;
    assert.equal(houston.mieCents, 8_000);
    assert.equal(houston.county, 'Montgomery / Fort Bend / Harris');
    const gulf = findGsaLocality(read.localities, 'gulf shores, al')!;
    assert.equal(gulf.seasons.length, 3, 'the three seasonal rows are one locality');
    assert.deepEqual(gulf.seasons.map(s => s.begin), ['2025-10-01', '2026-03-01', '2026-06-01'], 'Oct opens the fiscal year, so it is in calendar 2025');
    assert.deepEqual(gulf.seasons.map(s => s.end), ['2026-02-28', '2026-05-31', '2026-09-30']);
    assert.equal(findGsaLocality(read.localities, 'Nowhere, TX'), null, 'an unpicked locality is null, never the nearest');
    // The file's standard row agrees with A-76's built-in FY2026 standard row.
    const builtIn = PER_DIEM_ROWS.find(r => r.validFrom === '2025-10-01' && r.country === 'US')!;
    assert.equal(builtIn.dailyCents, read.standardMieCents);
  });

  test('locality rows feed A-76 suggestions for their fiscal year only, over the standard rate', () => {
    const rows = gsaLocalitiesToPerDiemRows(readGsaPerDiemCsv(FY26).localities, '2026-10-23');
    const nyc = rows.find(r => r.area.startsWith('New York City, NY'))!;
    assert.equal(nyc.dailyCents, 9_200);
    assert.equal(nyc.validFrom, '2025-10-01');
    assert.equal(nyc.validTo, '2026-09-30');
    assert.match(nyc.note || '', /Lodging is separate \(cap \$179–\$342 by season/);
    assert.match(nyc.note || '', /75% \(\$69\.00\)/);
    assert.equal(nyc.source.retrieved, '2026-10-23');
    assert.equal(nyc.source.status, 'calculation');

    const onTrip = perDiemRateFor({ country: 'US', date: '2026-03-15', currency: 'USD', extraRows: rows.filter(r => r === nyc) });
    assert.equal(onTrip?.dailyText, '92.00', 'the picked locality beats the $68 standard rate');
    const nextFy = perDiemRateFor({ country: 'US', date: '2026-11-15', currency: 'USD', extraRows: rows.filter(r => r === nyc) });
    assert.equal(nextFy?.dailyText, '68.00', 'outside FY2026 the locality row does not apply and the standard row answers');
    assert.equal(perDiemRateFor({ country: 'US', date: '2026-03-15', currency: 'USD' })?.dailyText, '68.00', 'no import: unchanged A-76 behaviour');
  });

  test('the fiscal year is chosen, never guessed: unstated refuses, a disagreement refuses', () => {
    const noFy = FY26.replace('FY26 Lodging Rate', 'Lodging Rate').replace('FY26 MIE', 'MIE Rate');
    assert.throws(() => readGsaPerDiemCsv(noFy), /does not say which fiscal year/);
    assert.equal(readGsaPerDiemCsv(noFy, { fiscalYear: 2026 }).fiscalYear, 2026, 'the same file reads once the person chooses the year');
    assert.throws(() => readGsaPerDiemCsv(FY26, { fiscalYear: 2025 }), /say fiscal year 2026, not 2025/);
  });

  test('a bad row refuses the whole file and names every problem; the wrong file is refused up front', () => {
    const broken = [
      'State,Destination,County / Location Defined,Season Begin,Season End,FY26 Lodging Rate,FY26 MIE',
      'TX,Houston,Harris,,,128,eighty',
      'Texas,Austin,Travis,,,130,80',
      'CA,,Los Angeles,,,182,92',
      'CA,Fresno,,,,120,74',
      'FL,Miami,Miami-Dade,February 30,December 31,190,92',
    ].join('\n');
    assert.throws(() => readGsaPerDiemCsv(broken), (err: Error) => {
      assert.match(err.message, /^Nothing was imported\./);
      assert.match(err.message, /Row 2: the M&IE rate "eighty" is not a dollar amount/);
      assert.match(err.message, /Row 3: the state "Texas" is not a two-letter state code/);
      assert.match(err.message, /Row 4: the destination is empty/);
      assert.match(err.message, /Row 5: Fresno, CA has no county/);
      assert.match(err.message, /Row 6: the season date "February 30" is not a real day/);
      return true;
    });
    assert.throws(() => readGsaPerDiemCsv('a,b,c\n1,2,3'), /No header row with State and Destination/);
    assert.throws(
      () => readGsaPerDiemCsv(FY26.replace('179,92', '179,80')),
      /two different M&IE rates/,
    );
  });

  test('the CSV export carries every locality with the GSA source and the read day', () => {
    const rows = gsaLocalitiesCsvRows(readGsaPerDiemCsv(FY26).localities, '2026-10-23');
    assert.equal(rows.length, 4);
    const gulf = rows.find(r => r[2] === 'Gulf Shores')!;
    assert.equal(gulf[4], '80.00');
    assert.equal(gulf[5], '118.00 / 152.00 / 198.00', 'each season lodging cap is listed, never averaged into the allowance');
    assert.match(gulf[6], /General Services Administration/);
    assert.equal(gulf[7], '2026-10-23');
  });
});
