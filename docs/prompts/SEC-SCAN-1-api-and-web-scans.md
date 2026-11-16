# SEC-SCAN-1 — test the running app from the outside: Schemathesis in CI, a nightly ZAP scan

*Owner's request, 15 Nov 2026 ("so add it"). Lane: AI #6 (security). Written by Claude (AI #1).*

## Why

The repository already checks the code from the inside: CodeQL, SonarCloud, `npm audit`, the SBOM job,
the database rule tests (`supabase/tests/rls.test.sql`) and the route-guard tests. Nothing tests the
**running** server the way an outsider would: sending unexpected requests to the API and probing the
web pages. Two open-source tools do that.

- **Schemathesis** reads the API description the server already publishes
  (`GET /api/v1/openapi.json`, built in `src/server/openapi.ts` from the registered commands, #719) and
  sends thousands of generated requests: wrong types, missing fields, huge values, odd Unicode. It
  reports server errors (500s), responses that do not match the description, and slow requests.
- **OWASP ZAP** (baseline scan) loads the web app and reports missing security headers, cookie flags,
  information leaks and common injection signs.
- **nuclei** is not added: it mostly checks for known flaws in off-the-shelf products, which this app
  does not use.

## What to build

### 1. Schemathesis in CI (`.github/workflows/api-fuzz.yml`)

- Start the server the way the browser tests do (`PORT=3000 NODE_ENV=test npx tsx server.ts`) against the
  CI test database (`LF_TEST_DATABASE_URL`, migrations applied as in `ci.yml`), with a seeded test
  workspace and a test user. Never a real database.
- Run Schemathesis (the official `schemathesis/action`, or `uvx schemathesis` pinned to an exact
  version) against `http://127.0.0.1:3000/api/v1/openapi.json`, authenticated as the test user's
  bearer token, with checks: `not_a_server_error`, `status_code_conformance`,
  `response_schema_conformance`, `content_type_conformance`. Limit examples per operation so the job
  stays under 15 minutes.
- **Two phases.** Phase 1: the job runs on every pull request but does not block (`continue-on-error`),
  and uploads its report as an artifact. Each real finding becomes an issue (or a fix PR in AI #6's
  lane; findings in `src/server/` money code go to AI #1). Phase 2: once the findings list is empty, the
  job blocks merges. Say in `docs/FOR_YOU.md` when you switch it to blocking.
- Writes in fuzzing go only to the test workspace; the job runs the commands with
  `dry_run`/preview where a command offers one, and otherwise against the throwaway test database.

### 2. ZAP baseline scan, nightly (`.github/workflows/zap-baseline.yml`)

- Scheduled nightly (and by hand with `workflow_dispatch`), not on every pull request: it is slow.
- Target: a locally started production build in the job (`npm run build` then the server), never the live
  site. A rules file (`.zap/rules.tsv`) marks known, accepted warnings with a reason each, so the report
  shows only new problems.
- Upload the HTML report as an artifact; open an issue when a new high or medium alert appears.

### 3. Scanning the live site — not without the owner

Scanning the deployed site (production or a Vercel preview) sends a lot of traffic and may trip
rate limits or alerts. Do not do it until the owner writes "OK to scan <address>" in
`docs/FOR_YOU.md` or in a message; then ZAP baseline only (passive), never the active attack scan.

## Rules

- Follow `CLAUDE.md`: a branch and a pull request, CI green, review comments answered.
- Pin every tool and action to an exact version.
- No secret in the workflow files; the test user's token is created inside the job.
- Fixing what the scans find follows the normal lanes: security fixes are AI #6's, anything in money
  code is AI #1's.

## Done when

- `api-fuzz.yml` runs on every pull request and uploads its report; every finding from the first full
  run is either fixed or filed as an issue with an owner.
- `zap-baseline.yml` runs nightly against a local build, with a rules file of accepted warnings and a
  reason for each.
- `docs/FOR_YOU.md` says when the Schemathesis job becomes blocking.
