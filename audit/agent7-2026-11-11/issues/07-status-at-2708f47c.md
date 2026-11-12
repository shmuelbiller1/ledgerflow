**Filed by AI #7 (independent audit, issue #150). This integration can open issues but cannot comment on or edit them, so the status of my open issues after today's merges is collected here. Review only — no application code changed.**

Pin: `main` `2708f47cb40711e57032bf6d3d4acc9f10f1061d` (PR #647 and PR #655 merged). Every probe named below was re-run at this commit on 11 Nov 2026, 20:27 UTC: real routers in-process, local PostgreSQL 17.11 with `main`'s 54 migrations, Node 24.22.2. All twelve probes complete; output in `audit/agent7-2026-11-11/evidence/main-2708f47c/` on the fork branch.

## Where each issue stands

| Issue | What it reported | At `2708f47c` |
|---|---|---|
| lead's C-1 | A browser session writes the ledger tables directly | **Closed.** All six writes are refused (`permission denied for table transactions` / `payments`; setting an invoice to paid is refused by the settlement guard) |
| #646 | Browser writes to documents that the server then trusts | **Partly closed.** Refused now: raising what is left on a credit note, `settledByRecordsCents`, `depositAppliedCents`. **Still accepted:** inserting an open credit note or vendor credit of any amount; lowering the total of an issued invoice; setting an issued invoice to void; inserting an issued invoice with no entry; raising the total of an approved bill. The server still **applies** a credit note that was never issued (`POST /payments/credits/apply` → 200: invoice paid, A/R still 500.00) and **refunds** one (`POST /payments/credits/refund` → 200: bank −300.00) |
| #652 | A bookkeeper voids, rewrites or reverses the ledger entry of an invoice or a payment | **Open, unchanged.** Three requests, each 200. See the addition below |
| #653 | A foreign invoice paid in instalments leaves −0.01 in Accounts Receivable | **Open, unchanged** |
| #654 | Entries at a foreign rate | **Changed, not closed** — next section |
| #656 | `POST /workspaces/:id/seed` writes into a hard-closed month | **Open.** As the issue said of PR #647: the demo accounts' ids now match and one audit row is written. It still posts two entries into the closed month, leaves the demo invoice and bill without entries, is not marked as demo, cannot be cleared (`/transactions/reset` → 409), and a second call adds a second INV-DEMO-001 |
| #657 | The ledger-door ratchet counts 0 direct writes | **Open.** 14 direct writes in 11 files now (18 in 14 before); the scanner still counts 0. The same three have no shared check: `workspaceRoutes.ts:724`, `paymentService.ts:493`, `recurringService.ts:261` |

## #654 after PR #647

| Case | Before (`2ac666b`) | Now (`2708f47c`) |
|---|---|---|
| Journal with a rate on every line — `POST /transactions` | created; "Reverse & Correct" refused (400) | **refused when created**: `400 The entry total (9139) does not match its lines (2470)`. With nothing to settle (10.00 / 5.00 / 5.00): `400 The entry total (3700) does not match its lines (1000)`. The validator writes the total in the books' currency, `checkLedgerEntry` compares it with the debit lines in the entry's currency, and that check now also runs on create |
| Currency and rate on the entry only, lines in that currency | 200, counted one for one | unchanged: 24.70 USD at 3.7 enters ILS books as 24.70 |
| Recurring job, template in EUR at 1.5 | posts 10.00 debit against 9.99 credit | unchanged. Trial balance 3000 / 2999, `isBalanced: false`, Data Health reports nothing. The new database trigger (`lf_transactions_ledger_integrity`) adds the lines up in the entry's own currency, where 3.33 + 3.33 − 6.66 = 0, so it lets the entry in |

**The journal screen is not affected (checked, new probe A7-02d).** `JournalEntryModal.tsx` converts each line to the books' currency in the browser, adds a rounding line and posts an entry in the books' currency. That payload: 200, valued as worked by hand (91.39 / −45.69 / −45.69 / −0.01), reversed exactly. Same at `2ac666b`. So the refusal above reaches API callers and imports, not the screens.

One sentence of #654 needs correcting: it said the finding becomes High "the day a multi-currency journal screen ships". A multi-currency journal screen exists; it is safe because it converts in the browser. The risk is a writer that stores a journal **in the foreign currency** with a rate on its lines.

## Addition to #652 — the ledger list offers the change itself (read in source, not run in a browser)

#652 said the rule that protects an invoice's or payment's entry exists only in the browser. It is narrower than that: `isDocumentEntry` / `isHandEntered` guard only the **inline cells** of a row (`TransactionRow.tsx:135`, `:146`). The **"Edit Transaction Details"** button on the same row (`TransactionRow.tsx:422`) opens `TransactionEditModal` for any entry in an open period; its `handleSave` (`TransactionEditModal.tsx:156-249`) checks the period, the description, the accounts and that the lines sum to zero — not where the entry came from — and saves through `PUT /api/v1/transactions/:id`, the request probe A7-04 shows the server accepting (200) for an invoice's entry. So this is reachable by clicking, not only by a hand-made request.

## Update to #650 (PR #647 / PR #640 review)

- §4 and §5 are history: PR #647 was merged with its checks passing; PR #640 is at a new head (`b4f312bf`, merged with `main`, checks running) that I have **not** tested.
- §3, test changes in PR #647. I **withdraw two of the three**: the removed `supabase/tests/rls.test.sql` cases follow from `transactions` becoming server-only (the period-lock cases moved to `invoices`), and `route-policy-coverage.test.ts` was rewritten to check each route registration, which is stricter. The speed-budget bullet was already reverted before the merge.
- §3, the one that stands: `src/tests/w8-gold.test.tsx` lost `assert.deepEqual(filed.body.return.boxes, r.boxes)`; the replacement checks only `kind` and `jurisdiction`. At `2708f47c` **no test compares the figures of a filed (kept) tax return with anything** (`rg "deepEqual\([^)]*boxes" src/tests` finds only the preview). `fileTaxReturn` now builds a state permit's kept copy from `usSalesTaxReturn(… order: [worldId] …)` (`taxReturnService.ts:103-112`); nothing pins that this equals what the US quarter screen shows for that permit. I did not run a case — this is a missing test on new tax code, not a demonstrated wrong figure. Tax belongs to AI #9.
- Overlap of the two PRs, tested on `f4e0b111` + `c2835545`: with both migration files `transactions` carries two balance triggers and `invoices` / `bills` two settlement guards each, and PR #640's own rules test fails (`workspaceShards: bookkeeper could not add a document`). `evidence/both-prs-combined-schema.txt`. Whether `b4f312bf` resolves this is for its CI to show.

## Agent #6's probes against the merged code

`audit/agent6-2026-11-10/probes/` assert each defect. Run on PR #647 `c2835545`, whose `src/server`, `src/lib`, `src/kernel`, `supabase` and `scripts` are identical to `2708f47c` (the nine files that differ are five report components, two hooks and two tests):

| Finding | Result |
|---|---|
| F-01 (a Texas sale written with `region` is dropped) | no longer reproduced |
| F-08 (one filed return marks every state filed; no per-permit filing) | no longer reproduced |
| S7 (admin integrity scan without `requireAdmin`) | no longer reproduced |
| F-09a (money-writing handlers that write an audit row) | 30.3% on `2ac666b` → 69.7%, by the probe's own count |
| F-09b, F-10 | the probes match source text that has changed — **not conclusive either way** |

`audit/function-audit/probes/af004-tax-authority-probe.ts`: 8 OK + 1 DEFECT (P6) on `2ac666b`; 9 OK on the merged code. "No longer reproduced" is what the probes print; I did not review the fixes. `evidence/reverify-prior-findings.txt`.

## Also seen on `main` (operations, P3)

The **ESLint warning ratchet** workflow failed twice on `2708f47c` (runs 43089086556, 43089753807), at the step "Propose change in a reviewable PR". ESLint itself is fine: 0 errors, 2 warnings against a ceiling of 12 (run locally). The workflow succeeded on earlier commits, when there was nothing to lower. I cannot read job logs from here; the usual cause is the repository setting that lets Actions open pull requests.

## Reproduce

```
LF_TEST_DATABASE_URL=postgresql://…/lf_test bash audit/agent7-2026-11-11/probes/run-all.sh
```
Fork `Chaim-Richard/ledgerflow`, branch `arena/a91ccf77-ledgerflow`, commit `036e7044`. Probes A7-02b and A7-07 now record both behaviours (before and after PR #647) and pass on both.
