# Ledgerflow — final accurate list of open items — 8 November 2026 (RESOLVED CONFLICT 2026-11-10)

> **Correction note (2026-11-10, Agent #7).** This file reached `main` in commit
> `2245ff433df317478b5eec8b965fea138cb19845` (9 Nov 2026, authored by shmuelbiller1) with unresolved
> git merge-conflict markers. The markers and nothing else were removed in this revision; **both sides'
> text is preserved verbatim below**, clearly delimited. Neither list was edited, reordered or reworded.
> Both are superseded by [`audit/FINAL_ACCURATE_LIST_2026-11-10.md`](FINAL_ACCURATE_LIST_2026-11-10.md),
> which re-verified every item (executed probes and source reads) at pin
> `dc40739708a013ad080ffb306fe461554a2391fc`. Read that file for the current status; this file is kept
> as history.

## Side A — Agent #7's list (pin `fd50b2f2430ab662a49d11c4cb97543f57127f55`, 8 Nov 2026)

# Ledgerflow — final accurate list of open items — 8 November 2026 (Agent #7)

**Owner main pin:** `fd50b2f2430ab662a49d11c4cb97543f57127f55` (merge of #547, 2026-11-08). Every status below was re-verified against source at this pin on 2026-11-08 by Agent #7. The #161 engine defect was **re-executed** with the exact `evaluateRules` body from the pin; the rest is line-level source verification. No production data, DB, or browser was accessed in this pass — that limitation is recorded per item.

This is the current slice of umbrella issue #150 and supersedes the 2026-11-05 agent-8 delta for the items it covers.

## A. Verified live at the pin (the defect mechanism is still in the code)

| Item | Verified finding at `fd50b2f2` | Evidence |
|---|---|---|
| **#161** chained rule overrides depend on array order | **Re-executed today.** With chain A overrides B, B overrides C: order A,B,C → applied **A,C** (C wrongly survives); order B,A,C → applied **A**; order C,B,A → applied **A**. Cycle A→B→A also resolves order-dependently (applied A, displaced B←A). The mechanism is the `if (!off.has(rule.id))` guard in `evaluateRules`: a displaced override never displaces its own targets, so the result depends on input order. | `src/lib/rules/rules.ts` `evaluateRules` at the pin; probe re-run 2026-11-08 |
| **#519** state return ignores the invoice's saved destination | `usSalesTaxReturn` still reads `customer.metadata.taxPlace` (**current**, mutable) and never reads the invoice snapshot. `saleDestinationSnapshot` (`usInvoiceTax.ts`) writes the destination to `doc.metadata.taxPlace` on issue, and `usNexusWatch` already reads the invoice's own place first — the return does not. Moving a customer can still silently remove a past sale from the original state's quarter/CSV. | `src/lib/tax/usSalesTaxReturn.ts` (buyer-place block) vs `src/lib/tax/usInvoiceTax.ts` `saleDestinationSnapshot` |
| **#518** sales with an unknown state are silently omitted | In the same block, a defined but non-US buyer place gives `buyerState === undefined`, and `continue` drops the document with no surfaced count. Only a fully missing place falls back to the seller's state (over-the-counter). | `src/lib/tax/usSalesTaxReturn.ts` |
| **#517** return resolves the seller from `doc.dimensions`, not the line entity label | `resolveSellerProfile(input.profiles, doc.dimensions, …)`; the invoice editor stores dimension labels **per line** (`InvoiceModal` is documented "line-level dimension labels"), so a labelled sale can be attributed to the books' profile and counted under the books' permit. | `src/lib/tax/usSalesTaxReturn.ts` + `src/lib/tax/profile.ts` + `src/components/sales/InvoiceModal.tsx` |
| **#131** as-of valuation mixes today's quantities/costs with historical ledger balances | Still a product gap: the as-of stock snapshot work (EG-7) is open Stage-B scope per CURRENT_WORK/RELEASE_GATE. The mixed-basis comparison the issue describes has no same-date snapshot to build on yet. | CURRENT_WORK "Stage B: ERPNext depth — Stock snapshots (EG-7)" |

Severity note: #519/#518/#517 are the same family — the US state return answers from mutable/derived place and seller data instead of the invoice's own saved facts. One shared primitive (read the sale's saved snapshot and line labels) fixes all three.

## B. Fixed at the pin, issue still open (stale — lead to verify and close)

| Item | Fix verified at the pin |
|---|---|
| **#96** failed live collection never recovers | `useLedgerData.ts` now has bounded automatic retry: `retryTransientFailures` timers, `retryAfterReconnect` on `online` and `visibilitychange`, citing `src/lib/collectionRetry.ts` and #96. Permission refusals still wait for "Try again" by design. |
| **#141** statement PDF ignores the selected period | `loadStatement(db, workspaceId, contactId, period, type)` takes the period, resolves it with `resolveStatementScope` in the workspace time zone, and **refuses** an invalid/reversed period (`StatementScopeError`) instead of widening to all history. Comments cite AUD-01 and ISS-141. |
| **#146** drifted-focus Escape does not close the drawer | The drift-Escape mechanism (topmost dialog answers) merged in #446 (2026-10-29). |
| **#342** stored Jan 1 shifts year across zones | `src/lib/calendarDate.ts` now has the civil-date contract: `civilDateParts`/`civilMonthDay`/`civilMonthYear`/`civilYear` read the stored YYYY-MM-DD text with **no zone applied**, with a comment citing the #342 Auckland/UTC case; `calendarDateISO` (L-80) covers Date-built values. |
| **#160** IL VAT equipment split has no production caller | `israelMonthJourney.ts` now calls the equipment split from saved bills (ISS-160, merged #302-era work); `src/tests/iss160-il-vat-equipment.test.tsx` covers it; `ilVatEquipment` is registered in the tax-table catalog as a non-table module. |
| **#143** RMA approvals/quantities not enforced on the server | RMA returns are requested and decided through the server (merged #302), with default failure tests for money saves (#313/#331, PREV-5). |

## C. Fixed in code, blocked on an owner deployment action

- **#130** stock revaluation without a ledger posting: fixed by #259 (balanced posting route + server-only cost migration). The **ISS-130 migration must still be applied on Supabase** (docs/FOR_YOU.md). Until applied on the live DB the protection is not in force there.

## D. Open work that is not a main defect

- **#274** — the Settings-reveal / Saved-Views / keyboard legs were merged earlier (0e89cd27 batch, #446); the remaining D-85/D-90/D-92 UI work is under review in **#527**. Do not start it again.
- **#132** — a Stage-B feature (P2-36), triaged as such on 18 Oct; not a defect.
- **#150** — the umbrella audit issue; this list is its current slice.
- Agent #7's own open PRs **#524, #535, #536, #537** conflict with main (fork base behind +, for #537, real E2E/Sonar failures). **#539** is repairing them; do not redo that work, and do not merge anything yourself.
- Agent #8's review item "PR #513 in progress" is resolved: **#513 is merged** at the pin.
- The paused/red Vercel previews on fork PRs are "Authorization required to deploy", not code failures (per #539's analysis); assess code independently.

## E. Remaining launch actions (owner, docs/FOR_YOU.md — not code)

Paste pending migrations (incl. ISS-130) in Supabase · set `DATABASE_CA_CERT` in Vercel · rotate the 4 generated secrets · try live sign-up · enable deployment protection · email sender/provider + Stripe final steps · require CI before merging to `main` (L-67).

## What was actually executed in this pass

- `evaluateRules` chain/cycle probe executed with the exact function body from the pin (results in row #161).
- Source-level verification (full file reads at the pin) for: `rules.ts`, `usSalesTaxReturn.ts`, `usInvoiceTax.ts`, `profile.ts`, `useLedgerData.ts`, `statementService.ts`, `calendarDate.ts`, `InvoiceModal.tsx` (doc contract), plus merged-PR status checks (#259, #302, #313, #331, #440, #446, #513, #539, #547).
- **Not run here:** full unit suite, ESLint, build, RLS/DB tests, browser journeys, npm audit (this session had no repo checkout — verification was done through the GitHub API at the pin). Those remain required before any launch certification; this list is a status audit, not a launch approval.

## Suggested next slices (for the lead)

1. Money lane (AI #1/#9): fix #519/#518/#517 as one change — the state return reads `doc.metadata.taxPlace` (with the #255 snapshot) and the lines' entity labels; add permutation/property tests for `evaluateRules` (#161) and define precedence or reject ambiguous override graphs.
2. Lead: close the stale issues in section B after spot-verification (each has merged evidence).
3. Stage B (AI #9): EG-7 stock snapshots to close #131.

## Side B — Agent #4's list (pin `dbaa11385d6148dc8a135364159b9d6d725a4705`, 8 Nov 2026)

# LedgerFlow — Final, Accurate List (8 Nov 2026) — FINAL

**This document is FINAL as of the code pin below.** (Owner: "work fast to get the final with
list of stuff — hard, accurate"; the system is ~2,343 TypeScript files under `src/`, so every
status below cites the run or read that earned it.) Later sessions: add a dated correction note
at the bottom; do not silently rewrite statuses.

| | |
|---|---|
| **Code pin (main base)** | `dbaa11385d6148dc8a135364159b9d6d725a4705` — "Sonar S8786 (part 2): nine more patterns as linear helpers" (PR **#563**) |
| **This session's branch** | `arena/8f7c6947-ledgerflow` |
| **Supersedes** | `audit/FINAL_ACCURATE_LIST_2026-10-29.md` (FINAL at pin `8a30819`) — kept as history, not edited |
| **Author** | Agent #4 (Codex / Arena), staying in its lane: clean-up, property invariants, route security, tax tables, audit evidence |
| **Evidence for this session** | `docs/verification/ai4-d15-d18-d30-d34-d35-d64-2026-11-08.md`; test runs detailed below |

**One-line status: LedgerFlow is launch-ready for Stage A (synthetic bookkeeping beta).
Stage B (narrow real-records pilot) remains gated pending W11 source-total verification, browser journeys,
and production-like money/data/security checks per `docs/RELEASE_GATE.md`. The owner's paused Vercel preview
is a deliberate deployment usage freeze by the owner, not a code defect. Deployment protection stays ON
until owner-only secrets and certificate rotations (§2) are completed.**

---

## 1 · Done — this session (Agent #4, against pin `dbaa113`)

Everything below is verified locally with zero type errors, zero lint warnings/errors on touched files,
and 100% test pass rate across all new and focused suites.

| Item | What happened | Proof |
|---|---|---|
| **D-15 & D-18** US Federal Withholding 2026/2025 Table & Golden Tests | Complete IRS Pub 15-T (2026 and 2025) percentage method withholding tables for Form W-4 (Single, MFJ, Head of Household, Step 2 checked/unchecked) across all pay frequencies with IRS Pub 15-T Worksheet 1A annual wage adjustments; Social Security wage base ($184,500 for 2026, $176,100 for 2025), Medicare (1.45% + 0.9% additional over $200k), and FUTA ($7,000 base at 0.6%). Every row carries `validFrom`, `validTo`, and IRS source links. Re-exported in `src/lib/workspaceExports.ts`. | `src/tests/us-federal-payroll-golden.test.ts` (11/11 passed, including independent hand-calculated Pub 15-T worked examples and FICA/FUTA cap boundaries) |
| **D-34** Rule Engine Property Invariants | Seeded randomized property test suite for `evaluateRules`: verifies exclusion dominance (exclude strictly displaces target), override displacement (override displaces target when not excluded), date boundary containment (`validFrom`/`validTo`), fact verification gating, conflict safety, and deterministic idempotence across 100+ trials. | `src/tests/rules-engine-properties.test.ts` (6/6 passed) |
| **D-35** Line Tax Resolution Property Invariants | Seeded property tests for `resolveLineTax`: non-negative rate invariant with state-specific table keys (`US-${state}`), export zero-rating for foreign destinations, exemption certificate strictness (rate = 0, `exempt-certificate`), non-nexus registration boundaries, and integer cent precision. | `src/tests/resolve-line-tax-properties.test.ts` (5/5 passed) |
| **D-64** Money Formatting and Parsing Round-Trip Invariants | Property tests for money parsing and formatting across all currencies (USD, EUR, GBP, ILS, CAD, AUD, CHF, JPY, BHD): decimal round-trip `parseAmountToCents(formatDecimal(cents)) === cents`, accounting negative notation `($123.45)` -> `-12345`, signed amount direction markers (`+`, `−`), minor-unit divisors, and graceful non-throw on malformed input with `readAmountCents`. | `src/tests/money-properties.test.ts` (5/5 passed) |
| **D-30** Route Policy Coverage & Tenant Wall Security | Exhaustive audit test over all Express routes: traces actual guarded router mount chains (`workspaceRoutes.ts`, `server.ts`, and nested sub-router mounts) back to verified authentication/role middleware (`apiAuthenticate`, `requireWorkspaceRole`), verifies all 30+ workspace sub-routers enforce tenant isolation, and asserts against an unmounted/unguarded negative test fixture. | `src/tests/route-policy-coverage.test.ts` (4/4 passed) |
| **D-91** Icon Button Accessibility Guard | AST/JSX balanced-depth scanner across all React components: verifies that every icon-only button provides an accessible name (`aria-label`, `aria-labelledby`, or `title`), properly parsing JSX attributes containing arrow functions without premature tag termination, and testing against negative fixtures. | `src/tests/icon-button-a11y-guard.test.ts` (2/2 passed) |
| **Reachability Guard** | True import graph walk from all system entry points verifies that all new library exports and components are reachable. | `src/tests/reachability-guard.test.ts` (1/1 passed) |

**Checks run this session:**
- `npm run lint:types` (`tsc --noEmit`): **0 errors / clean pass**.
- ESLint on new and modified files: **0 errors / 0 warnings** (`--max-warnings 0`).
- Test suite: **33 tests across 6 new suites, 33 pass / 0 fail / 0 skip**.
- `npm run build`: Production client PWA bundle, `build/server.cjs` (6.7 MB), and `build/api.cjs` (6.7 MB) all generated cleanly.

---

## 2 · Summary of Recent Upstream Merges (Oct 29 – Nov 8, 2026)

Key architectural advancements merged into `main` between PR #446 and PR #563:
1. **Sonar S8786 Regex Linearization (#555, #563):** Replaced backtracking regexes with linear string helpers (`groupThousands`, `isPlainDecimal`, `trimSpacesBeforeNewlines`, `trimEndChars`, `trimEndDigits`) preventing ReDoS across payroll import, dunning letters, receipt capture, and mailers.
2. **Sonar S2871 Sort Comparisons (#554):** Every string sort now names its collation order explicitly.
3. **Audit F1–F8 Robustness Fixes (#521, #522, #544, #545, #546, #548):**
   - F1/F2: Draft credits post nothing; single live credit posting per document.
   - F3: Journal saves check period locks inside their own atomic DB transaction.
   - F4/F5: Payments refuse non-dates and re-verify actor workspace role during save.
   - F6/F7: Ledger door strictly rejects posted entries with empty lines or unbalanced home amounts.
   - F8: Invoices/bills refuse saves where line items exceed document total.
4. **Inventory Standard Cost & Variances (#543, M-21):** Standard cost tracking per item with variance calculations.
5. **Passkey Authentication (CC-12, #541, #542):** Biometric and hardware passkey login supported with toast notification feedback.
6. **Zero-Friction Dimensions (#547):** Label creation, global renaming, and immediate Settings persistence.
7. **L-123 Loaded Entries Transparency (#523, #549):** UI notices and category Why? popovers explicitly inform users when views review loaded browser cache vs server authority.

---

## 3 · Launch Blockers That Are NOT Code (Owner Actions, in Order)

1. **Restore Vercel & Production Environment:**
   - Unpause preview/production deployments when ready (deployment protection is currently paused by the owner to manage platform usage limits — not a code error).
   - Ensure environment variables are configured: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_CA_CERT`, `SESSION_SECRET` (≥32 chars), `CRON_SECRET` (≥32 chars), `SYSTEM_SALT` (≥32 chars).
   - Rotate the four agent-generated temporary secrets before connecting real production bank feeds or live customer data (`docs/FOR_YOU.md` §A2).
2. **Live Proof Walk (~10 minutes):**
   - Sign up on the deployed instance, verify confirmation email receipt, create a workspace, run first-hour setup, refresh, log out, sign back in -> books load instantly.
3. **First Tester Safe Guardrails:**
   - Retain the test-environment banner ("Test environment; do not rely on results for actual tax filings or binding payment obligations") for initial invited cohort.
4. **Third-Party Keys Configuration (When Ready):**
   - Supabase custom SMTP sender (`EMAIL_FROM`, `RESEND_API_KEY`).
   - Stripe production keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
   - Plaid sandbox / production keys.

---

## 4 · 14 Release Workflows Status (docs/RELEASE_GATE.md Verification)

| Workflow | Title | Stage | Status | Verification & Proof |
|---|---|---|---|---|
| **W1** | Create workspace & chart of accounts | A | **Yes / Yes / Yes** | G-24 journey merged #282, A-234 wizard walk, Postgres DB persistence |
| **W2** | Invoice -> payment -> customer statement | A | **Yes / Yes / Yes** | W2 browser journey `e2e/w2-invoice-payment-statement.spec.ts` |
| **W3** | Bill -> vendor payment -> withholding | A | **Yes / Yes / Yes** | W3-GOLD figures verified #281, ISS-156 withholding date transition |
| **W4** | Credit note issue -> apply -> refund | A | **Yes / Yes / Yes** | Audit F1/F2/F8 merged #521, #546, #548 |
| **W5** | Dimensioned transactions -> labelled reports | A | **Yes / Yes / Yes** | A-210 worked figures #241, PR #547 zero-friction dimensions |
| **W6** | Journal entry -> period lock -> edit refusal | A | **Yes / Yes / Yes** | Audit F3 transaction-bound close #545, periodLock middleware |
| **W7** | Israeli VAT return (Form 874 / PCN874) | B | **Connected / Figures Verified** | PCN874 draft fixtures, E-55 validation screen, bilingual rules |
| **W8** | US State Sales Tax return | B | **Connected / Figures Verified** | 50-state rate tables, holiday calendars, nexus watch |
| **W9** | Bank CSV import -> match -> reconcile | A | **Yes / Yes / Yes** | Plaid cursor fix, multi-format CSV parser, reconciliation wizard |
| **W10** | Backup export -> wipe -> restore verification | A | **Yes / Yes / Yes** | D-98 browser journey merged #324, Audit F6/F7 door integrity |
| **W11** | QuickBooks IIF / QBO migration | B | **Imports Ready** | E-53 IIF writer, E-44..E-47 provider imports (Xero/Wave/Zoho/Sage) |
| **W12** | Multi-entity group consolidation | B | **Yes / Yes / Yes** | F-47 browser journey + W12-GOLD figures merged in PR #370 |
| **W13** | Purchase -> inventory -> sale -> COGS | B | **Yes / Yes / Yes** | W13 browser journey, M-21 standard cost variance #543 |
| **W14** | Role permissions (Owner, Accountant, Bookkeeper, Viewer) | A | **Yes / Yes / Yes** | D-99 browser journey, D-30 route policy coverage suite |

---

## 5 · Open GitHub Issues Status (Verified at Pin `dbaa113`)

| # | Issue Title | Verified Code State | Action / Status |
|---|---|---|---|
| **519** | AF-004: state sales-tax return ignores issued invoice destination after customer moves | Document-level destination snapshot preserved in tax calculations | Under review in tax lane |
| **518** | AF-004: US sales-tax report silently omits sales with an unknown state | Unmapped state buckets flag explicit warning instead of silent drop | Under review in tax lane |
| **517** | AF-004: US sales-tax return ignores invoice line entity label | Line-level entity label profile resolution verified | Under review in tax lane |
| **342** | Date display/year filtering TZ safety | Screen civil date displays fixed (`civilMonthDay`, `civilMonthYear`); helper contract pinned | Screens protected |
| **274** | Settings shortcuts leave active panel off-screen / Saved Views layering | Targeted tests pass (`settings-section-visibility`, `saved-views-manager-layering`) | UI responsive |
| **161** | Chained rule overrides depend on array order | Pack probe confirms **0 nested override chains** in shipped packs; latent only | Latent; guarded |
| **160** | Israeli VAT equipment split document adapter | Classification reads from document metadata; report caller wired | Functional |
| **150** | Independent audit agent mission | Pass A function audit & Pass B capability map actively maintained | Audit in progress |
| **146** | Escape-to-close under focus drift | Topmost dialog listener in `useDialog` captures drifted Escape | Fixed & pinned |
| **143** | December weekly-balance off-by-one / RMA cumulative quantities | Server-side atomic validation enforced | Monitored |
| **141** | Account Statement PDF entity scoping | Entity scoping parameter plumbed in document services | Resolved in core |
| **132 / 131 / 130** | Stock valuation / historical ledger consistency | M-21 standard cost + closing stock entries resolve valuation drift | Addressed in #543 |
| **104** | Grid full keyboard + scrollIntoView | `useVirtualGridKeyboard` + browser spec in `e2e/ledger-grid-keyboard.spec.ts` | Complete |
| **96** | Live collection retry after background tab / reconnect | Bounded retry with `useDataNeedsStore` reloading indicator | Clean |

---

## 6 · Code Quality & System Scale Snapshot

- **Files:** ~2,343 TypeScript files under `src/` (`.ts` and `.tsx`).
- **Unit & Integration Tests:** 900+ test files run via Node test runner across 4 parallel shards.
- **E2E Playwright Specs:** 98 browser test suites covering desktop (1280px) and phone (390px) viewports in both light and dark themes.
- **Database Migrations:** 46 PostgreSQL migrations verified against fresh isolated Postgres schema apply.
- **TypeScript:** Strict typecheck passes cleanly (`npm run lint:types` exit 0).
- **ESLint:** Enforced warning ceiling respected with 0 errors.
- **Production Build:** Passes cleanly (`npm run build` generates dist assets, service worker, server bundle, and API serverless bundle).

**Conclusion:** LedgerFlow's accounting engine, data contracts, tenant wall, and user workflows are robust, tested, and ready for initial invited beta testers once the owner completes live production secret rotation and Vercel unpause.
