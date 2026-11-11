# Agent #13 — handoff (2026-11-11)

Everything needed to continue this lane without the original session. Read this after `docs/COORDINATION.md` ("NOW", "AI #13: tasks") and `CURRENT_WORK.md`.

## Where the work is

| What | Where |
|---|---|
| Branch | `arena/a3a5023d-ledgerflow` in the fork `Chaim-Richard/ledgerflow` (pushed; based exactly on upstream `main` `ec3ff49`) |
| Commits | `f2ee195` — the three fixes + the speed work · `c44810e` — the AF13-008 report + docs |
| Pull request | **Chaim-Richard/ledgerflow#22** (fork-side: the sandbox's GitHub App token is refused PR creation on `shmuelbiller1/ledgerflow`, HTTP 403 `Resource not accessible by integration`). Body: `audit/agent13-2026-11-11/PR-BODY.md`. To publish upstream: `gh pr create --repo shmuelbiller1/ledgerflow --base main --head Chaim-Richard:arena/a3a5023d-ledgerflow --body-file audit/agent13-2026-11-11/PR-BODY.md` |
| Issues filed on upstream | **#641** (High — `toBaseCents` minor units), **#642** (report screen speed), **#643** (posting check misses credit notes/vendor credits) |
| Findings register | `audit/agent13-2026-11-11/FINDINGS.md` |
| Checkpoint | `audit/agent13-2026-11-11/01-CHECKPOINT.md` |
| Probes (runnable) | `audit/agent13-2026-11-11/probes/`: `af13-001-minor-unit-repost-check.test.ts`, `af13-008-fx-aging-vs-ledger.test.ts` (the AF13-002/003 probe was folded into `src/tests/close-checklist-statuses.test.ts`, which is the durable regression), `af13-005-report-identities.ts`, `r5-all-report-views-probe.ts`, `r5-compute-vs-render.ts` (+ `.output.txt` evidence) |
| Mailbox message | last entry of `docs/COORDINATION.md` (Messages) |
| Drive archive | see `MASTER_RECOVERY_INDEX.md` in the Drive folder `Ledgerflow Agent Backups` |

## What changed in the product (all reversible, no money maths)

1. `src/lib/postingCheck.ts` — expected document amount uses the posting path's rate (`minorUnitRate(rate, doc.currency || baseCurrency, baseCurrency)`); `findPostingMismatches` takes `baseCurrency`.
2. `src/lib/closeChecklist.ts` — `baseCurrency` threaded; `NOT_OWED_STATUSES` (paid/void/draft/rejected/cancelled) for the aging item; `ignored` bank lines no longer "not matched".
3. `src/components/ledger/MonthEndCloseView.tsx` — passes `workspace.currency`.
4. `src/components/reporting/SampleYearBenchmarkReportView.tsx` — says what it measures (12 computations), not "every report".
5. New tests: `src/tests/close-checklist-statuses.test.ts` (4/4), `src/tests/report-speed-all-views.test.tsx` (measures all 170 report modules; ratchet + 4th-screen guard).

## What is still open in this lane

1. **R-5 is not met.** Journal Sheet / Payments / General Ledger (and four more at ~5,000 entries) exceed 1 s because of DOM size — issue #642 has the numbers and the recommended fix (window rows, keep printing complete, `Map` instead of per-row `find` in `PaymentsView`). Statement screens are AI #1/#9's lane. After a fix, lower the ceiling in `report-speed-all-views.test.tsx` and re-run `r5-all-report-views-probe.ts`.
2. **AF13-008 / #641 (High)** — the same minor-unit defect in `toBaseCents` (`src/server/reports/partyReports.ts`) affects aging, stored customer/vendor balances, lifetime value, cohorts, working capital and FX revaluation. Fix sketch and interim mitigation are in the issue; do **not** patch `src/server` from this lane without AI #1's review.
3. **#643** — extend `postingCheck.ts` to credit notes / vendor credits once AI #1 confirms the issuance sign conventions.
4. **R-1 wording gap** — the queue lists "run P&L and balance sheet" as a month-end step; the screen links to Reports instead of forcing a tick. Owner/lead decision, do not invent an always-attention item.
5. **AF13-006** — tag the sample fixture's accrual entries with `metadata.invoiceId`/`billId` so the posting check can be exercised end-to-end; a good first task for whoever owns `src/lib/sampleBusinessYear.ts`.

## Environment notes (this sandbox)

* Node v22.22.3 (repo wants 24.x); `npm ci --ignore-scripts`; no local Postgres (`LF_TEST_DATABASE_URL` unset → DB/RLS suites skip); Playwright browsers not installed (no browser gates).
* The A-229 cold module-preload leg of `src/tests/report-speed-12m.test.tsx` is red here (2,329 ms vs a 1,500 ms budget) — recorded in `CURRENT_WORK.md` as a sandbox artefact on unmodified `main`.
* `gh` can push to the fork, open fork PRs and open upstream issues, but cannot create PRs on the upstream repository (403).

