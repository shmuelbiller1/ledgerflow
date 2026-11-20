# Gates and evidence — Agent #6 — 2026-11-20

**Pinned revision:** `d1f2c8d` + this branch. **Sandbox:** Node v22.22.3, npm 10.9.8, 2 vCPU / 3.8 GB,
no PostgreSQL server, no Docker, outbound network limited to GitHub/npm.

---

## 1. Fast gates run locally (owner's 18 Nov rule: type check, lint on changed files, the tests for the
code changed — the full suite and the browser shards belong to CI)

| Gate | Command | Result |
|------|---------|--------|
| Type check | `NODE_OPTIONS=--max-old-space-size=3072 npx tsc --noEmit` | **exit 0** (a plain `tsc --noEmit` OOM-killed in this 3.8 GB sandbox — recorded so nobody reads it as a code failure) |
| ESLint (changed files only) | `npx eslint src/lib/csv.ts src/lib/privacyRobots.ts src/main.tsx src/server/http/contentSecurityPolicy.ts scripts/check-security-headers.ts src/tests/security-*.test.ts src/tests/audit-af010b-csv-dates.test.ts src/tests/csp-report-only.test.ts` | **0 errors, 0 warnings** |
| Production build | `NODE_OPTIONS=--max-old-space-size=3072 npm run build` | **passes** — `vercel-csp --check`, Vite, PWA (95 precache entries), `build/server.cjs`, `build/api.cjs` |
| CSP / vercel.json agreement | `npx tsx scripts/vercel-csp.ts` | **exit 0** after regeneration |
| Dependency gate (S-25) | `npx tsx scripts/check-dependency-audit.ts` | **PASS** — production: 0 critical / 0 high / 0 moderate / 0 low |

## 2. Test suites for the code this branch changed

| Suite(s) | Tests | Result |
|----------|-------|--------|
| `security-csv-formula-injection`, `audit-af010b-csv-dates`, `j1-export-import-roundtrip`, `pure-financial-utils-equivalence`, `csv-export` | 25 | **pass** |
| `security-token-page-indexing`, `security-client-error-reporting`, `csp-report-only`, `security-preflight-scripts` | 49 → **50** after the Gitar correction (`robots.txt` must not disallow token prefixes; `vercel.json` must send `X-Robots-Tag`) | **pass** |
| Combined run of the nine suites above | **74** | **74 pass, 0 fail** |
| Export/archive neighbours: `accountant-export-pack`(+view), `csv-export`, `audit-af010c-expr-csv`, `iif-export`, `j1-export-import-roundtrip`, `j5-hebrew-exports`, `j8-year-end-archive`, `scheduled-reports`, `report-export-header`, `monthly-report-csv`, `hebrew-data`, `bk10-archive-restore`, `asset-register-export` | **85** | **85 pass, 0 fail** |
| Structural guards: `vercel-ignore-boundary`, `reachability-guard`, `layers-guard` | 9 | **pass** |
| Boundary/contract/security: `pwa-bundle-optimization`, `server-bundle-boundary`, `route-contract`, `vercel-ignore-boundary`, `security-sweep` | 18 | **pass** |

## 3. What was deliberately **not** run locally, and why

| Not run | Reason | Who owns it |
|---------|--------|-------------|
| Full `npm test` (≈6,000 tests) and the six time-zone shards | Owner's rule: CI runs them in parallel, faster than this sandbox; a 3.8 GB box OOMs on the whole suite | CI |
| `npm run test:rules` (RLS), and every `*.test.ts` that opens a database (`security-s5-idempotency-matrix`, `security-s11-session-hardening`, `security-s15-person-erasure`, `security-s19-*` (no DB), `security-s26-admin-audit`, `security-s8-s38-s39-isolation`) | No PostgreSQL server in this sandbox (PGlite is not installed and is not a faithful substitute for the `40001`/serialization behaviour these assert) | CI (`Database rules` job) |
| Playwright browser shards, including `e2e/security-headers.spec.ts` | No browser/`playwright install` budget in this sandbox; the headers are asserted by the unit-level preflight test and will be re-asserted in CI | CI |
| ZAP baseline and Schemathesis fuzz runs | Nightly/PR workflows; a local run needs Docker and a built server; artifacts live on a storage host this sandbox cannot read | CI (`.github/workflows/zap-baseline.yml`, `api-fuzz.yml`) |

**No claim is made here that CI is green.** The branch's checks are CI's to report; this file states
exactly what was executed in the sandbox and what was not.

## 4. Reproduction artefact for the server-lane defect

```
npx tsx audit/agent6-2026-11-20/repro/workspace-csv-export.mjs
```

Prints the handler's bytes before and after `patches/01-workspace-csv-export-formula-and-currency.patch`
for three rows (a `=`-leading description, a JPY amount, a KWD amount). `git apply --check` on the patch
passes at `d1f2c8d`; `tsc --noEmit` passes with it applied (checked, then reverted — no `src/server/**`
change is committed on this branch).

## 5. GitHub state at the time of writing

- Open PRs on `shmuelbiller1/ledgerflow`: #952 (UI-2 table migration), #946 (report CSV currency,
  AI #10 — overlaps the *report* half of #910/#940, not AF6-20261120-01), #938 (AI #12 N-3).
- Open security issues from the 19 Nov session: **#941, #942, #943, #944, #945** (all server/DB lane).
- #953 (intermittent `40001` serialization conflict in `sandbox-step-admission.test.ts`) is a CI-flake
  investigation owned by the DB/CI lane; it is not touched here, and nothing on this branch changes
  concurrency or transaction boundaries.
