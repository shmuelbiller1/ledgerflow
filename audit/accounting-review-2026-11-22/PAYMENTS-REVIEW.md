# Payment and allocation audit — partial

**Revision:** `9b815a58ebbe1d0f99c44f908ee77b7faa73705`. **Status:** in progress, not release approval. Independent probes used synthetic documents, an isolated PostgreSQL 18.7 with all repository migrations and stub auth, and real document/payment HTTP routers with a test-injected owner identity. This does not test actual authentication or hosted Supabase. No customer data or real financial transaction was used.

## PM-01 — Initial payment accepts mismatched customer/vendor and allocations to another party (P1)

**Worked synthetic example:** Post Bob's $100 invoice and then submit a $100 customer receipt identifying Alice but allocating it to Bob's invoice. The payment endpoint returns success, marks Bob's invoice $100 paid, and writes its allocation row with party `alice`. An ordinary receipt from Alice should not silently extinguish Bob's receivable: absent documented third-party-payment authority and correct allocation ownership, reject the mismatch and leave the invoice and allocation ledger unchanged. Even where a third party may legally pay a debt, the payer and document owner must be distinguishable, not recorded as if Alice owns Bob's invoice.

**Mechanism:** `src/server/commands/payments.ts:17-47` accepts customer/vendor IDs and allocation list without enforcing party consistency; `src/server/services/paymentService.ts:293-355` checks workspace, status, amount, date, currency but does not compare a document's party with the payment party. Allocation rows at `:569-572` use the supplied customer/vendor before the actual document's party. `applyUnappliedPayment` has a party check (`:653-671`) but the initial payment route does not.

**Scope:** Reproduced against the route in a controlled crafted request; we have not established whether the ordinary payment UI lets a user construct this request, or whether any live payment is affected. Third-party payments, split payments and missing party IDs need explicit supported accounting policy rather than an assumption that every mismatch is invalid.

## PM-02 — One payment accepts invoice and bill allocations and records payable as receivable (P0 for affected requests)

**Worked synthetic example:** Post Carol's $100 invoice (debit A/R, credit sales) and David's $100 bill (debit expense, credit A/P). A single $200 request identifying Alice allocates $100 to each, even though one is a receipt and the other a payment. The endpoint returns success; both documents show $100 paid. It posts a **$200 cash debit and $200 A/R credit**, with **no debit to A/P**. The bill's payment-allocation row says `documentType: bill`, `side: receivable`, `partyId: alice`. In this probe, another $100 Bob-invoice receipt brings total cash to $300; after the two $100 invoices and one $100 bill are all shown paid, the actual account balances are **A/R credit $100** and **A/P credit $100**, rather than zero open-item control balances.

A properly supported $100 customer receipt plus $100 vendor payment would debit and credit cash $100 separately (net zero), credit A/R $100 and debit A/P $100. A legitimate contra settlement would require its own authorization, same-counterparty checks and proper netting entries; it is not a $200 cash receipt. The submitted $200 request may itself be nonsensical, and the essential defect is that the server accepts it and creates authoritative mismatched records instead of rejecting it.

**Mechanism:** In `paymentService.ts:293-355` mixed types pass the document loop; `:370,405` classify the entire payment as received when any invoice is included. A single resolved offset account is used for all allocations (`:353-355,521-531`), and every allocation is stamped with the same receivable/payable side (`:562-572`). The input schema does not prohibit mixed types. Database row constraints in the tested migrations do not prevent a receivable-side bill row. By contrast later advance application checks type (`:664-665`).

**Scope/acceptance:** Crafted authenticated-identity route request in isolated DB, not proof the ordinary UI emits it or that live books are affected. Enforce direction, party and control-account compatibility at the shared transactional boundary, including direct command, bulk, webhook and import callers; reject mixed direction unless a dedicated, explicitly designed contra-settlement workflow applies. Verify idempotent retries, void/reversal and reconciliation, mixed currencies, aliases/third-party payers, and concurrent changes. Investigate whether existing books contain side/type/party mismatches before any correction. Source of real cash must remain independently verified.

