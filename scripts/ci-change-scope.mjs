import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * Which CI work a pull request needs (`.github/workflows/ci.yml`, job `changes`).
 *
 * The workflow decides with three outputs, because the three long families of work cannot be
 * reached from the same kinds of file:
 *
 *   docs_only    – only documentation changed: the long jobs (validate, unit, timezones, build)
 *                  are skipped and `Docs checks` runs the unit tests that read a doc.
 *   browser_mode – `full` (five browser shards), `targeted` (only the changed specs, one runner),
 *                  or `skip`.
 *   build_mode   – `full` when a file that the production bundle or the server bundle is built
 *                  from changed; `skip` for docs, unit tests, browser specs and screenshots.
 *
 * A documentation file is Markdown anywhere, or a non-code asset inside `docs/` or `audit/`.
 * Both trees are excluded from the deployment (`.vercelignore`: `/docs/`, `/audit/`), so nothing
 * in them is bundled, served, or loaded by a browser test; the unit tests that read one are named
 * by `scripts/ci-doc-tests.mjs` instead of by a text search. Code-like files inside those trees
 * (`.ts`, `.mjs`, `.cjs`, `.sh`, `.py` — the archived probes and fixers) are NOT documentation:
 * `eslint .` covers them, so they still run the validate job.
 *
 * A browser spec is not a build input and not a unit test, so a spec-only change skips the
 * production build. It does NOT skip the unit suite: `src/tests/browser-wait-guard.test.ts` reads
 * every spec, so a spec can fail a unit test (measured 15 Nov 2026; see
 * `audit/ci-test-routing-2026-11-15.md`).
 */

