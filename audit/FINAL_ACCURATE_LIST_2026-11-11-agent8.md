# Agent #8 — Final Accurate List (2026-11-11)

**Agent:** #8 (fork `Chaim-Richard/ledgerflow`) · **Mission:** `docs/INDEPENDENT_AUDIT_AGENT.md` (owner, 18 Oct)
**Pinned SHA:** `ec3ff49336c53eeed531a79ac32cc08d1574ec96` (upstream `main`, merge of PR #626, 2026-11-10T23:54Z)
**Authority:** review-only. No money, posting, tax-maths, `src/server/`, migration or schema file was changed by this agent.
**Session branch:** `arena/a675941f-ledgerflow`
**Evidence:** [`agent8-2026-11-11/probe-output.txt`](agent8-2026-11-11/probe-output.txt) · probe [`function-audit/probes/af004-614-residual.ts`](function-audit/probes/af004-614-residual.ts)

> ## ⚠ STATUS UPDATE — this document is pinned at `ec3ff49` and its three live defects are now FIXED
>
> Later the same day, upstream moved **29 commits** to `39b0012881fdc78edab2479fb62b0b632234aa82`. AI #1 fixed all
> three findings within hours and this agent re-verified them by re-running the probes named in the issues:
>
> - **A8-1111-F1 and A8-1111-F2** (filed as [#627](https://github.com/shmuelbiller1/ledgerflow/issues/627)) → **FIXED by PR #635**, verified: probe cases R1b, R1c, R2b flipped DEFECT → OK with control R2c still counting 1, so the zero is not vacuous.
> - **A8-1111-F3** (filed as [#628](https://github.com/shmuelbiller1/ledgerflow/issues/628)) → **FIXED by PR #635**, verified: R3a–R3d and the older probe's P1, P2, P7 all flipped DEFECT → OK. `world:us` under Israeli books now resolves to `{country:'US'}` with **no** VAT registrations.
> - Also fixed the same day: [#629](https://github.com/shmuelbiller1/ledgerflow/issues/629) (`FxService` raw axios, no timeout) → **PR #634**, verified: no `axios` remains in `src/server/`, `safeFetch` with a host allowlist and a 10 s deadline, and `ratesOf` now refuses an unusable rates table.
> - **All eleven cases of `af004-614-residual.ts` now pass**; it is the regression guard for #627/#628.
>
> **Remaining audit observations:** AF-004-P6 (`composeFacts` verified-flag false negative, conservative) and A8-1111-F5 (stale
> `itemReports.ts` docstring). **AF-007 / [#645](https://github.com/shmuelbiller1/ledgerflow/issues/645) was a genuine P2 finding at the pinned revision, but was subsequently FIXED by merged PR #660 on 11 Nov 2026.** The current cache has a 500-entry bound, expiry sweep and exported test seams. Do not quote AF-007 as currently open.
>
> Read [`agent8-2026-11-11/ADDENDUM-39b0012-reverification.md`](agent8-2026-11-11/ADDENDUM-39b0012-reverification.md)
> for the current state. Everything below remains accurate **as a record of pin `ec3ff49`** — do not quote its
> defect rows as open.

---

## 1. What this slice was

Agent #7's 10 Nov scorecard proposed the next audit batch verbatim: *"Re-verify the tax-attribution family at
the fix."* Between that pin (`dc407397`, 10 Nov 03:08Z) and this one, **PR #614** (merged 10 Nov 17:37Z) closed
#517, #518 and #519, and **PR #611** (merged 10 Nov 11:30Z) closed #161. A further wave (#141, #143, #130, #160,
#342, #146, #274, #599) closed the same day.

So this slice is a **closure-wave re-verification**: re-execute the existing probes against the real libraries at
the new pin, decide for each closed issue whether the fix actually holds, and establish whether anything was
closed that is not fixed. It is not a function-by-function Pass A and is not claimed as one.

**Headline:** four of the closures verify clean. **Two defects survive the #614 fix, and one further defect was
never covered by any issue at all.** All three are in the tax lane (AI #1 / AI #9), so they are reported here and
as GitHub issues, not patched.

---

## 2. Findings register

Severity per the mission: P0 stop-invitation · P1 beta prerequisite · P2 usable-with-clear-limits · P3 later.

| ID | Outcome | Sev | Lane | Tracked | One line |
|---|---|---|---|---|---|
| **A8-1111-F1** | **verified-defect** | **P1** | AI #1/#9 (tax) | **new issue** | `usQuarterJourney`'s certificate step ignores the saved destination snapshot that #614/#519 established, so moving a customer rewrites a *past* quarter's certificate worklist and readiness |
| **A8-1111-F2** | **verified-defect** | **P1** | AI #1/#9 (tax) | **new issue** | the same step resolves the seller from `doc.dimensions`, not `documentEntityLabels`, so a first-line entity label is invisible to it and the two counts disagree — breaking the file's own documented invariant |
| **A8-1111-F3** | **verified-defect** | **P1** | AI #1/#9 (tax) | **new issue** | `resolveSellerProfile` merges `place` field-by-field and inherits `registrations` wholesale across **countries**, so a US entity is counted in the Israeli VAT return and an Israeli branch's sale in a US state return |
| A8-1111-F4 | verified-defect (tooling) | **P2** | **AI #8 (fixed here)** | this PR | `af004-tax-authority-probe.ts` P3 still asserted the pre-#614 contract, printing **DEFECT for closed issue #518** — a false positive that would have been re-reported by the next agent |
| A8-1111-F5 | verified-defect (docs) | **P3** | AI #1 (server report) | this list | `itemReports.ts:246-251` still says *"items keep no movement history yet (W-02), so … the stock side is today's"* — false since `inventoryAsOf` shipped; it tells the next engineer as-of stock is impossible |
| A8-1111-F6 | unsupported (carried) | P2 latent | AI #1/#9 | this list | `composeFacts` keeps the first occurrence of a set-valued fact, so a value stated both declared and verified reports `verified=false` (conservative false negative, probe P6) |

### A8-1111-F1 — the certificate step re-derives the buyer's state from the customer's place *today*

- **Where:** `src/lib/usQuarterJourney.ts:330-331`
  ```ts
  const place = (customer?.metadata as { taxPlace?: … } | undefined)?.taxPlace;
  const buyerState = place?.country === 'US' ? place.state : seller.place?.state;
  ```
- **Contract it breaks — the file's own, twice:**
  - header: *"Every figure is computed by the existing pure library the screen already uses, so the journey shows the same numbers that screen shows and **no second rule is invented here**"*
  - lines 304-306: *"The membership rule is **the state return's own** (counted status, the period, the seller's permit, **the buyer's state** with the seller's place as the over-the-counter fallback), **so the two counts agree**"*
  - `usSalesTaxReturn.ts:11-14` (added by #614): *"the destination is the sale's own saved tax place (the snapshot taken when it was issued), then its ship-to state, then (a credit note) its invoice's, and **only then the customer's place today, so moving a customer does not move past sales**"*
- **Reproduction (probe R1, real libraries, worked figures):** a California books with CA permit `sales_tax:US-CA:CA-5555`; one zero-rated `digital-goods` sale of 100.00 issued 2026-07-10 with saved destination `{US, CA}`; customer `c1` with **no** exemption certificate.
  - `digital-goods` is **exempt in CA, taxable in TX** (verified against `usProductTaxability.ts`), which is what makes the divergence observable.
  - Customer still in CA → certificate step `not-applicable`: *"No zero-tax sale to a US customer is recorded in the quarter, so no certificate is needed from this data."*
  - Customer moved to TX → certificate step **`attention`**: *"1 zero-tax sale(s) to a US customer: 1 without a recorded certificate…"*
  - `usSalesTaxReturn` for the CA permit is **identical both times**: `documentCount 1 → 1`, `exemptSalesCents 10000 → 10000` (probe R1a = OK, so #519's fix itself holds).
- **Consequence:** a correctly zero-rated **California** sale starts demanding an exemption certificate after the customer moves to Texas. `exemptByProduct` is looked up in the **wrong state's table**, and the quarter's `certificates` step flips to `attention`, so the quarter is not shown as ready to close — while every state return it summarises is unchanged. Editing a customer's address silently rewrites a closed quarter's readiness.
- **Why #614 missed it:** #614 changed `usSalesTaxReturn.ts` and `usQuarterJourney.ts`, but in the journey only the *unplaced* reporting (lines 254-262, 290-293). The certificate loop at 321-337 was left on the old rule.
- **Recommended correction (owner's decision, not applied here):** have the certificate step call the same precedence chain as `usSalesTaxReturn.ts:85-91` — ideally by exporting that destination resolution from `usSalesTaxReturn` and using it in both places, so there is one rule and not two. Add a permutation test asserting the two counts agree for: saved snapshot, ship-to, credit-note-follows-invoice, customer-today, and no-place-anywhere.
- **Acceptance test:** probe R1b and R1c flip to OK with no change to any existing expected figure.

### A8-1111-F2 — the certificate step cannot see a first-line entity label

- **Where:** `src/lib/usQuarterJourney.ts:327` `resolveSellerProfile(profiles, doc.dimensions, order)`
  versus `src/lib/tax/usSalesTaxReturn.ts:78` and `src/lib/tax/ilVatReturn.ts:54`, which both use
  `documentEntityLabels(doc)` — *"the first line's labels, else the document's"* (`ilVatReturn.ts:42-49`), i.e. what the invoice screen actually saves.
- **Reproduction (probe R2, real libraries):** same CA books; an Israeli branch label profile `world:il` holding **its own IL VAT registration and no US permit**; one zero-tax 100.00 sale with the label on `items[0].dimensions` and a `general` item (taxable in both CA and TX, so the product-exemption branch cannot decide the outcome).
  - `usSalesTaxReturn` for the CA permit → `documentCount = 0` (**probe R2a = OK**: #517's fix holds in the return).
  - Journey certificate step → counts **1** zero-tax US sale, because `doc.dimensions` is absent so the seller falls back to the books and its CA permit.
  - **Non-vacuity control (probe R2c = OK):** the identical sale with *no* label anywhere is also counted 1 — proving the step counts when it should, so R2b's divergence is real and not an artefact of a step that counts nothing.
- **Consequence:** an Israeli branch's sale appears in the **US quarter's** certificate worklist while being absent from every state return the same screen lists. The journey's own header promise ("no second rule is invented here") is false at this line.
- **Recommended correction:** `resolveSellerProfile(profiles, documentEntityLabels(doc), order)` — one token — plus the same agreement test as F1.
- **Note on the earlier probe:** the old `AF-004-P4` case reported this divergence for a *non-US buyer*, which conflated two mechanisms. R2 isolates the seller-label mechanism with a control; P4 is left in place as historical evidence and cross-referenced.

### A8-1111-F3 — `resolveSellerProfile` inherits place fields and registrations across countries

- **Where:** `src/lib/tax/profile.ts:98-99`
  ```ts
  if (out.registrations === undefined && profile.registrations?.length) out.registrations = profile.registrations;
  if (profile.place) out.place = { ...profile.place, ...stripEmpty(out.place) };
  ```
  Line 99 fills each *missing field* of the nearer place from the farther one with no country check, so `state`/`city`/`district` cross a border. Line 98 hands a label that records **no** registrations the books' registrations, whichever country they are in.
- **Not covered by any issue.** #517/#518/#519 were closed by #614, whose own body says *"All three were in `usSalesTaxReturn`"* and *"Not changed: the nexus watch (already correct), posting, and stored data"*; its file list does not include `profile.ts`. A GitHub search for `is:issue resolveSellerProfile`, `is:issue cross-country` and `is:issue tax profile inherit` returns **0** results. Agent #7's scorecard grouped P1/P2/P7 under "the #517–#519 family", so when that family closed these three were closed with it in everything but the code.
- **Reproduction A (probe R3, synthetic):** books = Acme California LLC with a CA permit; label `world:il` = `{ name: 'Acme Israel branch', place: { country: 'IL' } }`, no registrations.
  - `resolveSellerProfile` → place **`{"country":"IL","state":"CA"}`** — an Israeli entity in California.
  - One IL-labelled over-the-counter sale of 100.00 → counted in the **California** return: `documentCount=1`, `grossSalesCents=10000` (it inherits the CA permit at line 98 and the state at line 99, which `usSalesTaxReturn.ts:91` then uses as the over-the-counter fallback).
- **Reproduction B (probe R3c/R3d) — the repository's OWN fixture.** `src/tests/tax-profile.test.ts:9-21` already contains an Israeli holding with a `world:us` child, but the suite only ever resolves `world:us/texas` (a complete own place) and `location:eilat` (same country as the books). Resolving the level no test resolves:
  - `world:us` → `{"name":"Acme US","place":{"country":"US","city":"Tel Aviv"}}`, VAT registrations in force **`["vat:IL:514000000"]`**.
  - a Texas child that records no city of its own → `{"country":"US","city":"Tel Aviv","state":"TX"}`.
  - Because `ilVatReturn.belongsTo` matches on `registrationKey`, an invoice labelled `world=us` **is counted in the Israeli VAT return** (this is the old probe's P7, still failing: `documentCount=1`, `taxableSalesCents=10000`).
- **Reachability — confirmed, not theoretical.** `src/components/platform/settings/TaxProfilesSettings.tsx` is a live Settings screen an owner or accountant edits: line 120 renders a free-text `Country` field with an ISO datalist and independent `State`/`City` fields; lines 122-123 add registrations or none; line 115's own help text says *"Registrations inherit as a whole when no own rows are supplied."* `taxProfilesProblem` (`profile.ts:165-180`) validates each profile in isolation and **never compares a label's country with the books'**, so nothing refuses the combination. The screen then renders the merged result as the entity's inherited place (line 100, 105).
- **Honest scoping (probe R3e = OK).** This does **not** make the invoice screen suggest a wrong-country *rate*: `resolveLineTax.ts:92-107` branches on `seller.place.country`, and `country` is always the nearest level's own, so `Acme US` resolves to `reason=not-registered, rate=0`. Recorded so the finding is not over-claimed. The harm is in the **returns**, which match on `registrationKey` and on the sub-country fallback — i.e. in filed figures, not in a suggested rate a person clicks.
- **Financial consequence:** a silently wrong tax return. A US entity's revenue inside an Israeli VAT filing, or an Israeli branch's revenue inside a US state filing, are both figures a person would submit to a tax authority. By the mission's own scale ("silently wrong financial report/export") this is a **P0 candidate**; it is recorded as **P1** because it needs a multi-country label profile that records no registrations of its own, and the affected screens are declaration screens that `TaxProfilesSettings.tsx:91` explicitly says *"saving a profile does not verify a registration or make a filing ready."*
- **Recommended correction (owner's decision — this is a product rule, not only a code fix):** decide and document one of
  1. a `place` inherits only from levels in the **same country** (a country change resets the narrower fields), and registrations inherit only when the countries match; or
  2. inheritance stays as-is but `taxProfilesProblem` **refuses** a label whose country differs from the books' while it has no registrations of its own, with a message naming the consequence. **Limitation:** a cross-country label with its own registrations still passes, and this does not prevent an Israeli label from inheriting `state: "CA"`. A separate decision on the place-country boundary is required; or
  3. each return filters inherited registrations by `place.country` before matching. **Limitation:** registration filtering alone does not prevent an Israeli label from inheriting `state: "CA"`. A separate decision on the place-country boundary is required.
  Whichever is chosen, `resolveSellerProfile` needs a test at the `world:us` level of the existing fixture, and the choice should be written into the `profile.ts` docstring, which currently promises inheritance without stating a country boundary.

### A8-1111-F4 — the audit probe asserted a superseded contract (fixed in this PR)

`audit/function-audit/probes/af004-tax-authority-probe.ts` case P3 expected `documentCount === 1` for a US sale
with a country but no state. #518's fix correctly moved such sales **out** of every state return and into the new
`unplaced` figure (`usSalesTaxReturn.ts:47-48, 92-101`), so `documentCount` is now 0 by design. Left as it was, the
probe printed `DEFECT AF-004-P3` against a **closed** issue — a false positive that the next agent would have
re-reported as a live defect, and that this agent reproduced before checking the source.

Corrected to the new contract and kept as a regression guard; it now asserts the exact worked figures
`unplaced = 1 document / 10000 net / 825 tax` and passes. P8 was likewise relabelled a #517 guard. The stale
expectation is the reason this list states #518 as **fixed**.

### A8-1111-F5 — a stale docstring in the inventory-valuation report

`src/server/reports/itemReports.ts:246-251` says *"Quantities are as of now: items keep no movement history yet
(W-02), so the books side follows `asOfDate` and the stock side is today's."* Movement history **does** exist now
(`src/lib/stockMoves.ts`, `src/server/services/stockMoveService.ts`) and `src/lib/inventoryAsOf.ts` reconstructs an
as-of valuation from it. Server file — reported, not patched (AI #1).

---

## 3. Closure-wave verification (the part that passed)

Each row was re-executed at this pin, not read from a report.

| Issue | Closed | Verdict at `ec3ff49` | Evidence |
|---|---|---|---|
| **#517** first-line entity label ignored by the US return | 10 Nov 17:37 (#614) | **FIXED** | probe P8 = OK; R2a = OK — `usSalesTaxReturn.ts:78` uses `documentEntityLabels`. *Residual: F2, the journey was not updated.* |
| **#518** US sale with an unknown state silently omitted | 10 Nov 17:37 (#614) | **FIXED** | probe P3 = OK — `unplaced` 1/10000/825; `usQuarterJourney.ts:290-293` surfaces it as a problem so the quarter is not shown ready |
| **#519** customer move rewrites past sales | 10 Nov 17:37 (#614) | **FIXED in the return** | probe R1a = OK; `af004-519-customer-moves.ts`: TX sale stays in TX after the customer moves to CA (`documentCount=1` both ways). *Residual: F1, the journey was not updated.* |
| **#161** chained rule overrides depend on array order | 10 Nov 11:30 (#611) | **FIXED** | `iss161-rule-override-order.test.ts` **7/7**; probe orders `A,B,C` / `B,A,C` / `C,B,A` all yield applied **set {A, C}** with `displaced B by A` |
| **#141** statement PDF ignores the selected period | 10 Nov 11:01 | **FIXED** | `statementService.ts:39-60` — `loadStatement(db, workspaceId, contactId, period, type)` resolves via `resolveStatementScope` and calls `computeStatement(…, scope.startDate, scope.endDate, …)`; `aud01-statement-scope.test.tsx` **4/4** |
| **#130** cost edits change valuation without a posting | 10 Nov 11:04 | **FIXED** | `iss130-stock-revaluation` + `iss130-revalue-dialog` pass (19/19 across the six closure-wave suites run here) |
| **#143** RMA approvals/quantities atomic on the server | 10 Nov 11:03 | **not re-executed here** | `iss143-rma-server.test.ts` is Postgres-gated; no local Postgres or Docker in this sandbox. `rma-cumulative-capacity` passes; CI's Postgres-17 job is green at this pin |
| **#160** IL VAT equipment split has no adapter | 10 Nov 11:03 | **FIXED** | `iss160-il-vat-equipment.test.tsx` passes |
| **#342** stored Jan 1 shifts into the prior year | 10 Nov | **behaviour confirmed, probe still prints SHIFTED** | `af011-date-contracts.mjs` shows `getFullYear()` returning 2025 for a stored `2026-01-01` in Auckland/Jerusalem/Tokyo. That is the *raw `Date` API* the probe demonstrates as the hazard, not the shipped display path; `date-display.test.ts` passes. Recorded so nobody reads the probe output as an open defect |

**Correction to the record.** Agent #7's 10 Nov scorecard lists `#161 / AF-012` as a live latent defect and
`AF-004-P1/P2/P4/P7` as tracked under "#517–#519 family". Both statements were **correct at that pin**
(`dc407397`, 03:08Z) — #611 and #614 merged later that day. At *this* pin #161 is fixed, and P1/P2/P7 are
**untracked**. Neither is a contradiction; the pin moved. This list supersedes those rows at `ec3ff49`.

---

## 4. Tests and gates actually run at this pin

| Gate | Result |
|---|---|
| `npm run lint:types` (`tsc --noEmit`) | **pass**, 0 errors |
| `npm run lint:eslint` | **pass**, 0 errors / **42 warnings** (cap unchanged; no baseline raised) |
| `af004-614-residual.ts` (new probe, real libraries) | 11 cases: **7 DEFECT / 4 OK** (2 non-vacuity controls + 1 scope control) |
| `af004-tax-authority-probe.ts` (corrected) | 8 cases: 5 DEFECT / 3 OK — P3 and P8 now guard the #518/#517 fixes |
| `af004-519-customer-moves.ts` | #519 holds in the return |
| `af012-rule-chain-order.mjs` + `af012-shipped-pack-chains.mjs` | order-independent; 18 packs / 584 rules / 67 overrides / **0 nested chains** |
| `iss161-rule-override-order.test.ts` | **7/7** |
| `us-sales-tax-return` + `us-quarter-journey` + `tax-profile` + `iss161` | **39/39** |
| `iss130-stock-revaluation`, `iss130-revalue-dialog`, `iss160-il-vat-equipment`, `rma-cumulative-capacity`, `date-display`, `pcn874-draft` | **19/19** |
| `aud01-statement-scope.test.tsx` | **4/4** |
| Upstream CI at this pin | **all 23 checks green** (unit 1-4/4, Auckland + LA timezone legs, Postgres-17 rules, browser 1-5/5, Playwright smoke, coverage gate, production build, SonarCloud, CodeQL, SBOM, ESLint ratchet) |
| **Not run here** | full `npm test` (no local Postgres; prior Agent #8 sessions saw it stall/timeout in this sandbox — **not claimed**); `npm run test:rules`; Playwright browser specs |

---

## 5. Coverage — honest counts

- **Functions read in full at this pin:** 6 — `usSalesTaxReturn` (whole file), `resolveSellerProfile` + `taxProfilesProblem` + `profileProblem`/`placeProblem`, `documentEntityLabels`/`belongsTo`, `usQuarterJourney`'s certificate step and unplaced reporting, `computeInventoryValuation`, `resolveLineTax` (the seller/buyer branch), `exemptionOn`/`taxExemptionOf`.
- **Functions executed through probes at this pin:** 9 — `usSalesTaxReturn`, `usQuarterJourney`, `resolveSellerProfile`, `registrationsOn`, `registrationKey`, `resolveLineTax`, `israelVatReturn`, `composeFacts`, `evaluateRules`.
- **Issues adjudicated:** 9 closed (verified or explicitly not-run) + 3 open (`#131`, `#132`, `#150`).
- **Files in the repository:** ~3,400 paths / ~2,700 code files at the prior Agent #8 pin. This slice touched a narrow, deep tax/reporting slice. **This is not a complete Pass A and is not a whole-repository audit.**
- **Not examined this session:** `src/server/` route-by-route, RLS policies, migrations, the browser/e2e suites, payroll, banking ingestion, consolidation, and every non-tax report.

### #131 (still open) — status at this pin, for the owner

The issue's core complaint (today's stock compared against a historical ledger) is **substantially mitigated in
the only production caller**. `InventoryValuationReportView.tsx:52-83` now takes a past date's quantities and
values from `inventoryAsOf` over the stock history and never from today's items; `comparable` (line 81) requires
both sides to be for the same date **and** complete; the CSV writes `unknown` rather than `0` for an item whose
history does not explain it (lines 97-99) and refuses to export at all when the figures are unknown (92-93);
a future date is refused (92, 161). Verified by grep that `computeInventoryValuation` has exactly **one**
production caller, so there is no unguarded mixed-basis path through an API, PDF or scheduled report.
Residual: the stale docstring (F5), and the ledger side still comes from the browser cache — guarded by
`ledgerPartial`/`comparable` rather than served full-history (the issue's point 4). **Recommendation: narrow #131
to those two residuals rather than leaving it open as written**, since the acceptance criteria it lists are now
largely met. AI #1's call.

---

## 6. Launch readiness

**CONDITIONALLY READY — not this agent's call to make, and no launch sign-off is claimed here.**

- Stage A's nine workflows were certified by earlier work and CI is fully green at this pin; nothing this slice
  found contradicts that for single-country books.
- **What is not ready:** any workspace that uses **entity labels across more than one country** (F3), and the
  **US quarter journey's readiness verdict** (F1, F2). F1 and F2 are cheap, well-scoped fixes in one function; F3
  needs a product decision before code.
- **Recommended gating:** if the first-tester cohort is single-country, F1/F2/F3 do not block Stage A and can be
  Stage B prerequisites. If any invited tester is multi-entity or multi-country, **F3 is a P0 stop-invitation**
  because it puts one country's revenue inside another country's filing.

### Three work queues

1. **Blocking now (if any tester is multi-country):** F3 — decide the country boundary for `place`/`registrations` inheritance, then a test at the existing fixture's `world:us` level.
2. **Before real bookkeeping:** F1 + F2 — make the certificate step use the return's own destination precedence and `documentEntityLabels`; add the "the two counts agree" test the source already promises. F4's corrected probe is the acceptance check. F5 — refresh the docstring.
3. **Parked until first feedback:** F6 (`composeFacts` verified-flag false negative, conservative); #132 (feature request); narrowing #131.

---

## 7. What was examined, and what was not

**Instruction sources actually read this session:** root `AGENTS.md`; `CURRENT_WORK.md`; `docs/COORDINATION.md`
(NOW rules, "Rules for every helper AI", the fork section for AI #6/#7/#8, the AI #8 queue, and the Messages
section); `docs/INDEPENDENT_AUDIT_AGENT.md`; `audit/README.md`; `audit/function-audit/README.md`;
`audit/function-audit/SCORECARD-2026-11-10.md` (Agent #7); `audit/agent8-checkpoint-2026-11-10.md` and
`audit/agent8-2026-11-08/03-accurate-findings-list-2026-11-08.md` (this agent's own prior work);
`CLAUDE.md` (present, points at the same rules). No separate agent inbox directory exists; agent messages live in
`docs/COORDINATION.md` "Messages" and in the per-agent `audit/` folders, both of which were read. No message from
Shmuel superseding the audit assignment was found; the owner's latest directions in COORDINATION (18 Oct plan,
19 Oct "check your own open PRs first", 28 Oct fork/Vercel note) were followed.

**GitHub state checked:** `git remote -v` (origin = the fork, as AGENTS.md expects); open upstream PRs (#623, #616,
#615 — Agent #11 and Agent #7, **not mine, not touched**); this agent's PR history (#617 merged 10 Nov, #557,
#562, #559, #538, #534, #530, #520, #434, #399, #252 merged; #435/#425/#424 closed and superseded). **No Agent #8
PR was open at session start**, so nothing was redone. Duplicate search run before every finding (§2 F3).

**Not accessible / not done, and why:** no local Postgres or Docker in this sandbox, so the Postgres-gated suites
(`iss143-rma-server`, `npm run test:rules`, RLS, migrations) were **not executed** and are not claimed; CI's
Postgres-17 job is green at this pin and is the evidence for those. The local checkout is **depth 1**, so no
`git log` archaeology was possible and all history claims come from the GitHub API. The full `npm test` was not
run to completion (prior Agent #8 sessions saw it stall in this sandbox); focused suites were run instead and are
listed individually in §4. No production data, credentials or live service was used; every figure in this list is
synthetic and worked by hand.
