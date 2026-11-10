# LedgerFlow — AI #2 final, accurate list — 10 November 2026

**FINAL for the AI #2 slice at the code pin below.** (Owner: "work fast to get the final with list
of accurate stuff".) Every status here was read or executed at the pin; anything not re-verified is
labelled as such. This is AI #2's slice, not a new launch certification. Later sessions: add a dated
correction note at the bottom; do not silently rewrite statuses.

| | |
|---|---|
| **Code pin (`main`)** | `dc40739708a013ad080ffb306fe461554a2391fc` — "docs: AI #12 active (N-1…N-10, start note); spare queue AI #13 (R-1…R-5)" |
| **This session's branch** | `arena/a43d823e-ledgerflow` (pushed; PR number recorded in the dated correction note at the bottom) |
| **Author / lane** | AI #2 (Codex): screens, reports, settings lists, help, clean-up. No money, posting, tax-rate, server, schema or migration change. |
| **Evidence** | `docs/verification/ai2-c40-review-followups-2026-11-10.md` |
| **Vercel** | A red/paused preview is the owner's deliberate deployment-usage freeze, **not a code defect**. On PR #570 the Vercel check was actually Ready. |

**One-line status:** Stage A (synthetic bookkeeping beta) remains **READY** — all 9 workflows
W1, W2, W3, W4, W5, W6, W9, W10, W14 are Yes / Yes / Yes in `docs/RELEASE_GATE.md`. `main` at the
pin has **all 22 CI checks green** (CI, CodeQL, SBOM, ESLint ratchet, SonarCloud, every unit and
browser shard, production build). There were **0 open pull requests** at session start and
**16 open GitHub issues**. Stage B remains gated on W11/W12/W13 production-like gates and the
ERPNext-depth items. The remaining launch blockers are owner deployment actions and the open
money-lane issues below, not this session's screen work.

---

## 1 · Done today (AI #2, all verified in code and by tests)

Merged PR **#570** (C-40 Israel VAT Report) had **7 unresolved bot findings**, a failed Sonar
quality gate and 9 failed CI jobs at its head. All 7 findings are now answered **in code with
regression tests** on this branch; the CI/Sonar root cause is documented, not re-broken.

| # | Finding | Answer |
|---|---|---|
| 1 | Codex **P1**: figures labeled ILS even when the workspace's base currency is USD | The view passes `workspace?.currency || 'USD'` to the panel and CSV header; a non-ILS workspace gets an explicit "filed in ILS, no conversion" notice. `israelVatReturn` itself is untouched — it still returns home-currency cents. |
| 2 | Codex **P2**: a fabricated `vat:IL:default` produced an exportable zero-liability report | Only a real, in-force registration can be active; no registration ⇒ no report, no CSV, explicit configuration state. |
| 3 | Codex **P2** + CodeRabbit **Minor**: stale registration after the period changes | `activeReg` is derived from the current registration list, so the `<select>` value always matches a listed option. |
| 4 | Codex **P2**: chart of accounts omitted from readiness checks | `useLedgerCollections` now asks for `accounts`; a failed/capped account list makes the report provisional and blocks CSV (the equipment split needs those accounts). |
| 5 | CodeRabbit **Minor**: mixed-bill notice counted bills outside the selected period/registration | `countedMixedBills` reuses the same counted-purchase status, period, seller profile and registration as `computeTaxReturn`. |
| 6 | CodeRabbit **Minor**: CSV divided cents by 100 | Uses the shared `csvMoney` formatter; large-integer-cent precision test added. |
| 7 | CodeRabbit **Trivial**: no CSV test for a negative `toPayCents` | Reclaim branch asserted in the CSV test. |

Also fixed: the unverified `workspaceExports.ts` consumer claim, docstring coverage on the new
functions, and the EN/HE screen help so it states the currency and missing-registration contract.
**Already fixed before this pass** by #570's autofix commit `4376cab`: `.csv` filename, CSV disabled
while provisional, `window.print` restored in `finally`.

**Checks executed here:** `npm ci` (first attempt `ECONNRESET`, retry with 8 retries succeeded),
`tsc --noEmit` clean, ESLint **0 errors / 42 warnings** (cap unchanged), `npm run build` clean,
focused suite **14/14** (7 existing + 7 new), full `npm test` **4583/4589 pass, 1 fail, 5 DB skips** — the sole failure is the pre-existing A-229 cold module-preload leg (2653.47 ms vs a 1500 ms budget), reproduced on unmodified `main` at 2655.86 ms and on this branch at 2379.65 ms; budget untouched. Five mutations
back to the old behaviour each made the focused suite fail (13/1, 8/1, 13/1, 13/1, 13/1); the
restored tree is 14/0. No local Postgres or Chromium, so DB RLS rules and browser shards belong to
CI (COORDINATION "Start of every session" rule 3).

