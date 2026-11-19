#!/usr/bin/env node
/**
 * Performance budgets, D-27 / F-38 (`perf/budgets.json`).
 *
 * Two halves, because they fail at different times:
 *
 *  1. Schema — the nightly job has always run this and must keep running: the file has a version and
 *     a `budgets` object, every latency budget is a positive number of milliseconds or a documented
 *     report name, and the `bundle` section carries positive kilobyte budgets.
 *
 *  2. Artifacts — the half D-27 was opened for and that was missing: when a production build is
 *     present (`dist/index.html`), the bundle is measured and **a budget that is exceeded fails the
 *     check with exit code 1**. Before this, `check:perf-budgets` only proved the JSON parsed, so a
 *     regression could never turn anything red.
 *
 * What is measured, and what is not (say only what is true):
 *
 *  - `firstLoadGzipKb` — the gzip bytes of every script and stylesheet `dist/index.html` itself
 *    references (the entry chunk, its `modulepreload` links and the stylesheet). This is the work a
 *    browser must download before the first frame. It is **bytes, not a stopwatch**: real first
 *    -contentful-paint times depend on the network, the device and the font CDN, so no time budget
 *    is claimed here.
 *  - `totalJsGzipKb` — every JS chunk in `dist/assets`, including the lazy ones a screen loads only
 *    when it is opened.
 *  - `maxChunkGzipKb` — the largest single JS chunk (the lazy Excel reader is the current largest).
 *  - `cssGzipKb` — every CSS file in `dist/assets`.
 *
 * The posting / P&L / balance-sheet / search / screen latency budgets in the same file are measured
 * by the load-test jobs (`scripts/load-test.ts`, `scripts/load/`), not here.
 *
 * Usage:
 *   node scripts/check-perf-budgets.mjs                     # schema, then artifacts when dist exists
 *   node scripts/check-perf-budgets.mjs --require-dist      # CI build job: a missing dist is an error
 *   node scripts/check-perf-budgets.mjs --json              # machine-readable result
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const KB = 1024;

/** Budget keys that describe the built client bundle, with the unit each is measured in. */
export const BUNDLE_BUDGET_KEYS = Object.freeze([
  'firstLoadGzipKb',
  'totalJsGzipKb',
  'maxChunkGzipKb',
  'cssGzipKb',
]);

const DEFAULT_BUDGETS_PATH = 'perf/budgets.json';
const DEFAULT_DIST = 'dist';

/**
 * Problems with the budgets file itself. An empty array means the file may be used.
 * @returns {string[]}
 */
export function validateBudgets(budgets) {
  const problems = [];
  if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) {
    return ['perf/budgets.json must contain a JSON object'];
  }
  if (!Number.isFinite(Number(budgets.version)) || Number(budgets.version) < 1) {
    problems.push('version must be a number of at least 1');
  }
  const entries = budgets.budgets;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    problems.push('budgets must be an object');
    return problems;
  }
  if (Object.keys(entries).length === 0) problems.push('budgets must name at least one budget');

  const bundle = entries.bundle;
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    problems.push('budgets.bundle must describe the built client bundle (see the script header)');
  } else {
    for (const key of BUNDLE_BUDGET_KEYS) {
      const value = Number(bundle[key]);
      if (!Number.isFinite(value) || value <= 0) problems.push(`budgets.bundle.${key} must be a positive number of KB`);
    }
  }

  /** A leaf budget carries a latency (p50Ms/p95Ms/firstRenderMs) or names what it measures. */
  const validateLeaf = (name, budget) => {
    const latencies = ['p50Ms', 'p95Ms', 'firstRenderMs'].filter(key => key in budget);
    if (latencies.length === 0 && typeof budget.report !== 'string' && typeof budget.route !== 'string') {
      problems.push(`budgets.${name} must carry a latency budget (p50Ms/p95Ms/firstRenderMs) or a report/route name`);
    }
    for (const key of latencies) {
      const value = Number(budget[key]);
      if (!Number.isFinite(value) || value <= 0) problems.push(`budgets.${name}.${key} must be a positive number of milliseconds`);
    }
  };

  for (const [name, budget] of Object.entries(entries)) {
    if (name === 'bundle') continue;
    if (!budget || typeof budget !== 'object' || Array.isArray(budget)) {
      problems.push(`budgets.${name} must be an object`);
      continue;
    }
    // A group (for example `screens`, one budget per screen) holds leaves; anything else is a leaf.
    const children = Object.entries(budget).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value));
    const isGroup = children.length > 0
      && children.length === Object.keys(budget).length
      && !('p50Ms' in budget) && !('p95Ms' in budget) && !('firstRenderMs' in budget);
    if (isGroup) {
      if (children.length === 0) problems.push(`budgets.${name} must name at least one screen or report`);
      for (const [childName, child] of children) validateLeaf(`${name}.${childName}`, child);
    } else {
      validateLeaf(name, budget);
    }
  }
  return problems;
}

/** Gzip size in KB, to one decimal place. */
export function gzipKb(buffer) {
  return Math.round((zlib.gzipSync(buffer, { level: 9 }).length / KB) * 10) / 10;
}

/**
 * Measure a production build. Returns only what the files say; a missing file is reported by the
 * caller, never guessed.
 * @returns {{ ok: boolean, missing: string[], measured?: Record<string, number|string> }}
 */
