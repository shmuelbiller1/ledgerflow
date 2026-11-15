# Which change runs which test — CI routing audit

**Date:** 15 November 2026
**Revision audited:** `e7796454` (`main`), branch `arena/204e16d4-ledgerflow`
**Scope:** the routing itself — the trigger rules, the change classifier, the jobs each kind of change
starts, the tests each job runs, and the work no change needs. Not the content of any test.
**Code changed:** yes. Every change is listed in §5 with the test that keeps it true.

> **How to read this.** Every number below was produced by a command listed in **Appendix A**, on
> this repository at the revision above. Where a number came from an earlier document I say so.
> Section 4 lists the seven defects I found with evidence; §6 lists what I deliberately did not
> touch, with the measurement that justifies leaving it.

---

## 1. The mechanism, in one page

A pull request runs `.github/workflows/ci.yml`. The `changes` job diffs the head against the merge
base (`git diff --name-status --no-renames -z "$BASE...$HEAD"`), feeds the NUL-delimited records to
`scripts/ci-change-scope.mjs`, and publishes three outputs:

| Output | Values | What reads it |
|---|---|---|
| `docs_only` | `true` / `false` | `docs_checks` (runs when true); `validate`, `unit`, `timezones` (skipped when true) |
| `browser_mode` | `full` / `targeted` / `skip` | `e2e_shards` (full, 5 runners), `e2e_targeted` (targeted, 1 runner), `e2e` gate |
| `build_mode` | `full` / `skip` | `build` — **added by this audit** (§4.1) |

A push to `main` and a manual run print `docs_only=false browser_mode=full build_mode=full`, so the
merged result always runs everything. The two gate jobs (`unit_gate`, `e2e`) always report, so every
required check resolves in every mode instead of leaving a pull request waiting for a check that
never starts.

Twenty runners start for a change that touches application code: `changes` 1, `validate` 1, `unit`
4, `unit_gate` 1, `build` 1, `timezones` 6, `e2e_shards` 5, `e2e` 1. That number is the budget every
other row in the table is measured against.

| The change touches | Runners before | Runners after |
|---|---|---|
| Documentation only (`.md` anywhere, or an asset under `docs/`) | 4 | 4 |
| A documentation **artifact** (`docs/CODE_ATLAS.jsonl`, `docs/eval/*.json`, `docs/verification/*.png`, `audit/*.csv`) | **20** | **4** |
| Unit tests only | 15 | **14** (the build is not a function of a test; 15 for the three bundle-invariant tests, §7.2) |
| Browser specs only | 16 | **15** (the build is not a function of a spec) |
| Screenshot baselines only | 20 | **19** |
| Application code, config, workflow, dependency, migration | 20 | 20 |

---

## 2. What the suites actually are

| Suite | Files | Where it runs |
|---|---|---|
| Unit tests | **1,068 files**: 1,055 `src/tests/*.test.ts(x)` plus 13 `src/lib`/`src/server/utils` | `unit` (4 shards, coverage) and `timezones` (2 zones × 3 shards) on every code change |
| Browser tests | **119** specs | `e2e_shards` (5 shards), or `e2e_targeted` for a spec-only change |
| Script tests | **12** (14 after this audit) | `validate`, named explicitly in a `node --test` command |
| Database security rules | `supabase/tests/rls.test.sql` | `validate`, after `npm run db:test-setup` |

`npm test` and `test:shard` pass explicit globs. `scripts/ci-build-inputs.test.mjs` now proves that
every `*.test.ts(x)` under `src/` is one of those globs — a test in a subdirectory would otherwise
exist and run in no job at all — and that every `scripts/*.test.mjs` is named by a CI step (§4.4).

---

## 3. The rule that decides "docs only"

