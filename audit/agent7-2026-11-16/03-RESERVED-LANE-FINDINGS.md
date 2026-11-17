# Agent #7 (2026-11-16) — Reserved-Lane Findings, Evidence and Decisions

Everything here is a **proposal**. `AGENTS.md` and `docs/COORDINATION.md` reserve `src/server/**`,
`supabase/migrations/**` and money/posting/tax math to AI #1, so none of these files is on the branch: each
finding ships as a patch in `patches/` and, where it can be proven, a probe in `probes/`.

Baselines: `origin/main` `3a4ad7d`; live PostgreSQL 16.2 (`lf_test`, migrations applied via
`npm run db:test-setup`). Patch `07` was withdrawn because `#746` landed the same fix.

---

## A7N-09 — "Make deposit" added every payment's minor units and booked the books' currency *(fixed upstream)*

`src/server/services/depositService.ts` used to sum `amountCents` across the selected payments and post one
entry in `workspace.currency`. A euro payment and a dollar payment were added together, and a yen payment's
whole yen were treated as cents. `#746` now converts each payment with its own rate and the digits of both
currencies (`convertMinorUnits`), so the patch this session had drafted was withdrawn.

**Evidence:** `src/server/services/depositService.ts` (`convertMinorUnits`, per-payment `pCurrency`/
`baseCurrency`) on `3a4ad7d`.

## A7N-10 — Group translation multiplied whole yen by a major-unit rate — `patches/08`

`translate()` in `src/server/reports/groupReport.ts` applied the quoted rate directly to a member's minor
units. A yen member's ¥1,000,000 at 0.0067 became **6,700 "cents" ($67.00)** instead of **670,000 cents
($6,700.00)**; KWD (three decimals) skewed the other way. The eliminations and associate figures used the
same bare multiply.

The patch converts through `convertMinorUnits(cents, rate, memberCurrency, reportCurrency)` in `translate()`,
in the closing/average/historical conversions used by eliminations and associates, and in the per-section
`rate()` the account-by-account payload hands to the screen (now `minorUnitRate`).

**Evidence (live code, no DB):** `probes/probe-08-translation-and-api-scope.ts` — on the unpatched tree it
reports `netIncome: 6700` and fails its assertion; with `patches/08` applied it reports `670000` (JPY) and
`325000` (KWD).

## A7N-11 — Asset undo trusted a client-writable pointer — `patches/09`

