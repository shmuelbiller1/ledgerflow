# AI #7 — F-41…F-45 Browser journeys for W2, W3, W4, W6, W9 (19 Oct 2026)

## What

Five end-to-end browser journey tests in `e2e/journeys-w2-w9.spec.ts`, each with
hand-worked figures and an accessibility check. They run on the real views the
user reaches (StatementView, Reconciliation, salesOrders library, MonthEndCloseView),
mounted against the app's own stores with stubbed request boundaries — so they
test the screen and its figures, not a live DB or bank feed.

| Task | Workflow | Worked figures | Test | What it checks |
|---|---|---|---|---|
| **F-41** | W2 Invoice → payment → customer statement | Invoice INV-1001 $1,000.00 (100000), payment $600.00 (60000) → outstanding $400.00 (40000) — 05 May invoice, 20 May payment, statement 01–31 May | `F-41 W2 browser: invoice $1,000 …` | StatementView shows Acme Corp, billed 1,000, paid 600, outstanding 400, invoice + payment rows, running balances |
| **F-42** | W3 Bill → payment → vendor statement | Bill B-77 $250.00 (25000), payment $250.00 fully paid → outstanding $0 | `F-42 W3 browser …` | Vendor Statement toggle, Office Depot, B-77 + Payment rows, outstanding 0.00 |
| **F-43** | W4 Bank CSV import → match → reconciled | Checking 1000; t1 $500 Acme, t2 $1,200 rent; bank lines b1 $500, b2 $-1,200; matched history 1 already | `F-43 W4 browser …` | Reconciliation shows pending lines + uncleared entries, Match found, hand-match sends correct `updateBankLine` + `updateTransaction`, Auto Align exists |
| **F-44** | W6 Order 25 % deposit → part invoices → delivery once (DEP-1) | Order EST-1 1,100.00 = 1,000 goods + 100 delivery; p1 25 % = 275.00 (goods 250.00 + delivery 25.00), p2 rest = 825.00 (goods 750.00 + delivery 75.00) → total 1,100, delivery charged once (10,000 cents); a 900.00 part against 825.00 left refused | `F-44 W6 browser …` | **the real `OrderInvoiceDialog`**: preview lines and Create buttons for both parts, the created parts `{mode:'percent',percent:25}` then `{mode:'rest'}`, both invoices 27,500 + 82,500 = 110,000 with delivery 10,000 once, the 900.00 part refused with "That is more than is left to invoice", and "Nothing is left to invoice on this order" once exhausted |
| **F-45** | W9 Close → posting refused → reopen | September 2026, clean month (nothing open, no drafts, no bank lines), hard close through 2026-09-30 | `F-45 W9 browser …` | 5 of 9 steps done, Close 2026-09 POST {mode: hard}, status "Closed: nobody can post", **the shared `postingLock` rule refuses 2026-09-25 (hard, through 2026-09-30)**, reopen disabled until reason, reopen POST {reason}, back to open and the same date allowed |

No money calculation or posting code was changed; every figure is read from
the existing libraries (`computeStatement`, `orderProgress`, `partProblem`,
`Reconciliation/useReconciliationModel`, `MonthEndCloseView`).

## Also in this batch

- **F-40** — `src/tests/layers-guard.test.ts`: lib/ never imports components/ or server/, components/ never imports server/.
- **F-39** — `docs/SCORECARD.md` + `scripts/scorecard.ts` (`npm run scorecard:update`).
- **F-38** — `perf/budgets.json`: posting, P&L, balance sheet, search and 7 screens with first-render budgets.

## Checks on this branch (AI #7)

- `npm run lint:types` — pass (timeout handled, no errors)
- `npm run lint:eslint` — 0 errors / 210 warnings (cap 210)
- `npm test` — passes locally, including the new evidence tests (see `docs/verification/ai7-continuation-2026-10-19.md` for the continuation run)
- `npx playwright test e2e/journeys-w2-w9.spec.ts` — **could not run in the session sandbox** (the Chromium download is blocked); GitHub CI runs it
- **First CI run failed `Browser shard 1/2`.** The fixtures mounted `.tsx` screens without Vite's React-refresh preamble, so the first screen import threw `$RefreshSig$ is not defined`. The preamble is now installed in `baseFixture` and in the W9 fixture, exactly as every other fixture spec does. See the continuation document for the evidence and the second-pass corrections to F-44/F-45.

## Files

- `e2e/journeys-w2-w9.spec.ts` (5 tests, 390 px, axe serious/critical)
- `src/tests/layers-guard.test.ts`, `perf/budgets.json`, `docs/SCORECARD.md`, `scripts/scorecard.ts`
- `docs/RELEASE_GATE.md` rows W2/W3/W4/W6/W9 Browser → Yes with evidence links
- `package.json` scripts `scorecard:update`, `check:layers`, `check:perf-budgets`

## Correction (19 Oct, second pass)

- F-44 did not mount a screen and its total rendered `$NaN`; it now drives the real `OrderInvoiceDialog` with the figures above.
- F-45's "posting into it 403" was not exercised and its fixture changed the clean month's step counts; the test now uses the proven clean-month seed and checks the shared posting rule before and after the reopen.
- F-41/F-42/F-43 were unchanged apart from the refresh preamble and the phone-width assertion.

## Limits

- Reconciliation is browser-tested but AU-1 (changed/removed bank lines on the Banking screen) and #96 remain to fully close W4 — noted in RELEASE_GATE.
- DIM-1 (payment-entry labels) still open for W2/W3 — statement totals are correct on document sides; payment-side labels are AI #1's lane.
