import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
// The budgets checker is a plain Node script so the workflow can run it without a build step.
import {
  BUNDLE_BUDGET_KEYS,
  evaluateBudgets,
  gzipKb,
  measureBundle,
  validateBudgets,
} from '../../scripts/check-perf-budgets.mjs';

/**
 * D-27: `perf/budgets.json` used to be validated only for being parseable, so a real regression in
 * the built bundle could never turn CI red. These tests pin the two halves the checker now owns —
 * the schema, and the measurement that fails a build — plus the wiring, so a later edit cannot drop
 * the enforcement and leave the file looking green again.
 */

const repo = process.cwd();
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(repo, file), 'utf8'));

function tempDist(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-perf-'));
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

describe('D-27 performance budgets', () => {
  it('accepts the repository budgets file', () => {
    assert.deepEqual(validateBudgets(readJson('perf/budgets.json')), []);
  });

  it('refuses a file with no version, no bundle section or a non-positive latency budget', () => {
    const budgets = readJson('perf/budgets.json');

    assert.ok(validateBudgets({ ...budgets, version: 0 }).some(problem => /version/.test(problem)));
    assert.ok(validateBudgets({ ...budgets, budgets: {} }).some(problem => /at least one budget/.test(problem)));

    const withoutBundle = structuredClone(budgets);
    delete withoutBundle.budgets.bundle;
    assert.ok(validateBudgets(withoutBundle).some(problem => /budgets\.bundle must describe/.test(problem)));

    const zeroLatency = structuredClone(budgets);
    zeroLatency.budgets.screens.sales.firstRenderMs = 0;
    assert.ok(validateBudgets(zeroLatency).some(problem => /budgets\.screens\.sales\.firstRenderMs/.test(problem)));

    const emptyScreen = structuredClone(budgets);
    emptyScreen.budgets.screens.overview = {};
    assert.ok(validateBudgets(emptyScreen).some(problem => /budgets\.screens\.overview/.test(problem)));

    const negativeBundle = structuredClone(budgets);
    negativeBundle.budgets.bundle.maxChunkGzipKb = -1;
    assert.ok(validateBudgets(negativeBundle).some(problem => /budgets\.bundle\.maxChunkGzipKb/.test(problem)));
  });

  it('fails a measurement that is over budget and names the overshoot', () => {
    const budgets = { firstLoadGzipKb: 100, totalJsGzipKb: 1000, maxChunkGzipKb: 200, cssGzipKb: 50 };
    const violations = evaluateBudgets(
      { firstLoadGzipKb: 100, totalJsGzipKb: 1000.4, maxChunkGzipKb: 200, cssGzipKb: 50 },
      budgets,
    );
    assert.deepEqual(violations, [{ key: 'totalJsGzipKb', budgetKb: 1000, actualKb: 1000.4, overByKb: 0.4 }]);
  });

  it('holds a measurement that lands exactly on its budget (the boundary is inclusive)', () => {
    const budgets = { firstLoadGzipKb: 100, totalJsGzipKb: 1000, maxChunkGzipKb: 200, cssGzipKb: 50 };
    assert.deepEqual(evaluateBudgets({ ...budgets }, budgets), []);
  });

  it('measures the first load from what index.html references, and every chunk for the totals', () => {
    const app = 'x'.repeat(2048);
    const vendor = 'y'.repeat(1024);
    const css = 'body{color:red}'.repeat(100);
    const lazy = 'z'.repeat(4096);
    const html = [
      '<script type="module" crossorigin src="/assets/app.js"></script>',
      '<link rel="modulepreload" crossorigin href="/assets/vendor.js">',
      '<link rel="stylesheet" crossorigin href="/assets/style.css">',
    ].join('\n');
    const dist = tempDist({
      'index.html': html,
      'assets/app.js': app,
      'assets/vendor.js': vendor,
      'assets/style.css': css,
      'assets/lazy.js': lazy,
    });

    const measured = measureBundle(dist);
    assert.equal(measured.ok, true);

    // First load is the sum of what the document itself points at — not the lazy chunk.
    const expectedFirstLoad = Math.round(((zlib.gzipSync(Buffer.from(app)).length
      + zlib.gzipSync(Buffer.from(vendor)).length
      + zlib.gzipSync(Buffer.from(css)).length) / 1024) * 10) / 10;
    assert.equal(measured.measured?.firstLoadGzipKb, expectedFirstLoad);
    assert.equal(measured.measured?.firstLoadFiles, 3);

    // The totals cover every chunk, including the one no document references yet.
    const expectedJs = Math.round(((zlib.gzipSync(Buffer.from(app)).length
      + zlib.gzipSync(Buffer.from(vendor)).length
      + zlib.gzipSync(Buffer.from(lazy)).length) / 1024) * 10) / 10;
    assert.equal(measured.measured?.totalJsGzipKb, expectedJs);
    assert.equal(measured.measured?.maxChunk, 'lazy.js', 'the lazy chunk is the largest');
    assert.equal(measured.measured?.cssGzipKb, gzipKb(Buffer.from(css)));
  });

  it('reports a missing build or a dangling reference instead of guessing a size', () => {
    const missingDist = measureBundle(path.join(os.tmpdir(), 'lf-perf-does-not-exist'));
    assert.equal(missingDist.ok, false);
    assert.ok(missingDist.missing.length > 0);

    const dangling = tempDist({
      'index.html': '<script type="module" src="/assets/gone.js"></script>',
    });
    const measured = measureBundle(dangling);
    assert.equal(measured.ok, false);
    assert.ok(measured.missing.some(file => file.endsWith('gone.js')));
  });

  it('keeps the budgets reachable from the checks that must run them', () => {
    const scripts = readJson('package.json').scripts;
    assert.match(scripts['check:perf-budgets'], /scripts\/check-perf-budgets\.mjs/);

    const ci = fs.readFileSync(path.join(repo, '.github/workflows/ci.yml'), 'utf8');
    const buildJob = ci.slice(ci.indexOf('\n  build:'), ci.indexOf('\n  timezones:'));
    assert.ok(buildJob.length > 0, 'the production build job is still in ci.yml');
    assert.match(buildJob, /node scripts\/check-perf-budgets\.mjs --require-dist/);
    assert.ok(
      buildJob.indexOf('npm run build') < buildJob.indexOf('check-perf-budgets.mjs --require-dist'),
      'the bundle is measured after it is built',
    );

    const nightly = fs.readFileSync(path.join(repo, '.github/workflows/nightly-stability.yml'), 'utf8');
    assert.match(nightly, /npm run check:perf-budgets/);
  });

  it('measures every budget key the schema knows about', () => {
    const budgets = readJson('perf/budgets.json');
    assert.deepEqual(Object.keys(budgets.budgets.bundle ?? {}).filter(key => key !== 'comment').sort(), [...BUNDLE_BUDGET_KEYS].sort());
  });
});