## PM-03 — Initial payment can settle a cancelled, unposted invoice (P0 for affected requests)

**Worked synthetic example:** A $100 invoice is created with `cancelled` status. The document posting router saves it without an invoice accrual journal, so there is no related receivable. A subsequent $100 receipt allocated to that invoice returns success, changes the invoice to `paid`, and creates **debit cash $100 / credit A/R $100**, producing an unsupported credit to receivables. A cancelled invoice should not be silently converted into a paid invoice. If actual money was received, it needs a supported, independently justified deposit or other appropriate treatment, not settlement of an unposted receivable.

**Mechanism:** `postInvoiceLedger` treats `cancelled` (also `rejected`) as unposted (`src/services/ledgerPost/invoicePosting.ts:26-29,80-86`), while the initial allocation loop in `paymentService.ts:305-310` explicitly refuses only `void` and `draft`. Settlement then updates status and posts the receipt. A cancelled invoice was tested; the exact behavior of rejected, legacy or other statuses has not yet been independently verified.

**Scope/acceptance:** The real document and payment routers were exercised with a crafted request, test-injected owner identity and local database; no evidence that a normal UI permits it or that actual cash was received. The shared payment boundary must require a valid, posted, payable/receivable document (not merely a non-draft/non-void string), and refuse invalid state atomically. Test state transition races, cancelled/rejected/void/draft/archived/legacy records, document reversals, reopened documents, deposits, voids and payment-ledger/control-account reconciliation.

## PM-04 — Paying invoice retainage leaves false balances in both receivable accounts (P1)

**Worked synthetic case:** Issue a $100 invoice with $10 contractual retainage, then receive $90 and later receive the $10 retained amount after it becomes payable. The issuance correctly debits **trade A/R $90** and **retainage receivable $10**, and credits sales $100. Once both amounts have genuinely been paid, the two receivables should each be zero: the final $10 needs to credit retainage receivable, or a separately documented release must first reclassify it to trade A/R. The actual document and payment routes record both receipts entirely against trade A/R. The invoice shows paid and cash is $100, but **trade A/R is credit $10 and retainage receivable debit $10**. The net is zero while the individual accounts are wrong, obscuring aging and account-level reconciliation.

**Mechanism:** Invoice template splits trade and retained receivables (`TransactionTemplates.ts:164–186`), whereas `calculateAmountDue` does not separately identify the held portion and `paymentService.ts:352–355,523–528` uses one normal offset account for all allocations. A metadata-only bill retention schedule explicitly does not change ledger balances; it is not evidence that this invoice's retainage was released. The test does not claim the normal UI exposes this exact two-payment sequence or that every construction contract has identical release terms; it uses the documented field and actual server routes with an injected identity and isolated DB. Bills, credit notes, FX and void/release workflows remain untested here.

**Acceptance:** Define held-versus-released amounts and due dates, track release with an auditable reclassification or route payments to the proper account, and ensure invoices, payment allocation rows, aging and each control account reconcile through partial payments, releases, reversals, contract variations, FX and period close.

```sh
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/retainage-database.test.ts
```

1 diagnostic passed, asserting the current wrong balances. It should fail when corrected until converted to acceptance tests.

## Reproduction and other evidence

```sh
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/payment-party-database.test.ts
```

The diagnostic passed while asserting current defective outcomes, and cleans its synthetic workspace. A correct fix should make those assertions fail; replace them with rejection/acceptance cases. The separate 97-test isolated DB workflow batch passed its included payment allocation/FX/void cases, including €400 at 1.12 and €500 at 1.08, and bill withholding. Passing those tests is not proof of the party or direction safeguards above. These four findings do not complete the payment, allocation, authorization, refund or reconciliation audit; no product code was changed.
