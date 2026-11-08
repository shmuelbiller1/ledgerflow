#!/usr/bin/env node
/**
 * Turn a Playwright JSON report into a short Markdown list of what failed and why.
 *
 * Playwright writes the JSON reporter's output to `PLAYWRIGHT_JSON_OUTPUT_NAME` when that is set,
 * otherwise to `playwright-report.json`. A CI job's raw log is not always reachable from the tools a
 * reviewer has, but the step summary is, so the reasons are written there.
 *
 * Usage: node scripts/playwright-failures.mjs [report.json]
 */
import fs from 'node:fs';

const path = process.argv[2] || process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || 'playwright-report.json';
if (!fs.existsSync(path)) {
  console.log('\n_No Playwright JSON report was written, so the failure reasons are not available._');
  process.exit(0);
}

const report = JSON.parse(fs.readFileSync(path, 'utf8'));
const failures = [];
const walk = (suite, trail) => {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const result = (test.results ?? []).at(-1);
      if (!result || result.status === 'passed' || result.status === 'skipped') continue;
      const firstError = (result.errors ?? [])[0]?.message ?? result.error?.message ?? '';
      // Playwright repeats the locator call log; the first two lines carry the reason.
      failures.push({
        title: [...trail, spec.title].join(' › '),
        status: result.status,
        reason: firstError.split('\n').filter(line => line.trim()).slice(0, 3).join(' / ').slice(0, 300),
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child, [...trail, child.title]);
};

for (const suite of report.suites ?? []) walk(suite, []);

if (failures.length === 0) {
  console.log('\n_All captured screens passed._');
} else {
  console.log(`\n### ${failures.length} test(s) did not pass\n`);
  console.log('| Test | Status | Reason |');
  console.log('|---|---|---|');
  for (const failure of failures) {
    console.log(`| ${failure.title} | ${failure.status} | ${failure.reason.replace(/\|/g, '\\|')} |`);
  }
}
