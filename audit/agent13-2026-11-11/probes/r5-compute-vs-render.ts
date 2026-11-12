/** Agent #13 R-5 probe: how much of each slow report's open time is computation, how much is DOM? */
import { performance } from 'node:perf_hooks';
import { buildSampleBusinessYear } from '../../../src/lib/sampleBusinessYear';
import { computeJournalSheet, yearRange } from '../../../src/server/reports/itemReports';
import { computeGeneralLedger } from '../../../src/server/reports/computeReports';

const fixture = buildSampleBusinessYear({ year: 2026, scale: 4 });
console.log(`fixture: ${fixture.transactions.length} transactions, ${fixture.accounts.length} accounts`);

let t0 = performance.now();
const { startDate, endDate } = yearRange(2026);
const sheet = computeJournalSheet(fixture.transactions, fixture.accounts, startDate, endDate);
console.log(`computeJournalSheet: ${(performance.now() - t0).toFixed(1)} ms — ${sheet.entries.length} entries`);

t0 = performance.now();
const gl = computeGeneralLedger(fixture.transactions, fixture.accounts, startDate, endDate);
const lines = gl.accounts.reduce((n, a) => n + a.entries.length, 0);
console.log(`computeGeneralLedger: ${(performance.now() - t0).toFixed(1)} ms — ${gl.accounts.length} accounts, ${lines} lines`);
