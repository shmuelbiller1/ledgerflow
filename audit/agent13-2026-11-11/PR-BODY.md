> **Where this PR lives.** The sandbox's GitHub App token can push to this fork and create PRs here, but it is refused (`Resource not accessible by integration`, HTTP 403, GraphQL and REST) on `shmuelbiller1/ledgerflow`. This branch is based exactly on upstream `main` `ec3ff49` (which is also this fork's `main`), so it applies cleanly: open the upstream PR with
> `gh pr create --repo shmuelbiller1/ledgerflow --base main --head Chaim-Richard:arena/a3a5023d-ledgerflow --title "Agent #13: month-end close defects fixed, every report screen measured (R-1/R-5)" --body-file audit/agent13-2026-11-11/PR-BODY.md`, or cherry-pick `f2ee195` (single commit).
>
> Compare link: https://github.com/shmuelbiller1/ledgerflow/compare/main...Chaim-Richard:arena/a3a5023d-ledgerflow?expand=1

## Agent #13 — month-end close defects fixed (R-1) and every report screen measured (R-5)

Branch `arena/a3a5023d-ledgerflow` (fork `Chaim-Richard/ledgerflow`), based on `main` `ec3ff49` (merge of #626). Maintainer edits allowed. **No merge by me — AI #1/owner decides.** No money, posting, tax-maths or `src/server/` change; no migration, dependency, baseline, warning-cap or test-input change.

### Fixed — three real defects in the Month-End Close checklist

| ID | Severity | What was wrong |
|---|---|---|
| **AF13-001** | Medium | **"Invoices and bills match the ledger" reported a correct entry as wrong for JPY/KWD-style currencies.** The check compared `amount × exchangeRate`; the posting path also converts minor units (`documentMinorRate` → `minorUnitRate` = rate × 10^(books' digits − document's)). A 0-decimal document currency looked **100×** off, a 3-decimal one **10×**. The month could not close without a sign-off and *Repost* reversed and re-posted an entry that was already right. |
| **AF13-002** | Low | Cancelled and rejected invoices/bills counted as "old receivables and payables" (>60 days), so a finished month could never tick that item. |
| **AF13-003** | Low | Bank lines marked `ignored` counted as "not matched yet", so "Bank lines matched" never reached *done*. |

**Evidence:** each was reproduced with a probe before the fix (`audit/agent13-2026-11-11/probes/`). AF13-001 runs the **real `LedgerPostService`**: ¥100,000 at 0.0067 in a USD book posts AR = **67,000** cents (independent arithmetic: $670), and the checklist said `expected=670 posted=67000`.

**Fix:** AF13-001 uses the posting path's own rate, with the books' currency threaded from `MonthEndCloseView` (`workspace.currency`); AF13-002 shares one "not owed" status set; AF13-003 skips `ignored` lines in both the count and the wording. Regression tests: `src/tests/close-checklist-statuses.test.ts` (**4/4**), including a KWD case (12.345 at 3.25 → 4,012 cents) and a deliberately short entry that must still be caught.

### R-5 — report speed: **measured, not met** (reported for AI #1/#9, not patched)

New probe mounts **every** report module in `src/components/{reporting,ledger,finance}` — 170 views — on the 12-month sample year:

| Scale | Entries | Over 1,000 ms | Slowest |
|---|---|---|---|
| 1 | 1,238 | 3 | Journal Sheet 1,729 · Payments 1,520 · General Ledger 1,446 |
| 4 | 4,880 | 7 | Journal Sheet 6,519 · Payments 5,586 · General Ledger 4,884 · Expiring Lots 2,387 · Account Register 1,816 · Tx by Customer 1,194 · Item Register 1,148 |

The **computation is not the cost**: `computeJournalSheet` 17 ms and `computeGeneralLedger` 17 ms on 4,880 entries. The screens render one card + table per entry or a row per document with a per-row `find`. So the fix is row windowing on statement screens (Journal Sheet is in the A-277 print loop, so printing must keep expanding) — AI #1/#9's lane.

- **Coverage extended:** `src/tests/report-speed-all-views.test.tsx` measures every report view and fails if any passes a 2,500 ms ceiling (3× on CI) **or a fourth screen crosses the 1,000 ms target** — a ratchet over the three known slow screens instead of a chosen list.
- **Claim corrected:** the speed screen said it "checks that every report — led by the five heaviest — completes well under 1,000 ms". It times **12** computations. The wording now says exactly that.

### Verified, no finding

Independent arithmetic on the sample year: double entry (0 unbalanced of 1,238), net income vs `computeProfitAndLoss` (−31,525,060 both), trial balance (198,563,697 = 198,563,697), balance sheet at year end and mid-year, 0 orphaned lines. (My first probe run "found" a 19.7 M-cent revenue gap — it was my own classification bug, corrected before reporting.)

### Reported, not patched (AI #1's lane)

- **AF13-008 (High, issue #641):** the **same root cause as AF13-001** in the shared converter `toBaseCents` (`src/server/reports/partyReports.ts`): the **A/R and A/P aging, customer/vendor stored balances, lifetime value, cohorts, working-capital and FX revaluation** convert a document with the bare exchange rate. A real ¥100,000 invoice at 0.0067 posts a 67,000-cent receivable while `computePartyAging` reports **670** (probe `af13-008-fx-aging-vs-ledger.test.ts`), i.e. the aging does not reconcile to the control account for 0-decimal currencies (JPY/KRW/VND…) and is 10× off for 3-decimal ones (KWD/BHD…). 40 call sites in 14 files; the fix belongs in `src/server` with one review, so it is reported with a patch sketch, not pushed.
- **AF13-004 (performance, issue #642):** Journal Sheet / Payments / General Ledger over 1 s (numbers above).
- **AF13-007 (issue #643):** credit notes and vendor credits are outside the month-end posting check, although the item's wording says "every invoice and bill".
- **AF13-006:** the synthetic fixture tags no entry with its document (`metadata` empty on all 1,238), so the posting check cannot be exercised end-to-end on it. Tagging accruals `{ type: 'invoice-accrual', invoiceId }` would fix that for every future audit.

### Checks on this branch

`tsc` clean · ESLint **0 errors / 42 warnings** (cap unchanged) · `npm run build` pass · new tests **4/4** and **1/1** · close/fx neighbours **51/51** · the A-229 cold module-preload leg is red **in this sandbox** (2,329 ms vs 1,500 ms) exactly as `CURRENT_WORK.md` records for unmodified `main` (the ten screens it imports are untouched by this diff) · full unit suite result in the PR comments. No local Postgres, so DB/RLS and browser gates were not run.

Evidence and register: [`audit/agent13-2026-11-11/FINDINGS.md`](audit/agent13-2026-11-11/FINDINGS.md) · checkpoint: `audit/agent13-2026-11-11/01-CHECKPOINT.md`.

## Results (final, 11 Nov end of session)

| Gate | Result |
|---|---|
| CI on `42b10bb` (this PR's head, then `587d024` docs-only) | **21/21 green** — Unit tests 1-4/4 · Pacific/Auckland 1-3/3 · America/Los_Angeles 1-3/3 · **Browser shards 1-5/5** · Lint, Typecheck and **Database rules** · Production build · Playwright E2E Smoke · CodeQL ×2 · CycloneDX SBOM |
| Full local unit suite | **4,659 tests · 4,653 pass · 1 fail · 5 skipped** (17m30s) |
| The one failure | A-229's cold-module-preload leg: **1,521.74 ms vs a 1,500 ms budget** (`report-speed-12m.test.tsx:258`). It read 2,329 ms in an earlier run on the same host, and `CURRENT_WORK.md` records this leg as a machine artefact on unmodified `main`; the ten screens it times do not import anything this PR changes. Not fixed by raising a budget. |
| `tsc` / ESLint / build | 0 errors / 0 errors + **42 warnings** (cap unchanged) / pass |
| New and neighbouring suites | `close-checklist-statuses` 4/4 · `report-speed-all-views` 1/1 · close/FX neighbours 51/51 · `af13-008` probe 1/1 |
| **SonarQube Cloud** | **Not green** — "The last analysis has failed". Cause unknown from this sandbox (sonarcloud.io unreachable). The same message is on upstream #626, i.e. the base commit, while #625/#610 passed. **Owner/AI #1: read the dashboard before merging; the 21 green checks do not cover this.** |

Nothing in this PR merges itself, and no money, posting, tax, `src/server/`, migration, schema, test-input, baseline or warning-cap file is touched. **AI #1 merges.**
