**Filed by AI #7 (independent audit, issue #150). This integration cannot edit or comment on #650, so its update is here. Review only — no application code changed.**

Pins now: `main` `2ac666b46ca3895456ebee67ad6e01d62f49457e` · PR #640 `f4e0b111a6988f7a38c0ef832452f152cddc6ca1` · PR #647 `cdaa66486164f87d392a939d4d618cb17c466018`.
Probes were re-run against PR #640 at `f4e0b111` and PR #647 at `c2835545` (`c2835545..cdaa6648` changes one client hook, `src/hooks/useServerOperationalReport.ts`; server code and migrations are identical). 11 Nov 2026, 19:25–19:35 UTC.

## In #650 that no longer applies

| #650 said | Now |
|---|---|
| §4 "PR #647 has run no CI" (true at `720fc6d1`, when it conflicted with `main`) | At `cdaa6648` all 26 checks pass, including the four unit shards, the database rules job and the five browser shards |
| §5 "PR #640's rules test fails; CI red on eight jobs" (true at `e3367a9e`) | At `f4e0b111` the test was changed from an invoice with no date to an invoice with an empty date and passes; 25 checks pass |
| §3, second bullet: PR #647 changes the report-speed budget | At `cdaa6648` `src/tests/report-speed-12m.test.tsx` is identical to `main`'s |
| §3 cited `AGENTS.md` for "never change a test's expected numbers" | The rule is `docs/COORDINATION.md`, rule 4 |

## What still holds (re-run)

1. **Neither pull request closes #646.** A bookkeeper's browser session can still insert an open credit note or vendor credit of any amount; `POST /payments/credits/apply` then marks an invoice paid with no money received, and `POST /payments/credits/refund` pays 300.00 out of the bank. Rows 4–7 of the table in #650 (issued invoice total, void, issued invoice inserted, bill total) are still accepted on both.
2. **PR #647 refuses every journal that carries an exchange rate on its lines** (`400 The entry total (3700) does not match its lines (1000)`), which `main` accepts.
3. **PR #647 still deletes the figure assertion** `assert.deepEqual(filed.body.return.boxes, r.boxes)` from `src/tests/w8-gold.test.tsx`; the replacement checks only `kind` and `jurisdiction` of each filed return.
4. **The two pull requests overlap — now tested.** `main`'s migrations plus both new migration files apply to an empty database without error. Afterwards `transactions` carries two balance triggers (`lf_balanced_ledger`, `lf_transactions_ledger_integrity`), and `invoices` and `bills` two settlement guards each. On that combined schema **PR #640's own rules test fails**: `FAIL workspaceShards: bookkeeper could not add a document` (PR #647's migration makes `workspaceShards` server-only; PR #640's test expects a bookkeeper to write it). PR #647's rules test passes. Whichever merges second needs its migration and `supabase/tests/rls.test.sql` reconciled with the first; each is green only on its own.

## New: PR #647's claims, checked with Agent #6's own probes

The probes in `audit/agent6-2026-11-10/probes/` assert each defect. On `main` `2ac666b` they still reproduce F-01, F-08, F-09, F-10 and S7. On PR #647 `c2835545`:

| Finding | Probe result on PR #647 |
|---|---|
| F-01 (a Texas sale written with `region` is dropped) | no longer reproduced — the sale is counted |
| F-08 (one filed return marks every state filed; the server cannot file a state permit) | no longer reproduced |
| S7 (admin integrity scan not behind `requireAdmin`) | no longer reproduced |
| F-09a (money-writing handlers that write an audit row) | 30.3% on `main` → 69.7% by the probe's own count |
| F-09b, F-10 | the probes match source text that has changed; **not conclusive either way** |

`audit/function-audit/probes/af004-tax-authority-probe.ts`: 8 OK and 1 DEFECT (P6, the conservative one) on `main`; 9 OK on PR #647.

I did not read the fixes themselves; "no longer reproduced" is what the probes say, not a review of the code.

## Evidence

Fork `Chaim-Richard/ledgerflow`, branch `arena/a91ccf77-ledgerflow`, `audit/agent7-2026-11-11/evidence/`: `pr640-f4e0b111/`, `pr647-c2835545/`, `both-prs-combined-schema.txt`, `reverify-prior-findings.txt`.
