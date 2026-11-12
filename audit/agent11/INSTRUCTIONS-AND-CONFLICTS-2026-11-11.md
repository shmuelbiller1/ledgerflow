# Agent #11 — Instruction Reading & Conflict Resolution Record (2026-11-11)

- **Session Date:** 2026-11-11 (UTC)
- **Agent:** Agent #11 (Imports, Exports, Documents + Full-System Independent Audit)
- **Working Branch:** `arena/d3fc43a9-ledgerflow` (branched from `upstream/main` at `ec3ff49336c53eeed531a79ac32cc08d1574ec96`, PR #626)
- **Upstream Repository:** `shmuelbiller1/ledgerflow`
- **Fork Repository:** `Chaim-Richard/ledgerflow`

---

## 1. Authoritative Instructions & Governance Files Examined

1. `AGENTS.md` — Root 3-layer architecture, zero-sum double-entry equilibrium (`sum(debits + credits) === 0`), strictly positive `totalAmountCents`, dynamic `resolveAccountRole(account)`, closed fiscal period immutability (reverse-and-rebook only), top-level workspace-scoped collections (`workspaceId`), integer cents / `decimal.js`, and strict quality ratchets (`--max-warnings 42`, `quality-baseline.json`).
2. `CLAUDE.md` — Owner product and engineering standards: plain-language UI copy, `csvMoney` formatting (never `cents / 100` floats), no `any`, no test expectation weakening, Vercel paused-preview policy.
3. `src/AGENTS.md` — TypeScript/React 19 rules, `byCodeUnit` deterministic sorting (Sonar S2871), linear-time helpers in `src/lib/textShape.ts` (Sonar S8786), `BRAND_NAME` usage.
4. `src/components/AGENTS.md` — Accessible labels on all controls/icon buttons, 44px mobile touch targets, cancellation/workspace-switch stale-async protection, explicit loading/empty/error/truncated states, actionable plain-language toast messages.
5. `src/lib/AGENTS.md` — Pure deterministic computation modules, no network/DOM side effects, civil-date helpers (`localIsoDate` / `civilDate`) without timezone drift.
6. `src/tests/AGENTS.md` — Node `--test` runner conventions, mutation-tested non-vacuous assertions, prohibition on modifying expected worked figures to pass failing tests.
7. `CURRENT_WORK.md` — Stage A (READY) vs Stage B (OPEN: W11 AU-4, W13 stock, EG-1/2/3/7) launch gates and owner pending operational steps.
8. `docs/COORDINATION.md` — Active multi-agent lane assignments, Agent #11 queue (`J-1`..`J-8`: CSV/IIF round-trip, 20-row import preview, duplicate handling, `.xls`/`.xlsx`, Hebrew/UTF-8 BOM exports, invoice PDF text verification, Document Library/Vault, Year-End Archive ZIP), and inter-agent messages through 2026-11-10 (`#626`).
9. `docs/FOR_YOU.md` — Owner operational checklist: pending Supabase migrations (`L-123`, `ISS-130`), `DATABASE_CA_CERT` in Vercel, rotating 4 generated secrets (`SESSION_SECRET`, `INVITE_SECRET`, `CRON_SECRET`, `SYSTEM_SALT`), custom SMTP, Stripe webhook setup, GitHub branch protection (`L-67`).
10. `docs/INDEPENDENT_AUDIT_AGENT.md`, `docs/RELEASE_GATE.md`, `docs/FIRST_TESTERS_GATE.md`, `docs/LEAD_RUNBOOK.md`, `docs/DEVELOPER_WORKFLOWS.md`, `docs/PLAN.md`, `docs/TRACKER.md`, `docs/BUG_PATTERNS.md`, `security_spec.md`.
11. Existing Audit & Verification Artifacts:
    - `audit/FINAL_ACCURATE_LIST_2026-11-10.md` (AI #3)
    - `audit/AI2_FINAL_ACCURATE_LIST_2026-11-10.md` (AI #2)
    - `audit/FINAL_ACCURATE_LIST_2026-11-10-agent7.md` (Agent #7)
    - `audit/agent6-2026-11-10/02-findings.md` (Agent #6)
    - `audit/agent8-checkpoint-2026-11-10.md` (Agent #8)
    - `audit/INDEPENDENT_AUDIT_REPORT_2026.md`
    - Prior Agent #11 session branch `origin/arena/37ddbc4d-ledgerflow` (`3463355f`, fork PR #18 / upstream PR #616) and AI #1's unmerged integration branch `upstream/claude/agent11-import-export` (`270014e6`, upstream PR #623), plus Google Drive archive folders (`1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK` and `1wvRkM9OJbdRfu7QC48dD5dMSMTE_LEOr`).

---

## 2. Explicit Resolution of Instruction Ambiguities & Conflicts

1. **Branch & Merge Governance (`CLAUDE.md` direct-to-`main` vs `COORDINATION.md` + Session Rules):**
   - *Resolution:* `CLAUDE.md` describes AI #1's historical direct-to-`main` workflow. As Agent #11, we work strictly on isolated branch `arena/d3fc43a9-ledgerflow`, push only to `origin arena/d3fc43a9-ledgerflow`, open/update PRs with full evidence, **never push to `main`**, and **never merge any PR** (Shmuel Biller is the sole final decision-maker).
2. **Codebase-Wide Fixes vs Lane Ownership (`src/server/` & Money/Tax Math):**
   - *Resolution:* `docs/COORDINATION.md` reserves `src/server/**`, SQL migrations, and core money/posting/tax calculation engines for AI #1 (lead) to prevent cross-agent semantic collisions, while assigning Agent #11 `J-1..J-8` (imports, exports, documents) and allowing safe client/lib/test/audit fixes. Accordingly:
     - We will cleanly port Agent #11's unmerged `J-1..J-8` work onto `ec3ff49` (`arena/d3fc43a9-ledgerflow`), resolve all 3 Codex P1/P2 review defects on J-8 (`yearEndArchive.ts`, `YearEndArchiveExport.tsx`), resolve safe client-side/pure-helper defects verified during our audit (respecting `src/server/**` and money/posting calculation boundaries), and provide standalone patch files + executable verification tests for any `src/server/**` or money-lane findings so AI #1 / Shmuel can apply them without merge risk.
3. **Unmerged Prior Agent #11 PRs (#616 / #623) vs Current Branch:**
   - *Resolution:* Upstream PR #616 (`3463355f`) conflicts with `main`; upstream PR #623 (`270014e6`) has a single-parent grafted merge commit (causing a 734-file diff against `main`), re-added a 2,369-line `.patch` file to git, predates PRs `#624`–`#626`, and has unresolved Codex P1/P2 comments. We do NOT touch or close `#616` or `#623`; instead we build a clean, conflict-free branch from `ec3ff49` containing Agent #11's work + AI #1's `270014e6` adaptations (`isEmailShape`, `byCodeUnit`, `BRAND_NAME`) + fixes for all review and newly audited defects.
4. **Vercel Red Status:**
   - *Resolution:* Per owner instructions and `CURRENT_WORK.md`, paused/red Vercel preview checks reflect deliberate deployment-usage cost controls and are never treated as code failures; we verify `npm run build`, typecheck, ESLint, unit/DB/RLS tests, and GitHub Actions CI independently.