`isDocumentationPath` accepted `*.md` anywhere, plus a short extension list *only under `docs/`*.
Everything else under `docs/` — and all of `audit/` — was application code as far as CI was
concerned, so regenerating the 34 MB code atlas (`docs/CODE_ATLAS.jsonl`) or adding one verification
screenshot started the full 20-runner matrix. Both trees are excluded from the deployment by
`.vercelignore` (`/docs/`, `/audit/`, verified by `src/tests/vercel-ignore-boundary.test.ts` from the
build entry points), so nothing in them can reach a bundle, the server or a browser. The rule is now
"a non-code extension inside either tree is documentation", and a **code** file inside those trees
(the archived probes and one-off fixers: 43 `.cjs`, 48 `.ts`, 4 `.mjs` in `audit/`) still runs every
job, because `eslint .` covers them.

---

## 4. Defects found

### 4.1 The production build ran for changes that cannot change it — **fixed**

`build` ran for every change that was not documentation-only, including a one-line edit to a unit
test or a browser spec. Neither is a bundle input: the Vite client is built from `src/main.tsx` and
the server bundle from `server.ts`.

**Evidence.** `bundleInputs()` in `scripts/ci-build-inputs.test.mjs` now walks both graphs —
**1,581 modules** — and finds no reachable test, spec or document.

**One exception, found by review (§7.2).** Three unit tests assert on the *built* artifacts
(`stage6-footprint-optimization`, `pwa-bundle-optimization`, `server-bundle-boundary`). They also run
in the unit shards, but `LF_REQUIRE_BUILT_DIST` and `dist/` exist only in the build job, so their
artifact assertions are skipped there and the edited assertion would never run. Those three files
(`BUNDLE_INVARIANT_TESTS`) are therefore build inputs, and a test keeps that list equal to the
`npm run test:bundle` command. (The same walk is the reason the
`vercel-ignore-boundary` test can claim its >1,000 modules.)

**Fix.** New `build_mode` output: `full` only when a file that is not a doc, a unit test, a browser
spec or a screenshot changed. The guard test fails and names this audit if a bundle input ever
imports a test.

### 4.2 The docs-only runner ran 73 tests that read no document — **fixed**

The workflow pasted a text search into its shell:

```bash
grep -lE "docs/|[A-Za-z_]+\.md['\"\`]" src/tests/*.test.ts ... | grep -v database-tests-notice
```

**Measured:** 18 files selected, 106 tests. 11 of those files reference a doc **only in a comment** —
`eg1-stock-cost-repost`, `eg2-credits-writeoffs`, `eg2-payment-ledger`, `eg2-payment-void`,
`eg3-period-closing`, `l94-posting-core`, `main-path`, `main-path-labels`,
`l123-step4-open-years`, `theme-contrast-pairs`, `audit-ai3-calendar-scope` — and they account for
73 of the 106 tests on their own. A documentation change cannot affect them (an `LF_TEST_DATABASE_URL`
suite that skips without a database cannot affect anything in that runner), so those were 73 tests
running for nothing, in the one job whose whole point is to be fast.

### 4.3 …and it could not see a document named in parts — **fixed**

The same search cannot match `path.join('docs', 'TRACKER.md')`: there is no `docs/` in any single
string. A test written that way would never run on a documentation-only pull request, so a doc
change that broke it would merge green. No current test uses that form — the hole was real but empty.

**Fix (4.2 + 4.3).** `scripts/ci-doc-tests.mjs` selects from the parsed source: string literals only,
then a path into `docs/`/`audit/`, or a `*.md`/`*.txt`/`*.rst` name that resolves to a file. 7 files,
32 tests, 7.0 s instead of 18 files, 106 tests, 15.5 s (this sandbox, two cores). The workflow now
calls the script; `scripts/ci-doc-tests.test.mjs` pins the list file by file, pins the comment-form
exclusion and the folder-form inclusion, and fails if the workflow goes back to a copied grep.

### 4.4 A test script that no job would ever run — **guard added**

