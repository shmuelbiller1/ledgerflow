# Agent #6 — audit scorecard at the pin (Pass A + Pass B, security lane)

**Pin:** `dc40739708a013ad080ffb306fe461554a2391fc` (upstream `main`, 2026-11-10).

## Coverage, honestly

| Metric | Count | How it is known |
|---|---:|---|
| Collections (tables) created by the migrations | 68 | parsed from every `supabase/migrations/*.sql` (`probes/lf-rules-coverage.py`) |
| Collections with a JSONB field allowlist | 21 | same parse (F-03) |
| Collections with neither allowlist nor field cap | 47 | same parse (F-03) |
| Express route files | 51 | `ls src/server/routes/*.ts` minus tests |
| Route registrations inspected for middleware | 11 of `adminRoutes.ts` (all) + the mounts of `labelingRoutes`, `logsUploadRoutes`, `metricsAuditRoutes`, `telemetryRoutes`, `registrationStatusRoutes`, `apiStatusRoutes`, `workspaceApiRoutes`, `developerApiRoutes`, `apiKeysRoutes`, `brainRoutes`, `authRoutes`, `ledgerMatchRoutes`, `cronRoutes` | read at the pin; the four that matter are pinned by `probes/s7-route-guards.test.ts` |
| Functions **read in full** at the pin (this session) | 14 | `usSalesTaxReturn`, `saleDestinationSnapshot`, `usQuarterJourney` (+`usQuarterPermits`, `registrationKey`), `evaluateRules`, `isSystemJobAuthorized`, `isCronRequest`, `authenticate`, `authorizeWorkspace`, `getReportContext`, `storePlaidSync`/`storePlaidChunk`, `runCron`/`BACKGROUND_JOBS`, `syncOneBank`, `maskCardNumbers` readers |
| **Executed** checks | 34 assertions | AF suites 20/20 + probes 8/8 + AF-012 2/2 + 4 sourced parses |
| DB-gated checks executed | **0** | no Postgres in this sandbox; `LF_TEST_DATABASE_URL` unset → every DB suite skips |
| Browser checks executed | **0** | no Playwright browsers and no app server in this sandbox |

**This is not a whole-product audit and it does not claim to be.** It is a *security-lane and
money-adjacent slice*: everything an independent reviewer can settle from source plus a pure
function in one session, with each claim pinned to a line or a run. The remaining ~99 % of the
function inventory stays where `audit/function-audit/SCORECARD.md` last left it (67 functions
inspected by AI #8; the 2026-11-08 agent-8 slice added AF-004 reachability work).

## Findings register (this session)

| ID | Sev | Finding | Lane | Reproduced |
|---|---|---|---|---|
| F-01 | **P1** tax reporting | US state return drops a sale whose place carries `region`; the seeded book writes `region` | AI #1 (tax maths) | yes, 4 assertions |
| F-02 | P2 | two `/api/v1/system/*` routes unmounted from middleware, one admin route not admin-gated; D-30 test blind | AI #1 (server) / Agent #6 for the test | yes, 4 assertions |
| F-03 | P2 | 47/68 `lf_rules` collections have no field allowlist or cap | AI #1 (schema) | parsed; live proof carried from 5 Nov |
| F-03b | P1 **latent** | #161 chained/cyclic overrides resolve by array order | AI #1 (tax maths) | yes, 2 assertions, shipped function |
| F-04 | P3 | `check-prod-env` wired to nothing (S-2) | Agent #6 | source |
| F-05 | P3 | `authRateLimiter` dead code; S-22 AI half already covered | Agent #6 | source |
| F-06 | P3 | no gitleaks, no audit hash chain (S-9/S-24, S-12) | Agent #6 | absence |
| F-07 | P2/P3 | AF-001-F1..F3 fixed and re-run green; AF-001-F4 `success:false` still open | AI #1 | suites 20/20 |

## What a next session should do, in order

1. **F-01** — one shared `stateOf(place)` reader + migrate the seeded book and `invoice-destination`
   fixture to one key. Add the probe to `src/tests/` so the fix stays fixed. This is a money-lane
   change: hand it to AI #1 with this file, do not merge it myself.
2. **F-02** — `authenticate, requireAdmin` on `/admin/integrity/orphan-scan`; a `systemJobAuthorize`
   middleware for the two `/system/*` routes; then replace D-30's word-grep with the registration
   parser in `probes/s7-route-guards.test.ts`.
3. **F-03** — a migration that adds `allowed_keys` to the money-adjacent set first
   (`idempotencyKeys`, `billingLedgerTraces`, `periodClosings`, `periodBalances`, `taxReturns`,
   `recoveryCodes`, `apiKeys`) and asserts it in `rls.test.sql` (the S-32 gap).
4. Re-run the full gate set with Postgres + browsers available: `npm run test:rules`, the whole
   unit suite, ESLint, build, the Playwright shards — none of which this sandbox can do.
5. Then continue Pass A at `postingCore` / `ledgerBulkCommit` / `reconcileRoutes`, which is where
   `audit/function-audit/SCORECARD.md` says the next 10-function batch starts.
