# The accurate list — what is actually left before launch (2026-10-25)

**Status: FINAL for this audit pass.** Every open GitHub issue, every release-gate workflow row and every
"ready/merged" claim I could reach was checked against the code at one pinned revision, and the checks that
can be executed in this environment were executed. The only gaps are named in §7: browser journeys (no
Chromium in this sandbox; the download is blocked) and the live deployment's configuration.

- **Pinned revision:** `50ee1205d9049d7c225beb433bcb3dff75b77be9` (`upstream/main`, 2026-10-25 21:01 UTC).
  Audit branch `arena/caef0461-ledgerflow` = that pin + a merge commit `c702476d` + this audit's documents.
- **Reviewer:** AI #8, independent audit (review-only: no posting, money, migration or server code changed).
- **Mission:** [`docs/INDEPENDENT_AUDIT_AGENT.md`](../docs/INDEPENDENT_AUDIT_AGENT.md), umbrella issue
  [#150](https://github.com/shmuelbiller1/ledgerflow/issues/150).
- **Function-level ledger:** [`function-audit/SCORECARD.md`](function-audit/SCORECARD.md).

---

## 1. What actually blocks the synthetic beta (stage A) today

Everything else in stage A was verified at the pin (see §5). These are the real gaps:

| # | Item | Why it blocks | Evidence |
|---|---|---|---|
| A1 | **There is no "test environment" banner in the app.** Gate **G-05** ("test records and real customer records cannot be confused — clear sandbox banner") is recorded as **PASSED** in `docs/archive/audit/FIRST_TESTERS_READINESS.md`; the code has no such banner. | Invited synthetic testers are the product's first promise; without the banner a tester can mistake a sandbox for their real books. | `grep -rni "test environment\|sandbox mode" src --include=*.tsx` → only a `localStorage` key `ledgerflow_use_sandbox_mode` that is *removed* on logout (`src/App.tsx:266,281,307`, `src/hooks/useSystemActions.ts:22`). The guest sample picker (`GuestCountrySamplePicker.tsx`, `canUseDemoSandbox`) is the only demo guard. **Decide:** add the banner (small, AI #3 UI lane) or record that stage A runs without it and put the warning in the invitation text. |
| A2 | **Owner actions in Vercel/Supabase** (not code): rotate `SESSION_SECRET`, `INVITE_SECRET`, `CRON_SECRET`, `SYSTEM_SALT`; set `DATABASE_CA_CERT`; turn deployment protection off for invited testers; set a real email sender; try sign-up on the live site. Keep Stripe on **test keys** for the synthetic beta (online invoice payment is reachable from an invoice). | Invitations cannot be sent to a site nobody can open, and the DB certificate check (AUD-20) is off until the certificate is set. | `docs/FOR_YOU.md` items 2–8; `docs/archive/audit/FIRST_TESTERS_READINESS.md` Cohort B. |
| A3 | **Confirm three migrations are applied** on Supabase: `20261020120000_inventory_cost_server_only.sql`, `20261021010000_inventory_cost_editable_at_zero.sql`, `20261022000000_rma_server_only.sql`. Every other migration (`…period_balances`, `…repost_queue`, `…report_preferences`, `…period_closings`, `…stock_closings`, `…payment_allocations`) is recorded as applied by Claude on 24–25 Oct. | Until these three are applied the app still works, but a browser can write stock cost and RMA approvals *around* the server checks (integrity + approval history). | `docs/FOR_YOU.md` lines 477–496 ("the connector timed out … may or may not be applied"), 539–576 (the rest: "applied"). |
| A4 | **Known defect #342 (below, AF-011), not fixed.** | A January 1 document is counted in the *previous* year on the tax screen whenever the user's device time zone differs from the workspace's. For a synthetic beta this is a wrong number a tester will report, not a data loss. **Decide:** fix before inviting (small, shared helper) or put it in the tester note as a known issue. | §2, AF-011. |

**Not** on this list, because it was verified working at the pin: the nine stage-A workflows, the posting
and reports maths, roles/RLS, backup/restore, close/reopen (see §5). And the Vercel preview being red is the
owner's paused preview, not a code failure.

---

## 2. Verified open defects at this pin (the accurate defect list)

| ID | Sev | What is wrong | Executed evidence at the pin | Lane | Blocks |
|---|---|---|---|---|---|
| **AF-001** = [#151](https://github.com/shmuelbiller1/ledgerflow/issues/151) | P1 (P0 mechanism) | `POST /plaid/sync` advances `syncCursor` without writing any `bankLines`; both clients ignore `transactions/modified/removed`; a healthy zero-change sync answers `success:false`; the legacy importer hardcodes `accountId:'offset-bank'`. | `src/tests/audit-af001-plaid-contract.test.ts` 4/4 — pins cursor advancement inside the route, zero `bankLines` references in the router, no payload consumer on either client. | AI #1 (server) | **Stage B**, gate **G-10**. Not reachable in stage A (no real bank credentials). |
| **AF-011** = [#342](https://github.com/shmuelbiller1/ledgerflow/issues/342) | **P1** | `parseLocalDate` returns a "workspace-midnight as a device instant"; `formatDate` then prints device-local fields → a stored `2026-01-01` displays as `2025-12-31` and `TaxManager.tsx:200` files it in **2025**, whenever the workspace zone is ahead of the device zone (e.g. Israeli book on a US laptop). | `TZ=UTC npx tsx audit/function-audit/probes/af011-date-contracts.mjs` → Auckland/Jerusalem/Tokyo shift, UTC/NY/LA don't; with `TZ=America/New_York` the Israeli workspace shifts. Nine components import the parser. Full detail: [`function-audit/AF-011-civil-date-contracts.md`](function-audit/AF-011-civil-date-contracts.md). | AI #1 (shared helper) | Wrong year/date on screens; **no** stored/posted change. Fix or document before inviting (A4). |
| **AF-012** = [#161](https://github.com/shmuelbiller1/ledgerflow/issues/161) | P2 latent | Override chains depend on array order: with A overrides B, B overrides C, C accumulates, `[A,B,C]` applies A+C, `[B,A,C]` applies only A, and a displaced rule keeps its displacement. Nothing in `lintRules` refuses a chain or a cycle. | `npx tsx audit/function-audit/probes/af012-rule-chain-order.mjs` → three orders, three answers. Shipped packs were scanned: **no** override currently targets another override, so no live tax figure is wrong today. [`AF-012-rule-override-chains.md`](function-audit/AF-012-rule-override-chains.md). | AI #9 (rules engine) | Nothing today; a future pack can make it a wrong rate. |
| **AF-013** = [#104](https://github.com/shmuelbiller1/ledgerflow/issues/104) | P2 | Ledger grid keeps a logical `focusedCell` but the virtual list has **no ref / `scrollToItem`**, and `ArrowDown` does `Math.min(length-1, index+1)` then `transactionsWithBalance[nextIndex].id` — with zero rows after a filter that is `[-1].id` (**TypeError**). Tab is `preventDefault`ed on a window-level listener. | Source at the pin: `TransactionGrid.tsx:92, 286–335` (`window.addEventListener('keydown')` line 333), no `scrollToItem` in `TransactionGrid*.tsx`. Browser reproduction **not** executed here (§7). | AI #3 (screens) | Accessibility claim **G-07**; not a financial defect. |
| **AF-014** = [#96](https://github.com/shmuelbiller1/ledgerflow/issues/96) | P2 | A lazily loaded collection whose live subscription fails stays failed until a person presses **Try again**: no `online`/`visibilitychange` retry in `useDataNeedsStore` (only `retry(key)`), and `useLedgerData` has no recovery hook. | `src/stores/useDataNeedsStore.ts` (grep: only `retry`), `src/hooks/useLedgerData.ts` (no online/visibility), `retry()` reached only from `DataStatusBar.tsx:58`, `AuditEvidencePackPanel.tsx:163`, `useAccessReview.ts:116`. Browser reproduction **not** executed here. | AI #2/AI #3 | A stale screen until manual retry; **G-03/G-06** honesty of the error state. |
| **AF-010-F1…F7** (this audit, earlier slices) | P2 ×3, P3 ×4 | Two `allocateCents` with opposite contracts; `utils.parseAmountToCents` drops the sign of `(100)`, throws on malformed text, ignores non-Latin digits; CSV formula guard bypassed by a leading space; `formatDecimal(Infinity)`; expression evaluator loses exact cents above 2^53. | `src/tests/audit-af010-*.test.ts` 12/12 (re-run at this pin: 27/27 across the six audit suites). | AI #1 | Reachable only through unusual input; no report is silently wrong on normal data. |
| **AF-002-F1** | P2 latent | The invoice/bill template drops non-positive tax/discount legs, so a call with negatives would post an unbalanced entry (the `amount <= 0` posting guards currently block it). | `src/tests/audit-af002-label-cents.test.ts` (in the 27/27). | AI #1 | Nothing reachable today. |
| [#160](https://github.com/shmuelbiller1/ledgerflow/issues/160) | P2 | The Israeli equipment input-VAT split now reads `metadata.fixedAsset` from saved documents (`israelMonthJourney.ts:307`) and `metadata` exists on the document models — but **no screen or import sets it**, so the split cannot be produced by a normal user. | Source scan: `fixedAsset` appears in reports/tests/fixtures only; no component writes it. | AI #9/AI #1 | **Stage C (W7)** only; W7 is not a stage-A/B row. |
| **AF-015** (this audit) | **P3** | The **P&L** route serves a cached answer **before** the workspace-membership check (`reportRoutes.ts:108–110`; every other report route calls `authorizeWorkspace` first, e.g. the balance sheet at `:141`). The cache key includes the user id, so nothing leaks between users; the gap is only "a user removed from a workspace can still read the report they fetched in the last 60 s". | Source: `getCacheKey` hashes `{path, query, body, user, snapshot}` (`:49`), `REPORT_CACHE` TTL 60 s (`:36–37`), P&L handler lines 101–124 vs balance sheet 134–143. | AI #1 | A one-line fix (authorize before the cache read); no financial figure. |
| [#274](https://github.com/shmuelbiller1/ledgerflow/issues/274), [#146](https://github.com/shmuelbiller1/ledgerflow/issues/146) | P2 | UI layout (settings shortcut panel off-screen, saved-views layering, loading flashes) and a flaky nested-drawer Escape. | **Not verified here** — browser-only, no Chromium in this environment (§7). | AI #3/AI #4 | Polish; no data risk. |
| [#132](https://github.com/shmuelbiller1/ledgerflow/issues/132) | — | A **feature idea** (trace product acquisition → cost → final use), not a defect. | — | backlog | Nothing. |

---

## 3. Issues that are actually fixed at this pin (they can be closed)

Each of these still shows **open** on GitHub, but the fix and its test are on `main` at the pin and the test
passes here against a real Postgres:

| Issue | What was fixed | Test executed at this pin |
|---|---|---|
| [#141](https://github.com/shmuelbiller1/ledgerflow/issues/141) A-72/AUD-01 | The statement **PDF** now takes the screen's period: `downloadDocumentPdf(..., scope)`, `documentRoutes.ts:156` reads `startDate`/`endDate` into `loadStatement`, and the service resolves one scope for screen, JSON and PDF. An **entity**-scoped PDF is deliberately refused: the PDF button is replaced by a note while an entity is chosen (`StatementView.tsx:145`). | `aud01-statement-scope.test.tsx` hits the PDF route with `&startDate=2026-04-01&endDate=2026-06-30` and asserts ending 400.00 (vs 1,390.00 all-history); `statement-by-entity.test.ts` 13 cases. Both in the 51/51 run below. |
| [#143](https://github.com/shmuelbiller1/ledgerflow/issues/143) ISS-143 | RMAs are requested/decided only through `POST /api/v1/workspaces/:ws/return-authorizations` (`returnAuthorizationService.ts`, role from membership, no self-approval, cumulative quantity, expected-status compare, one transaction), and a database trigger (`20261022000000_rma_server_only.sql`) refuses **every** browser path that writes `metadata.returnAuthorizationsById`. | `iss143-rma-server.test.ts` **5/5** against the real database (roles, self-approval, quantities, idempotency, cross-workspace). |
| [#130](https://github.com/shmuelbiller1/ledgerflow/issues/130) ISS-130 | A stock cost change posts a balanced revaluation entry; the browser cannot change the cost of stock on hand (screen lock + `inventory_cost_server_only` migration); retries are idempotent; locked periods refused. | `iss130-stock-revaluation.test.ts` — worked figures (10 × 10.00 → 12.00 = +20.00, half units +0.03), refusals, retry. Passed in the 51/51 run. |
| [#131](https://github.com/shmuelbiller1/ledgerflow/issues/131) ISS-131 | Inventory valuation **as of a date** reads stock history (not today's quantity) and says **Unknown** with a reason instead of guessing; the comparison with the books is suppressed when an item is unknown. | `iss131-inventory-as-of.test.tsx` — as of 30 Sep 10 × $10.00 = $100.00 (never today's 20 × $15.00), unknown handling, backdated move. Passed in the 51/51 run. |
| **AU-4** (W11, screen side) | Import acceptance **is** built: `src/lib/importAcceptance.ts` + `ImportAcceptanceView` (Reports → Import Acceptance) compares the source trial balance account by account and the A/R, A/P, cash and tax-payable totals, naming every difference. `docs/COORDINATION.md` already ticks it; `docs/RELEASE_GATE.md` W11 still says "Verified: No". | `au4-import-acceptance.test.tsx` (worked figures and refusal cases) — in the 51/51 run. |

**Still genuinely open for W11:** a browser journey and a real QuickBooks export as the source file (E-57),
plus the server-side check if the owner wants the comparison to run without a pasted file. That is a
**stage B** requirement, not stage A.

### In flight (open PRs, not in `main`, so not in any status above)

| PR | What | State |
|---|---|---|
| [#386](https://github.com/shmuelbiller1/ledgerflow/pull/386) | AI #7: W2/W3/W4/W6/W9 browser journeys and stability batch | **OPEN, mergeable = CONFLICTING**; needs a rebase/merge of `main` and a review decision |
| [#387](https://github.com/shmuelbiller1/ledgerflow/pull/387) | AI #7: the standalone W2 journey | OPEN, overlaps #386 |

Specs with those names already exist on `main` (`e2e/w2-invoice-payment-statement.spec.ts`,
`w3-bill-payment-run-statement`, `w4-bank-csv-import-reconcile`, `w6-order-deposit-part-invoices`,
`w9-sealed-period-reopen`). Whoever reviews them must decide whether they add coverage or duplicate the
existing journeys; until merged they are not part of any gate.

---

## 4. Where the documents disagree with the code (correct the documents, not the code)

| Document says | Code at the pin says | Action |
|---|---|---|
| `docs/archive/audit/FIRST_TESTERS_READINESS.md`: **G-05 PASSED** — "Test environment banner active in sandbox mode". | No banner exists anywhere in `src/` (only a removed `localStorage` key). | Add the banner or change the row to **Unverified/Blocked** (§1 A1). |
| Same file: **G-01, G-03, G-06, G-07, G-08 PASSED**, with code/test-level evidence. | The gate definition demands an authenticated browser/production check; only **G-04** (RLS) was executed as specified. | Mark those rows "not yet demonstrated as the gate requires" unless the browser evidence is linked with a commit. |
| `docs/archive/audit/AUDIT_PROGRESS.md`: DB-gated suites not run. | Now run (this audit, §5) — first time in this environment. | Keep, and point to §5. |
| `docs/RELEASE_GATE.md` W11: Connected "Partly", Verified "No". | Screen + library + tests exist (AU-4). | Connected **Yes**; Verified **Yes (screen + worked figures)**; Browser **No**. |
| `docs/RELEASE_GATE.md` W13: Browser **Yes**. | Journey spec exists (`e2e/w13-stock-journey.spec.ts`) and AI #4's integrated Postgres journey is recorded as *awaiting review*. | Keep "Yes" only if the CI run is linked; otherwise "Yes (CI, review pending)". |
| `docs/COORDINATION.md` ticks AU-4 "[x] merged #292". | True for the screen; the gate row is the stale one. | Ticked row is right; fix W11 (§ above). |
| `docs/archive/audit/FIRST_TESTERS_READINESS.md`: BUG-03 fixed by "a mandatory `Idempotency-Key`". | The header is **optional** (`documentPostRoutes.ts:41`); the safety property comes from **INT-2** — a second live posting of the same document is refused inside the commit (`ledgerBulkCommit.ts:231`, and the same for bills and payments). So no document can post twice; only the wording is wrong. | Reword to "idempotency key optional; one live posting per document enforced at commit". |
| `docs/FOR_YOU.md`: three migrations "may or may not be applied". | Everything else is applied; those three guard stock cost and RMA writes. | Confirm and tick (§1 A3). |
| `audit/function-audit/SCORECARD.md` pinned at `8df972da`, 67 functions. | 85 commits have landed since; this pass re-pins and adds the executed DB evidence. | Updated in this branch. |

---

## 5. What was executed at this pin (the evidence behind the list)

Local **Postgres 18.4** (embedded npm distribution) with `supabase/tests/plain-postgres-stub.sql` and **all 45
migrations** applied by `npm run db:test-setup`; `LF_TEST_DATABASE_URL` set for every suite below.

| Check | Command | Result |
|---|---|---|
| Type check | `npm run lint:types` | **0 errors** |
| ESLint | `npm run lint:eslint` (`--max-warnings 105`) | **0 errors, 61 warnings** |
| Database rules | `npm run test:rules` | **ALL RLS TESTS PASSED** |
| Release-gate worked figures (DB) | `w1-gold`, `w3w4-gold`, `w7-gold`, `w8-gold`, `w12-gold`, `w13-gold` | **31 tests, 31 pass** — these **skip** without a database, which is why earlier audits could not see them |
| Statement scope, entities, stock, AU-4 (DB) | `aud01-statement-scope`, `statement-by-entity`, `iss130-stock-revaluation`, `iss131-inventory-as-of`, `au4-import-acceptance` | **51 tests, 51 pass** |
| RMA server (DB) | `iss143-rma-server` | **5 tests, 5 pass** |
| EG-2 payment ledger, void, credits/write-offs (DB) | `eg2-payment-ledger`, `eg2-payment-void`, `eg2-credits-writeoffs`, `eg2-client-void-retired` | **29 tests, 29 pass** |
| This audit's own suites | `audit-af001-plaid-contract`, `audit-af002-label-cents`, `audit-af010-*` (6 files) | **27 tests, 27 pass** |
| Probes | `audit/function-audit/probes/af011-date-contracts.mjs`, `af012-rule-chain-order.mjs`, `af012-shipped-pack-chains.mjs` | reproduce #342 and #161 and measure the 584 shipped rules (outputs in the AF documents) |
| Production build | `npm run build` | **exit 0** (client bundle + `build/server.cjs`) |
| Bug-pattern scanner | `npx tsx scripts/bug-patterns.ts` | every count at or below its baseline (swallowing-action 95/96, success-after-call 12/12, unchecked-write 2/2, write-in-loop 10/13, stale-async 79/81, silent-catch 53/54, effect-before-write 0/0) |
| Code atlas | `node scripts/code-atlas.mjs stats` | runs clean |
| **Whole unit suite with the database** | 4 shards (`--test-shard=n/4`, all `src/tests`, `src/lib`, `src/server/utils`) | **4,616 tests · 904 suites · 4,616 pass · 0 fail · 0 skipped** (every shard exit 0). The zero skip count is the point: the database-gated suites executed instead of being skipped. |

Stage-A **browser** column: the nine journeys exist as specs (`e2e/journeys-w1`, `w2-invoice-payment-statement`,
`w3-bill-payment-run-statement`, `w4-bank-csv-import-reconcile`, `w5-labels-reports-journey`,
`w6-order-deposit-part-invoices`, `w9-sealed-period-reopen`, `w10-backup-restore-reports`,
`w14-roles-access`) and their PRs record CI runs. They were **not re-executed here**: no Chromium is
installable in this sandbox (playwright's CDN is blocked; a static Chromium build fails on missing
`libnspr4/libnss3`). That is the one gate layer this pass cannot independently confirm.

---

## 6. Stage B / stage C — real, but not launch blockers for the synthetic beta

- **W11 (imports):** a browser journey over a real QuickBooks export and the E-57 server-side proof (§3).
- **W13 (stock):** AI #4's integrated Postgres journey is awaiting review; landed cost is a preview only
  (BF-04) and full lot/FIFO costing waits for the owner.
- **ERPNext depth, from the source at the pin:** the payment ledger (EG-2) writes immutable
  `paymentAllocations` rows in the settlement transaction (steps 1–2; `amountPaidCents` keeps its additive
  update "until the cutover after step 3"); backdated changes are *marked* in `repostQueue` (EG-1 step 1) but
  nothing recomputes them yet; period and stock closings write snapshots (EG-3/EG-7); credit limit is
  enforced server-side (EG-5). None of this is missing from stage A; all of it matters before a real-records
  pilot promises "corrections repair themselves".
- **Tax automation (W7/W8)** and payroll processing remain stage C by the owner's decision; their screens
  say "calculation — check before filing". W7's equipment split has one open gap (#160).
- **Israeli allocation numbers** (a legal requirement for a real tax invoice) remain a stage-B gate.
- **AF-001** must be closed before any real bank connection (gate G-10).

---

## 7. Limits of this report (read before quoting it)

1. **No browser execution here** (no Chromium available; download blocked). Every "Browser: Yes" claim is
   taken from the repository's own CI evidence, not re-run. #104, #96, #146 and #274 stay
   `needs-reproduction` until a browser run names the commit.
2. **The live deployment was not inspected.** Vercel/Supabase settings, applied migrations and secrets are
   the owner's items (§1 A2/A3); the repository cannot prove them.
3. **Tests written by the fixing lane are evidence, not proof.** For #141/#143/#130/#131/AU-4 I read the fix
   *and* ran the tests; where a test could have been written to match a wrong behaviour I say so in the AF
   documents.
4. **Coverage is honest, not complete:** see the SCORECARD for how many functions were read out of the
   inventory. Indexing is not review.
5. Nothing in this audit changed money, posting, tax, stock, migrations or `src/server/`.

---

## 8. One-paragraph answer for the owner

The nine stage-A workflows are real at `50ee1205`: their worked-figure tests pass against a real Postgres
(31/31), the statement/stock/AU-4/RMA checks pass (51/51 and 5/5), RLS passes, types are clean and the suite
is green (4,616 tests with a real database, 0 failed, 0 skipped). Five GitHub issues that are still open are actually fixed and should be closed (#141, #143, #130,
#131, AU-4). What is genuinely left before inviting synthetic testers: **the sandbox banner (missing), your
Vercel/Supabase actions, three migration confirmations, and a decision on the date/time-zone bug #342**
(wrong year on the tax screen for users whose laptop zone differs from the book's). Real-books launch (stage
B) additionally needs the bank-sync durability fix (#151) and a browser import journey.
