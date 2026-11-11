/**
 * Agent #13 R-5 probe, 2026-11-11.
 *
 * R-5 asks: "every report on the 5,000-entry sample year opens in under one second on a normal
 * laptop; fix the slow ones without changing the figures; the existing speed test extended."
 *
 * The existing speed test (src/tests/report-speed-12m.test.tsx) mounts a chosen list of 39 report
 * views. This probe mounts EVERY report screen module in src/components on the scale=4
 * (~5,000-entry) sample year and prints the measured mount time, so the coverage gap and the slow
 * ones are visible instead of assumed. It shares its harness with
 * `src/tests/report-speed-all-views.test.tsx`, so the probe and the test cannot drift apart.
 *
 * Run: NODE_ENV=test NODE_OPTIONS=--max-old-space-size=4096 npx tsx audit/agent13-2026-11-11/probes/r5-all-report-views-probe.ts
 */
import './helpers/dom-probe';
import { buildSampleBusinessYear } from '../../../src/lib/sampleBusinessYear';
import {
  mountReportScreen, reportScreenPaths, sampleYearReportProps, seedSampleYear,
} from '../../../src/tests/helpers/reportScreens';

async function main() {
  const fixture = buildSampleBusinessYear({ year: 2026, scale: Number(process.env.PROBE_SCALE || 4) });
  seedSampleYear(fixture);
  const props = sampleYearReportProps(fixture);
  const files = reportScreenPaths();

  const results = [];
  for (const file of files) results.push(await mountReportScreen(file, props));
  results.sort((a, b) => b.ms - a.ms);

  console.log(`\nFixture: ${fixture.transactions.length} transactions, ${files.length} report modules\n`);
  console.log('id'.padEnd(46), 'ms'.padStart(9), 'status');
  for (const row of results) {
    const status = row.error ? row.error : row.ms < 1000 ? 'ok' : 'SLOW';
    console.log(row.id.padEnd(46), String(row.ms).padStart(9), status);
  }
  const over = results.filter(row => !row.error && row.ms >= 1000).length;
  console.log(`\nover 1,000 ms: ${over} of ${results.filter(row => !row.error).length} measured`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
