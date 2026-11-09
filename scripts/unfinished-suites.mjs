#!/usr/bin/env node
/**
 * List the test files a cancelled browser shard never finished.
 *
 * A shard that is killed at its time limit fails with "exceeded the maximum execution time" and no
 * failing test, which says nothing about where it was stuck. The blob report is written as each test
 * completes, so a file with no completed test is either the one that hung or one after it. Printing
 * them as an annotation makes the answer readable from the run's annotations, where the raw log is
 * not always available.
 *
 * Usage: node scripts/unfinished-suites.mjs <blob-report directory>
 */
import fs from 'node:fs';
import path from 'node:path';

// A directory from the command line may point anywhere; only a folder inside the checkout is read,
// so a crafted path cannot make this walk an unrelated part of the filesystem.
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const requested = path.resolve(REPO_ROOT, process.argv[2] ?? 'playwright-reports/blob-report');
const directory = requested.startsWith(REPO_ROOT + path.sep) ? requested : null;
if (!directory || !fs.existsSync(directory)) {
  console.log('::warning::No blob report was downloaded, so the unfinished suites are unknown.');
  process.exit(0);
}

const SPEC_FILE = /^[A-Za-z0-9_./-]*\.spec\.[cm]?[jt]sx?$/;
const files = fs.readdirSync(directory).filter(name => name.endsWith('.zip'));
const started = new Set();
for (const file of files) {
  const buffer = fs.readFileSync(path.join(directory, file));
  // The report is a zip; file names are stored as plain text in its local headers.
  // One pass, no nesting: take the run of path characters, then keep it only if it ends in a spec
  // extension. A pattern with optional parts inside a repeat made the scan quadratic on big blobs.
  for (const match of buffer.toString('latin1').matchAll(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*/g)) {
    // A path starts a word, so trim any dots that belonged to the zip header around it.
    const candidate = match[0].replace(/^\.+/, '');
    if (SPEC_FILE.test(candidate)) started.add(candidate);
  }
}

if (started.size === 0) {
  console.log('::warning::The blob report named no spec files; the job log is the only record of this shard.');
  process.exit(0);
}

for (const spec of [...started].sort((a, b) => a.localeCompare(b, 'en'))) console.log(`::error title=Suites in the cancelled shard::${spec}`);
console.log(`The shard's report names ${started.size} spec file(s); one of them hung or never started.`);
