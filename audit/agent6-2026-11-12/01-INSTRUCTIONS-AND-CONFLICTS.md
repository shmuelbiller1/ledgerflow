# Agent #6 — Instruction Sources & Conflict Resolution Record (2026-11-12)

- **Agent Identity:** Agent #6 (Security, Integrity & Independent Engineering/Accounting Audit Lane)
- **Session Date:** 2026-11-12 (UTC)
- **Repository:** `shmuelbiller1/ledgerflow` (`/home/user/ledgerflow`)
- **Working Branch:** `arena/c3c0cb2e-ledgerflow` (branched from `main` at `c82bead475d9184248265e6f22229813b251a3b2`)

---

## 1. Instruction Sources Actually Examined

Every instruction source listed below was read in full (or in all applicable sections) before any code edits or PR operations:

1. **Direct Owner Session Prompt (Shmuel, 2026-11-12):**
   - Authoritative mandate to act as Agent #6, examine all instructions/agent messages/PRs/issues/Google Drive artifacts, execute a repository-wide accounting/financial/security/engineering audit, produce a verified Findings Register, fix authorized & safe real defects with tests, maintain branch/PR/CI hygiene without merging PRs, continuously back up all work to Google Drive with read-back verification, and issue an honest launch-readiness verdict.
2. **Root & Scoped Repository Governance Files:**
   - `AGENTS.md` (lines 1–122) — Root engineering invariants, verification commands, lane ownership (`Money, posting, tax maths and src/server/ belong to AI #1 — report problems there, don't patch them`), git/PR rules, and ratchet discipline.
   - `CLAUDE.md` (lines 1–98) — Architecture overview (React 19 + Vite + Express 5 + Supabase PostgreSQL JSONB + `pgFirestore.ts`), money/double-entry invariants (integer cents, signed line sum = 0), verification gates.
   - `CURRENT_WORK.md` (lines 1–121) — Live status board at `main` (`c82bead4`), lane assignments, helper AI rules, and current launch blockers.
   - `src/AGENTS.md` (lines 1–39) — `src/lib/` vs `src/components/` vs `src/server/` architectural boundary rules (`npm run check:layers`).
   - `src/components/AGENTS.md` (lines 1–41) — Plain-English UI labels, dark mode pairs, semantic tokens, accessibility (`aria-label`, Escape/focus trap), and empty/loading/error states.
   - `src/lib/AGENTS.md` (lines 1–33) — Pure deterministic library rules, integer minor units, no React/DOM/server imports.
   - `src/tests/AGENTS.md` (lines 1–42) — Node built-in test runner (`node:test`), `tsx --test`, deterministic dates/IDs, `SYSTEM_SALT` requirement, DB skip behavior when `LF_TEST_DATABASE_URL` is unset.
3. **Coordination, Runbooks, Gate Specs & Security Docs:**
   - `docs/COORDINATION.md` (lines 1–300, 560–1039) — All agent task queues, **AI #6 security queue (`S-1`..`S-40`)**, helper-AI rules ("Rules that never change"), and all **Messages** through 11 Nov evening (including AI #1's explicit note at line 1015 asking Agent #6 to clean up 8 CodeRabbit review notes on `audit/agent6-2026-11-10/` from PR `#618`).
   - `docs/INDEPENDENT_AUDIT_AGENT.md` — Independent audit protocol (`AF-001`..`AF-010`), Pass A/B methodology, reproduction-probe standards.
   - `docs/FIRST_TESTERS_GATE.md` & `docs/RELEASE_GATE.md` — Launch readiness gates (`G-01`..`G-19`) and core workflows (`W1`..`W14`).
   - `docs/LEAD_RUNBOOK.md` — Lead merge loop and PR verification expectations.
   - `security_spec.md` & `docs/SECURITY_CONTROLS.md` — Two-boundary security model (Supabase RLS/`lf_guard` vs privileged `pgFirestore`), ISO 27001 / SOC 2 evidence map, and `S-23` CSP enforcement design.
   - `docs/FOR_YOU.md` — Owner-only external operational prerequisites (`SESSION_SECRET`, `SYSTEM_SALT`, `DATABASE_CA_CERT`, Stripe/Plaid/SMTP keys, pending Supabase migrations).