const DOCUMENT_ASSET = /\.(?:md|mdx|txt|rst|csv|json|jsonl|ya?ml|png|jpe?g|gif|svg|webp|pdf|patch|log)$/i;
export const isDocumentationPath = p => /\.md$/i.test(p) || (/^(?:docs|audit)\//i.test(p) && DOCUMENT_ASSET.test(p));

export const isUnitTestPath = p =>
  /^(?:src\/tests\/[^/]+\.test\.tsx?|src\/lib\/[^/]+\.test\.ts|src\/server\/utils\/[^/]+\.test\.ts)$/.test(p);
export const isBrowserSpecPath = p => /^e2e\/(?:[^/]+)*[^/]+\.spec\.tsx?$/.test(p);
export const isScreenshotPath = p => /^e2e\/__screenshots__\//.test(p);

const normalize = x => typeof x === 'string' ? { status: 'M', path: x } : x;
const valid = f => Boolean(f) && typeof f.path === 'string' && Boolean(f.path.trim())
  && typeof f.status === 'string' && /^[AMDTUXB]$/.test(f.status);

export function classifyChangedPaths(changes) {
  if (!Array.isArray(changes)) throw new TypeError('expected an array of changes');
  const files = changes.map(normalize);
  // An unreadable or empty diff must fail closed: run everything.
  if (!files.length || !files.every(valid)) {
    return { docs_only: false, browser_mode: 'full', targeted_specs: [], build_mode: 'full' };
  }

  const docsOnly = files.every(f => isDocumentationPath(f.path));
  // Build inputs: everything that is not documentation, a unit test, a browser spec or a
  // screenshot baseline. The bundle and the server entry cannot be reached from those.
  const buildInputs = files.some(f => !isDocumentationPath(f.path) && !isUnitTestPath(f.path)
    && !isBrowserSpecPath(f.path) && !isScreenshotPath(f.path));
  // The browser suite can only be affected by something other than docs and unit tests
  // (a deleted spec counts: it may still be referenced by a shared helper).
  const browserRelevant = files.some(f => !isDocumentationPath(f.path) && !isUnitTestPath(f.path));
  const specsOnly = files.some(f => isBrowserSpecPath(f.path))
    && files.every(f => isDocumentationPath(f.path) || isUnitTestPath(f.path) || isBrowserSpecPath(f.path));
  // --no-renames reports a delete as D; a deleted spec cannot be run.
  const presentSpecs = files.filter(f => f.status !== 'D' && isBrowserSpecPath(f.path)).map(f => f.path);

  return {
    docs_only: docsOnly,
    browser_mode: !browserRelevant ? 'skip' : specsOnly ? (presentSpecs.length ? 'targeted' : 'skip') : 'full',
    targeted_specs: specsOnly ? presentSpecs : [],
    build_mode: buildInputs ? 'full' : 'skip',
  };
}
export const isDocsOnlyChangedPaths = files => classifyChangedPaths(files).docs_only;

/**
 * The jobs a classified change starts, in workflow order. Kept next to the classifier so a
 * developer can ask "what will run for this diff?" without reading the YAML, and so a test can
 * prove the plan and the workflow agree (`scripts/ci-change-scope.test.mjs`).
 */
export function planJobs(scope) {
  const longRuns = scope.docs_only !== true;
  const plan = [
    { jobs: ['changes'], runs: true, because: 'every run classifies its diff' },
    { jobs: ['docs_checks'], runs: scope.docs_only === true,
      because: 'documentation only: the unit tests that read a doc (scripts/ci-doc-tests.mjs)' },
    { jobs: ['validate'], runs: longRuns,
      because: 'lockfile, TypeScript, ESLint, production env, database rules, npm audit, scripts tests' },
    { jobs: ['unit', 'unit_gate'], runs: longRuns,
      because: 'the whole unit suite in four shards with the merged coverage gate' },
    { jobs: ['timezones'], runs: longRuns,
      because: 'the whole unit suite in two time zones, three shards each' },
    { jobs: ['build'], runs: scope.build_mode === 'full',
      because: scope.build_mode === 'full' ? 'a file the bundles are built from changed'
        : 'docs, unit tests, browser specs and screenshots are not bundle inputs' },
    { jobs: ['e2e_shards'], runs: scope.browser_mode === 'full',
      because: 'application, configuration or migration change: all five browser shards' },
    { jobs: ['e2e_targeted'], runs: scope.browser_mode === 'targeted',
      because: 'only browser specs changed: just those specs, on one runner' },
    { jobs: ['e2e'], runs: true, because: 'the browser gate always reports (skipped when nothing runs)' },
  ];
  return plan;
}

export function formatPlan(scope) {
  const lines = [
    `docs_only=${scope.docs_only} browser_mode=${scope.browser_mode} build_mode=${scope.build_mode}`,
    scope.targeted_specs.length ? `targeted specs: ${scope.targeted_specs.join(', ')}` : null,
  ].filter(Boolean);
  for (const step of planJobs(scope)) {
    lines.push(`${step.runs ? 'RUN ' : 'skip'} ${step.jobs.join(' + ')}: ${step.because}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const explain = argv.includes('--explain');
  const paths = argv.filter(a => a !== '--explain');
  let changes;
  if (paths.length) {
    // A developer pasting changed files: `node scripts/ci-change-scope.mjs --explain src/App.tsx`
    changes = paths.map(path => ({ status: 'M', path }));
  } else {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    // git diff --name-status --no-renames -z emits STATUS NUL PATH NUL records.
    const parts = Buffer.concat(chunks).toString('utf8').split('\0');
    if (parts.at(-1) === '') parts.pop();
    if (parts.length % 2 !== 0) throw new Error('Invalid Git status record');
    changes = [];
    for (let i = 0; i < parts.length; i += 2) changes.push({ status: parts[i], path: parts[i + 1] });
  }
  const scope = classifyChangedPaths(changes);
  if (explain) {
    process.stdout.write(formatPlan(scope) + '\n');
  } else {
    process.stdout.write('docs_only=' + scope.docs_only + '\n');
    process.stdout.write('browser_mode=' + scope.browser_mode + '\n');
    process.stdout.write('targeted_specs=' + JSON.stringify(scope.targeted_specs) + '\n');
    process.stdout.write('build_mode=' + scope.build_mode + '\n');
  }
}
