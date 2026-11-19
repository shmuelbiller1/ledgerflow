# Instructions, Baseline & Repo State — Agent #6 — 2026-11-19

**Date:** 2026-11-19 UTC  
**Branch:** `arena/6e749e1a-ledgerflow` (clean working tree at start)  
**Base commit:** `5eacf71f633f00a5db7ae44d3fdba75b4d3700cf` (`main` at that point)  
**Agent identity:** #6 — Security lane (S-* + SEC-SCAN-1) + Independent Audit (Pass A/B)  
**Tooling:** Node v22.22.3 (available) / Node v24.22.1 (fetched via setup-node), npm 10.9.8, no Docker/Postgres locally, no external network beyond GitHub/NPM allowlist

---

## 1. Instruction sources examined

| Category | Exact source | Key takeaways applied |
|----------|--------------|-----------------------|
| **Root contracts** | `AGENTS.md` + `src/AGENTS.md`, `src/tests/AGENTS.md`, `src/lib/AGENTS.md` | 3-layer architecture (DB → Algorithms → Lenses), `useLedgerCollections` guard, `isPostable` filter, absolute `totalAmountCents`, plural categories, role resolution, collection naming, bot-review mandatory, CI green mandatory |
| **Current work** | `CURRENT_WORK.md` (28 Oct snapshot) + `docs/prompts/CMD-1-checklist.md` (supersedes counts) | Stage A 9 workflows READY; Stage B W11/W13 + ERPNext depth remain; AI #3 batches done; owner launch actions still open |
| **Coordination** | `docs/COORDINATION.md` §NOW + PLAN §15-§16 + RELEASE_GATE + AI #6 queue | AI #6 queue: S-1..S-40 (S-6, S-11, S-13, S-15, S-19, S-21~S-28 partial/open); SEC-SCAN-1 done report-only; plan stages 1-4; finish line = 14 workflows C/V/B |
| **Lead & audit** | `docs/LEAD_RUNBOOK.md`, `docs/INDEPENDENT_AUDIT_AGENT.md`, `docs/FIRST_TESTERS_GATE.md` | Pass A (every function) + Pass B (workflow); pinned SHA + blob evidence; severity = user outcome; standalone patch model |
| **Security spec** | `security_spec.md` v14 Oct + `docs/SECURITY_CONTROLS.md` + `docs/SECURITY_SWEEP.md` + `security-baseline.json` + `.gitleaks.toml` | Two trust boundaries (browser RLS vs privileged server), `apiAuthenticate` + `requireWorkspaceRole` + `authorizeWorkspace` required on every privileged route, `lf_rules/lf_guard`, secrets handling, CSP rollout S-23, sweep baseline 24×500 errors + viewer writes |
| **Developer** | `docs/DEVELOPER_WORKFLOWS.md`, `docs/TOOL_REVIEW.md`, `docs/UI_GUIDE.md`, `docs/SCREEN_REBUILD_CHECKLIST.md` | InlineEdit, drawer, suggestions, pinned pages, verification recipes |
| **Owner ops** | `docs/FOR_YOU.md` (50+, DONE archive) + `docs/privacy/*` + `docs/runbooks/incident.md` | Secrets to rotate, DB CA cert, Vercel protection, Stripe keys, IL/US tax registration, backup/PITR verification gap (S-19) |
| **Prior Agent #6** | `audit/agent6-2026-11-10/`, `agent6-2026-11-12/`, `agent6-2026-11-12b/`, `agent6-2026-11-16/`, `agent6-2026-11-17*/` | AF6-001..019 history; patches 01-07; SEC-SCAN-1 follow-ups; ZAP/ Schemathesis CI; rate-limit audit #428; S-38/S-39 isolation suites |
| **Git history** | `git log --oneline -1` = `5eacf71 fix: period commands... (#901)` includes #826, #844, #845, #820, #806; `git status` clean; no uncommitted changes at start | Confirms base includes period-scope + FX past-date + admin audit fixes; does NOT include PR #908 (#827/#796/#857) which is still open |
| **GitHub live** | `gh pr list`, `gh issue list`, `gh api repos/shmuelbiller1/ledgerflow/issues/{827,857,910}` | #827 (Permissions-Policy, ?=, AI masking, 500 details) OPEN; #857 (bill.update bypass) OPEN; #910 (CSV yen/dinar 100×) + #906 (yen/dinar CSV) + #900 etc OPEN; PR #908 (AI #1 fix for #827/#796/#857) OPEN, not merged; ZAP/Schemathesis workflows present but artifact logs not readable in this sandbox |
| **Drive** | `google_drive` connector enabled; `MASTER_RECOVERY_INDEX.md` not yet updated for this session | Drive is recovery HQ; must upload checkpoints and verify |

