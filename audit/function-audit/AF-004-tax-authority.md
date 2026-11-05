# AF-004 — tax fact and seller-profile authority (independent audit, AI #8, slice 4)

**Status:** `needs-reproduction` for P1 family (reproduced by pure-function probe; DB/UI path not exercised) · review only
**Pinned SHA:** `28b90c2e4aa3abcbaeea58208c514820711b24f3` (= `origin/main`, PR #512 merge, read 2026-11-05)
**Mission:** `docs/INDEPENDENT_AUDIT_AGENT.md` §AF-004 ("compare `composeFacts`, `evaluateRules`, `resolveSellerProfile`, `TaxPlaceSuggestion`, `ilVatReturn`, and `usSalesTaxReturn`; trace entity ownership, conflicting facts and unverified rule packs all the way to posting").
**Scope limits:** no money, posting, migration, `src/server/`, or live-data change. Probe script only. No Postgres, no UI, no browser.

---

## 1. What was reviewed (function-level, pinned SHA)

Full body read and caller traced for each item below. "Executed" means the probe in §3 or the existing suite in §4 ran the function at this SHA.

| # | Symbol (file:lines) | Read | Executed | Outcome |
|---|---|:-:|:-:|---|
| 1 | `resolveSellerProfile` (`src/lib/tax/profile.ts:82–102`) | ✔ | ✔ P1, P2, P7, P8 | **Defect F1 (root cause)**, F2 |
| 2 | `stripEmpty` (`profile.ts:104–107`) | ✔ | via #1 | part of F1 (place merge) |
| 3 | `registrationsOn`, `registrationKey`, `nodeAncestry` (`profile.ts:65–117`) | ✔ | via #1, #6, #7 | no finding |
| 4 | `composeFacts` (`src/lib/rules/facts.ts:91–129`) | ✔ | ✔ P5 (control), P6 | conflicts correct (P5); **F5** conservative false negative (P6) |
| 5 | `isVerified`, `inForce` (`facts.ts:82–83`) | ✔ | via #4 | no finding |
| 6 | `usSalesTaxReturn` + `add` closure + `toBase` (`src/lib/tax/usSalesTaxReturn.ts:36–80`) | ✔ | ✔ P2, P3, P8 | **F2, F3** (see §2) |
| 7 | `israelVatReturn` (`src/lib/tax/ilVatReturn.ts:58–89`) | ✔ | ✔ P7 | **F1 reaches the Israeli VAT return** |
| 8 | `belongsTo`, `documentEntityLabels` (`ilVatReturn.ts:42–56`) | ✔ | ✔ P7, P8 | correct first-line labels here; **F2** is the US path that does not do the same |
| 9 | `usQuarterJourney` — exemption-certificate block only (`src/lib/usQuarterJourney.ts:295–327`) | ✔ | ✔ P4 (real call) | **F4** |
| 10 | `evaluateRules` (`src/lib/rules/rules.ts:63–86`) | ✔ | ✘ | read only; override-order defect is AF-012 (PR #10 lineage), not re-tested here |
| 11 | `buildTaxReturn`, `taxReturnDocument` (`src/lib/taxReturnDocs.ts:23–53`) | ✔ | via #6, #7 | no finding in this slice |
| 12 | `TaxPlaceSuggestion` (`src/components/sales/TaxPlaceSuggestion.tsx`) | ✘ | ✘ | **not yet reviewed** (next slice) |

Counts for this slice: **12 items** listed; **10 executed** (directly, or through an executed caller — items 2, 3, 5, 8, 11 are covered only through their callers); **1 read-only** (`evaluateRules`, item 10); **1 not reviewed** (`TaxPlaceSuggestion`, item 12). Not claimed as "audited": `TaxPlaceSuggestion`, the rule packs (`src/lib/rules/packs/*`), `ilWithholdingPack`, `resolveLineTax`, the IL/US UI screens, and the server tax routes (`src/server/services/taxReturnService.ts`).

---

## 2. Findings

Severity follows INDEPENDENT_AUDIT_AGENT.md §Prioritization. "Reachability" states what is still unknown.

### F1 — Label profiles inherit a **different country's** place and registrations (root cause) — **P1**, reachability: config-dependent
- **Mechanism:** `resolveSellerProfile` walks the label chain and then the books. For each level it copies `registrations` from the nearest level that has any (`profile.ts:98`) and merges `place` **field by field** with no check that the country matches (`profile.ts:99`: `out.place = { ...profile.place, ...stripEmpty(out.place) }`).
- **Consequence:** an entity labelled as Israeli (`world:il`, place `{country:'IL'}`, no registrations) under a Texas books profile resolves to `place = {country:'IL', state:'TX'}` and **inherits the books' Texas sales-tax permit**.
- **Probe:** `P1` → observed `{"country":"IL","state":"TX"}` (from `["world:il","books"]`).
- **Downstream reach (executed):**
  - `P2`: an Israeli-labelled sale with no customer place is counted in the **Texas** sales-tax return (`documentCount=1`, `grossSalesCents=10000`).
  - `P7`: a **US-labelled** sale with no registrations of its own lands in the **Israeli VAT return** (`documentCount=1`, `taxableSalesCents=10000`) when the books hold an Israeli VAT number.
- **Existing tests:** none pin the cross-country case. `src/tests/tax-profile.test.ts:28–41` covers same-country inheritance only (Texas child; Eilat inherits the IL VAT number).
- **Validation gap:** `taxProfilesProblem` (`profile.ts:164–180`) does not reject a label profile whose country differs from its parent or the books, so the configuration is accepted.
- **Likelihood:** requires a second-jurisdiction (or second-state) label profile with no registrations of its own. Plausible for any multi-entity or multi-location workspace; not reachable in a single-entity, single-jurisdiction books setup. Whether stage-A synthetic testers can create such a profile: **unknown, needs AI #1 / owner answer**.
- **Suggested fix direction (not implemented):** do not inherit `place` fields or `registrations` from a parent whose `country` differs; or refuse to save a label profile whose country differs from its parent without its own registrations. Acceptance test: §5, case A1.

### F2 — The US sales-tax return counts sales the entity label does not own (label ignored, and F1 fallback) — **P0 candidate**, reachability: multi-entity configuration
- **Mechanism (a):** `usSalesTaxReturn` reads `doc.dimensions` (`usSalesTaxReturn.ts:57`), but the screens keep entity labels on the **first line** (`ilVatReturn.ts:38–41`, CON-4b review). A saved invoice therefore resolves to the books' profile, whatever its entity label.
- **Probe P8:** an invoice whose first line is labelled `world:il` (Israeli branch, which holds only a VAT registration) is counted in the Texas permit return: `documentCount=1`. With the label honoured, the Israeli branch holds no `sales_tax` registration and the sale would be excluded.
- **Mechanism (b):** when the customer has no `taxPlace`, the buyer's state falls back to `seller.place?.state` (`usSalesTaxReturn.ts:62`). Combined with F1, an untagged sale from an Israeli-labelled entity is attributed to Texas (`P2`).
- **Why P0 candidate:** the mission's P0 list includes a silently wrong financial report or export. This is a silently wrong state sales-tax return (gross and taxable sales, tax collected) with no warning. It is a P0 **only if** a workspace reaches it: a second entity or location label with its own profile, and sales booked under it. Stage-A synthetic testers: **unknown**.
- **Existing tests:** `src/tests/us-sales-tax-return.test.ts` (1 test) does not cover a first-line label or a foreign-labelled sale. Not pinned either way.

### F3 — A US customer whose tax place has no state is dropped without any trace — **P2**, reachability: data-entry dependent
- **Mechanism:** `usSalesTaxReturn.ts:62–63`: `buyerState = place?.country === 'US' ? place.state : …`; when `place.state` is undefined, `buyerState !== state` and the sale is skipped silently. No counter, no warning, no "unassigned" bucket.
- **Probe P3:** a Texas customer with `taxPlace {country:'US'}` (no state) and a $108.25 invoice with $8.25 tax → `documentCount=0`, `taxCollectedCents=0`. The tax is neither reported nor flagged.
- **Note:** `UsAddressHelp` on the tax-profile screen suggests the UI usually captures a state; whether the **customer** place form enforces one was **not checked** (next slice).

### F4 — Two implementations of the buyer-state rule disagree for non-US buyers — **P3**, reachability: any US quarter with a Canadian/foreign zero-tax sale
- **Mechanism:** `usQuarterJourney.ts:322` — `place?.country === 'US' ? place.state : seller.place?.state`. For a **non-US** buyer it falls back to the **seller's** state. `usSalesTaxReturn.ts:62` returns `undefined` (sale excluded). The same sale is therefore excluded from the state return and simultaneously counted as a US zero-tax sale needing an exemption certificate.
- **Probe P4 (real `usQuarterJourney`):** the state return counts 0 documents; the quarter's "Exemption certificates" step reports `Zero-tax sales` count **1** for this Canadian buyer.
- **Impact:** a false "certificate missing" worklist item and a wrong count. Tax figures are not changed by this path. Still a duplicated rule with different defaults (mission strategy question).

### F5 — Set-valued facts ignore a verified copy when an unverified copy of the same value comes first — **P3** (conservative)
- **Mechanism:** `facts.ts:119`: `unique = stated.filter((f,i) => findIndex(value) === i)` keeps the **first** occurrence, then `verified: unique.every(isVerified)` (`:120`). A verified duplicate that appears after an unverified declared one is discarded.
- **Probe P6:** a books-level declared `productCategory: groceries` plus a document-verified `groceries` → `verified=false`.
- **Impact:** a false negative only (a rule that requires verification stays blocked). It cannot pass an unverified fact, so it is not an unsafe pass. Fix: `verified` should be `values.every(v => stated.some(f => f.value===v && isVerified(f)))`.

### Verified-no-finding (controls)
- **P5:** two label dimensions state different `legalForm` values → `conflicts.length === 1` and the first dimension in `order` is chosen, as the comment at `facts.ts:88` says. `evaluateRules` then marks rules reading the attribute `undecided` (read at `rules.ts:65–72`, not executed here).
- **Existing suites, executed (§4):** `tax-profile`, `us-sales-tax-return`, `il-vat-return`, `il-vat-return-golden`, `us-quarter-journey`, `resolve-line-tax`, `rule-rate-table`, `golden-year-fixtures`: **51/51** pass at this SHA.

---

## 3. Probe (executed)

File: `audit/function-audit/probes/af004-tax-authority-probe.ts` · output: `af004-tax-authority-probe.output.txt`

```sh
cd <repo root> && NODE_ENV=test /path/to/tsx audit/function-audit/probes/af004-tax-authority-probe.ts
```

Output at `28b90c2e` (tsx 4.19.2, Node v20.20.2):

```
DEFECT AF-004-P1 place merge across countries: observed {"country":"IL","state":"TX"} (from ["world:il","books"])
DEFECT AF-004-P2 Israeli sale leaks into Texas return: observed documentCount=1, grossSalesCents=10000
DEFECT AF-004-P3 TX sale with US place but no state is silently omitted: observed documentCount=0, taxCollectedCents=0
DEFECT AF-004-P4 non-US buyer: usSalesTaxReturn documentCount=0; real usQuarterJourney certificate step counts 1 zero-tax sale(s)
DEFECT AF-004-P7 US branch sale lands in the Israeli VAT return: observed documentCount=1, taxableSalesCents=10000
OK     AF-004-P5 control: conflicting legalForm reported as conflict: conflicts=1, chosen=llc
DEFECT AF-004-P6 duplicate verified/declared set value stays unverified: verified=false
DEFECT AF-004-P8 US return ignores first-line entity label: documentCount=1
```

"DEFECT" means observed ≠ the contract stated in the source comments. The probe exits 0 by design; it documents and does not gate CI. Limitation: the probe calls the pure functions directly, not through the invoice screens, the API, or a database. Fixtures are synthetic and hand-written (not captured from a real workspace).

## 4. Existing tests executed at this SHA

```sh
for f in tax-profile us-sales-tax-return il-vat-return il-vat-return-golden us-quarter-journey resolve-line-tax rule-rate-table golden-year-fixtures; do
  NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic tsx --test src/tests/$f.test.ts
done
```
Result: 6 + 1 + 1 + 10 + 16 + 3 + 2 + 12 = **51 pass, 0 fail, 0 skipped**. tsx 4.19.2 installed outside the repo (the repo's `node_modules` was not installed in this sandbox).

**Not executed:** `npm ci`, `npm test` (full), `npm run lint:types`, `npm run lint:eslint`, `npm run build`, any `LF_TEST_DATABASE_URL` suite, the `*-gold` worked-figure suites, Playwright. Sandbox: Node 20.20.2 (repo expects 24), 2 vCPU, ~1 GB RAM, no Postgres.

## 5. Adversarial acceptance tests proposed (to add with the fix, not added here)

- **A1 (F1):** books = Texas LLC with a `sales_tax` TX permit; label `world:il` = `{country:'IL'}`, no registrations → `resolveSellerProfile(...).place.state` is undefined and `registrations` is undefined (or refused at save time).
- **A2 (F2a):** invoice with `items[0].dimensions = {world:'il'}`, Israeli branch holding only a VAT registration → `usSalesTaxReturn` for the TX permit has `documentCount = 0`.
- **A3 (F3):** US customer with `taxPlace {country:'US'}` (no state) → the sale appears in an "unassigned" count, or the save is refused; never silently dropped.
- **A4 (F4):** Canadian buyer, zero-tax sale → `usQuarterJourney` zero-tax count = 0 and `usSalesTaxReturn` count = 0 (both agree).
- **A5 (F5):** `[unverified groceries, verified groceries]` → `verified === true`.

## 6. Unknowns and next steps

1. **Reachability (decides P0 vs P1 for F1/F2):** can a stage-A tester create a label profile in another country or state? Ask AI #1 / owner. Check `TaxProfilesSettings` save paths and `taxProfilesProblem` callers in `src/server/`.
2. Read `src/components/sales/TaxPlaceSuggestion.tsx` and the customer tax-place form (whether `state` is required for US places) — next slice.
3. Run the same probes through the real invoice save path with a Postgres fixture (the F2 `items[0]` shape comes from the screens, not from a fixture written by hand).
4. Review `src/lib/rules/packs/*` for `requiresVerified` usage and whether any pack relies on `composeFacts.verified` for a legal status.
5. Owner-facing question: whether an entity profile in another jurisdiction should inherit anything from the books at all (design decision, mission strategy question).

## 7. Cross-references

- Existing audit register: `audit/function-audit/SCORECARD.md` (slices 1–3, pin `8df972d`) · PR #10 (AF-011/012, pin `50ee1205`, open on fork) — this slice does not duplicate AF-011 or AF-012.
- Related issue lineage: #342 (date contract, AF-011), #161 (rule chains, AF-012). No issue opened by this slice (no GitHub write access; see `audit/function-audit/issue-drafts/` for the drafting convention).
