# Audit scorecard — Agent #7 slice (10 Nov 2026)

**Owner:** Agent #7 (independent audit, review-only) · **Umbrella issue:** [#150](https://github.com/shmuelbiller1/ledgerflow/issues/150)
**Pinned SHA:** `dc40739708a013ad080ffb306fe461554a2391fc` (upstream `main`, 2026-11-10T03:08Z). Executed evidence ran at this SHA, or at `5968faf3` whose code tree is identical (`git diff --stat 5968faf3..dc4073970` = `docs/COORDINATION.md` only).
**Owner-facing list:** [`../FINAL_ACCURATE_LIST_2026-11-10-agent7.md`](../FINAL_ACCURATE_LIST_2026-11-10-agent7.md) · **Fork PR:** https://github.com/Chaim-Richard/ledgerflow/pull/17 · **Drive:** folder `2026-11-10 final accurate list session` (`1rWocRGHuq834BzET46Bq3PsmFxhvNFMd`)

## What this slice was

A **status re-verification** at the latest pin, not a function-by-function pass: every open GitHub issue (15/15) re-checked against source and, where executable, re-executed; CI at the pin verified; a new defect found on `main` (documentation integrity, fixed in this slice); the 2026-11-08 list resolved (it contained unresolved git conflict markers).

## Executed at this pin

| Evidence | Result |
|---|---|
| `probes/af012-rule-chain-order.mjs` (real `evaluateRules`) | order A,B,C → applied A,C; B,A,C → A; C,B,A → A — **#161 reproduces** |
| `probes/af012-shipped-pack-chains.mjs` (all shipped packs) | 18 packs · 584 rules · 67 overrides · **0 nested chains · 0 dangling targets** |
| `probes/af004-tax-authority-probe.ts` (real `usSalesTaxReturn`/`israelVatReturn`/`resolveSellerProfile`) | P1,P2,P3,P4,P6,P7,P8 **reproduce**; P5 control holds |
| `probes/af004-519-customer-moves.ts` (new) | #519 **reproduced end-to-end** through `saleDestinationSnapshot` → return counts the sale only while the customer remains in TX |
| Focused suites at the pin | 38/38 pass (6 suites incl. `rules-engine-properties` 6/6, `iss160`, `collection-retry`, `calendar-dates`, `civil-date-properties`, `aud01-statement-scope`) |
| Conflict-marker sweep (`git grep '^(<<<<<<<|>>>>>>>)'`) | 1 hit → `FINAL_ACCURATE_LIST_2026-11-08.md` (fixed in this slice) |
| Conflict-guard search (CI for markers) | none exists → suggested to lead (#599) |
| GitHub issue states | all 15 re-read: all OPEN; last close was #444 (2026-10-30) |
| Upstream `main` CI at the pin (2026-11-10T03:08Z) | **success**: lint/typecheck/**Postgres-17 rules**, unit 1–4/4 + Auckland/LA timezone legs, coverage gate, production build, browser 1–5/5, Playwright smoke; ESLint ratchet, SBOM, CodeQL success |
| Local full `npm test` | stalled (no output, ~0 CPU after ~55 min; no Postgres in sandbox); **stopped, not claimed** |

## Coverage (honest counts)

- Files read fully at this pin: **9** (`rules.ts`, `usSalesTaxReturn.ts`, `usInvoiceTax.ts`, `profile.ts`, `ilVatReturn.ts`, `usNexusWatch.ts`, `calendarDate.ts` (partial — the contract block), `useLedgerData.ts`, `statementService.ts`, `israelMonthJourney.ts`, `returnAuthorizationRoutes.ts`) ≈ **11**.
- Functions executed via probes at this pin: **5** (`evaluateRules`, `usSalesTaxReturn`, `israelVatReturn`, `resolveSellerProfile`, `composeFacts`) plus the **2** newly added (`saleDestinationSnapshot` path via #519 probe).
- Issues adjudicated: **15 open issues + 1 new conflict-marker finding (#599)**.
- Not performed: function-by-function Pass A beyond this set; no DB/RLS run here (CI-only); no browser run; no production-data access. Indexing ≠ review.

## Findings register (delta vs the AI #8 scorecard @ 50ee1205)

| ID | Sev | Finding | Lane | Tracked |
|---|---|---|---|---|
| **#599** | P1 (docs) | `main` carried an unresolved merge conflict in `FINAL_ACCURATE_LIST_2026-11-08.md` (`2245ff43`); also the reason two contradictory "FINAL" lists were on `main` | lead / owner | **issue #599** (fixed in this slice) |
| #161 / AF-012 | P2 latent | Chained overrides order-dependent; 0 shipped chains; no chain property test | AI #9 money | issue #161 |
| #519 / AF-004 | P1 | State return ignores #255 destination snapshot; customer move rewrites past attribution | AI #1/#9 | issue #519 |
| #517 / AF-004 | P1 | US return ignores line entity labels (`documentEntityLabels` unused) | AI #1/#9 | issue #517 |
| #518 / AF-004 | P1 | Unknown-state sales silently dropped; no counter surfaced | AI #1/#9 | issue #518 |
| AF-004-P1/P2/P4/P7 | P1–P2 | Books registrations/place leak into labelled entities (TX return & IL VAT return); two buyer-rule implementations disagree | AI #1/#9 | this audit; #517–#519 family |
| #131 | — | Stock side truthful (merged); residual = server full-history books figure (issue point 4) | AI #1/#9 + EG-7 | issue #131 |
| #130 | — | Code fixed (#259); ISS-130 migration superseded by owner-run 21 Oct migration | verify on live DB → close | issue #130 |
| #96/#141/#146/#342/#160/#143 | — | Fixed at the pin; all six still open on GitHub | lead: verify + close | see list §4 |

## Beta readiness (FIRST_TESTERS_GATE)

**NOT CERTIFIED.** Stage A G-01…G-08 have in-repo/CI evidence for most rows but need deployed-site checks (owner). Stage B blocked by live G-16 defects (#517/#518/#519), G-17 (owner config), G-12 (DIM-3 open), and the #131 residual. Full matrix in [`../FINAL_ACCURATE_LIST_2026-11-10-agent7.md`](../FINAL_ACCURATE_LIST_2026-11-10-agent7.md) §10.

## Proposed next 10-function batch (for the next audit agent)

Re-verify the **tax-attribution family at the fix**: `documentEntityLabels` · `resolveSellerProfile` (registrations inheritance branch) · `registrationsOn` · `registrationKey` · `exemptionOn` · `taxReturnDocument` · `buildTaxReturn` · `COUNTED_SALES` · `usQuarterJourney` (certificate zero-tax step) · `saleDestinationSnapshot` — i.e., pin the shared contract the money lane will touch for #517/#518/#519, then re-run the AF-004 probe and expect every DEFECT row to flip to OK without touching `P5`/`P6` behaviour. Then re-execute `rules-engine-properties` extended with a permutation-independence property for chained overrides (#161).

## Limitations

No DB/RLS execution in this sandbox (verified only through CI's Postgres-17 job). No browser run. No production access. Full unit suite **not claimed** (stalled locally; CI green at the pin instead). This slice is a status audit, not a launch approval.
