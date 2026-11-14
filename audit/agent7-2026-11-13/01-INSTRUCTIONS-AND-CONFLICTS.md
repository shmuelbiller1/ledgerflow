# Agent #7 — Instruction Sources, Conflict Resolution & Baseline Checkpoint (2026-11-13)

- **Agent Identity:** Agent #7 (Stability, Client/UI Integrity & Independent Accounting/Security Audit Lane)
- **Session Date:** 2026-11-13 (UTC)
- **Repository:** `/home/user/ledgerflow` (`origin` = `Chaim-Richard/ledgerflow`, `upstream` = `shmuelbiller1/ledgerflow`)
- **Working Branch:** `arena/cbdeb4bb-ledgerflow`
- **Pinned Base Commit:** `e33b3f2bc8273ab2fcecf3affc34e0652d7d594c` (`upstream/main` == `origin/main`, 2026-11-12 21:55:47Z, `Merge pull request #696 from shmuelbiller1/ai9/eu-queue-2`)
- **Initial Ancestry Hygiene:** The sandbox checked out `arena/cbdeb4bb-ledgerflow` at `9ce114e85` (an earlier unpushed pointer from AI #10's `arena/afa69cbe-ledgerflow` whose H-7/H-8 work was already integrated into `upstream/main` via PR `#684`). Before any commit was created, `arena/cbdeb4bb-ledgerflow` was aligned cleanly onto `upstream/main` (`e33b3f2bc8273ab2fcecf3affc34e0652d7d594c`), matching `origin/main`.

---

## 1. Instruction Sources Actually Examined

Every source listed below was read directly before making any repository changes:

1. **Direct Owner Session Mandate (Shmuel, 2026-11-13):**
   - Act as Agent #7 on Ledgerflow (`~3,000+` files) and perform a codebase-wide engineering, accounting, financial-operations, security, and launch-readiness audit and authorized remediation pass.
   - Produce all 15 required deliverables, maintain dedicated branch/PR/CI hygiene without merging PRs, treat disabled Vercel preview checks as expected cost-saving configuration rather than code failures, and **preserve all recovery checkpoints and `MASTER_RECOVERY_INDEX.md` exclusively on GitHub** (explicit Section 9 override: Google Drive is disconnected (`status: disconnected` verified via `list_connector_tools`) and must not be used or claimed).
2. **Root & Scoped Repository Governance Files:**
   - `AGENTS.md` — Root invariants, verification commands, lane ownership (`Money, posting, tax maths and src/server/ belong to AI #1 — report problems there, don't patch them`), git/PR rules, ratchet discipline, and plain-English/accessibility standards.
   - `CLAUDE.md` — System architecture (React 19 + Vite + Express 5 + PostgreSQL JSONB + `pgFirestore.ts`), money/double-entry rules (integer minor units, signed line sum = 0), and verification gates.
   - `CURRENT_WORK.md` — Live branch/merge board, step-0 start-from-upstream-main protocol, helper-AI boundaries, and known 2-vCPU speed-test caveats (`A-229` cold module preload, `R-5` report render speed).
   - `src/AGENTS.md`, `src/components/AGENTS.md`, `src/lib/AGENTS.md`, `src/tests/AGENTS.md` — Scoped architectural layer rules (`npm run check:layers`), UI/dark-mode/RTL/accessibility rules, pure library rules, and Node `node:test` + `tsx --test` conventions.
3. **Coordination, Audit Charter & Launch Gate Specifications:**
   - `docs/COORDINATION.md` — Helper-AI rules ("Read-only for helper AIs: `src/server/**`, `supabase/migrations/**`, `src/lib/ledgerMath.ts`, `src/lib/taxEngine.ts`, `scripts/ratchet*.json`, `.github/workflows/**`"), fork workflow for AI #6/#7/#8, **AI #7 stability queue (`F-1`..`F-40`)**, and all **Messages** through 12 Nov (`AI #7`, `AI #6`, `AI #10`, `AI #11`, `AI #13`).
   - `docs/INDEPENDENT_AUDIT_AGENT.md` (and upstream issue `#150`) — Independent audit charter, Pass A/B methodology, runnable probe requirements, and review-only rule on AI #1's lane unless explicitly assigned.
   - `docs/FIRST_TESTERS_GATE.md`, `docs/RELEASE_GATE.md`, `docs/FOR_YOU.md` — Release gates (`G-01`..`G-19`, `W1`..`W14`, `AF-001`..`AF-006`) and owner-only production environment prerequisites.
4. **Prior Audit Artifacts & Latest Hardening Migrations on `upstream/main`:**
   - Agent #7 Nov 10 & Nov 11 audits: `audit/agent7-checkpoint-2026-11-10.md`, `audit/FINAL_ACCURATE_LIST_2026-11-10-agent7.md`, and `audit/agent7-2026-11-11/{README.md,FINDINGS.md,SCORECARD.md,probes/*}` (`A7-01`..`A7-12`).
   - Agent #6 Nov 12 audits: `audit/agent6-2026-11-12/{01-INSTRUCTIONS-AND-CONFLICTS.md,07-FINAL-LAUNCH-READINESS-REPORT.md,08-POST-REVIEW-CORRECTIONS.md}` (merged via `#673` & `#685`) and open fork PR `Chaim-Richard/ledgerflow#28` (`origin/arena/b33f6cd0-ledgerflow:audit/agent6-2026-11-12b/{02-FINDINGS-REGISTER.md,03-TEST-AND-EVIDENCE.md,04-FINAL-LAUNCH-READINESS.md}`).
   - SQL migration `supabase/migrations/20261112100000_close_ledger_and_settlement_trigger_gaps.sql` (merged in PR `#685` `a8866555e`).
5. **GitHub Issues, Pull Requests, Reviews & CI Workflows:**
   - Open & recently closed upstream issues on `shmuelbiller1/ledgerflow`: `#150`, `#641`, `#646`, `#648`, `#650`, `#651`, `#652`, `#653`, `#654`, `#656`, `#657`, `#661`, `#662`.
   - Merged upstream PRs `#673` (including Shmuel's direct review/fix comments and commit `674b49a`), `#679`, `#685` (`a8866555e`), `#696` (`e33b3f2bc`), and open PRs:
     - **Upstream `shmuelbiller1/ledgerflow#697`** (`ai9/eu-queue-3`, AI #9, OPEN — EU-E4/E5/E9/F3/I1 touching `Dashboard.tsx`, `GeneralLedgerView.tsx`, `ProfitAndLossView.tsx`, `TransactionGrid.tsx`, `TransactionGridToolbar.tsx`, `BudgetManager.tsx`, `ReportPicker.tsx`, `crudRoutes.ts`, `budgetGuard.ts`, and new label/report files; 1 ESLint warning over ceiling in CI).
     - **Fork `Chaim-Richard/ledgerflow#28`** (`arena/b33f6cd0-ledgerflow`, Agent #6 session 2, OPEN, CI green — touching `src/lib/salesReps.ts`, `CommissionReportView.tsx`, `cashBasis.ts`, `reportRoutes.ts`, `crudRoutes.ts`, `reverseRoutes.ts`, `ledgerEditGuards.ts`, `docs/COORDINATION.md`, and `audit/agent6-2026-11-12b/`).

---

## 2. Identified Instruction Conflicts & Authoritative Resolutions

| ID | Conflict / Tension | Competing Sources | Authoritative Resolution Followed |
|---|---|---|---|
| **C-1** | **Broad fix mandate vs. reserved ownership of `src/server/**`, `supabase/migrations/**`, money/posting/tax math, and `.github/workflows/**`** | Session prompt §6 (*"Where authorized and safe: Correct confirmed defects..."*) vs. `AGENTS.md`, `docs/COORDINATION.md`, and `docs/INDEPENDENT_AUDIT_AGENT.md` (*"Money, posting, tax maths and `src/server/` belong to AI #1 — report problems there, don't patch them"*; helper-AI read-only list). | **Harmonized via "Where authorized and safe" + proven `#673` → `#685` handoff model:** (1) Directly fix confirmed client/UI/stability defects inside Agent #7's authorized scope (`src/components/**`, non-money/tax `src/lib/**`, `src/tests/**`) with zero overlap against open PRs `#28` and `#697`. (2) Keep reserved `src/server/**`, `supabase/migrations/**`, `src/lib/ledgerMath.ts`, `src/lib/taxEngine.ts`, and `.github/workflows/**` untouched in the branch working tree, while authoring **standalone, real-PostgreSQL-tested, `git apply --check`-verified recovery patches** under `audit/agent7-2026-11-13/patches/` plus executable reproduction/regression probes under `audit/agent7-2026-11-13/probes/` so Shmuel / AI #1 can apply them cleanly as in PR `#685`. |
| **C-2** | **Branch naming (`ai7/<task>` vs. `arena/cbdeb4bb-ledgerflow`) and one-task-per-PR vs. single session branch** | `docs/COORDINATION.md` (*"checkout -b ai<N>/<task-id> upstream/main; one task per PR"*) vs. Arena session branch lock (*"Always do all your work on the current branch `arena/cbdeb4bb-ledgerflow`... Never switch to, create, or push to any other branch"*). | **Follow Arena session branch lock:** Perform all commits, pushes, and PR operations exclusively on `arena/cbdeb4bb-ledgerflow` rooted cleanly at `upstream/main` (`e33b3f2bc8273ab2fcecf3affc34e0652d7d594c`), structured in logical, well-documented commits. |
| **C-3** | **Upstream PR target (`shmuelbiller1/ledgerflow`) vs. GitHub App fork token permission** | `docs/COORDINATION.md` fork workflow (*"base repository `shmuelbiller1/ledgerflow`... head `Chaim-Richard/ledgerflow`"* ) vs. sandbox GitHub App token returning HTTP 403 on cross-repo PR creation into `shmuelbiller1/ledgerflow`. | Push `arena/cbdeb4bb-ledgerflow` to `origin` (`Chaim-Richard/ledgerflow`), attempt upstream PR creation and record exact CLI output, and open/maintain a clean reviewable PR against `Chaim-Richard/ledgerflow:main` (which is identical to `upstream/main` `e33b3f2bc` and executes all 21 CI jobs including PostgreSQL 17, RLS, Playwright Chromium 5 shards, CodeQL, SBOM, and SonarQube Cloud), while providing the one-click upstream compare URL for Shmuel / AI #1. Never merge any PR. |
| **C-4** | **Google Drive backup instructions vs. explicit Section 9 override** | Earlier audit conventions referencing Google Drive vs. Session prompt §9 (*"Google Drive is not connected to this Arena account... Skip all Google Drive backup steps, preserve everything through GitHub only, and do not claim anything was saved to Drive."*). | **GitHub-only preservation:** Verified `google_drive` connector is `disconnected`. All checkpoints, findings, probes, patches, reports, and `MASTER_RECOVERY_INDEX.md` are committed and pushed regularly to `origin/arena/cbdeb4bb-ledgerflow`. Zero Drive saves are attempted or claimed. |
| **C-5** | **Concurrent `docs/COORDINATION.md` edits** | `docs/COORDINATION.md` (*"a line under Messages"*) vs. open fork PR `#28` touching `docs/COORDINATION.md`. | Keep primary audit artifacts inside `audit/agent7-2026-11-13/` so there is zero merge friction with `#28` or `#697`; add at most a cleanly anchored end-of-file Agent #7 message note if safe, or document handoff notes cleanly in `audit/agent7-2026-11-13/05-HANDOFF-NOTES.md` and PR description. |

---

## 3. Baseline Verification & Re-Verification of Prior Agent #7 Probes at `e33b3f2bc`

A disposable local **PostgreSQL 16.2** instance (`127.0.0.1:5432/lf_test`) was provisioned in `/tmp/lf_pgdata` (outside the repository tree) and initialized with `npm run db:test-setup`.

### 3.1 Baseline Repository Gates Executed at `e33b3f2bc`

| Check | Command | Result |
|---|---|---|
| TypeScript typecheck | `npm run lint:types` (`tsc --noEmit`) | **PASS** — 0 errors |
| ESLint | `npm run lint:eslint` (`eslint . --max-warnings 2`) | **PASS** — 0 errors, 2 pre-existing warnings (`supabaseAuth.ts:21`, `pg/values.ts:7`) |
| Architecture layers | `npm run check:layers` | **PASS** — 4/4 |
| Tax tables structure | `npm run check:tax-tables` | **PASS** — 55 modules, 34 tables, 1,163 rows, 0 problems |
| Rule packs lint | `npm run lint:rule-packs` | **PASS** — 584 rules, 0 problems |
| Perf budgets schema | `npm run check:perf-budgets` | **PASS** — 5 entries valid |
| PostgreSQL migrations | `LF_TEST_DATABASE_URL=... npm run db:test-setup` | **PASS** — stub + all 56 migrations applied cleanly on PostgreSQL 16.2 |
| Supabase RLS & trigger suite | `LF_TEST_DATABASE_URL=... npm run test:rules` | **PASS** — `ALL RLS TESTS PASSED` |
| Production build | `npm run build` | **PASS** — Vite client built in 31.9s; `build/server.cjs` 6.7 MB; `build/api.cjs` 6.7 MB; PWA 92 precache entries |
| Production bundle boundaries | `npm run test:bundle` | **PASS** — 16/16 |

### 3.2 Live Re-Execution of Agent #7's 15 Probes (`audit/agent7-2026-11-11/probes/run-all.sh`) at `e33b3f2bc`

| Prior Finding / Issue | Probe Executed | Live Status on `main` (`e33b3f2bc`) |
|---|---|---|
| **C-1** (Direct browser ledger/payment writes) | `a7-05-browser-writes-ledger.sql` | **CLOSED on `main`** — All 8 direct client writes to `transactions`/`payments`/settled `invoices` refused (`sum of all posted lines = 0`). *(Minor SQL format typo noted in `20261112100000`: `raise exception '... "%s" -> "%s"'` prints `"sents" -> "paids"` because PL/pgSQL `raise` uses `%`, not `%s`.)* |
| **A7-07 / `#656`** (`POST /workspaces/:id/seed` into closed period) | `a7-07-closed-period-sweep.test.ts` | **CLOSED on `main`** — Seed route removed (`404`), 0 of 14 writers penetrated hard-closed September 2026. |
| **A7-08 / `#654` part 4** (Recurring FX entry 0.01 out of balance in home currency) | `a7-08-recurring-entry.test.ts` | **CLOSED on `main`** — `recurringService` + `lf_enforce_balanced_ledger` now produce balanced trial balance (`3000 == 3000`, `isBalanced: true`). *(Note: browser can still insert `recurring` template with `exchangeRate` directly.)* |
| **A7-01 / `#657`** (Ledger-door scanner blind to `const txRef = ...; t.set(txRef, ...)`) | `a7-01-ledger-door-dataflow.ts` | **CLOSED on `main`** — `scripts/bug-patterns.ts` updated in `#673`; reports 11 direct ledger writes matching probe (`paymentService.ts:493` still bypasses `ledgerWrite`). |
| **A7-06 / `#646` & `#650` §1** (Browser-forged open credit note applied & refunded; 6 residual browser document writes) | `a7-06-residual-browser-writes.sql` + `a7-06-forged-credit.test.ts` | **STILL OPEN & CONFIRMED LIVE (`P1` / Critical)** — Migration `20261112100000` still allows client `INSERT` of `open` `creditNotes`/`vendorCredits` and client `INSERT`/`UPDATE` of `sent`/`approved`/`void` `invoices`/`bills`! `POST /payments/credits/apply` returns `200` (marks `$500` invoice `paid` while ledger A/R remains `$500`), and `POST /payments/credits/refund` returns `200` (credits Bank `-$300` against an unissued credit note!). |
| **A7-04 / `#652` & `#662`** (Document-backed ledger entries voided/rewritten/reversed/multiplied via generic routes; UI modal & Undo bugs) | `a7-04`, `a7-04e`, `a7-04f`, `a7-04g` | **PARTIALLY FIXED on `main`, PARTIALLY IN OPEN PR `#28`, RESIDUAL GAPS REMAIN (`P1` / High)** — `DELETE` after `status -> draft` now returns `409` on `main` (`a7-04f`), and open Fork PR `#28` guards document postings on `PUT /transactions/:id` & `POST /:id/reverse`, **but on `main` `e33b3f2bc` `a7-04`, `a7-04e`, `a7-04g` all still reproduce (`200`)**, AND even with PR `#28`: (1) `a7-04h` ("Undo" full `PUT` fails to clear `deletedAt`, leaving hand-entered journals out of the books after clicking Undo!), (2) `partialUpdate: { exchangeRate: 100 }` on any entry whose lines omit `exchangeRate` multiplies report balances 100×, (3) `TransactionEditModal.tsx` still allows editing document-backed entries in the UI, and (4) `TransactionEditModalView.tsx:257` hardcodes `currency !== 'USD'` instead of workspace `baseCurrency`! |
| **A7-03 / `#653`** (Foreign invoice paid in instalments at identical rate leaves permanent `-0.01` in A/R) | `a7-03-fx-installments.test.ts` | **STILL OPEN & CONFIRMED LIVE (`P2` / Medium)** — `100.00 EUR` @ `1.0842` paid as `33.33 + 33.33 + 33.34` leaves `ar: -1` (`-$0.01`) on Trial Balance forever while A/R Aging shows `$0.00`. |
| **A7-02 / `#654` parts 1–3** (FX journal header-only rate valued 1:1; line-rate journal rejected on `POST /transactions` (`totalAmountCents` 9139 vs 2470)) | `a7-02-fx-reversal-residue.ts` + `a7-02b-fx-reversal-route.test.ts` | **STILL OPEN & CONFIRMED LIVE (`P2` / Medium)** — `POST /transactions` with header `exchangeRate: 3.7` and line `rate: 1` values `24.70 USD` as `24.70 ILS` (`A7-02c`), while `POST /transactions` with line `exchangeRate: 3.7` is rejected `400 The entry total (9139) does not match its lines (2470)` by `checkLedgerEntry` (`ledgerDoor.ts:43`). |
