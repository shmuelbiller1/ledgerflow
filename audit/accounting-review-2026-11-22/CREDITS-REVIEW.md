# Credit notes and refunds — partial review

**Revision:** `9b815a58ebbe1d0f99c44f908ee77b7fbaa73705` · **Status:** incomplete; no release approval. Tests used real document and payment routers with an injected synthetic identity and an isolated PostgreSQL 18.7 database (migrations and plain-Postgres auth stubs), not hosted Supabase or real customer data.

## CR-01 — Foreign-currency credit refunds use default 1:1 line rates and fail to clear control balance (P0 for affected requests)

This is a concrete independently reproduced caller of **CL-01**, not a separate root cause. In USD books issue a customer credit of **€100** at **$1.20/€**. Issuance debits sales returns and credits A/R by **$120**. Refund the full €100 assuming the refund-day rate is also $1.20/€: it should debit A/R and credit cash by **$120**, leaving zero on this credit in A/R (no FX difference at the same rate). The real refund route instead saved lines with default exchange rate 1 and **debit A/R $100 / credit cash $100**, marked the credit fully used, and left a **$20 credit** in A/R. If the actual refund-day rate differs, cash must reflect that rate and an appropriate gain/loss is also needed; this test assumes equal rates and does not claim knowledge of a live transfer.

`src/server/services/creditService.ts:428-446` builds refund line amounts in the credit currency but supplies the exchange rate only on the header; `TransactionSchema` defaults line rates to one, and the validator prefers those. The credit issuance path already translates to home currency (`src/services/ledgerPost/creditPosting.ts`). The linked [core ledger review](CORE-LEDGER-REVIEW.md) explains the common schema/validator mechanism. This synthetic test traces an actual issued credit and subsequent refund through both routers and persists both journals; it does not establish real-world incidence or validate actual authentication. Test both customer/vendor direction, all currency exponents, partial refunds and FX rates, before/after corrections and reports. Do not merely force a header rate onto already-home-currency entries.

## CR-02 — Refund can be dated before the credit was issued (P2; policy and legacy cases require review)

A separate USD credit dated **May 10** was issued and fully refunded on **May 1** through the refund route; both were saved. The refund journal precedes the credit in chronological reports even though it is recorded as a refund *of that credit*. The credit-application path enforces application dates (`creditService.ts:235-243`), but `refundCredit` (`:395-417`) checks period lock and remaining balance without comparing the refund date to the credit date. If refunds before the credit's stated issuance date are intended, their economic basis and date semantics need explicit policy and treatment; otherwise reject the inconsistent chronology. This is not proof that a genuine underlying obligation did not exist before formal issuance.

**Acceptance:** Define credit issuance and refund effective-date policy with accounting review; enforce it consistently in service/command boundaries, or explicitly represent valid earlier advances with the correct liability. Test pre/post period boundaries, created-versus-effective dates, time zones, legacy documents, reversals and idempotent recovery.

## Execution

```sh
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/credit-refund-database.test.ts
```

The diagnostic passed while asserting the current outcomes, and deleted the synthetic workspace. Corrected behavior should make these assertions fail; rewrite as acceptance tests. Foreign settlement rates, rounding, concurrency, credit applications, tax and vendor returns remain open, along with actual authenticated browser and hosted deployment. No product code was changed.
