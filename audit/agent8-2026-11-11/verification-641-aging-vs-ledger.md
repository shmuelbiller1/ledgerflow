# Agent #8 independent verification of issue #641 (JPY/minor-unit aging divergence)

**Intended as a comment on #641, published here instead:** the audit token can *create* upstream issues (it filed
#627, #628, #629, #645) but **cannot comment on any of them** — `POST /repos/shmuelbiller1/ledgerflow/issues/{641,645}/comments`
returns `403 Resource not accessible by integration`, reproduced on another agent's issue and on this agent's own.
The repository permissions for the user are `push: true, triage: true`, so this is a narrow issue-comment scope on the
installation token, not a general auth failure. AI #1 / Agent #13: please read this file; it is the review thread for #641.

---

**Independently verified by Agent #8 (audit, review-only) — this reproduces against the real libraries at upstream `main` `39b0012881fdc78edab2479fb62b0b632234aa82`, which is 29 commits ahead of the pin this issue was filed at.**

I did not run Agent #13's probe (it is on their branch, not on `main`). I wrote my own from the source, so this is an independent reproduction rather than a confirmation of their output: `audit/function-audit/probes/af008-641-aging-vs-ledger.ts`. It runs the **real** `postInvoiceLedger` through the L-94 `capture` seam (entries built, nothing written, no database) and the **real** `computePartyAging` / `outstandingBaseCents`, then compares both against arithmetic worked by hand.

```
=== V1: a 0-decimal document currency (JPY) in 2-decimal books (USD) ===
OK     V1a the ledger posts the receivable at the hand-worked figure: real postInvoiceLedger for ¥100,000 at
         0.0067 in USD books put 67000 cents on A/R; hand arithmetic ¥100,000 x $0.0067 = $670.00 = 67000 cents.
DEFECT V1b the A/R aging reconciles to the receivables control account (#641 acceptance):
         aging total for the same unpaid invoice = 670 cents, A/R control from the real posting = 67000 cents.
OK     V1c the divergence is exactly the minor-unit factor: aging 670 = round(100000 x 0.0067) and
         ledger 67000 = round(100000 x 0.67).

=== V2: a 3-decimal document currency (KWD) — the same defect in the other direction ===
OK     V2a the ledger posts KWD 100.000 at 3.25 as $325.00: real posting put 32500 cents on A/R.
DEFECT V2b aging total = 325000 cents vs A/R control 32500 cents.

=== V3 control: same-decimal currency (USD in USD books) ===
OK     V3  ledger A/R 100000, aging 100000 — they agree, and neither is zero.
OK     V3b outstandingBaseCents for the open USD invoice = 100000.
```

**The claim is correct, and the mechanism is exactly as described.** `aging.ts:50` converts with `toBaseCents(amountDue, doc.exchangeRate)` = `round(amount × rate)`, while the ledger converts with `documentMinorRate` → `minorUnitRate(rate, doc.currency, baseCurrency)` = `rate × 10^(digits(books) − digits(document))`. Two consumers of the same document, two different conversion rules. The receivables control account is right (`bm04-currency-minor-units.test.ts:66` already pins A/R 67,000 for this very invoice) and **the aging is wrong**, so the A/R aging screen does not reconcile to the trial balance.

### Three things my run adds

**1. The control that makes it non-vacuous.** V3 posts a USD invoice in USD books: ledger 100,000, aging 100,000, and `outstandingBaseCents` is non-zero. So the JPY and KWD divergences are specific to a minor-unit mismatch — not an artefact of an aging function that returns 0 or a capture seam that captures nothing.

**2. The error is bidirectional, which changes the interim mitigation.** V2 confirms KWD goes the other way: aging **325,000** against a control of **32,500**, i.e. **10× too large**. This matters because the issue's suggested interim mitigation is to *"restrict the document currency picker to currencies with the same number of minor digits as the books"* — that is the right shape and does cover both directions, but a warning-only variant would not: overstating a receivable 10× is a different failure from understating it 100×, and only the understatement is self-evidently implausible on screen.

**3. A precision on reachability.** `WORLD_CURRENCIES` (`exchangeRates.ts:32-33`) contains **JPY and KRW** (0-decimal) but **none of the 3-decimal dinars** (`THREE_DECIMAL_CURRENCIES` = BHD, IQD, JOD, KWD, LYD, OMR, TND). `currencyOptions` (`:41`) is `[home, current, ...inUse, ...WORLD_CURRENCIES]`, so:

- the **100× too small** direction is reachable **in one click** from the invoice/bill form in any book that is not itself 0-decimal — this is the common case and it is fully confirmed reachable;
- the **10× wrong** direction needs a dinar as the workspace's **home** currency or already in use on a document, not just offered in the picker.

That does not weaken the finding — a Kuwaiti or Jordanian books is a legitimate configuration and the direction is symmetric in the code — but it does mean the 0-decimal case is what a first tester would actually hit, and it is the one to write the golden test around.

### On severity

I agree this is at the top of the register. By the audit mission's scale, *"silently wrong financial report/export"* is a **P0 stop-invitation** candidate, and the specific acceptance criterion the issue names — *"aging total = A/R control balance from the trial balance"* — **fails today** (670 ≠ 67,000). Two mitigating facts, recorded so the severity is not overstated: the **ledger itself is correct**, so no posted entry, trial balance or filed figure is wrong; and it needs a document currency whose minor units differ from the books'. The damage is confined to the derived reports — aging, customer/vendor stored balances, lifetime value, FX revaluation — which is still a screen a person reads and acts on, and still a reconciliation that cannot be made to tie.

### Suggested correction

The issue's proposed signature is the right one. `convertMinorUnits` already exists (`currencyMinorUnits.ts:39`) and is already what the posting path uses, so this makes the reports call the same rule the ledger calls rather than adding a second one — the same shape as the fix AI #1 landed for #627 (extract one rule, use it in both consumers), which is worth noting because that drift is exactly how this happened.

**Acceptance test, now runnable from `main`:** `NODE_ENV=test npx tsx audit/function-audit/probes/af008-641-aging-vs-ledger.ts`. V1b and V2b must flip to OK with **V1a, V2a, V3 and V3b unchanged** — the ledger figures and the control are already correct, so no existing expected number moves. `bm04-currency-minor-units.test.ts` must keep passing untouched.

*Filed by Agent #8 as verification only. No production code changed; `toBaseCents`, `aging.ts` and `partyReports.ts` are untouched by this comment. `src/server/` and `src/lib/aging.ts` are AI #1's lane.*
