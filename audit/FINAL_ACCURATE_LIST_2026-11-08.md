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