4. **Prior Agent Audits in Repo & Google Drive (`1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK`):**
   - `audit/ai6/security-audit-2026-11-05.md` (Agent #6 5 Nov security baseline).
   - `audit/agent6-2026-11-10/{README,00-INDEX,01-checkpoint,02-findings,03-gates,04-scorecard,05-handoff,PR-BODY}.md` + all 7 probes under `audit/agent6-2026-11-10/probes/`.
   - `audit/claude-2026-11-11/README.md` (AI #1 11 Nov whole-project audit & PR `#647` remediation log).
   - Google Drive `MASTER_RECOVERY_INDEX.md` (`1pTGxQhLdqBvH4sLoR-0MZ0XuvKtTP86F`), Agent #7/5/13 addenda (`1AefTjgXdXiaihBNG62BWoI87IrQ3f2pq`, `1dGKhtJaFzIfiIJ5fDUz8U1V_ZdVNmHOy`, `1HmvDrCugLIC13UpmWr-xi3RnyUWqonFU`), and Agent #11 instruction/conflict record (`1yYg90WxcRtxvKOftGqaNmakEKAFc2oxh`).
5. **GitHub Issues, Pull Requests, Reviews & CI Workflows:**
   - All open technical issues (`#641`, `#646`, `#648`, `#650`, `#651`, `#652`, `#653`, `#654`, `#657`, `#661`, `#662`).
   - Open PRs (`#663`, `#665`, `#667`, `#668`, `#669`, `#670`, `#671`, `#672`, plus stale fork PR `Chaim-Richard/ledgerflow#6`), merged PRs (`#618`, `#636`, `#647`, `#660`, `#664`), all 8 CodeRabbit inline comments on PR `#618` (`4530895604`..`4530895745`), and recent GitHub Actions runs (`CI`, `CodeQL`, `Dependency SBOM evidence`, `ESLint warning ratchet`).

---

## 2. Identified Instruction Conflicts & Authoritative Resolutions

| # | Conflict / Tension | Competing Sources | Authoritative Resolution Followed |
|---|---|---|---|
| **C-1** | **Broad defect-remediation mandate vs. lane ownership of `src/server/**`, SQL migrations, and money/posting/tax math** | Session prompt §6 (*"FIX REAL PROBLEMS AND TEST YOUR WORK — Where authorized and safe: Correct confirmed defects..."*) vs. `AGENTS.md` & `docs/COORDINATION.md` (*"Money, posting, tax maths and `src/server/` belong to AI #1 — report problems there, don't patch them"*; AI #6 security lane rules). | **Harmonized via "Where authorized and safe":** (1) On branch `arena/c3c0cb2e-ledgerflow`, directly fix all confirmed defects, missing `S-*` security controls/tests/docs, tooling gaps (`scripts/bug-patterns.ts` `#657`, ESLint ceiling ratchet), non-reserved client/UI security/integrity bugs, and PR `#618` CodeRabbit cleanups that fall within Agent #6's authorized lane and do not collide with open PRs `#663`–`#672`. (2) For defects inside reserved `src/server/**`, `supabase/migrations/**`, or money/posting/tax calculation engines, commit runnable reproduction probes/tests + full Findings Register entries, **and** produce standalone, test-verified recovery patch files in `audit/agent6-2026-11-12/patches/` (and Google Drive `05 Code Changes and Recovery Patches`) so AI #1 / Shmuel can apply them cleanly with zero merge conflict. |
| **C-2** | **Branch naming (`ai6/<task>` vs. `arena/c3c0cb2e-ledgerflow`) and one-task-per-PR vs. single session branch** | `docs/COORDINATION.md` (*"one branch and PR per task"*) vs. Arena platform & session rules (*"Always do all your work on the current branch `arena/c3c0cb2e-ledgerflow`... Never switch to, create, or push to any other branch"*). | **Follow Arena session branch rule:** Keep all commits, pushes, and the session PR strictly on `arena/c3c0cb2e-ledgerflow` (`origin` = `shmuelbiller1/ledgerflow`), structured into clean, logical commits by concern. |
| **C-3** | **PR merge authority** | General git workflows vs. Session prompt §7 & `AGENTS.md` (*"Never merge pull requests"*). | **Strict non-merge rule:** Push commits to `arena/c3c0cb2e-ledgerflow` and open/update the PR for Shmuel / AI #1 review; never merge or close any PR. |
| **C-4** | **Vercel preview status vs. CI health** | Red/absent Vercel preview check vs. Session prompt §7 (*"Automatic Vercel preview deployments on merge were disabled to reduce costs. Do not treat a red Vercel preview status alone as a code failure"*). | **Evaluate real build & CI gates:** Verify deployable artifacts locally via `npm run build` + `npm run test:bundle` and monitor GitHub Actions (`CI`, `CodeQL`, `Dependency SBOM evidence`), never treating disabled Vercel preview checks as a code failure. |
| **C-5** | **Editing `docs/COORDINATION.md` vs. concurrent PR merge conflicts** | `docs/COORDINATION.md` (*"leave a short note under Messages"*) vs. open PRs `#663`, `#669`, `#670`, `#671`, `#672` all touching `docs/COORDINATION.md`. | Append only a minimal, cleanly anchored Agent #6 status note at the end of `Messages` (and tick verified `S-*` items only where unambiguous), keeping full detailed reports in `audit/agent6-2026-11-12/` and Google Drive. |
| **C-6** | **Google Drive `MASTER_RECOVERY_INDEX.md` update vs. `read_file_text` tool truncation (~25–30 KB)** | Session prompt §8 (*"Maintain a master recovery index"*) vs. connector output truncation risk on large files. | Download `MASTER_RECOVERY_INDEX.md` via `download_file` to the local workspace first, verify byte integrity before appending Agent #6's 2026-11-12 section (`update_file_content`), and also upload a standalone `2026-11-12_Agent6_Master_Recovery_Addendum.md` so zero prior agent entries can ever be lost. |
