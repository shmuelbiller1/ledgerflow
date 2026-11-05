/**
 * F-40 — the architecture layers, checked (photocraft's `xtask layers`).
 *
 * The rule the repository actually keeps, and what this test enforces:
 *
 *   components/  →  lib/, components/, and `src/server/reports/` only
 *   lib/         →  lib/, and `src/server/reports/` only
 *   lib/         ↛  components/
 *
 * `src/server/reports/` is allowed on purpose: it holds the pure statement functions
 * (`computeProfitAndLoss`, `computeStatement`, …) that the browser screens and the
 * server both call, so a report's screen and its API cannot disagree (see the project
 * guidance). Everything else under `src/server/` — routes, services, db, auth — is a
 * server concern and must never be imported by a screen or a library.
 *
 * A violation prints the file, the line and the rule, so the fix is a two-line change.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function filesIn(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesIn(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

/** Every module specifier an import/export statement names. */
export function importsOf(source: string): Array<{ specifier: string; line: number }> {
  const found: Array<{ specifier: string; line: number }> = [];
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    if (!/\b(import|export)\b/.test(line)) return;
    const match = line.match(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/);
    if (match) found.push({ specifier: match[1], line: index + 1 });
  });
  return found;
}

/** Where a specifier points, in repository terms: `components`, `server-reports`, `server`, `lib`, or `outside`. */
export function layerOf(file: string, specifier: string): 'components' | 'server-reports' | 'server' | 'lib' | 'outside' {
  if (!specifier.startsWith('.')) return 'outside';
  const resolved = path.relative(process.cwd(), path.resolve(path.dirname(file), specifier)).split(path.sep).join('/');
  if (resolved.startsWith('src/components/')) return 'components';
  if (resolved === 'src/server/reports' || resolved.startsWith('src/server/reports/')) return 'server-reports';
  if (resolved === 'src/server' || resolved.startsWith('src/server/')) return 'server';
  if (resolved === 'src/lib' || resolved.startsWith('src/lib/')) return 'lib';
  return 'outside';
}

export function layersViolations(files: string[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const isLib = file.startsWith('src/lib/');
    const isComponent = file.startsWith('src/components/');
    if (!isLib && !isComponent) continue;
    for (const { specifier, line } of importsOf(fs.readFileSync(file, 'utf8'))) {
      const layer = layerOf(file, specifier);
      if (isLib && layer === 'components') {
        violations.push(`${file}:${line} — lib/ must not import components/ (${specifier})`);
      }
      if (isLib && layer === 'server') {
        violations.push(`${file}:${line} — lib/ must not import server/ outside src/server/reports (${specifier})`);
      }
      if (isComponent && layer === 'server') {
        violations.push(`${file}:${line} — components/ must not import server/ outside src/server/reports (${specifier})`);
      }
    }
  }
  return violations;
}

const scoped = [...filesIn('src/lib'), ...filesIn('src/components')];

describe('F-40 architecture layers', () => {
  test('lib/ never imports components/ or server/ (reports/ excepted); components/ never imports server/ (reports/ excepted)', () => {
    const violations = layersViolations(scoped);
    assert.deepEqual(violations, [], `Layer violations:\n${violations.join('\n')}`);
  });

  test('the guard sees the whole tree, and the rule is not vacuous', () => {
    assert.ok(scoped.length > 400, `only ${scoped.length} files scanned`);
    // A screen using the shared report functions is allowed, and must stay allowed:
    const allowed = importsOf(fs.readFileSync('src/components/reporting/StatementView.tsx', 'utf8'));
    assert.ok(allowed.some(i => i.specifier.includes('/server/reports/')), 'the reports exception is exercised');
    assert.deepEqual(layersViolations(['src/components/reporting/StatementView.tsx']), []);
  });

  test('a wrong import is classified with its file and the rule it breaks', () => {
    const file = 'src/lib/pretend.ts';
    assert.equal(layerOf(file, '../components/Thing'), 'components');
    assert.equal(layerOf(file, '../server/db/firestore'), 'server');
    assert.equal(layerOf(file, '../server/reports/partyReports'), 'server-reports', 'the pure report functions are shared on purpose');
    assert.equal(layerOf(file, './money'), 'lib');
    assert.equal(layerOf(file, 'react'), 'outside');

    const parsed = importsOf("import { x } from '../server/db/firestore';\nimport { y } from '../components/Thing';\nexport const z = () => import('./local');\n");
    assert.deepEqual(parsed.map(p => p.specifier), ['../server/db/firestore', '../components/Thing', './local']);
    assert.deepEqual(parsed.map(p => p.line), [1, 2, 3]);
    // and the real scan would report both of the first two
    const violations = parsed
      .map(({ specifier, line }) => ({ specifier, line, layer: layerOf(file, specifier) }))
      .filter(i => i.layer === 'server' || i.layer === 'components');
    assert.deepEqual(violations.map(v => v.specifier), ['../server/db/firestore', '../components/Thing']);
  });
});