`src/tests/test-discovery-guard.test.ts` (AUD-06) already proves that `npm test` and `test:cov` run
every `src/**/*.test.ts(x)` — that half of the problem was covered, and this audit confirms it still
holds (1,068 files). The **script** tests were not covered: `scripts/*.test.mjs` run only because
`validate` names each one in a `node --test` command, so a new script test is run by nothing until
someone remembers to add it. `scripts/ci-build-inputs.test.mjs` now fails when a
`scripts/*.test.mjs` is named by no CI step — it caught this audit's own new test before I added it
— and checks the other half of the unit-test contract: every test file on disk is one
`isUnitTestPath` recognises, so its own change is routed as a test change rather than as application
code.

### 4.5 The browser specs are linted but never type-checked — **reported, not fixed**

`tsconfig.json` includes `["src", "server.ts"]`, and `npm run lint:types` is `tsc --noEmit` on that
project. `e2e/` (119 specs, 13,128 lines) and `scripts/*.ts` are outside it. `eslint .` does cover
them; TypeScript does not.

**Measured.** Extending the include to `e2e/` yields **161 errors**: 119 are `Cannot find module
'/src/...'` inside `page.evaluate` (browser-context code that needs ambient declarations, not bugs)
and **42 are real** — a `Transaction` literal missing its required `type`
(`e2e/chart-drill-shapes.spec.ts:30`), a property that does not exist and was renamed
(`dimensionNodes` vs `dimensions`, `e2e/data-quality-and-sample-year.spec.ts:103`), implicit `any`
in evaluate callbacks in `business-menu`, `w4-bank-csv-import-reconcile`, `journeys-w2-w9`, and
`window.bookmarkUi` used without a declaration (`e2e/bookmarks.spec.ts:26`).

**Consequence today:** a spec's type error is found by the 30-minute browser shard, or by nothing at
all if the branch is not exercised. **Not fixed here** because it is not a routing change: it needs a
second `tsconfig` (with ambient declarations for the `/src/...` and `/@react-refresh` imports inside
`page.evaluate`) and a sweep of the 42 real errors, which must not be done inside a CI-routing PR.
False aliasing would be worse than the gap: a `tsc` that reports 161 errors is a gate nobody reads.

### 4.6 `ignore` is used by a test but is not a dependency — **fixed**

`src/tests/vercel-ignore-boundary.test.ts` imports `ignore`, which is not in `package.json`. It
resolves only because `eslint` and `@typescript-eslint/eslint-plugin` hoist it to the root
(`package-lock.json`: two providers, `^5.2.0` and `^7.0.5`; npm picked 7.0.11). A dependency bump
that nests it, or a different hoisting decision, turns a documentation-only pull request red with
`ERR_MODULE_NOT_FOUND` — and the message would point at a dotfile, not at a missing dependency.

**Fix.** `ignore: ^7.0.11` declared as a devDependency; the lock diff is one line and
`npm ci --dry-run --ignore-scripts` accepts it. A scan of every bare import in `src/`, `scripts/`,
`server.ts` and `api/` against both dependency lists finds nothing else undeclared except the
intentional stubs (`@supabase/auth-js`, `@supabase/realtime-js` mocked in `src/tests/helpers/dom.ts`),
`k6` (a load-test runtime) and Vite's `virtual:pwa-register`.

### 4.7 The strategy document disagrees with the workflow — **fixed**

`docs/CI_STRATEGY.md` stated the lint ceiling as `eslint . --max-warnings 212`. It is **2**:
`eslint .` reports exactly two warnings (`no-explicit-any` in `src/server/auth/supabaseAuth.ts:21`
and `src/server/db/pg/values.ts:7`). A document that says the ceiling is 212 when it is 2 makes the
strongest quality gate in the repository look decorative. The same section said "all four browser
shards" (five since 24 Oct) and described the time-zone matrix as two parts (three since 26 Oct).
Corrected, and the routing table in §1 is now in that document.

---

## 5. What changed

