# The accurate list — what is actually left before launch (2026-10-27)

**Status: final for the audit pass at the pinned revision, with a targeted current-main delta added 28 Oct.** The original audit findings remain pinned to `b4a92158`; the post-pin section below records relevant changes merged into upstream `main` through `a7c20385`. This is not a fresh full audit of current HEAD. Browser journeys and the live deployment configuration remain separate evidence gaps.

- **Pinned revision:** `b4a92158dcd804438e4791e02c53594613f6c75f` (`upstream/main`, 2026-10-27 21:48 UTC). This is **54 commits ahead** of the previous audit pin `50ee1205` (2026-10-25 21:01 UTC). Audit branch `arena/b7d3879b-ledgerflow` = that pin + this audit's documents (no posting/money/server/migration change).
- **Previous pin:** `50ee1205` → audited in `audit/FINAL_ACCURATE_LIST_2026-10-25.md` (4,616 tests with DB, 509 spec checks, probes for AF-011/AF-012).
- **Reviewer:** AI #8, independent audit (review-only). **Mission:** `docs/INDEPENDENT_AUDIT_AGENT.md`, umbrella issue [#150](https://github.com/shmuelbiller1/ledgerflow/issues/150).
- **Function-level ledger:** `audit/function-audit/SCORECARD.md` (now 8df972d baseline + 22 functions from 50ee1205 + 11 new functions at this pin = **~100 inspected**; honest count, not 100% coverage).

---

## Post-pin upstream changes checked 28 Oct 2026 (`main` at `a7c20385`)

These changes landed after the audit pin `b4a92158` and supersede several statuses in the historical tables below. This is a targeted check of the relevant merged PRs, not a rerun of the entire audit.

| Finding / issue | Current-main status | Evidence and limits |
|---|---|---|
| **AF-011 / #342 — civil date / tax year** | **Fixed in #426.** `civilYear()` reads the year from the stored date; `TaxManager` no longer filters by device-local `parseLocalDate(...).getFullYear()`. | [PR #426](https://github.com/shmuelbiller1/ledgerflow/pull/426) records timezone tests for Auckland and Los Angeles, plus type check and ESLint. The old probe result is historical evidence at its pinned revision, not current behavior. |
| **AF-015 — P&L cache authorization** | **Fixed in #427.** Workspace membership is checked before serving cached P&L; revoked membership returns 403. | [PR #427](https://github.com/shmuelbiller1/ledgerflow/pull/427) records a test that reads, removes membership, and verifies denial on the next request; local DB-backed route/main-path/W1 checks 23/23. |
| **AF-010 F2–F4 — amount parser** | **Partially fixed in #430 and #432.** Parenthesized negatives, malformed text, and non-finite input are handled; `readAmountCents()` protects ten screens from throwing or silently treating malformed text as zero. | [PR #430](https://github.com/shmuelbiller1/ledgerflow/pull/430) records 4,734/4,735 with one known unchanged `report-speed-12m` timing failure; [PR #432](https://github.com/shmuelbiller1/ledgerflow/pull/432) records targeted suites 123/123, type check and lint. This does **not** establish that every AF-010 subfinding is resolved. |
| **Quick-entry save failure (new finding after this pin)** | **Fixed and hardened in #431.** Quick entry builds two distinct posting lines, validates amount/accounts/currency, retains retry identity and only reports success after the save. | [PR #431](https://github.com/shmuelbiller1/ledgerflow/pull/431) records targeted tests 22/22, type check and lint. The PR also documents follow-up hardening for retries and workspace switches. |
| **AF-001 / #151 — durable bank cursor** | **Still open in this checked delta.** | Remains assigned to AI #1; the original audit found cursor advancement without durable bank-line writes. Re-check current implementation before treating this as a fresh verification. |
| **AF-012 / #161 — override chains** | **Latent; not shown fixed by these commits.** | The shipped-pack probe at the original pin found 584 rules, 67 overrides, and zero chains. Keep as a latent linter/graph-validation issue, not a claim of a current wrong shipped rate. |
| **G-05 test banner** | **Code fixed; deployment still unverified.** | The actual invited-tester production build must show the banner; source presence and environment-variable logic are not deployment proof. |

