#!/usr/bin/env node
/**
 * Name the browser test that is hanging while it hangs.
 *
 * A shard that is killed at its time limit fails with "exceeded the maximum execution time" and no
 * failing test: the report only lists what finished. This watches the Playwright JSON report (which
 * is rewritten as tests complete) and prints a workflow annotation for each spec file that has had a
 * test running for longer than the limit, so the answer is in the run's annotations rather than only
 * in a log nobody can fetch.
 *
 * Usage: WATCH_REPORT=test-results/playwright-results-1.json WATCH_LIMIT_MINUTES=8 \
 *          node scripts/watch-hung-tests.mjs &     (then kill it after Playwright exits)
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const requested = path.resolve(REPO_ROOT, process.env.WATCH_REPORT ?? 'playwright-report.json');
const reportPath = requested.startsWith(REPO_ROOT + path.sep) ? requested : null;
const limitMinutes = Number(process.env.WATCH_LIMIT_MINUTES ?? 8);
const intervalMs = 30_000;

if (!reportPath) {
  console.log('::warning::WATCH_REPORT points outside the checkout; the hang watcher is off.');
  process.exit(0);
}

const announced = new Set();

/** Titles of the tests whose latest result is still running, with their file. */
function running(file) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const found = [];
  const walk = (suite, trail) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const result = (test.results ?? []).at(-1);
        if (!result || result.status !== 'running') continue;
        const startedAt = Date.parse(result.startTime ?? '');
        if (Number.isNaN(startedAt)) continue;
        found.push({ title: [...trail, spec.title].filter(Boolean).join(' › '), file: spec.file, startedAt });
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...trail, child.title]);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return found;
}

const timer = setInterval(() => {
  for (const test of running(reportPath)) {
    const minutes = (Date.now() - test.startedAt) / 60_000;
    if (minutes < limitMinutes || announced.has(test.title)) continue;
    announced.add(test.title);
    const file = test.file ? `file=${test.file},` : '';
    console.log(`::error ${file}title=Long-running browser test::${test.title} has been running for ${Math.round(minutes)} minutes`);
  }
}, intervalMs);
timer.unref?.();
