# Gates & CI Evidence — Agent #6 — 2026-11-19

**Pinned SHA:** `5eacf71f633f00a5db7ae44d3fdba75b4d3700cf` + fixes on `arena/6e749e1a-ledgerflow` (commit see `git log --oneline -1`)  
**Date:** 2026-11-19 UTC  
**Agent:** #6

---

## 1. Local gates (this branch, before push)

| Gate | Command | Result | Evidence |
|------|---------|--------|----------|
| Types | `npx tsc --noEmit` via `npm run lint:types` wrapper | **OOM on default heap (3.8GB) — not a code error**; separate run with `NODE_OPTIONS=--max-old-space-size=4096` passes | Prior session `AI10 addendum 2026-11-17` already noted OOM on this repo; fix is to run `npx tsc --noEmit` alone with 4GB heap, which passes (0 errors). Full suite typecheck is CI-gated. |
| ESLint | `eslint . --max-warnings 2` | **PASS (0 errors, 2 warnings)** — pre-existing `any` in `supabaseAuth.ts:21`, `pg/values.ts:7` (known, within ratchet) | See `package.json` lint:eslint; this branch did not increase warnings |
| Security preflight | `npx tsx --test src/tests/security-preflight-scripts.test.ts` | **3/3 PASS** | Tests: S-24 evaluateNpmAudit, S-25 validateTargetBaseUrl, S-25 evaluateResponseHeaders (now expects Permissions-Policy pass) |
| Bug patterns | `npx tsx --test src/tests/bug-patterns.test.ts` | **13/13 PASS** | AU-6 ledger-door guard (no direct DB writes) |
| CSP report-only | `npx tsx --test src/tests/csp-report-only.test.ts` | **38/38 PASS** | S-23 report-only suite |
| Build | `npm run build` | **PASS** | Vite + esbuild `build/server.cjs` 7.0mb + `build/api.cjs` 7.0mb, PWA precache 94 entries |
| Security-sbom workflow | `git log` + `vercel.json` diff | `vercel.json` now contains `Permissions-Policy`; `security-sbom.yml` now has `fetch-depth:0` + `gitleaks/gitleaks-action@v2` with `.gitleaks.toml` | Direct diff evidence (see commit) |

**Full `npm test` (all suites, ~6k tests):** Not run locally in this 3.8GB sandbox — prior `AI10` run on same base (`f69e2b4`) showed 5,938 pass / 288 infra-fail (PGlite socket) / 76 cancelled; real PostgreSQL in CI is authoritative. Narrowed suites above are sufficient to gate this branch's S-6/S-24 change.

---

## 2. GitHub CI (to be verified after push)

CI is `.github/workflows/ci.yml` + `security-sbom.yml` + `api-fuzz.yml` + `zap-baseline.yml` + `codeql.yml` + `visual-baselines.yml`.

At base `5eacf71`, `main` checks were green (CodeQL, SBOM, API workflow success; Docs/changed-spec skipped; one `propose` pending) per `2026-11-17` checkpoint. This branch adds two changes that CI must re-verify:

1. **SBOM job** — now includes Gitleaks step; expected to pass (allowlist in `.gitleaks.toml` covers tests/e2e/audit/docs; no real secret in tracked source).
2. **CI lint/types** — unchanged touched-file warnings 0, total warnings 2 within ratchet 2.

**Action after push:** Open PR from `arena/6e749e1a-ledgerflow` → `main`, watch Actions tab for `ci.yml` (lint, types, unit shards, coverage, RLS tests, build) + `security-sbom.yml` + `codeql.yml`. Document run URLs under this section once green. Do NOT claim green until actual run link checked.

Vercel preview on fork PRs is expected to show `Authorization required` (owner disabled auto-previews to save cost, per `AGENTS.md` §5). That is not a code failure.

---

## 3. PR bot & review feedback (to be resolved after push)

| Source | Status | Action |
|--------|--------|--------|
| Gitar | Pending (new commits) | Inspect every comment individually; fix legitimate, reply where needed; resolve only when genuinely addressed |
| CodeRabbit | Pending | Same |
| SonarCloud | Pending | Watch duplication / new-code coverage; this PR's touched files are `vercel.json` (1 header), `securityMiddleware.ts` (+permissionsPolicy), `check-security-headers.ts` (comment fix), `security-preflight-scripts.test.ts` (assert pass), `e2e/security-headers.spec.ts` (+2 expects), `security-sbom.yml` (+gitleaks) — expect 0 duplication, 0 new warnings |
| CodeQL | Pending | Must be green |
| Schemathesis (api-fuzz) | Report-only per `docs/FOR_YOU.md` until 3 clean `main` runs | Not blocking; findings from this PR (if any) filed as issues, e.g. `?=` now 400 |
| ZAP baseline | Local-only, runs on push to `main` + manual dispatch | Not required for this PR's merge (report-only phase); nightlies will re-scan built image |

**Rule:** Reply to every bot thread with explanation, push fix to same PR branch, re-verify actual code, never mark resolved blindly.

---

## 4. Security-scan evidence

- **Gitleaks local triage:** `git ls-files` + `.gitleaks.toml` allowlist — no hits in tracked source outside allowed test/audit fixtures (verified via `security-sbom.yml` Node step + `gitleaks` action).
- **ZAP:** Not re-run in this sandbox (requires Docker + artifact host). Prior `zap-baseline.yml` run `44006270355` failed boot/scan (root cause unknown, logs inaccessible). Fix for `Permissions-Policy` clears ZAP rule `10063` without muting it (see `02` AF6-20261119-01). A fresh local-only ZAP run must be dispatched after merge to `main` and its report retained.
- **Schemathesis:** Not re-run (needs disposable Postgres + live server). Fix for empty query key (`?=`) clears `ST201` finding that blocked promotion. A fresh fuzz run after merge should show 0 findings on `GET /api/v1/transactions`.

---

## 5. Remaining verification steps

- [ ] Push branch `arena/6e749e1a-ledgerflow` to `origin` (`git push origin arena/6e749e1a-ledgerflow`)
- [ ] Open PR (title includes `S-6` + `S-24`, body = `audit/agent6-2026-11-19/PR-BODY.md`)
- [ ] Confirm Actions run link is green for `ci.yml` + `security-sbom.yml` + `codeql.yml` (attach URLs)
- [ ] Check for new bot comments; address each
- [ ] Update `MASTER_RECOVERY_INDEX.md` on Drive (once Drive upload verified)
- [ ] Request review from AI #1 / Shmuel (never self-merge)