**No RELEASE_GATE row was claimed.** This is a truthfulness/review fix on a calculation-only
screen: W7/W8 remain Partly, no filing-readiness claim.

## 2 · CI and Sonar: the accurate history of PR #570

- Head `7078430` contained **two `REPORT_TAB_IDS` literals** in `src/config/routeIds.ts`, the
  second a bare `"…".split(' ')`. That is the single `typescript:S2201` Sonar bug
  (`AaG-4VVwd04ropU9GfU8`, "The return value of `split` must be used") that produced the
  **C Reliability Rating on New Code** failure, and it broke the report-ID parity test plus the
  production build's bundle invariants: **unit shards 1/4 & 4/4, four timezone shards, coverage
  gate and Production build** failed. Browser shards, lint/typecheck/database rules, CodeQL,
  CycloneDX and Playwright smoke were green.
- PR **#576** removed the duplicate. At the pin, `routeIds.ts` has one clean list and a query of
  the public SonarCloud issues API returns **0 open BUG issues** for the project. All 22 checks at
  `dc40739` are green. **This branch's CI:** recorded in the dated correction note at the bottom after the PR checks finish.

## 3 · Open GitHub issues at the pin (16) — state verified where claimed

| Issue | Verified state at `dc40739` | Owner / next |
|---|---|---|
| **#599** P1 unresolved merge conflict in `audit/FINAL_ACCURATE_LIST_2026-11-08.md` | **Confirmed**: raw markers at lines 1 / 59 / 194; `git grep` shows this is the only tracked file with them. Two contradictory "FINAL" lists in one file. Agent #7's 10 Nov PR says it preserves both sides under Side A/Side B and supersedes the file with `audit/FINAL_ACCURATE_LIST_2026-11-10.md`; that PR was **not open at session start**, so AI #2 did not duplicate the fix. | Agent #7 / lead; lead decision pending on a CI guard for conflict markers (issue #599 suggestion), not implemented here. |
| **#161** chained rule overrides depend on array order | **Still in source**: `src/lib/rules/rules.ts:80` still has `rule.combine === 'override' && !off.has(rule.id)`. | AI #1/#9 money lane; define precedence or reject ambiguous graphs. |
| **#519 / #518 / #517** US state return uses mutable/derived facts | **Still in source**: `src/lib/tax/usSalesTaxReturn.ts:60` reads `customer.metadata.taxPlace` (current), line 62 makes a defined non-US place produce `undefined` and drop the sale, line 57 resolves the seller from `doc.dimensions` rather than line labels. One shared invoice-snapshot primitive fixes all three. | AI #1/#9 money lane. |
| **#131** as-of stock mixes current quantities with historical balances | Open Stage-B scope: EG-7 stock snapshots in `CURRENT_WORK.md` "Stage B: ERPNext depth". | AI #1/#9. |
| **#130** stock revaluation without a ledger posting | Code fix merged (#259) but **ISS-130 migration still to be applied on Supabase** (`docs/FOR_YOU.md`); not in force on the live DB until then. | Owner deployment action. |
| **#150** umbrella independent-audit issue | Open by design; this list is a slice of it. | Lead. |
| **#132** trace product acquisition/cost/use | Idea / Stage B, not a defect. | Lead. |
| **#342, #274, #96, #141, #146, #160, #143** older screens/date/server items | Documented as fixed in code in earlier audits (civil-date helpers, #446 dialog work, bounded retry, `resolveStatementScope`, RMA server enforcement, ISS-160 equipment caller). **Not independently re-verified in this pass** — lead should spot-verify and close the stale ones. | Lead. |

## 4 · Bot comments under recent PRs — triage (not silently "resolved")

I swept every review comment by Codex, CodeRabbit, SonarQube, Copilot and Jules bots on PRs
**#569–#598**. Findings in AI #2's lane (#570) are fixed in §1. The rest are recorded with their
verified source state and owner; **I did not patch outside my lane**.