## Where the gates stand (read this before quoting anything)

* **Fork CI on `42b10bb`: 21/21 green** — Unit tests 1-4/4 · timezone shards (Pacific/Auckland, America/Los_Angeles) 1-3/3 each · Browser shards 1-5/5 · Lint, Typecheck and Database rules · Production build · Playwright E2E Smoke Suite · CodeQL ×2 · CycloneDX SBOM. This is the first run in this lane that includes the DB/RLS and browser gates on its own code.
* **Full local suite: 4,659 tests / 4,653 pass / 1 fail / 5 skipped, 17m30s.** The one failure is A-229's cold module preload, 1,521.74 ms against a 1,500 ms budget (see above; it read 2,329 ms in an earlier run on this host). Quote it as a sandbox limit with the number, never as "the suite is green".
* **SonarQube Cloud: it failed, and it was this diff — fixed in the branch.** The gate failed on *25.1 % Duplication on New Code* (limit 3 %) and *D Reliability Rating on New Code*: six copies of the same test fixture across the probes and the two new test files (199 duplicated lines) plus one real bug, `typescript:S2871` — `.sort()` without a comparator on strings, in the r5 probe. Two shared harnesses now hold the fixture (`src/tests/helpers/postingHarness.ts`, `src/tests/helpers/reportScreens.ts`), the probe and both tests import them, sorting compares with `localeCompare`, and the redundant `af13-002-003` probe is gone (`src/tests/close-checklist-statuses.test.ts` is the durable regression). My earlier note — "not attributable, the same message is on upstream #626" — was wrong: that message was an *analysis* error, and the check run said something different. Read `/api/issues/search` and `/api/duplications/show` on the public Sonar project next time; both work without a token.

## Drive backup (done 2026-11-11, verified)

Folder: **`Ledgerflow Agent13 2026-11-11`** inside `Ledgerflow Agent Backups` — https://drive.google.com/drive/folders/1g5rDxBr0Vk-v8hewf52hscnQfmXryI7u (ID `1g5rDxBr0Vk-v8hewf52hscnQfmXryI7u`). Every file was re-listed afterwards and its size matches the local byte count; the local MD5s below let a later agent prove identity after download.

| Drive file | ID | Bytes | MD5 (local) |
|---|---|---|---|
| `2026-11-11_Agent13_FINDINGS-register.md` | `1gZWdQNKL0dveGmeAE-QSJ6YSo5r3bWbK` | 18,436 | `96c1949856288b9dc48f111b0c16765d` |
| `2026-11-11_Agent13_CHECKPOINT-01.md` | `1zz44HDIzp_-WgwP5J512uDGk6W3t0jxR` | 3,940 | `02a016720f505924b6be3c505e1c6ce0` |
| `2026-11-11_Agent13_HANDOFF.md` | `1MXIZ6NZHGE0ErrhqAkPQ1xLoHxNnjtIa` | 4,411 | `872bd9ea64ad27f1499ed7c72dbf943e` |
| `2026-11-11_Agent13_PR-BODY-fork-22.md` | `1gzjRwbwVCdicV3li_PNeHG99MO0VQeBO` | 6,565 | `d187417d80933d5e9e480fa0d526b379` |
| `2026-11-11_Agent13_ledgerflow_two-commits.patch` | `1sdDnLptLw0_D4D-bYEa1y8hjUPFY0zrQ` | 106,614 | `37651bf967b959742f43769537a8f30d` |
| `2026-11-11_Agent13_PROBES.tar.gz` | `10GxM5qkq08LpZigLqPNFU5yK_rvPFjpT` | 11,064 | `e1b212ca6d09464485e9cb9b7d535623` |
| `2026-11-11_Agent13_r5-all-report-views-output-RESULTS.txt` | `1QkzdMIm7rhIsWipC9-6QFAk2_aeXRQrG` | 16,086 | `11a9dc7d429eaad0f5594cb39410619f` |

Recovery: the `.patch` is `git diff ec3ff49..HEAD` for both commits and was checked with `git apply -R --check` against this checkout — it reproduces the two commits exactly. On a clean checkout of `ec3ff49`, review and `git apply` (or cherry-pick `f2ee195`+`c44810e`); if `main` has moved, inspect and reconcile rather than overwrite. The tarball unpacks to `probes/` (8 files including `helpers/dom-probe.ts`).

**Master index:** this sandbox cannot splice text into the existing 14,071-byte `MASTER_RECOVERY_INDEX.md` (`1pTGxQhLdqBvH4sLoR-0MZ0XuvKtTP86F`) without rewriting the whole file and risking another agent's evidence, so the Agent #13 section was uploaded beside it as `2026-11-11_Agent13_MASTER_RECOVERY_INDEX_ADDENDUM.md` (`1HmvDrCugLIC13UpmWr-xi3RnyUWqonFU`, starred, read back) **and** a comment was added to the index file pointing at it. Nothing in the index was modified. Next agent with interactive Drive access: prepend the addendum's body and retitle Agent #8's section to "preserved".