**Not all messages/issues/PRs could be read** — GitHub's GitHub Projects GraphQL error blocks some issue views; ZAP/Schemathesis artifact bytes are outside allowlist. Those gaps are documented, not silently ignored.

---

## 2. Conflicts & authoritative resolution

| # | Conflict | Sources | Resolution |
|---|----------|---------|------------|
| C-1 | User prompt §6 says fix accounting/money vs AGENTS.md says money/posting/tax is AI #1 lane | User Prompt §6 vs AGENTS.md / COORDINATION Rules 2-3 | Follow authoritative project instructions: AI #6 implements SEC-SCAN-1, security/non-money fixes, client/docs/CI directly; for confirmed money/posting/migration defects, deliver verified reproduction + standalone patch under `audit/.../patches/` + GitHub issue handoff to AI #1. No direct `src/server/**` money edits. |
| C-2 | "Work on main" (CLAUDE.md, AI #1) vs "work on assigned branch" (Arena) | CLAUDE.md / TRACKER.md vs Arena branch lock | Arena branch `arena/6e749e1a-ledgerflow` is fixed; do not switch/create/push other branches. One branch, one PR, never merge. |
| C-3 | Overlapping PR #908 (#827 fix) with this branch's S-6 work | COORDINATION "never overwrite another agent's work" | This branch implements only the headers part (vercel.json + securityMiddleware) which is AI #6's S-6 lane; pure money/billing parts (AI masking, 500 details) remain as patches/handoff to avoid overwriting PR #908's lane. Document overlap. |
| C-4 | Vercel "Authorization required" red on fork PRs | AGENTS.md §5 | Expected when previews are disabled to save cost; not a code defect. Verify build/lint/tests instead. |

---

## 3. Repository baseline at pinned revision

- **Files:** ~3,700 tracked files (per `git ls-files | wc -l`; matches prior atlases 3,671-3,800)
- **Type system:** TypeScript 5.9.3, `tsconfig.json` strict, `vite.config.ts`, `server.ts` dual bundle (`build/server.cjs`, `build/api.cjs`)
- **DB:** Supabase Postgres, 60+ migrations through `20261115000000_document_commands_server_only.sql` plus 2026-11-18 period/FX patches; browser writes via `lf_set/lf_update/lf_delete/lf_batch` (see `supabase/migrations/`), server via `pgFirestore.ts` (privileged, bypasses RLS)
- **Security baseline file:** `security-baseline.json` — records 24 routes that return 500 on refusal (instead of 403), `documents` viewer writes, `publicRoutes`, `selfRoutes`, per-table RLS matrix; `security_spec.md` §9 checklist
- **Gitleaks:** `.gitleaks.toml` extends default + custom `ledgerflow-api-key` rule; `security-sbom.yml` currently runs a custom tracked-source secret regex (10 patterns) but does NOT invoke `gitleaks` binary, does not consume `.gitleaks.toml`, and does not scan history
- **CI:** `.github/workflows/ci.yml` (lint, types, tests, RLS, build), `security-sbom.yml` (SBOM + secret scan + dependency audit S-25), `api-fuzz.yml` (Schemathesis report-only), `zap-baseline.yml` (ZAP baseline against local build), `codeql.yml`, `visual-baselines.yml`
- **Node tooling:** `tsc`, `eslint`, `vite` present after `npm ci --ignore-scripts` (53s, 1205 pkgs, 15 moderate vulns via `npm audit`; `npm audit fix` not run to avoid churn)
- **Tool limits:** No local Postgres/Docker, no Docker daemon, no apt; artifact/download hosts outside allowlist (cannot fetch ZAP/Schemathesis reports directly); 2 CPU / 3.8GB RAM; full `npm test` may OOM or exceed 30-min timeout

---

## 4. Branch state at start

```
On branch arena/6e749e1a-ledgerflow
nothing to commit, working tree clean
* arena/6e749e1a-ledgerflow
  main
  remotes/origin/main -> main at 5eacf71
```

- No local commits ahead of `main` at start.
- Prior AI #6 checkpoints exist under `audit/agent6-2026-11-*`; not overwritten.
- New audit folder `audit/agent6-2026-11-19/` created this session.

---

## 5. Risk note

At this pin, **no full `npm test` with DB was executed yet** (requires disposable Postgres), and **no ZAP/Schemathesis run** was re-executed (requires Docker + test DB). Those are CI-gated and documented as remaining risks. Focused unit suites and preflight scripts are run locally where possible.