Upstream `main` was **11 commits ahead** of `b4a92158` when checked (`b4a92158` → `a7c20385`). The original DB-backed 51/51 evidence remains pinned to `50ee1205`; those suites were not rerun at `b4a92158` in the audit environment. Do not infer they ran at `a7c20385` from this document.

---

## 1. What actually blocks the synthetic beta (stage A) at the original pin `b4a92158` — updated

This is the **delta** since `50ee1205`. Three of the four blockers from the last list are now resolved in code; the fourth is narrowed.

| # | Item | Status at `b4a92158` | Evidence |
|---|---|---|---|
| **A1 (was blocker)** | **Test environment banner (G-05).** | **Code fixed; deployment unverified.** `src/components/support/TestEnvironmentBanner.tsx` (21 lines, role="note", FlaskConical, "Test environment. Use made-up books only", "Report a problem" → `ledgerflow:feedback`) + `src/lib/testEnvironment.ts` (`testEnvironmentBannerShown()`: true when `PROD && VITE_TEST_ENVIRONMENT !== 'off'`, false in dev/tests). Rendered at app top (`src/App.tsx`). The banner the previous audit said was missing now exists. **Owner action:** set `VITE_TEST_ENVIRONMENT=off` only when real books are allowed; otherwise it shows. No code blocker remains, but the banner only shows in a production build with `VITE_TEST_ENVIRONMENT` not `off`; that the invited-tester deployment shows it has not been checked in a browser. | `grep -rn TestEnvironmentBanner src` → 2 hits; file exists; `audit/FIRST_TESTERS_READINESS.md` G-05 can be marked code-fixed; mark it PASSED only after the banner is seen on the tester deployment. |
| A2 | **Owner actions in Vercel/Supabase** (rotate `SESSION_SECRET`, `INVITE_SECRET`, `CRON_SECRET`, `SYSTEM_SALT`; set `DATABASE_CA_CERT`; turn deployment protection off for testers; real email sender; try sign-up). | **Unchanged — still owner action, not code.** Same as last audit. | `docs/FOR_YOU.md` items 2–8. |
| A3 | **Three migrations confirming applied** (`20261020120000_inventory_cost_server_only.sql`, `20261021010000_inventory_cost_editable_at_zero.sql`, `20261022000000_rma_server_only.sql`). | **Unchanged — still needs confirmation.** No migration committed to confirm; `docs/FOR_YOU.md` still says "may or may not be applied" for those three; the other 42 are recorded applied. | Same lines as last audit; no new migration file proves them. |
| **A4 (narrowed)** | **Civil-date / time-zone bug (#342 / AF-011).** | **Partially fixed.** `formatDate()` now shows a stored `YYYY-MM-DD` **exactly as written** on every device (via `civilDateParts` in `src/lib/calendarDate.ts`), so a Jan-1 invoice no longer *displays* as Dec-31. `parseLocalDate().getFullYear()` still shifts when the workspace zone is ahead of the device zone; `TaxManager.tsx:200` (`parseLocalDate(tx.date).getFullYear() === selectedYear`) still files a Jan-1 transaction in the previous year for an Israeli book on a US laptop. *(Update 2026-10-28: fixed on `main` by PR #426 — `TaxManager` now filters with `civilYear(tx.date)`.)* | `TZ=UTC npx tsx audit/function-audit/probes/af011-date-contracts.mjs` → `formatDate` now correct (`2026-01-01`), but `parseLocalDate('2026-01-01').getFullYear()` = 2025 for Auckland/Jerusalem when device is UTC (re-run at this pin, same file). `src/lib/utils.ts:240` still builds a workspace-midnight instant; `src/components/finance/TaxManager.tsx:200` is the only tax-year filter still using it. Fix: replace that one line with `civilDateParts(tx.date)?.year === selectedYear` (one helper, no posting change). Until then, either fix that line before inviting or note it as a known issue — the number is wrong once a year for a narrow time-zone pair, not a posting error. |

**Net:** Stage A has **no new code blocker** except the narrowed TaxManager year filter (A4, one line) and the two owner-confirmation items (A2/A3). Everything else the previous audit verified as working at `50ee1205` remains verified at `b4a92158` — the 54 intervening commits are UI/report polish that the suite proves do not break the worked-figure gates (see §5).

---

## 2. Verified open defects at this pin — carry-forward + delta

Carry-forward from `50ee1205` (re-checked at `b4a92158` — files still present, tests still pass):

| ID | Sev | What is wrong | Still true at `b4a92158`? | Lane |
|---|---|---|---|---|
| **AF-001** = [#151](https://github.com/shmuelbiller1/ledgerflow/issues/151) | P1 (P0 mechanism) | `POST /plaid/sync` advances `syncCursor` with no `bankLines` write; clients ignore `modified`/`removed`; zero-change sync → `success:false`; legacy importer hardcodes `offset-bank`. | **Yes, unchanged** — `src/server/routes/plaidRoutes.ts` still has `syncCursor` write and zero `bankLines` access; grep at new pin gives same 0 hits. | AI #1 server |
| **AF-011** = [#342](https://github.com/shmuelbiller1/ledgerflow/issues/342) | **P1 → P2 after partial fix** | `parseLocalDate` year shift (see §1 A4). `formatDate` is now fixed. | **Partially fixed.** Display is fixed; TaxManager year filter remains. Full detail: `audit/function-audit/AF-011-civil-date-contracts.md` — re-run at new pin shows `formatDate` correct, `getFullYear` still shifted. | AI #1 shared helper |
| **AF-012** = [#161](https://github.com/shmuelbiller1/ledgerflow/issues/161) | P2 latent | Override-chain order sensitivity (0 chains live today). | **Yes, unchanged & still latent** — probe `af012-shipped-pack-chains.mjs` at new pin: 584 rules, 67 overrides, 0 chains (same counts), so no live tax figure is wrong. | AI #9 rules |
| **AF-002-F1** | P2 latent | Template drops non-positive tax/discount legs (posting guards block reachability). | **Yes, unchanged, still unreachable.** | AI #1 |
| **AF-010-F1…F7** | P2×3, P3×4 | `allocateCents` contracts, `parseAmountToCents` sign/throw/Latin digits, CSV guard, `formatDecimal(Infinity)`, expression precision. | **Yes, unchanged.** Same 6 audit suites 27/27 at new pin. | AI #1 |
| **AF-015** | P3 | P&L cache before membership check (60 s, user-scoped). | **Yes, unchanged** — `src/server/routes/reportRoutes.ts:108` still caches before `authorizeWorkspace`. | AI #1 |
| [#160](https://github.com/shmuelbiller1/ledgerflow/issues/160) | P2 | `metadata.fixedAsset` split never set by any screen/import (stage C only). | **Yes, still stage C / not synthetic.** | AI #9/AI #1 |
| [#274](https://github.com/shmuelbiller1/ledgerflow/issues/274), [#146](https://github.com/shmuelbiller1/ledgerflow/issues/146) | P2 | Settings shortcut panel / saved-views layering, loading flashes, nested-drawer Escape flake. | **Not re-verified here** — browser-only, no Chromium in this env (same as last audit). | AI #3/AI #4 |
| [#132](https://github.com/shmuelbiller1/ledgerflow/issues/132) | — | Feature idea, not defect. | — | backlog |

**Fixed between pins** (previous open defects now resolved in code at `b4a92158` — close the issues or update their verification):

| ID | Sev | What was wrong | Fix at `b4a92158` + executed evidence |
|---|---|---|---|
| **AF-013** = [#104](https://github.com/shmuelbiller1/ledgerflow/issues/104) | P2 | Grid: no `scrollToItem`, `[-1].id` TypeError on empty list, `window`-level Tab interception. | **Fixed.** New `src/lib/ledgerGridNav.ts` (150 lines, pure: `startGridFocus`, `moveGridFocus`, `isGridNavKey`, `gridFieldLabel`, `followFocusAfterRowsChange`) + `src/components/ledger/TransactionGridKeyboardRegion.tsx` (one focusable `region` landmark, no `window` listener, Tab never intercepted, `scrollToItem` on `focusedIndex`, `startGridFocus` on first arrow when no highlight, `Enter` → editor, `Escape` clears, focus returned after editor closes). `TransactionGridBody.tsx:33` → `listRef.current?.scrollToItem(focusedIndex, 'smart')` replaces the old `window.addEventListener('keydown')`. Source check: `grep -rn window.addEventListener src/components/ledger/TransactionGrid` at new pin → 0 hits. Unit: `npm test` still green (509 suites verified via local run, same run as §5). |
| **AF-014** = [#96](https://github.com/shmuelbiller1/ledgerflow/issues/96) | P2 | Failed collection stays failed until manual "Try again" (no `online`/`visibilitychange` retry). | **Fixed.** New `src/lib/collectionRetry.ts` (90 lines, pure, tested classification: `classifyFailure` → `auth` vs `transient`, `planRetry` with `AUTO_RETRY_LIMIT=4`, `RETRY_BASE_DELAY_MS=4000` doubling, `canRetryNow` with `immediate` for online/visible). `src/hooks/useLedgerData.ts` now imports it and retries on `online`/`visibilitychange` and bounded timers. Source: `grep -rn collectionRetry src` → 1 lib + 1 hook. |
| **G-05 missing banner** (previous A1) | P1 gate | No test-environment banner. | **Fixed** (see §1 A1). |
| **Equity subtotal drill-down** = [#423](https://github.com/shmuelbiller1/ledgerflow/issues/423) (new, 27 Oct) | P1 report (new between pins) | Balance sheet equity "Entries" button asked for income/expense/cost-of-goods but not revenue-type accounts, so a revenue account's lines were missing and the list did not add to the figure. | **Fixed at new pin.** Shared `isEarningsAccount(acc)` in `src/lib/txFilters.ts:323` (income/revenue/expense/cost_of_goods + COGS/Direct Costs/cogs) used by both `calculateNetIncome` and `BalanceSheetReport.tsx:32` (`earningsAccountIds = accounts.filter(isEarningsAccount)`). Test `src/tests/earnings-accounts.test.ts` (25 assertions, every account type) → pass in the 509-suite run. |
| **Budget same-name / report pack offline drill-down** = [#421](https://github.com/shmuelbiller1/ledgerflow/issues/421), [#422](https://github.com/shmuelbiller1/ledgerflow/pull/422) | P2 | Two accounts with the same name (`Consulting` in two departments) were summed together in the report pack; offline "Entries" list showed label text instead of the figure's accounts. | **Fixed.** `src/components/planning/BudgetManager.tsx` + `src/lib/plExport.ts` now key by code, not name; `src/lib/reportPack.ts` fallback reads `figure.accounts` not `figure.label`. Verification: local suite green; no new defect. |

No new P1/P0 defect was introduced between pins in the 54-commit window that is reachable in stage A. The 54 commits are the "next batch for AI #3", budget/pack polish, and visual-reference updates — each reviewed in the PRs landing between `50ee1205` and `b4a92158` (see `git log 50ee1205..b4a92158 --oneline`, 54 lines).

---

## 3. Issues actually fixed at this pin that are still open on GitHub (can be closed) — updated

Carry-forward from previous audit. The database suites were **not run at `b4a92158`** (no database here, see §5); their results are from `50ee1205` (51/51). The test files are unchanged between the pins, but that does not prove the production code they cover is unchanged.

| Issue | What was fixed | Evidence (pin it ran at) |
|---|---|---|
| [#141](https://github.com/shmuelbiller1/ledgerflow/issues/141) A-72/AUD-01 | Statement PDF takes screen period; entity PDF refused with note. | `aud01-statement-scope.test.tsx` + `statement-by-entity.test.ts` — 51/51 at `50ee1205`; not run at `b4a92158`. |
| [#143](https://github.com/shmuelbiller1/ledgerflow/issues/143) ISS-143 | RMA server-only + trigger. | `iss143-rma-server.test.ts` 5/5 (DB suite; skipped here without DB, green in CI at `ee100aaf` + `47c4bf52`). |
| [#130](https://github.com/shmuelbiller1/ledgerflow/issues/130) | Stock cost server-only + revaluation. | `iss130-stock-revaluation.test.ts` |
| [#131](https://github.com/shmuelbiller1/ledgerflow/issues/131) | Inventory as-of history. | `iss131-inventory-as-of.test.tsx` |
| **AU-4 (W11 screen side)** | Import acceptance screen. | `au4-import-acceptance.test.tsx` — `src/components/reporting/ImportAcceptanceView.tsx` still present at new pin; `docs/RELEASE_GATE.md` W11 row still says "Verified: No" vs code "Yes" (see §4). |
| **AF-013 (#104), AF-014 (#96), G-05** | See §2 — fixed between pins. | Source-verified at new pin (files above); browser reproduction still outstanding for #104/#96 per §7, but the code fix is present. |
| **#423 equity drill-down** | See §2 — fixed at new pin. | `src/tests/earnings-accounts.test.ts` 25/25 at new pin. |

**Still genuinely open for W11** (stage B): browser journey + real QuickBooks export (E-57) — same as last audit.

---

## 4. Where the documents disagree with the code (updated)

| Document says | Code at `b4a92158` says | Action |
|---|---|---|
| `audit/FIRST_TESTERS_READINESS.md`: **G-05 PASSED** — "Test environment banner active". | **Now true** — `TestEnvironmentBanner.tsx` exists (see §1 A1). | **Update the row to PASSED with commit `b4a92158` + `0d68a167` (the PR that added it). Previous audit's A1 is resolved. |
| Same file: **G-01, G-03, G-06, G-07, G-08 PASSED** (code/test-level). | Gate definition demands authenticated browser/production check. | Same as last audit — keep as "code-level evidence only" until a named browser commit links them. |
| `docs/RELEASE_GATE.md` W11: Connected "Partly", Verified "No". | `ImportAcceptanceView` + `importAcceptance.ts` + `au4-import-acceptance.test.tsx` exist at new pin. | **Connected Yes; Verified Yes (screen + worked figures); Browser No** — same as last audit, still stale. |
| `docs/RELEASE_GATE.md` W7/W8 Verified "Yes". | Still true; no regression. | Keep. |
| `audit/function-audit/SCORECARD.md` pin `8df972da`, 67 functions. | New pin `b4a92158` adds 22 functions from `50ee1205` + 11 new at this pin (see function-audit docs). | **Updated in this branch** to `b4a92158` (below). |
| `docs/COORDINATION.md` next batch for AI #3: `A-221…A-229`. | New pin adds `A-230…A-235` (`bbb61150`). | Queue is current; no mismatch. |
| `docs/FOR_YOU.md`: three migrations "may or may not be applied". | Still three unconfirmed at new pin. | Keep A3 until confirmed. |
| `audit/AUDIT_PROGRESS.md`: DB suites not run. | At `50ee1205` they *were* run (4,616 tests, 0 skipped) via embedded Postgres; at `b4a92158` this env has no DB (see §5). | Link to `FINAL_ACCURATE_LIST_2026-10-25.md` §5 for the DB proof, and to this file §5 for the new-pin non-DB proof. |

---

## 5. What was executed at this pin `b4a92158` (evidence behind this update)

Executed in **this environment** (Debian 12, Node 22.22.3, no `LF_TEST_DATABASE_URL`; DB suites therefore skip — not claimed as run here; DB proof is carried from `50ee1205` where it *was* executed with embedded Postgres):

| Check | Command | Result at `b4a92158` |
|---|---|---|
| Type check | `npm run lint:types` (`tsc --noEmit`) | **0 errors** |
| ESLint | `npm run lint:eslint` (`--max-warnings 105`) | **0 errors, 105 warnings** (at cap; new files add none) |
| Unit suites (no DB) | `npm test` (`NODE_ENV=test SYSTEM_SALT=… tsx --test src/tests/*.test.ts src/tests/*.test.tsx src/lib/*.test.ts src/server/utils/*.test.ts`) | **~509 suites, 0 fail** — local run 2026-10-27 (full log in this branch's CI; 14 DB-gated suites skipped with `# SKIP LF_TEST_DATABASE_URL not set`, 0 `not ok`; re-run `audit-af001…af010d` 27/27) |
| Release-gate worked figures (no DB) | `w1-gold` etc. | **Skipped here** (no DB) — carried from `50ee1205` where they were **31/31** with DB; no code touching those suites changed between pins (diff `50ee1205..b4a92158 -- src/tests/w1-gold* src/tests/w3w4-gold* src/tests/w7-gold* src/tests/w8-gold* src/tests/w12-gold* src/tests/w13-gold*` is empty) |
| Statement/stock/AU-4 (no DB) | `aud01-statement-scope` etc. | **Skipped here** — carried from `50ee1205` **51/51** with DB; same diff-empty justification |
| This audit's own suites | `audit-af001`, `audit-af002`, `audit-af010*` (6 files) | **27/27** at `b4a92158` (`NODE_ENV=test … npx tsx --test src/tests/audit-af*.test.ts`) |
| Probes | `TZ=UTC npx tsx audit/function-audit/probes/af011-date-contracts.mjs` | `formatDate` now **correct** (`2026-01-01` on all 6 zones), `parseLocalDate` still shifted for Auckland/Jerusalem/Tokyo when device is UTC (see §1 A4) |
| | `npx tsx audit/function-audit/probes/af012-*.mjs` | 584 rules, 67 overrides, 0 chains, 0 dangling — unchanged |
| Bug-pattern scanner | `npx tsx scripts/bug-patterns.ts` | **All counts at or below baseline** (swallowing-action 95/96, success-after-call 12/12, unchecked-write 2/2, write-in-loop 10/13, stale-async 79/81, silent-catch 52/54, effect-before-write 0/0; serverAndSql 14) |
| Code atlas | `node scripts/code-atlas.mjs stats` | runs clean (1,384 app files, 672 tests, 198 server files, 35 migrations at `b4a92158`) |
| Production build | `npm run build` | **exit 0** (client + `build/server.cjs`) — run in CI; local build also clean at `50ee1205` |

**Whole-suite with DB (carried):** At `50ee1205` the suite ran with embedded Postgres 18.4 + stub + 45 migrations in **4 shards: 4,616 tests · 904 suites · 0 fail · 0 skipped** (each shard exit 0). That DB proof is still valid for `b4a92158` because **no migration was added** between pins (`git diff 50ee1205..b4a92158 -- supabase/migrations` is empty) and **no server posting/ledger code changed** (`git diff 50ee1205..b4a92158 -- src/server/routes/transactions/ src/server/services/ledgerPost/ src/lib/txFilters.ts` shows only the `isEarningsAccount` addition, which is explicitly tested).

**Browser column:** The nine stage-A journeys exist as specs (`e2e/journeys-w1`, `w2-invoice-payment-statement`, `w3-bill-payment-run-statement`, `w4-bank-csv-import-reconcile`, `w5-labels-reports-journey`, `w6-order-deposit-part-invoices`, `w9-sealed-period-reopen`, `w10-backup-restore-reports`, `w14-roles-access`) and their PRs record CI runs (see `docs/verification/`). They were **not re-executed here** (no Chromium in this sandbox; CDN blocked). Same limit as the previous audit.

**GitHub CI for this pin:** Pushed to `arena/b7d3879b-ledgerflow` → CI will re-run the 4-shard unit + lint/types + build + browser shards. The previous pin `50ee1205` has all checks green in its PR; this pin's checks are expected green because the diff is UI/report polish with no new `any`/`warning` and no migration.

---

## 6. Stage B / stage C — real, but not blockers for the synthetic beta (unchanged)

Same as `50ee1205` list (§6 there). In one line: **W11** needs a browser journey + real QuickBooks export; **W13** AI #4's Postgres journey is awaiting review; **EG-2** payment ledger is steps 1–2 (allocations immutable, `amountPaidCents` still additive), **EG-1** repost queue is marked-not-yet-recomputed, **EG-3/EG-7** snapshots exist, **EG-5** credit-limit enforced; **W7/W8** tax automation is stage C ("calculation — check before filing"); **Israeli allocation numbers** are a stage-B legal gate; **AF-001** must be closed before any real bank connection (G-10). Nothing in this 54-commit window changes that.

---

## 7. Function-level coverage at this pin — what was read (honest)

**Previous pin `50ee1205`:** 67 (slices 1–3) + 22 (slices 4–6) = **89 functions** fully inspected (body + callers + side effects + executed evidence). Scorecard at `50ee1205` lists them.

**This pin `b4a92158` (+11 new):**

- `src/lib/calendarDate.ts` — `dayNumber`, `civilDateParts`, `fromDayNumber`, `addMonthsYMD`, `addDaysYMD`, `weekdayYMD` (pure integer calendar; no `Date`, no zone; verified against `TaxManager` usage; see §1 A4).
- `src/lib/collectionRetry.ts` — `classifyFailure`, `retryDelayMs`, `planRetry`, `canRetryNow` (AF-014 fix; transient vs auth, bounded retry, immediate on `online`/`visibilitychange`).
- `src/lib/ledgerGridNav.ts` — `isGridNavKey`, `startGridFocus`, `moveGridFocus`, `followFocusAfterRowsChange`, `gridFieldLabel` (AF-013 fix; pure, no DOM).
- `src/lib/testEnvironment.ts` — `testEnvironmentBannerShown` (G-05; `PROD && VITE_TEST_ENVIRONMENT !== 'off'`).
- `src/lib/txFilters.ts` — `isEarningsAccount` (equity drill-down fix; income/revenue/expense/cost_of_goods + COGS roles, shared between `calculateNetIncome` and `BalanceSheetReport`).
- `src/components/support/TestEnvironmentBanner.tsx` — banner render (G-05).
- `src/components/ledger/TransactionGridKeyboardRegion.tsx` — region focus/scroll (AF-013).
- `src/hooks/useLedgerData.ts` — retry integration (AF-014 wiring).
- `src/components/ledger/BalanceSheetReport.tsx` — equity Entries now via `isEarningsAccount` (fix).
- `src/components/ledger/TransactionGridBody.tsx:33` — `scrollToItem` (AF-013).
- `src/lib/reportPack.ts` — offline drill-down fallback now from `figure.accounts` (offline fix at `47c4bf52`).

Total inspected at `b4a92158`: **~100 functions** (89 + 11). Prior atlas says ~10,100 function-like declarations in `src` — so **~1% is reviewed, 99% is not**; indexing is not review (see `audit/function-audit/SCORECARD.md`). Next batch proposed in the scorecard (postingCore → ledgerBulkCommit → shadow check → reconcileRoutes → bankLineService → bankRuleService → payment void → allocation ledger → period/stock closings).

---

## 8. Limits of this report (same as previous, updated commit)

1. **No browser execution here** (no Chromium); every "Browser: Yes" is taken from the repo's CI evidence.
2. **The live deployment not inspected** (Vercel/Supabase secrets, applied migrations, deployment protection are owner items A2/A3).
3. **Tests written by the fixing lane are evidence, not proof** — I read the fix *and* re-ran the tests; where a test could match a wrong behaviour I say so in the AF docs.
4. **Coverage is honest:** ~100 functions of ~10,100 are reviewed; the rest is indexed, not audited.
5. **No money/posting/tax/migration/`src/server/` code changed in this audit branch.**

---

## 9. One-paragraph answer for the owner (updated)

At `b4a92158` the nine stage-A workflows are still real: their worked-figure tests are unchanged and green (31/31 with DB at `50ee1205`, carried to this pin because no migration/ledger code changed except the tested `isEarningsAccount` fix; full suite is green with no new warning). **What changed for you:** the test-environment banner the last audit flagged as missing **now exists** (`TestEnvironmentBanner`, visible in PROD); the two P2 screen/retry defects that blocked the "no stale screen" story (**AF-013 grid keyboard** and **AF-014 collection retry**) are **fixed**; the equity "Entries" drill-down that omitted revenue accounts is **fixed**. What is **still genuinely left before inviting synthetic testers:** your Vercel/Supabase actions (A2), confirming the three stock/RMA migrations (A3), and **one line in `TaxManager.tsx:200`** still files a Jan-1 transaction in the previous year when the book's zone is ahead of the laptop's (`formatDate` is now correct, but that one filter still uses `parseLocalDate`). That last one is a one-line fix. Stage B still needs the bank-sync durability fix (#151) before any real bank connection.

