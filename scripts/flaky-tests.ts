/**
 * F-32 — compare the browser suite's runs and name the tests that differ.
 *
 *   npm run test:flaky                 # runs the e2e suite three times, then compares
 *   npm run test:flaky -- --runs 5
 *   npm run test:flaky -- --compare a.json b.json c.json   # compare reports already made
 *
 * Exit code: 0 when nothing is flaky or broken, 1 otherwise, so a nightly job fails and a
 * person looks. A failure is never re-run until it passes: every run is kept and compared.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareRuns, flakyReportText, fromPlaywrightJson, type RunResult } from '../src/lib/flakyReport';

const args = process.argv.slice(2);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const compareIndex = args.indexOf('--compare');
const explicit = compareIndex >= 0 ? args.slice(compareIndex + 1) : [];

const readReport = (file: string): RunResult[] => fromPlaywrightJson(JSON.parse(fs.readFileSync(file, 'utf8')));

let runs: RunResult[][] = [];
if (explicit.length > 0) {
  runs = explicit.map(readReport);
} else {
  const count = Number(value('--runs') || 3);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-flaky-'));
  for (let run = 1; run <= count; run += 1) {
    const file = path.join(dir, `run-${run}.json`);
    console.log(`Run ${run} of ${count} → ${file}`);
    try {
      execFileSync('npx', ['playwright', 'test', '--reporter=json'], {
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: file },
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      // A red run is expected to exit non-zero; the report file is what matters.
    }
    if (!fs.existsSync(file)) {
      console.error(`Run ${run} wrote no report (${file}); stopping rather than guessing.`);
      process.exit(1);
    }
    runs.push(readReport(file));
  }
}

const report = compareRuns(runs);
process.stdout.write(flakyReportText(report));
process.exit(report.clean ? 0 : 1);