| File | Change |
|---|---|
| `scripts/ci-change-scope.mjs` | Documentation = Markdown anywhere or a non-code asset in `docs/`/`audit/`; new `build_mode`; `planJobs`/`formatPlan` and `--explain`; invalid diffs still fail closed (run everything) |
| `scripts/ci-doc-tests.mjs` | **New.** The unit tests that read a document, selected from parsed literals |
| `scripts/ci-build-inputs.test.mjs` | **New.** Bundle-entry walk (proves `build_mode`), unit-test-glob guard, script-test-named-by-CI guard |
| `scripts/ci-doc-tests.test.mjs` | **New.** Pins the docs selection, the comment/folder forms, the CLI, and the workflow call |
| `.github/workflows/ci.yml` | `build_mode` output and `build` condition; `docs_checks` calls the script; the two new guards added to `validate`; comments corrected |
| `scripts/ci-change-scope.test.mjs` | 34 classification cases (12 new: docs artifacts, code inside `docs/`, screenshots, deletions), CLI, and a plan-versus-workflow check |
| `scripts/ci-cancellation.test.mjs` | Asserts the new `build` condition and the non-PR outputs |
| `package.json`, `package-lock.json` | `ignore: ^7.0.11` declared (§4.6) |
| `docs/CI_STRATEGY.md` | "What a change runs" with the measured table; lint ceiling, shard counts corrected |

Nothing in `src/` changed, so no financial, posting or tax behaviour is touched.

---

## 6. Deliberately not changed

1. **A spec-only change still runs the whole unit suite (10 runners).** Tempting and wrong:
   `src/tests/browser-wait-guard.test.ts` reads **every** `e2e/*.spec.ts` and fails when a spec
   passes a `{ timeout }` object as `waitForFunction`'s argument instead of its third parameter
   (that defect made one shard take 45 minutes). A spec change can fail a unit test, so the unit
   suite is not skippable. Only the build is.
2. **The time-zone matrix (6 runners) still runs on every pull request.** It is now the single
   largest per-PR cost after the four unit shards: the entire 1,068-file suite, twice more. The 22
   Oct audit proposed a date-path filter and the project rejected it — "a date bug in a file the
   filter missed would only show on `main`". I agree with that reasoning and did not re-litigate it.
   If it is ever revisited: run one zone on pull requests and both on `main`, which is a policy
   decision, not a routing bug.
3. **CodeQL and the SBOM workflow run on documentation-only pull requests.** `codeql.yml` says the
   main ruleset requires a code-scanning result, so `paths-ignore` would leave that check
   *expected-but-never-reported* and block the merge. The safe shape is the one `e2e` already uses —
   the job always runs, its analysis steps are conditioned — and that needs the ruleset confirmed by
   the owner first.
4. **`nightly-stability`'s flaky detector cannot fail** (`|| true` plus `continue-on-error: true`).
   It reports through the run summary and an artifact only. Changing it to fail would make a known
   flaky test red the whole nightly; the owner's rule is never to quarantine, so this stays a
   reporting job. Worth an issue-tab summary step, not a routing change.
5. **The coverage gate is unchanged.** Thresholds are 75/72/73 in both `test:cov` and
   `coverage:gate`, and `scripts/coverage-merge.test.mjs` still keeps the two equal. This audit did
   not touch thresholds, shard counts or the merge.

---

## 7. What review of this pull request caught

The bots on PR #715 found three defects, two of them introduced by the first commit of this audit. They
are worth recording because the audit's own subject is "does the routing notice what it should".

### 7.1 A regular expression I broke — the worst kind of regression in this file (fixed)

Rewriting `ci-change-scope.mjs`, I changed `(?:[^/]+\/)*` to `(?:[^/]+)*` in `isBrowserSpecPath`. Two
consequences: a nested spec (`e2e/journeys/w1.spec.ts`) no longer counted as a spec, and the two
adjacent quantifiers partition the same filename, so rejection backtracks exponentially.

**Measured on that commit** (the command is in Appendix A): `e2e/journey-a11y-baseline.json` — a file
that exists — **1.8 s** per match; a 24-character name 3.9 s; a 28-character name **61 s**. The
classifier asks up to three times per path, in the `changes` job that every other job `needs:`, whose
timeout is five minutes. A 30-character baseline file name would have stopped the whole pipeline.

