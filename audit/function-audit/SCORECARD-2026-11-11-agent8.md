# Audit scorecard — Agent #8 slice (11 Nov 2026)

**Owner:** Agent #8 (independent audit, review-only) · **Umbrella issue:** [#150](https://github.com/shmuelbiller1/ledgerflow/issues/150)
**Pinned SHA:** `ec3ff49336c53eeed531a79ac32cc08d1574ec96` (upstream `main`, merge of PR #626, 2026-11-10T23:54Z)
**Owner-facing list:** [`../FINAL_ACCURATE_LIST_2026-11-11-agent8.md`](../FINAL_ACCURATE_LIST_2026-11-11-agent8.md)
**Raw evidence:** [`../agent8-2026-11-11/probe-output.txt`](../agent8-2026-11-11/probe-output.txt)
**New issues filed:** [#627](https://github.com/shmuelbiller1/ledgerflow/issues/627) (quarter-journey residual of #614) · [#628](https://github.com/shmuelbiller1/ledgerflow/issues/628) (cross-country inheritance)

## What this slice was

Agent #7's 10 Nov scorecard proposed the next batch verbatim: *"Re-verify the tax-attribution family at the fix."*
Between that pin (`dc407397`, 10 Nov 03:08Z) and this one, PR #614 closed #517/#518/#519 and PR #611 closed #161;
a further wave (#141, #143, #130, #160, #342, #146, #274, #599) closed the same day. This slice re-executed the
existing probes against the **real libraries** at the new pin and adjudicated each closure.

**Result: 4 closures verify clean, 1 verifies clean in part, and 3 defects survive — none of them covered by an
open issue.**

## Executed at this pin

| Evidence | Result |
|---|---|
| `probes/af004-614-residual.ts` (**new**, real `usSalesTaxReturn` + `usQuarterJourney` + `resolveSellerProfile` + `resolveLineTax`) | 11 cases: **7 DEFECT / 4 OK**, incl. 2 non-vacuity controls and 1 honest scope control |
| `probes/af004-tax-authority-probe.ts` (**corrected**) | 8 cases: 5 DEFECT / 3 OK — P3 and P8 now guard the #518/#517 fixes instead of misreporting them |
| `probes/af004-519-customer-moves.ts` | #519 holds in the return (TX sale stays in TX after the customer moves to CA) |
| `probes/af012-rule-chain-order.mjs` | order-independent at the **set** level: `A,B,C` / `B,A,C` / `C,B,A` all → applied {A, C}, displaced B by A — **#161 fixed** |
| `probes/af012-shipped-pack-chains.mjs` | 18 packs · 584 rules · 67 overrides · 0 nested chains · 0 dangling targets |
| `probes/af011-date-contracts.mjs` | raw `getFullYear()` hazard demonstrated; the shipped display path is covered by `date-display.test.ts` (passes) |
| `iss161-rule-override-order.test.ts` | **7/7** |
| `us-sales-tax-return` + `us-quarter-journey` + `tax-profile` + `iss161` | **39/39** |
| `iss130-stock-revaluation`, `iss130-revalue-dialog`, `iss160-il-vat-equipment`, `rma-cumulative-capacity`, `date-display`, `pcn874-draft` | **19/19** |
| `aud01-statement-scope.test.tsx` | **4/4** |
| `npm run lint:types` | pass, 0 errors |
| `npm run lint:eslint` | pass, **0 errors / 42 warnings** (cap unchanged) |
| Upstream CI at this pin | **23/23 green** (unit 1-4/4, Auckland + LA legs, Postgres-17 rules, browser 1-5/5, smoke, coverage gate, build, Sonar, CodeQL, SBOM, ratchet) |
| Full `npm test` / `test:rules` / Playwright | **not run — no local Postgres or Docker in this sandbox. Not claimed.** |

## Closure-wave adjudication

| Issue | Verdict at `ec3ff49` | Evidence |
|---|---|---|
| #517 first-line entity label | **FIXED** in the return | probe P8/R2a OK — `usSalesTaxReturn.ts:78` uses `documentEntityLabels`. Residual → **#627 defect 2** |
| #518 unknown-state sale omitted | **FIXED** | probe P3 OK — `unplaced` = 1 doc / 10000 net / 825 tax; journey surfaces it as a problem (lines 290-293) |
| #519 customer move rewrites past sales | **FIXED in the return only** | probe R1a OK. Residual → **#627 defect 1** |
| #161 chained override order | **FIXED** | 7/7 + probe order-independence. Supersedes Agent #7's row at the older pin |
| #141 statement PDF period | **FIXED** | `statementService.ts:39-60` takes `period`, resolves scope; `aud01` 4/4 |
| #130 cost edits without a posting | **FIXED** | `iss130-*` pass |
| #160 IL VAT equipment split | **FIXED** | `iss160-il-vat-equipment` passes |
| #143 RMA server atomicity | **not re-executed** | Postgres-gated; CI's Postgres-17 job green at this pin |
| #131 inventory as-of (OPEN) | **substantially mitigated** | `InventoryValuationReportView.tsx:52-83` uses `inventoryAsOf`; `comparable` gate; CSV writes `unknown` not `0`; **one** production caller of `computeInventoryValuation` (grep-verified). Recommend narrowing the issue |

## Findings register (delta vs Agent #7's 10 Nov scorecard)

| ID | Sev | Finding | Lane | Tracked |
|---|---|---|---|---|
| **A8-1111-F1** | **P1** | the quarter journey's certificate step reads the customer's place *today*, not the saved destination: moving a customer flips a past quarter to `attention` while every state return is unchanged | AI #1/#9 | **#627** |
| **A8-1111-F2** | **P1** | the same step resolves the seller from `doc.dimensions`, not `documentEntityLabels`: a first-line entity label is invisible, so an Israeli branch's sale enters the US quarter's worklist | AI #1/#9 | **#627** |
| **A8-1111-F3** | **P1** (P0 if any tester is multi-country) | `profile.ts:98-99` inherits `place` fields and `registrations` across countries: "Acme US" resolves to `{country:'US', city:'Tel Aviv'}` holding `vat:IL:514000000`, and is counted in the Israeli VAT return | AI #1/#9 | **#628** |
| A8-1111-F4 | P2 (tooling) | the AF-004 probe asserted the pre-#614 contract and printed **DEFECT for closed issue #518** | **AI #8 — fixed in this PR** | this PR |
| A8-1111-F5 | P3 (docs) | `itemReports.ts:246-251` still claims items keep no movement history; false since `inventoryAsOf` shipped | AI #1 | this list |
| A8-1111-F6 | P2 latent | `composeFacts` keeps the first occurrence of a set-valued fact, so declared+verified reports `verified=false` (conservative) | AI #1/#9 | carried |

## Coverage (honest counts)

- **Files read in full at this pin: 8** — `usSalesTaxReturn.ts`, `profile.ts`, `ilVatReturn.ts` (the label/belongsTo block), `usQuarterJourney.ts` (certificate + unplaced blocks and the header contract), `resolveLineTax.ts` (the seller/buyer branch), `taxExemption.ts`, `itemReports.ts` (`computeInventoryValuation`), `InventoryValuationReportView.tsx`, plus `TaxProfilesSettings.tsx` and `TaxPlaceSuggestion.tsx` for reachability.
- **Functions executed through probes at this pin: 9** — `usSalesTaxReturn`, `usQuarterJourney`, `resolveSellerProfile`, `registrationsOn`, `registrationKey`, `resolveLineTax`, `israelVatReturn`, `composeFacts`, `evaluateRules`.
- **Issues adjudicated: 12** (9 closed + 3 open).
- **Not performed:** function-by-function Pass A beyond this set; no `src/server/` route-by-route review; no RLS/migration execution; no browser run; no production access. **Indexing ≠ review, and this slice is a deep narrow one, not a whole-repository audit.**

## Beta readiness

**CONDITIONALLY READY — no launch sign-off claimed.** Stage A's certification for single-country books is not
contradicted by anything found here, and CI is fully green at this pin. **Not ready** for: any workspace using
entity labels across more than one country (F3), or reliance on the US quarter journey's readiness verdict (F1/F2).
F1 and F2 are one-function fixes; F3 needs an owner product decision before code.

## Proposed next 10-function batch

Pin the **shared destination/label contract** the money lane must touch for #627, then the returns that consume it:
`documentEntityLabels` · the destination-precedence chain in `usSalesTaxReturn.ts:84-91` (extract and export) ·
`usQuarterJourney`'s certificate loop · `belongsTo` · `registrationsOn` · `registrationKey` ·
`usQuarterPermits` · `usNexusWatch`'s seller resolution (confirm it uses the label, as #614 says it already does) ·
`resolveLineTax`'s permit lookup · `reviewUseTax`'s state source. Add one property: **for every document, the
journey's certificate membership and the state return's membership are the same predicate.** Then re-run
`af004-614-residual.ts` and expect all 11 cases OK with no existing expected figure changed.

## Limitations

No local Postgres or Docker, so DB/RLS/migration gates were not executed and are not claimed (CI's Postgres-17 job
is the evidence at this pin). The checkout is **depth 1**, so no local `git log` archaeology was possible; all
history claims come from the GitHub API. Full `npm test` not run to completion — focused suites run individually
instead. Every figure is synthetic and worked by hand; no production data, credential or live service was used.
