#!/usr/bin/env node
/** Best-effort diagnostics only. A killed shard may not upload a report at all. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const root = fs.realpathSync(path.resolve(import.meta.dirname, '..'));
const MAX_REPORT_BYTES = 32 * 1024 * 1024;
const terminalStatuses = new Set(['passed', 'failed', 'timedOut']);
const byCodeUnit = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const escapeData = value => stripVTControlCharacters(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
// When maxFailures stops before a declared skip/fixme starts, expectedStatus can still be 'passed'.
const intentionallySkipped = test => test.expectedStatus === 'skipped'
  || test.annotations?.some(({ type }) => type === 'skip' || type === 'fixme');

function readReport() {
  const directory = fs.realpathSync(path.resolve('playwright-reports', 'blob-report'));
  if (!directory.startsWith(root + path.sep)) throw new Error('Expected a report directory inside the checkout');
  const blobs = fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.name.endsWith('.zip'));
  if (!blobs.length || blobs.some(entry => !entry.isFile())) throw new Error('No usable blob reports');

  // Use the verified upload directory as cwd, with fixed CLI arguments. Keep the machine-readable
  // report separate from Playwright's progress and runner messages, and discard it after reading.
  const scratch = fs.mkdtempSync(path.join(directory, '.diagnostic-'));
  try {
    const output = path.join(scratch, 'merged.json');
    const env = { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: output };
    delete env.PLAYWRIGHT_JSON_OUTPUT_DIR;
    delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;
    const merged = spawnSync(process.execPath, [
      path.join(root, 'node_modules', 'playwright', 'cli.js'), 'merge-reports', '--reporter=json', '.',
    ], { cwd: directory, env, encoding: 'utf8', timeout: 20_000, maxBuffer: MAX_REPORT_BYTES });
    if (merged.error) throw new Error(`Playwright merge did not complete (${merged.error.code || 'spawn error'})`);
    if (merged.status !== 0) {
      const hint = merged.stderr.trim().split(/\r?\n/, 1)[0];
      throw new Error(`Playwright merge exited with ${merged.status ?? merged.signal ?? 'unknown status'}${hint ? `: ${hint}` : ''}`);
    }
    if (!fs.existsSync(output)) throw new Error('Playwright did not write the JSON report');
    if (fs.statSync(output).size > MAX_REPORT_BYTES) throw new Error('Playwright JSON exceeded the diagnostic size limit');
    return JSON.parse(fs.readFileSync(output, 'utf8'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function describeReport(report) {
  const files = new Set();
  const incomplete = new Set();
  const pending = [...report.suites];
  while (pending.length) {
    const suite = pending.pop();
    for (const child of suite.suites ?? []) pending.push(child);
    for (const spec of suite.specs ?? []) {
      const file = spec.file || suite.file;
      if (typeof file !== 'string' || !file || !spec.tests.length) continue;
      files.add(file);
      if (spec.tests.some(test => !intentionallySkipped(test) && !terminalStatuses.has(test.results.at(-1)?.status))) {
        incomplete.add(file);
      }
    }
  }
  if (!files.size) throw new Error('No reported specs');
  if (!incomplete.size) console.log(`No unfinished tests recorded in ${files.size} reported spec file(s).`);
  for (const file of [...incomplete].sort(byCodeUnit)) {
    console.log(`::warning title=Browser test completion not recorded::${escapeData(file)}`);
  }
  console.log('Only uploaded reports were examined; the tests in a shard with no report are unknown.');
}

try {
  describeReport(readReport());
} catch (error) {
  const reason = error?.code === 'ENOENT' ? 'downloaded reports not found' : (error?.message || 'unexpected error');
  console.log(`::warning::No usable Playwright blob report was available; unfinished tests are unknown. See the shard log and live diagnostics. ${escapeData(reason.slice(0, 240))}`);
}
