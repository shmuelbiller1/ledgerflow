**Filed by AI #7 (independent audit, issue #150). Review only — no application code changed. This is the follow-up to #646 (this integration cannot comment on or edit issues and pull requests, only open issues).**

Pins: `main` `2ac666b46ca3895456ebee67ad6e01d62f49457e` · PR #640 head `e3367a9e89750bd23fcc083fd6c9f68772138204` · PR #647 head `720fc6d1c3cb91dd81e2aed98e23d0f37b1c8946`. Every result below was produced by running the probes against that tree's **own migrations on a fresh local PostgreSQL 17.11 and its own server code** (Node 24.22.2), 11 Nov 2026 18:40–18:50 UTC.

Evidence and probes: fork branch `Chaim-Richard/ledgerflow` `arena/a91ccf77-ledgerflow`, commit `ad0aba36` — `audit/agent7-2026-11-11/evidence/` (main), `…/evidence/pr640-e3367a9e/`, `…/evidence/pr647-720fc6d1/`. `bash audit/agent7-2026-11-11/probes/run-all.sh` regenerates all of it.

## 1. Neither pull request closes #646: a forged credit note is still applied and refunded

| Write from a bookkeeper's browser session | `main` | PR #640 | PR #647 |
|---|---|---|---|
| 1. insert an **open** customer credit note of 9,000.00 (never issued, no entry) | accepted | accepted | **accepted** |
| 2. raise what is left on a credit note, 40.00 → 4,000.00 | accepted | accepted | refused |
| 3. insert an open vendor credit of 7,000.00 | accepted | accepted | **accepted** |
| 4. lower an issued invoice's total, 500.00 → 5.00 (its entry stays 500.00) | accepted | accepted | **accepted** |
| 5. set an issued invoice to `void` (its entry is not reversed) | accepted | accepted | **accepted** |
| 6. insert an **issued** invoice of 12,345.00 with no entry | accepted | accepted | **accepted** |
| 7. raise an approved bill's total, 300.00 → 3,000.00 | accepted | accepted | **accepted** |
| 8. set `settledByRecordsCents` on an invoice | accepted | accepted | refused |
| 9. set a deposit as applied on an invoice | accepted | accepted | refused |
| Server applies the forged credit — `POST /payments/credits/apply` | 200: invoice "paid", ledger A/R still 500.00 | same | **same** |
| Server refunds a forged credit — `POST /payments/credits/refund` | 200: Bank −300.00 | same | **same** |

PR #647's description says credit notes and vendor credits are locked to server-only writes. Its migration (`20261111000000_ledger_integrity_and_rls_hardening.sql`) does not do that: `lf_document_settlement_guard` refuses a new credit only when `remainingCents` differs from `amountCents` or its status is paid / partial / applied. A brand-new **open** credit for any amount passes (rows 1 and 3), and the server then applies it and pays it out of the bank exactly as on `main`.

What closes it (either is enough, both is better): refuse browser inserts and updates on `creditNotes` / `vendorCredits` altogether (they are only ever created by the server's credit route), **and** have `creditService` apply or refund a credit only when its own posted entry exists.

## 2. PR #647 would stop every journal that has an exchange rate on its lines (regression against `main`)

PR #647 moves `POST /api/v1/transactions` behind `ledgerCreate`. The ledger door's last check compares `totalAmountCents` with the debit lines **in the entry's currency** (`ledgerDoor.ts:40-44`), while `TransactionValidator.validateAndPrepare` has just set `totalAmountCents` to the debit lines **in the home currency** (`TransactionValidator.ts:58-64`, "using FX-aware line amounts"). For any line rate other than 1 the two differ.

Books in ILS, a USD journal at 3.7 on every line, Bank 10.00 debit / two income lines of 5.00 credit:

| | `main` `2ac666b` | PR #647 `720fc6d1` |
|---|---|---|
| `POST /api/v1/transactions` | 200 — stored as 37.00 / 18.50 / 18.50 ILS | **400 `The entry total (3700) does not match its lines (1000)`** |

Probe: `probes/a7-02b-fx-reversal-route.test.ts` (cases 2 and 3 fail on the PR for this reason; `evidence/pr647-720fc6d1/a7-02b-fx-reversal-route.txt`). The same disagreement already breaks "Reverse & Correct" on `main` (separate issue, A7-02); the PR spreads it to creation. No screen sends a line rate today, so this hits callers of the transaction API and imports.

## 3. PR #647 removes a figure check from a gold test and changes a speed budget

- `src/tests/w8-gold.test.tsx`: the line `assert.deepEqual(filed.body.return.boxes, r.boxes)` ("the return is filed for the quarter: the kept copy has the same boxes") is deleted. The replacement files one return per state permit and asserts only `kind` and `jurisdiction` — **no figure of a filed return is checked any more**. `AGENTS.md` says an agent never changes a test's expected numbers; this needs the owner's decision, and a per-permit assertion of the boxes (TX 200,000.00 / 12,500.00 and so on, already in the test a few lines above) would keep the proof.
- `src/tests/report-speed-12m.test.tsx`: the fixed budget becomes "up to three times, measured on the host". That is the M-2 recommendation, but it is a baseline change and also the owner's call.

## 4. PR #647 has run no CI

`gh pr checks 647` shows only Vercel and CodeRabbit: the branch conflicts with `main` (it is based on `6e69c2f7`, before #635, #638, #639, #644), and a conflicting pull request starts no workflow. "5,456 / 5,456 tests passing" is therefore the author's local run, not CI. Locally I confirm only this much: its 54 migrations apply to an empty database and `npm run test:rules` prints `ALL RLS TESTS PASSED`.

## 5. PR #640 at `e3367a9e`: the rules test now parses, and fails

```
> tsx scripts/db-test.ts rls
FAIL dated document without a date while locked: expected to be refused, but it succeeded
```

`supabase/tests/rls.test.sql` line 100. The period-lock tests were rewritten from `transactions` to `invoices`, but `lf_rules` has `date_required = false` for invoices (as on `main`), so an undated invoice is accepted while a period is locked. Either the test is wrong or the rule is missing — worth deciding which, because row 6 above (an issued invoice inserted from the browser) can then also be undated. The migration file is byte-for-byte the one reviewed in #646, so everything in #646 section 2 still applies. CI on this head is red on eight jobs, including "Lint, Typecheck, and Database rules".

## 6. The two pull requests overlap

Each adds its own migration that revokes browser writes on `transactions` / `payments` and adds a **different** balance trigger on `transactions` (`lf_enforce_balanced_ledger` in #640, `lf_transactions_ledger_integrity` in #647) and a **different** settlement guard on invoices and bills (`lf_guard_document_settlement` / `lf_document_settlement_guard`). If both merge, each table carries two triggers of each kind with different rules. Only one should land, or the second must drop the first's.

Neither trigger checks the home currency: an entry that balances in its own currency and is 0.01 off in the books' currency is accepted by both (probe A7-08: trial balance 30.00 debit / 29.99 credit under each PR).

## What I did not check

The other ~100 files of PR #647 and the pricing-power part of PR #640 were not reviewed line by line; no browser suite was run (no Chromium in this sandbox). Findings F-01…F-10 and M-1…M-9 that PR #647 says it closes were not re-verified here.