`undoDisposal()` reads `asset.disposalTransactionId` (and each partial share's `transactionId`) from the asset
row, then voids that entry and rewinds the asset from that entry's `metadata.before`. `#746` added a
workspace check, but a same-workspace pointer still lets a tampered asset void an unrelated entry (an invoice,
a payroll run) and reset its own accounting state from `metadata.before` = `{}`.

The patch requires the entry to name *this* asset and be the entry type this service writes
(`metadata.assetId === asset.id`, `metadata.type` in `asset-disposal` / `asset-partial-disposal`), and refuses
a missing entry instead of silently dropping the sale.

**Evidence:** `patches/09-asset-undo-entry-ownership.patch` (applies to `3a4ad7d`), `git apply --check` clean.

## A7S-01 — Year close locks drafts out of reach; four period commands sat on `write:transactions` — `patches/10`

1. **Trapped drafts.** `period.close` (month) refuses to close a month holding drafts (`closeStepsProblem`),
   but `period.yearclose` writes `lockDate` over a whole year without looking. A draft inside that year then
   can neither be posted nor deleted: the lock refuses every write on or before the closing date. The patch
   refuses the close when drafts are dated inside the year and says so in the preview.
2. **API-key scope.** `requiredApiKeyScope()` maps period commands by an enumerated list
   (`close|closesteps|depreciation|relock|reopen|signoff|unlock`). `period.yearclose`,
   `period.balancesrebuild`, `period.fxrevaluation` and `period.fxrevaluationundo` therefore fell through to
   the generic `write:transactions`, so a transaction integration could lock a year or restate the books. The
   patch maps every `period.*` command to `write:workspaces`.

**Evidence:** `probes/probe-08-translation-and-api-scope.ts` asserts the scope of all eleven period commands
(they were `write:transactions` for four of them before the patch).

## A7S-03 (+ the ledger-link half of A7S-04) — Tickets and document ledger links — `patches/11`

1. **Support tickets.** `ticket_read` let *every member of the workspace* read *every* ticket, including
   `unreadForAdmin` and `errorDiagnostics`; `ticket_update` let any member update a ticket in the workspace,
   and the allowlist let a client write `unreadForAdmin`, `lastMessageBy` and `errorDiagnostics`.
2. **Document ledger link.** `documents.own_update` is granted to every member, viewers included, and
   `linkedTransactionId` was in the client allowlist — a viewer could detach a receipt from the entry it is
   the evidence for, or point it at another entry, with no audit line.

The patch narrows ticket read/update to the person's own ticket (platform admins keep everything), takes the
support-side bookkeeping fields out of the allowlist, extends `lf_documents_kind_guard` with an
old-vs-new comparison for `linkedTransactionId` (setting it at upload stays possible; changing it later is
the server's), and adds `POST /api/v1/workspaces/:id/attachments/:id/link` — writer roles, entry must be in
the same workspace and posted, audit line written — which `Vault.tsx` uses instead of `updateDoc`.

Note the patch's `Vault.tsx` hunk is against `3a4ad7d`; the branch changes the same file for `A7C-04`/`A7C-05`,
so it applies to the base revision, not on top of the branch.

**Evidence (live PostgreSQL, as the browser role):**
`probes/probe-11-document-links-and-ticket-visibility.ts`. Unpatched database:

```
A. OPEN: viewer read another member's ticket (subject=Billing question, unreadForAdmin=3)
B. OPEN: a viewer relinked doc doc_c509a50b from tx_original to tx_forged without lf_can_write
C. OPEN: a client wrote unreadForAdmin on its own ticket (support-side state)
D. uploader metadata after the patch: allowed
E. directory view: not readable (42P01)
```

With the migration applied — `A/B/C` refused, `D` allowed (tags still editable), `E` readable without pay or
bank fields — and `npm run test:rules` still reports `ALL RLS TESTS PASSED`.

**Rejected variant, recorded so nobody repeats it.** Taking the four link keys out of `lf_rules.allowed_keys`
is *not* enough and is actively wrong: `lf_guard` validates every key present in `new.data`, so an existing
document that already carries `linkedTransactionId` becomes completely unwritable — the uploader cannot even
change its tags. The old-vs-new trigger comparison is the mechanism that works. The first draft of this patch
also swapped `own_update` for a `lf_can_write` policy and made documents silently update zero rows, which the
`A8-009` rule test caught.

## A7S-02 — Duplicate customers/vendors

Lowest-severity item in this set, no patch: `src/server/commands/customers.ts` (and vendors) create a record
without looking for an existing one with the same normalised name, so the same customer can exist twice and
its A/R split across both. A duplicate check is a product decision (merge vs. refuse, which fields define
"same"), so it is recorded here rather than patched.

## A7S-04 (row-policy half) — A viewer can read every colleague's salary and ACH details — **NOT APPLIED**

`employees` (and `payRuns`) get the standard `member_read` policy: any member, a viewer included, can
`select` every row, including `salaryCents`, `hourlyRateCents`, `preTaxDeductionsCents` and the
`bankRouting`/`bankAccount` used for ACH.

Not applied because `supabase/tests/rls.test.sql` (`isolation` loop) asserts a viewer *can* read an employee
row — changing this changes the product contract, not just its hardening. What already ships in patch 11 is
the read-only `lf_employee_directory` view (name, role, department, contact; no pay, deductions, tax ids or
bank instructions) so a screen can move onto it first.

Proposed narrowing, ready to apply with the matching test change:

```sql
drop policy if exists member_read on public.employees;
create policy employee_read on public.employees for select to authenticated
  using (public.lf_can_write(workspace_id)
         or data->>'uid' = public.lf_uid()          -- the person's own record
         or data->>'timeUid' = public.lf_uid());    -- their own timesheet actor

drop policy if exists member_read on public."payRuns";
create policy payrun_read on public."payRuns" for select to authenticated
  using (public.lf_can_write(workspace_id));
```

## A7S-05 — `validateWorkspaceMember` throws untyped errors

`src/server/db/firestore.ts` throws plain `Error` for "not a member", "workspace not found" and "API key
scoped to another workspace", so any route that does not catch it answers **500** for what is a 401/403/404 —
and `security-sweep.test.ts`'s `serverErrors` baseline counts them. Fixing it means a typed error plus a
mapping in the shared error handler; both live in `src/server/**` and touch every route's contract, so it is
recorded here rather than queued as a patch.

---

## Carry-forward queue from 2026-11-13 (status on `3a4ad7d`)

| Patch | Applies to `3a4ad7d`? | Note |
|---|---|---|
| `01-ledger-door-fx-and-credit-refund-fixes` | no | spot check: `refundCredit` now carries the credit's `exchangeRate`/`currency` (`creditService.ts`), and `taxCodes.ts › roundTaxCents` uses `minorUnitRate` — appears fixed by `#746`; needs a rebase to confirm what remains |
| `02-posted-immutability-complete-reconcile-batch-crud` | no | spot check: `reconcileRoutes` now filters on `isPostable`; needs a rebase to confirm the batch/void halves |
| `03-non2dec-jpy-kwd-tax-and-prepaid-fixes` | no | spot check: `currencyMinorUnits` is used in `taxCodes.ts`; prepaid schedule half unverified |
| `04-fx-revaluation-asof-cutoff-and-ap-account` | no | `fxRevaluationService.ts` has no `asOf` cut-off on `3a4ad7d` — appears still open |
| `05-rls-assets-hardening-and-payroll-role-check` | no | superseded by `supabase/migrations/20261116000000_rls_mfa_and_asset_hardening.sql` (`#746`) |
| `06-reporting-statement-tb-cashflow-and-unposted-filter` | **yes** | still applies cleanly |