Found by CodeQL (`security/code-scanning/79`), SonarCloud (`javascript:S5852`, HIGH security,
CRITICAL), Codex and Gitar — four tools, one line. The separator is restored and pinned two ways: a
nested-spec classification case, and a timing test that rejects a 64-character non-spec path in under
250 ms.

### 7.2 Three tests assert on the build, and the new `build_mode` skipped it (fixed)

Codex (P2). `src/tests/stage6-footprint-optimization.test.ts` reads `dist/assets` and only *requires*
it under `LF_REQUIRE_BUILT_DIST=1` — set in the build job alone. A pull request editing that test
therefore ran its edited assertions in no job at all. §4.1 is corrected: those three files are build
inputs.

### 7.3 `[…].sort()` without a comparator (fixed)

SonarCloud `javascript:S2871` (CRITICAL, reliability) on `scripts/ci-doc-tests.mjs`: the docs-test list
was sorted with the default comparator. It is a code-point comparator now, in both the producer and the
test that pins the order.

---

## Appendix A — reproduce every number

```bash
# The classifier, on any diff (no push needed)
node scripts/ci-change-scope.mjs --explain src/App.tsx docs/PLAN.md
git diff --name-status --no-renames -z origin/main...HEAD | node scripts/ci-change-scope.mjs

# Suite sizes
ls src/tests/*.test.ts* | wc -l                       # 1,055
ls src/lib/*.test.ts src/server/utils/*.test.ts | wc -l   # 13
node --test scripts/ci-build-inputs.test.mjs            # bundle inputs: 1,581
find e2e -name '*.spec.ts' | wc -l                    # 119
ls scripts/*.test.mjs | wc -l                         # 12 before this audit

# The docs-only selection, before and after
grep -lE "docs/|[A-Za-z_]+\.md['\"\`]" src/tests/*.test.ts src/tests/*.test.tsx \
  src/lib/*.test.ts src/server/utils/*.test.ts | grep -v database-tests-notice | wc -l   # 18
node scripts/ci-doc-tests.mjs | wc -l                 # 7
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  node_modules/.bin/tsx --test --test-force-exit $(node scripts/ci-doc-tests.mjs) | tail -4   # 32 tests

# Which selected files read no document (the 11 dropped)
node scripts/ci-doc-tests.test.mjs                     # pins the comment-only cases

# The build-input proof and the "a test runs nowhere" guards
node --test scripts/ci-build-inputs.test.mjs

# E2E type-check gap (§4.5): extend tsconfig.json's include to ["e2e"], then
npx tsc -p tsconfig.e2e-probe.json --noEmit | wc -l     # 161 (119 browser-context, 42 real)

# Phantom dependency scan (§4.6): compare bare imports in src/, scripts/, server.ts against
# package.json dependencies + devDependencies. Only the intentional stubs remain.

# Lint ceiling (§4.7)
npm run lint:eslint                                     # 2 warnings, 0 errors

# The ReDoS of §7.1, on the commit that had it (do not run the 28-character case casually):
node -e "const re=/^e2e\/(?:[^/]+)*[^/]+\.spec\.tsx?$/; for (const p of ['e2e/journey-a11y-baseline.json','e2e/'+'a'.repeat(24)+'.json']) { const t=process.hrtime.bigint(); re.test(p); console.log(p.length, Number(process.hrtime.bigint()-t)/1e6, 'ms'); }"
# fixed version, same inputs: microseconds (scripts/ci-change-scope.test.mjs asserts < 250 ms)
```

## Appendix B — the routing rules in one line each

- **docs only** → `docs_checks` runs the tests that read a document; everything long is skipped.
- **build input** → `build` runs; that is every changed path that is not a doc, a unit test, a spec
  or a screenshot.
- **browser relevance** → `full` when anything other than docs, unit tests or specs changed
  (a screenshot counts: the suite is what verifies it); `targeted` when only specs changed; `skip`
  otherwise.
- **deleted spec** → not run; if nothing else changed, the browser suite is skipped rather than
  started empty.
- **unreadable diff** (empty, odd record count, an unknown status letter) → run everything.