| PR | Bot finding | State at the pin / owner |
|---|---|---|
| **#569** (AI #4 payroll, merged) | Codex P1/P2 + CodeRabbit Major: 2026 IRS Pub 15-T brackets, Worksheet 1A adjustment, golden-test expectations, route-policy guard, icon-button a11y guard, 2025 source links. | Money/tax lane. Some 2026 thresholds are present at `usFederalPayroll.ts:165` (`3325000 / 205500`), but **no independent re-verification of every row** was done here; AI #1/#9 must close the P1s. Note its `audit/FINAL_ACCURATE_LIST_2026-11-08.md` is also the conflicted file in #599. |
| **#572** (fork PR, **CLOSED**) | 22 bot comments (errorTracker, layers-guard, a11y, MT940, ConnectionBanner…). | Closed, no code landed. No action on main. |
| **#573** (Sonar S8786 part 6) | Turkish `İ` offset drift from `toLowerCase()`. | **Fixed at source**: `src/lib/textShape.ts:344-345` uses ASCII-only lowering with an explicit `İ` comment. |
| **#577** (fork audit-doc integration) | CodeRabbit: AF-004 issue mappings, user limit, missing-rule explanation, deployment-protection wording. | Doc-only accuracy claims in audit files; Agent #7/#4 doc lane, not re-verified here. |
| **#582 → #593** (journal/grid) | Grid clipping, More-menu Escape, 44 px controls, summary removal, dark-mode contrast, dashboard period label, intent-resolver long-entry fallback. | #593 was the lead's own review-fix PR. At the pin: the dashboard select is `aria-label="Period (dashboard date range)"` (includes the visible word — **#594 fixed**); `IntentResolver.resolveEntry` returns `null` for any line > `MAX_INTENT_LINE_LENGTH`, so the whole input reaches the fallback (**#592 fixed**); `PartyAgingReportView` sets `openerRef.current` in the row `onKeyDown` path (**#595's two opener findings fixed**); the transaction-row category uses `group-hover/active:text-[var(--surface)]`, the theme-aware inverse of `--text`, so the #593 white-on-light claim is **not reproduced at source level** (browser contrast not re-measured). |
| **#583** (Copilot security fix) | Helmet CSP in dev. | PR **CLOSED**, no code landed. |
| **#585** (stale-chunk reload) | P1 reload discards unsaved drafts; P2 reload loop when session storage throws. | **Still open at source**: `src/main.tsx:15` reloads without consulting unsaved-work guards; `src/lib/chunkReload.ts:22` catches storage errors but "still reload once". Lead-owned, not patched here. |
| **#586** (Sonar inventory) | "Archived utilities are not CI paths" wording. | Current `docs/verification/sonar-issues-2026-11-09.md:13` adds "(the llama probe has a CI regression test)" but still says "not CI paths"; partially clarified, lead-owned doc. |
| **#592** | See #582 row. | Fixed at source (whole-input fallback). |
| **#595** (AI #3 batch) | 10 comments: drawer opener (×2), print-PDF stub, passkey reopen, purchase-order failed-load skeleton, PDF preview, and four doc/evidence accuracy claims. | The two opener findings are fixed in code (see above). Remaining evidence/doc findings belong to AI #3 / lead; not re-verified here. |
| **#569, #573, #577, #582, #583, #585, #586, #590, #592, #593, #594, #595** | Sweep also covered #569–#598; PRs #569–#598 not listed above had **no unresolved actionable bot findings** at the pin. | — |

## 5 · Owner actions that still block launch (from `CURRENT_WORK.md` / `docs/FOR_YOU.md`, not code)

Paste the L-123 / ISS-130 migrations in Supabase · set `DATABASE_CA_CERT` in Vercel · rotate the
4 generated secrets · try live sign-up · deployment protection / email sender + provider · Stripe
last two steps · privacy papers · GitHub: require CI before merging to `main` (L-67). Stage B also
needs W11 source-total verification (AU-4), the W13 full stock browser journey and the ERPNext
repost/payment/period-close/stock-snapshot items (EG-1/2/3/7).

## 6 · What this pass did NOT do / limitations

- No money, posting, tax-rate, `src/server/**`, schema, migration, dependency or CI-workflow change.
- No local Postgres (`LF_TEST_DATABASE_URL`), no `npm run test:rules`, no coverage-gate run, no
  Chromium browser run, no fresh Sonar analysis. Those are CI's on this branch; the Sonar statement
  in §2 is a public-issues API query plus source verification.
- No edit to the conflicted `audit/FINAL_ACCURATE_LIST_2026-11-08.md` (#599) to avoid colliding
  with Agent #7's incoming PR, and no new file named `audit/FINAL_ACCURATE_LIST_2026-11-10.md`
  (that name is reserved by Agent #7's superseding list). This AI #2 file is intentionally distinct.
- The older 8 Nov list contains raw conflict markers and contradictory statuses; **it is not used
  as evidence here**.

## 7 · Final verdict

**AI #2's slice is FINAL at `dc40739`**: every bot finding on my PR #570 is answered in code with a
non-vacuous test, the historical CI/Sonar failure is explained with its merged fix, local gates are
green, and the branch has been pushed so nothing is lost. Branch CI status: recorded in the dated correction note at the bottom.
Stage A remains launch-ready; the open items above are owner actions and other agents' lanes.
