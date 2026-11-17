# Agent #6 checkpoint 02 — SEC-SCAN-1 workflow diagnosis, validation and launch assessment

**Date:** 2026-11-17 UTC
**Branch:** `arena/aed2bcd0-ledgerflow`
**Base:** `4c87916df6f87fcad768a898ba39b268d3d5f7ac`
**Current PR:** [#756](https://github.com/shmuelbiller1/ledgerflow/pull/756), open; latest pushed code at `3e16fb393b0a98315097678bbc6c895ff39fe0e6` (documentation update in this checkpoint is pending its final commit).
**Scope:** SEC-SCAN-1 workflows, their contract test and status documentation. No `src/server/**`, money, posting, tax, migration, or AI #1 server-lane changes were made. No live URL or production database was scanned.

## 1. GitHub zero-job diagnosis

The scanner's workflow registration failure has a reproducible YAML cause. The `Install pinned Schemathesis` step had this plain scalar:

```yaml
run: python -m pip install --disable-pip-version-check --only-binary :all: schemathesis==4.33.4
```

The colon followed by a space in `:all: schemathesis` is parsed as YAML mapping syntax. The local `yaml` parser rejected the workflow at line 61 with `Nested mappings are not allowed in compact mappings`. The old workflow file on `main` also appeared in GitHub's workflow registry under `.github/workflows/api-fuzz.yml` rather than its declared display name. Runs created for it had zero jobs, 0-second duration, no artifacts, and no downloadable logs. `gh workflow run ... --ref main` returned HTTP 422 saying `workflow_dispatch` was absent even though the source text contained it.

The corrected command shell-quotes the option value, so YAML reads a valid string and the shell still passes pip `--only-binary=:all:`:

```yaml
run: python -m pip install --disable-pip-version-check --only-binary=':all:' schemathesis==4.33.4
```

A regression assertion now requires that quoted form. Both scanner workflows pass a YAML parse check; the API workflow parses `push`, `pull_request`, and `workflow_dispatch` plus its `schemathesis` job. ZAP parses `schedule` and `workflow_dispatch` plus `zap-baseline`.

**PR proof:** after the fix, GitHub executed the `pull_request` API-fuzz job and uploaded JUnit/output artifacts. The run's display name was `API schema fuzzing (Schemathesis)`. This demonstrates the PR workflow definition is parseable and executable. The default branch has not received the fix, however: latest observed `main` was `a507aed5d2ddce7d7ed00f4a9fdfd6b20e648eeb`, where line 61 still contains the invalid scalar. A post-fix dispatch attempt therefore still returned 422. Manual dispatch on `main` is **not yet verified** and cannot be considered restored until the fix reaches the default branch.

Observed zero-job `main` runs (all have zero jobs and no artifacts):

| Run | Main SHA | Result |
|---|---|---|
| `43981616172` | `225b225ca3b0781f8250343af04a095c77449a71` | failure, 0 jobs |
| `43983831337` | `4c87916df6f87fcad768a898ba39b268d3d5f7ac` | failure, 0 jobs |
| `43991078303` | `5f0a37933d827c4e838ed6c35e2c2eaf4c56d59b` | failure, 0 jobs |
| `43992114900` | `a507aed5d2ddce7d7ed00f4a9fdfd6b20e648eeb` | failure, 0 jobs |

The earlier PR runs `43978220182` and `43978793029` did execute before the problematic workflow version reached `main`; neither is a post-fix `main` run.

## 2. Schemathesis execution and report status

PR #756 produced two actual scanner runs:

| Run | PR head | Execution/report | Interpretation |
|---|---|---|---|
| `43992691517` | `3973a2a6ee424b095352a014ef8bb9c3116b59ac` | One job completed; migrations and seed/server step succeeded; JUnit verification and upload succeeded. Artifact `14287503454`, 466,741 bytes. No failed-step annotation was returned. | A real report was produced, but its contents were not inspected here. Do not infer a clean finding set from job green alone while the step is report-only. |
| `43993423090` | `3e16fb393b0a98315097678bbc6c895ff39fe0e6` | One job completed; migrations, seed/server, JUnit verification and artifact upload succeeded. Artifact `14289540111`, 468,410 bytes. GitHub check annotation states `Process completed with exit code 1` for the Schemathesis step. | The scanner command failed and `continue-on-error: true` masked the step failure at job level, as designed for Phase 1. This is **not** a clean scan. |

The report artifact exists in GitHub for both executions. This sandbox could list metadata, but `gh run download` redirected to the Actions blob-storage host and ended with EOF (that host is outside the available network allowlist); therefore the JUnit and console output were not read. Review the report from the GitHub UI before interpreting the exit-1 finding or declaring a clean scan. The differing step outcomes across two PR executions are another reason not to promote the scanner.

## 3. Workflow safety/reproducibility changes

- Both jobs use `ubuntu-24.04`, PostgreSQL `17.12`, Node `24.22.3`; the API job uses Python `3.11.18` and Schemathesis `4.33.4`.
- Actions are pinned by full immutable commit SHA to versions whose `action.yml` declares `runs.using: node24`:
  - checkout v7.0.1 — `3d3c42e5aac5ba805825da76410c181273ba90b1`
  - setup-node v7.1.0 — `949feb2413d6458794dcd2491c4babbbce0c15c1`
  - setup-python v7.1.0 — `6d4fd22b20465ccc0f7354476588e8df7c9ca0e0`
  - upload-artifact v7.0.2 — `cf430e030ddbb5b0abf93d22962f4752f3646cd9`
- GitHub initially warned that the previously pinned actions targeted Node 20 and were being forced onto Node 24. Their pins were upgraded to the Node 24 releases above; the subsequent run `43993423090` had no Node 20 runtime warning.
- Schemathesis remains report-only. The promotion note retains the explicit requirement for **three consecutive clean `main` runs with reports uploaded**.
- ZAP remains schedule/manual only (not on PRs), uses the pinned ZAP `2.16.1` image tag, and targets `http://127.0.0.1:3000` only. It sets local `APP_URL` and starts the built production bundle (`node build/server.cjs`) rather than `tsx server.ts`.

## 4. Validation performed

- Full local test suite under Node `24.22.3`: **5,395 total, 5,387 passed, 0 failed, 8 skipped**. The skipped tests require `LF_TEST_DATABASE_URL`, which was not configured locally.
- Focused security/API and scanner contract suite after final action-SHA assertion changes: **5/5 passed**.
- Built bundle boundary tests: **16/16 passed**.
- TypeScript: passed with `NODE_OPTIONS=--max-old-space-size=4096`.
- ESLint: **0 errors, 2 existing warnings** (`supabaseAuth.ts` and `pg/values.ts`).
- Production build: passed; produced `build/server.cjs`.
- Local smoke test ran the built production server with dummy configuration and `LF_STANDALONE_JOBS=off`; `/api/health` and `/` each returned HTTP 200. This was a startup/static-shell smoke test, not a database-backed scan.
- `npm audit --audit-level=high`: exit 0; **15 moderate** findings, no high/critical findings.
- Direct GitHub Actions workflow parsing with the project-installed `yaml` parser: both changed YAML documents parsed successfully after the fix.

No Docker or local PostgreSQL executable was available, so ZAP was not run locally. GitHub's PR Schemathesis service did apply migrations to its ephemeral PostgreSQL and produce reports.

## 5. Launch / promotion assessment

**SEC-SCAN-1 implementation:** PR #756 contains the YAML parser fix, immutable/Node-24 Actions pins, exact runtime/image tags, safer local production-server ZAP startup, test assertions and updated status documentation. The PR-triggered API job now executes and uploads a report.

**Scanner readiness:** **Not certified / do not promote.** One of the two actual PR Schemathesis runs reports exit code 1, and the report bytes were not inspectable in this environment. The default-branch workflow is still invalid at the latest observed SHA, so all four observed `main` failures remain zero-job runs; there are **zero qualifying post-fix clean `main` runs**. Keep `continue-on-error: true` and Phase 1. Do not treat job-level green when the scanner step is report-only as a clean scan.

**ZAP readiness:** production bundle startup was smoke-tested locally; the ZAP container itself has not been run. Its local-only target remains enforced. No live-site scan was performed. Written owner approval for a specific address is still required before any live scan.

**PR state:** #756 is open on `arena/aed2bcd0-ledgerflow`; no merge was performed. The manual dispatch check remains blocked until the workflow fix reaches `main`.