export function measureBundle(distDir) {
  const indexPath = path.join(distDir, 'index.html');
  const assetsDir = path.join(distDir, 'assets');
  if (!fs.existsSync(indexPath)) return { ok: false, missing: [indexPath] };
  if (!fs.existsSync(assetsDir)) return { ok: false, missing: [assetsDir] };

  const html = fs.readFileSync(indexPath, 'utf8');
  const referenced = [...new Set([...html.matchAll(/(?:src|href)="(\/?assets\/[^"]+)"/g)].map(match => match[1]))];
  if (referenced.length === 0) return { ok: false, missing: [`${indexPath} references no /assets/ scripts or styles`] };

  const missing = [];
  let firstLoadBytes = 0;
  for (const ref of referenced) {
    const file = path.join(distDir, ref.replace(/^\//, ''));
    if (!fs.existsSync(file)) { missing.push(file); continue; }
    firstLoadBytes += zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
  }

  let totalJsBytes = 0;
  let cssBytes = 0;
  let maxChunkBytes = 0;
  let maxChunk = '';
  for (const file of fs.readdirSync(assetsDir)) {
    const full = path.join(assetsDir, file);
    if (!fs.statSync(full).isFile()) continue;
    if (file.endsWith('.js')) {
      const bytes = zlib.gzipSync(fs.readFileSync(full), { level: 9 }).length;
      totalJsBytes += bytes;
      if (bytes > maxChunkBytes) { maxChunkBytes = bytes; maxChunk = file; }
    } else if (file.endsWith('.css')) {
      cssBytes += zlib.gzipSync(fs.readFileSync(full), { level: 9 }).length;
    }
  }
  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    missing: [],
    measured: {
      firstLoadGzipKb: Math.round((firstLoadBytes / KB) * 10) / 10,
      totalJsGzipKb: Math.round((totalJsBytes / KB) * 10) / 10,
      maxChunkGzipKb: Math.round((maxChunkBytes / KB) * 10) / 10,
      cssGzipKb: Math.round((cssBytes / KB) * 10) / 10,
      maxChunk,
      firstLoadFiles: referenced.length,
    },
  };
}

/**
 * Compare a measurement against the `bundle` budgets. Empty array = inside every budget.
 * @returns {{ key: string, budgetKb: number, actualKb: number, overByKb: number }[]}
 */
export function evaluateBudgets(measured, bundleBudgets) {
  const violations = [];
  for (const key of BUNDLE_BUDGET_KEYS) {
    const budgetKb = Number(bundleBudgets?.[key]);
    const actualKb = Number(measured?.[key]);
    if (!Number.isFinite(budgetKb) || !Number.isFinite(actualKb)) continue;
    if (actualKb > budgetKb) {
      violations.push({ key, budgetKb, actualKb, overByKb: Math.round((actualKb - budgetKb) * 10) / 10 });
    }
  }
  return violations;
}

/** A human-readable table; the same numbers the JSON output carries. */
export function formatReport(measured, bundleBudgets) {
  const lines = ['Bundle budget (gzip KB, measured from the production build):'];
  for (const key of BUNDLE_BUDGET_KEYS) {
    const budgetKb = Number(bundleBudgets?.[key]);
    const actualKb = Number(measured?.[key]);
    const status = actualKb > budgetKb ? 'OVER' : 'ok';
    lines.push(`  ${key.padEnd(18)} ${String(actualKb).padStart(8)} / ${String(budgetKb).padStart(6)}  ${status}`);
  }
  if (measured?.maxChunk) lines.push(`  largest chunk: ${measured.maxChunk}`);
  return lines.join('\n');
}

function main(argv) {
  const requireDist = argv.includes('--require-dist');
  const asJson = argv.includes('--json');
  const budgetsPath = (argv.find(arg => arg.startsWith('--budgets=')) || `--budgets=${DEFAULT_BUDGETS_PATH}`).slice('--budgets='.length);
  const distDir = (argv.find(arg => arg.startsWith('--dist=')) || `--dist=${DEFAULT_DIST}`).slice('--dist='.length);

  const result = { schema: { ok: false, problems: [] }, bundle: null, ok: false };
  let budgets;
  try {
    budgets = JSON.parse(fs.readFileSync(budgetsPath, 'utf8'));
  } catch (error) {
    result.schema.problems = [`${budgetsPath} could not be read as JSON: ${error.message}`];
  }
  if (budgets) {
    result.schema.problems = validateBudgets(budgets);
    result.schema.ok = result.schema.problems.length === 0;
  }

  const measured = measureBundle(distDir);
  if (measured.ok && result.schema.ok) {
    const violations = evaluateBudgets(measured.measured, budgets.budgets.bundle);
    result.bundle = { measured: measured.measured, budgets: budgets.budgets.bundle, violations, ok: violations.length === 0 };
  } else {
    result.bundle = { skipped: true, missing: measured.missing };
  }

  result.ok = result.schema.ok && (result.bundle.ok ?? !requireDist);

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.schema.ok) console.log(`Perf budgets valid: ${Object.keys(budgets.budgets).length} entries`);
    for (const problem of result.schema.problems) console.error(`::error::${problem}`);
    if (result.bundle?.skipped) {
      const note = `No production build at ${distDir}: bundle budgets not measured (run \`npm run build\` first).`;
      if (requireDist) console.error(`::error::${note}`);
      else console.log(note);
    } else if (result.bundle) {
      console.log(formatReport(result.bundle.measured, result.bundle.budgets));
      for (const violation of result.bundle.violations) {
        console.error(`::error::${violation.key} is ${violation.actualKb} KB, over its ${violation.budgetKb} KB budget by ${violation.overByKb} KB`);
      }
      if (result.bundle.ok) console.log('Every bundle budget holds.');
    }
  }
  process.exit(result.ok ? 0 : 1);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main(process.argv.slice(2));
