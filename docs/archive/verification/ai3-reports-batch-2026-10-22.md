# AI #3 batch 2026-10-22 — seven reports, A-121, A-182, A-149 (PR #325, stacked on #316)

Worked figures are the hand-computed expectations inside each lib test (the tests state the
arithmetic in comments); nothing here posts, files or changes a rate.

## The seven reports (each: pure lib + view + registry + EN/HE help + CSV + e2e coverage line)

- **A-187 Aged Receivables by Sales Rep** — `agedReceivablesByRep` reuses `computePartyAging`
  unchanged. Hand check: rep Noa Levi total 180,000¢ of which 60,000¢ overdue; customers no rep lists
  sit in their own group (10,000¢); grand total 190,000¢. 3 lib + 1 view tests.
- **A-193 Gross Margin by Item Group** — monthly `computeSalesByItem` grouped by item category.
  Widgets Jan: sales 10,000¢, cost 4,000¢, margin 60%; a month with a missing item cost keeps
  `costIsEstimate` and is flagged on screen. 3 lib + 1 view tests.
- **A-190 Top Customers and Vendors** — ranked by `partyPeriodSummary` invoiced/billed. Big Ltd:
  invoiced in period 150,000¢ (draft 999,000¢ and pre-period 5,000¢ excluded), closing 105,000¢
  (155,000 − 10,000 credit − 40,000 paid), with a 12-month trend. 3 lib + 1 view tests.
- **A-192 Inventory Turnover** — sale-type moves only, over the inventory-details endpoint.
  Widget: sold 109, average (100+36)/2 = 68, turnover 1.6029, days-of-stock 31/1.6029 ≈ 19.3,
  COGS at each move's own cost 43,600¢; turnover stays blank when the average is not positive.
  Lib + view tests.
- **A-191 Expense by Employee** — `receiptChecklist` rows grouped by employee, per-currency
  totals (never summed across currencies); recorded / missing / **not-checked** (attachment index
  incomplete) kept distinct. Lib + view tests.
- **A-179 Time by Person and Project** — over `GET /workspaces/:id/time`; 120 + 90 minutes show
  as 3:30 h, billable and waiting-for-approval are subsets of the same total. Lib + view tests.
- **A-137 Bank Holidays and Due Dates** — four calendars generated from the authorities' rules
  (US Federal Reserve Banks K.8 incl. the Saturday-holiday "Banks open Friday" nuance; Bank of
  Israel statutory Hebrew-calendar closures, both Purims, short-hour eves separate; GOV.UK
  England & Wales substitute days; ECB TARGET's six fixed days that never move). 2026 lists
  pinned exactly (e.g. IL: Pesach Apr 2 + Apr 8, Rosh Hashanah 2nd day Sep 13, Yom Kippur Sep 21;
  TARGET Dec 25 Fri → next business day Dec 28). Authority + source URL + retrieved 2026-10-22
  printed on screen; the ECB URL was re-verified live (the first URL used was a 404 — fixed to
  the ECB's long-term-calendar press release). 6 lib + 1 view tests. Years outside 2000–2100
  return nothing rather than extrapolate.

## A-121, A-182, A-149

- **A-121** — on Reports → Backorders: `releasableLines` / `ordersReadyToRelease` reuse the
  report's oldest-first allocation. Fixtures (5 chairs): releasable = SO1-chair×1 + SO2-chair×4,
  orders deliverable in full = SO2 only; with 3 chairs only SO1's line is covered and no order is
  complete. Partly-covered lines are deliberately excluded; the screen says the cover is
  computed, not reserved.
- **A-182** — `contactFileImport` reads vCard (unfolding, N/FN/ORG fallback, quoted-printable
  UTF-8 — a Hebrew name decodes) and the Google Contacts CSV (strict header detection) into the
  ordinary mapped + checked import; extra emails/phones land in Notes; nameless cards are
  reported, never invented. Duplicate check by hand: exact-name row → "will be skipped" (the
  server's identity is the normalised name — verified in `recordImportService`), same-email and
  same-phone-digits rows under a different name → flagged as would-duplicate. 5 lib + 3 view tests.
- **A-149** — the five AI #3 non-report screens (Petty Cash, Custom Fields, Branding Profiles,
  Price-List Import, Import) gained `SCREEN_HELP_HE` main/settings entries, pinned by a new test;
  EN import help now mentions the address-book path.

## Checks (PR #325)

- Local: `tsc --noEmit` clean; `npm run lint:eslint` **0 errors / 106 warnings** (the cap; none
  added); new/affected suites 46/46 under `TZ=Pacific/Auckland`; guard bundle 48/48 after the
  main merge; quality ratchet + bug-patterns green (two ratchet trips found and fixed properly —
  civil-date maths instead of `Date.UTC`, and the `alive` staleness flag the scanner can see).
- CI run **39849817819**: Lint/Typecheck/Database-rules, production build, **all 8 unit shards**
  (4× UTC, 2× America/Los_Angeles, 2× Pacific/Auckland), coverage gate, CodeQL/SBOM, and Browser
  shards 1–3 green. Browser shard 4 fails on one stale reference image
  (`balance-sheet-390-dark.png`: expected 2260px tall, received 2346px — A-202's explainer added
  86px) and the smoke rollup mirrors it. That closes only via the manual *Refresh visual
  baselines* workflow (review branch, human looks) — this sandbox cannot dispatch it (403), has
  no Chromium, and artifact downloads are blocked; instructions are on PR #325.
- Also fixed on the way: `e2e/screen-help.spec.ts` (from #316) searched for the עברית button
  inside the dialog *already named in Hebrew*, so it could only time out — it passes in CI for
  the first time on this PR (assertions unchanged).

No money calculation, posting, tax maths, `src/server/`, reserved modal, quality baseline or
screenshot baseline was changed.
