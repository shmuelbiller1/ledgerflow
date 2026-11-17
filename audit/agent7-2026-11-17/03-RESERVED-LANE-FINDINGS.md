# Agent #7 (2026-11-17) — Reserved-Lane Findings, Evidence and Decisions

> **Lane rule:** `src/server/**`, `supabase/migrations/**`, and money/posting/tax math belong to AI #1 (`AGENTS.md`).
> Nothing in this file is committed to `src/server/**` on `arena/985167b2-ledgerflow`. Every finding below ships
> as a patch in `patches/` plus a deterministic probe in `probes/` where one can be written without a live DB.
> Baselines: `origin/main` `f69e2b4` (`2026-11-17T02:45Z`); prior lane merge `3a4ad7d` (PR #753, 2026-11-17T01:18Z).

---

## Still Open on `f69e2b4` — Five Queued Patches

### A7N-10 — Group translation multiplied whole yen/fils by a major-unit rate — `patches/08`

**File:** `src/server/reports/groupReport.ts` — `translate()` and its callers.

**Defect:** `translate()` converts a member's figures with `Math.round(cents * rate)`. The rate is quoted for **major
units** (`1 JPY in USD`), but `cents` here are **minor units** — whole yen for JPY (0 decimals), fils for KWD (3).
A yen member's ¥1,000,000 at 0.0067 therefore became `1_000_000 * 0.0067 = 6,700` "cents" ($67.00) instead of
`670,000` cents ($6,700.00) — a **100× understatement**. KWD (3 decimals) skewed the other way (≈10× over).
Eliminations (`owedBy`/`owedTo`/`withinGroup`) and associate equity used the same bare multiply, and the
per-section `rate()` handed to the account-by-account screen carried no digits correction.

**Fix:** Convert through `convertMinorUnits(cents, rate, fromCurrency, toCurrency)` (which applies
`rate * 10^(digits(to)-digits(from))`) in `translate()`, in the `toReport()` helper for eliminations/associates,
and via `minorUnitRate(rate, from, to)` for the account-lines `rate()` callback. See `patches/08`.

**Evidence (live code, no DB):**

```
$ npx tsx audit/agent7-2026-11-17/probes/probe-08-translation-and-api-scope.ts   # on f69e2b4, unpatched
A7N-10 yen member, $ report: {"income":6700,"cogs":0,"grossProfit":6700,"expense":0,"netIncome":6700,"totalAssets":6700,"totalLiabilities":0,"totalEquity":6700,"cta":0}
AssertionError: ¥1,000,000 at 0.0067 is 670,000 cents ($6,700.00) — 6700 !== 670000
```

With `patches/08` applied (verified on `3a4ad7d` and `apply --check` clean on `f69e2b4`):

```
A7N-10 yen member, $ report: {"income":670000,"netIncome":670000,"totalAssets":670000,"cta":0}
A7N-10 KWD member, $ report: {"netIncome":325000}   (KWD 1,000.000 at 3.25 = $3,250.00)
probe 08: all assertions held
```

**Severity:** **High** (P0 for any group containing a 0- or 3-decimal currency — silent 10–100× misstatement of consolidated revenue, assets, and CTA).

---

### A7N-11 — Asset undo trusted a client-writable pointer — `patches/09`

**File:** `src/server/services/assetDisposalService.ts` — `undoDisposal()`.

**Defect:** The function reads `asset.disposalTransactionId` (and each partial share's `transactionId`) from the
asset row — data the client can write — then voids that entry and rewinds the asset from `entry.metadata.before`.
PR #746 added a `workspaceId` check, but a same-workspace pointer still lets a tampered (or stale) asset void
an **unrelated entry of the same workspace** (an invoice, a payroll run) and reset its own accounting state from
`before = {}` or a stale snapshot.

**Fix:** Require the entry to name *this* asset and be the entry type this service writes:
`metadata.assetId === assetId` and `metadata.type === 'asset-disposal'` (full) or `'asset-partial-disposal'`
(partial). A missing or mismatched entry is refused with `409` instead of silently dropping the sale. See `patches/09`.

**Evidence (static):** `grep -n metadata.assetId src/server/services/assetDisposalService.ts` on `f69e2b4` returns
nothing; the file checks only `shareEntry.workspaceId !== input.workspaceId` (line 174). The patch adds the two
`metadata.*` guards and is `apply --check` clean.

**Severity:** **High** (P0 data-integrity / authorization — voiding an unrelated posted entry via a writable pointer).

---

### A7S-01 — Year close locks drafts into unpostability; four period commands on `write:transactions` — `patches/10`

**Files:** `src/server/commands/periods.ts` (`periodYearCloseCommand`), `src/server/auth/apiAuthenticate.ts`
(`requiredApiKeyScope`).

1. **Trapped drafts.** `period.close` (month) refuses to close a month holding drafts (`closeStepsProblem`), but
   `period.yearclose` writes `lockDate` over a whole year **without looking**. A draft dated inside that year
   can then neither be posted nor deleted: the lock refuses every write on or before `closingDate`. The patch
   adds `trappedDrafts(entries, yearStart, closingDate)` and refuses the close with a 409 + preview line when
   drafts would be trapped.

2. **API-key scope.** `requiredApiKeyScope()` maps period commands by an enumerated list
   `close|closesteps|depreciation|relock|reopen|signoff|unlock`. `period.yearclose`,
   `period.balancesrebuild`, `period.fxrevaluation`, `period.fxrevaluationundo` fell through to the generic
   `write:transactions`, so a transaction integration could lock a year or restate FX. The patch maps **every**
   `period.*` command to `write:workspaces`.

**Evidence:**

```
$ npx tsx audit/agent7-2026-11-17/probes/probe-08-translation-and-api-scope.ts   # A7S-01 half
A7S-01 period command scopes: [
  {"name":"period.fxrevaluation","scope":"write:transactions"},   // ← wrong
  {"name":"period.fxrevaluationundo","scope":"write:transactions"},
  {"name":"period.balancesrebuild","scope":"write:transactions"},
  {"name":"period.yearclose","scope":"write:transactions"}
]
AssertionError: period.fxrevaluation must need write:workspaces, not write:transactions
```

With `patches/10` applied (verified on `3a4ad7d`, `apply --check` clean on `f69e2b4`): all eleven period commands
return `write:workspaces`.

Static on `f69e2b4`: `grep -n trappedDrafts src/server/commands/periods.ts` returns nothing; the
`period.yearclose` handler has no draft guard (lines 84–110 of `periods.ts` at `f69e2b4`).

**Severity:** **High** (P1 data loss — drafts permanently unpostable; Medium/High for scope escalation).

---

### A7S-03 (+ ledger-link half of A7S-04) — Tickets and document ledger links — `patches/11`

1. **Support tickets.** `supabase/migrations/0001_init.sql` + later `lf_rules` rows grant `ticket_read` to
   *every member of the workspace* (reads `unreadForAdmin`, `errorDiagnostics` of every colleague's ticket);
   `ticket_update` lets any member update any ticket; the `allowed_keys` allowlist lets a client write
   `unreadForAdmin`, `lastMessageBy`, `errorDiagnostics` (support-side bookkeeping).

2. **Document ledger link.** `documents.own_update` is granted to every member, viewers included, and
   `linkedTransactionId` is in the client allowlist — a viewer can detach a receipt from the entry it evidences
   or point it at another entry, with no audit line. The browser code `Vault.tsx:272` still does the direct
   `updateDoc(doc(db,'documents',id),{linkedTransactionId})` that the database should refuse.

**Fix:** Narrow `ticket_read`/`ticket_update` to the author's own ticket (platform admins keep all via
`lf_is_platform_admin()`), remove support-side keys from the allowlist, add an old-vs-new trigger guard
`lf_documents_kind_guard` that allows `linkedTransactionId` at upload but forbids later client changes to it,
and add `POST /api/v1/workspaces/:id/attachments/:id/link` — writer roles or uploader, entry must be in the
same workspace and posted, audit line written — which `Vault.tsx` uses instead of `updateDoc`. Includes a
read-only `lf_employee_directory` view (name/role/department/contact, no pay/bank) shipped alongside so a
screen can move off `employees` before the policy narrowing. See `patches/11`.

**Evidence (live PG, browser role) — from `3a4ad7d` verification, still applies on `f69e2b4` (migrations unchanged):**

```
# Unpatched database, as a workspace viewer:
A. OPEN: viewer read another member's ticket (subject=Billing question, unreadForAdmin=3)
B. OPEN: a viewer relinked doc doc_c509a50b from tx_original to tx_forged without lf_can_write
C. OPEN: a client wrote unreadForAdmin on its own ticket (support-side state)
D. uploader metadata after the patch: allowed
E. directory view: not readable (42P01)
```

With the migration applied — `A/B/C` refused, `D` allowed (tags still editable), `E` readable without pay/bank
fields — and `npm run test:rules` still `ALL RLS TESTS PASSED` (verified log in `04-VERIFICATION-LOG.md`).

On `f69e2b4`: `src/components/forensics/Vault.tsx:272` still contains the direct `updateDoc` (evidence the
client half is still on the vulnerable path); `supabase/migrations/0001_init.sql` ticket policies unchanged.
The `Vault.tsx` hunk of patch 11 is against `3a4ad7d` and does not `apply --check` on top of `f69e2b4`'s
`Vault.tsx` (which differs by the A7C-04/05 hunks now on `main`), but the **server halves** (`attachmentRoutes.ts`
+ migration) are `apply --check` clean on `f69e2b4` with `Vault.tsx` excluded — the server is the security
boundary.

**Severity:** **High** (P0/P1 access-control — cross-user ticket disclosure and evidence tampering).

---

### A7N-07/A7N-08 — Reporting: statement FX, trial-balance orphan, cash-flow disposal, unposted filter — `patches/06`

**Files:** `src/server/reports/computeReports.ts` (`computeTrialBalance`, `computeCashFlow`, `computeStatement`),
`src/server/reports/partyReports.ts` (`computeCustomerBalanceSummary`, `computeVendorBalanceSummary`),
`src/server/services/statementService.ts`.

**Defect (still present on `f69e2b4`):**

- **Statement FX:** `computeStatement` sums `inv.amountCents` / `pay.amountCents` / `credit.amountCents` raw,
  without converting via `exchangeRate`/`currency` to the workspace's base currency. A USD invoice and an EUR
  invoice at 1.2 for the same 10,000 cents are treated as equal; credits similarly.
- **Trial-balance orphan:** Lines whose `accountId` is missing from the chart are silently dropped — the
  trial balance can balance while orphaned lines are invisible. The patch collects them into a synthetic
  `__orphaned__` account so the imbalance is visible.
- **Cash-flow disposal:** `asset-disposal` entries that move cash are classified by their counter-account
  instead of as investing activity; the patch forces them into `investing` with correct inflow/outflow.
- **Unposted filter:** Customer/vendor statements and balance summaries exclude `void`/`draft` but not
  `posted === false` documents (the flag `creditPosting.ts` sets for unposted credits) — the patch adds that
  predicate and propagates `baseCurrency` through `statementService`.

**Fix:** See `patches/06-reporting-statement-tb-cashflow-and-unposted-filter.patch` — `toBaseCents` conversions
throughout `computeStatement`, `__orphaned__` bucket, `metaType === 'asset-disposal'` investing branch, and
`posted !== false` guards in `partyReports.ts`. `statementService.ts` passes `workspace.currency` as
`baseCurrency`.

**Evidence:** `grep -n toBaseCents src/server/reports/computeReports.ts` on `f69e2b4` returns nothing; the file
still sums `inv.amountCents` directly (lines 368–412). `git apply --check` on `patches/06` against `f69e2b4`
is **clean**.

**Severity:** **High** (P0/P1 correctness — statement balances wrong across currencies, TB hides orphaned lines).

---

## Carry-Forward from 2026-11-13 (patches `01..05` against `e33b3f2b`)

| Patch | Finding | Status on `f69e2b4` | Verdict |
|---|---|---|---|
| `01-ledger-door-fx-and-credit-refund-fixes` | A7N-02a — `refundCredit` FX minor-unit conversion, `arAccountId`/`apAccountId` preference, audit log; `ledgerDoor` FX-aware total | `apply --check` **conflicts**; spot check shows `postedCreditProblem` now uses `convertMinorUnits`, but the refund posting still uses raw `amountCents` as `homeAmountCents` and `control` ignores explicit `ar/apAccountId` | **Partially fixed upstream** — remaining hunk needs rebase; not claimed closed |
| `02-posted-immutability-complete-reconcile-batch-crud` | A7N-03 — `reconcile`/`batch`/`crud` bypass posted immutability | **conflicts**; `crudRoutes` half partially fixed by #705, `reconcileRoutes` now checks `revalLock`+certified but `bulkRoutes` `BATCH_FIELDS` still allows `status`/`lines` mutation with only a total-equality guard | **Still candidate** — needs rebase + DB probe |
| `03-non2dec-jpy-kwd-tax-and-prepaid-fixes` | A7N-04 — non-2-decimal tax recompute / IL VAT / US nexus / prepaid | **conflicts**; `taxCodes.ts:roundTaxCents` now appears to use `minorUnitRate` on `f69e2b4` | **Likely fixed by #746** — needs confirming probe before retirement |
| `04-fx-revaluation-asof-cutoff-and-ap-account` | A7N-05 — `revaluateForeignBalances` ignores `asOf` cutoff, bills' custom `apAccountId` | **conflicts**; `fxRevaluationService.ts` still has no `asOf` date filter and posts to default AP | **Still open** — highest-value carry-forward; needs rebase |
| `05-rls-assets-hardening-and-payroll-role-check` | A7N-06 — assets RLS `riud` for bookkeeper, payroll role | **conflicts** | **Superseded** by `20261116000000_rls_mfa_and_asset_hardening.sql` (PR #746) |
| `07-deposit-multicurrency-total` | A7N-09 — deposit mixed currencies | **withdrawn** on `3a4ad7d` | **Fixed upstream** by #746 — per-payment `convertMinorUnits`, not re-queued |

The only carry-forward patch still `apply --check` clean on `f69e2b4` is `06` (now in this session's `patches/`).

---

## Deliberately Recorded, Not Patched (product decisions)

### A7S-04 row-policy half — Viewers can read salary/ACH

`employees` + `payRuns` use the standard `member_read` policy: any member, viewer included, can `select` every
row including `salaryCents`, `hourlyRateCents`, `preTaxDeductionsCents`, `bankRouting`/`bankAccount`. This is
**not** in patch 11's narrowing because `supabase/tests/rls.test.sql` *asserts* a viewer can read an employee
row — changing it changes the product contract. What ships in patch 11 is the read-only
`lf_employee_directory` view (no pay/deductions/tax ids/bank) so a screen can migrate first. The proposed
narrowing is:

```sql
drop policy if exists member_read on public.employees;
create policy employee_read on public.employees for select to authenticated
  using (public.lf_can_write(workspace_id) or data->>'uid' = public.lf_uid() or data->>'timeUid' = public.lf_uid());
drop policy if exists member_read on public."payRuns";
create policy payrun_read on public."payRuns" for select to authenticated
  using (public.lf_can_write(workspace_id));
-- and the matching assertion change in supabase/tests/rls.test.sql
```

Shmuel to decide; not applied without that call.

### A7S-02 — Duplicate customers/vendors

`src/server/commands/customers.ts` (and vendors) create a record without looking for an existing one with the
same normalized name. Whether "same" means normalized name, email, or tax number — and whether to refuse, merge,
or offer skip/update — is a product decision, recorded here not patched.

### A7S-05 — `validateWorkspaceMember` untyped errors

`src/server/db/firestore.ts` throws plain `Error` for "not a member" / "workspace not found" / "API key scoped
to another workspace", so routes that do not catch it answer **500** for what is a 401/403/404 — the
`serverErrors` baseline counts them. Fixing it needs a typed error + handler across every route's contract,
recorded here not queued as a patch.

### A7N-09 — Deposit multi-currency (withdrawn)

As above — #746 already converts each payment with its own rate and digits; the draft patch was withdrawn
rather than shipped stale.

---

## AF-00* Hypotheses (from `docs/INDEPENDENT_AUDIT_AGENT.md` / `docs/FIRST_TESTERS_GATE.md`)

| Lead | Area | Checked on `f69e2b4` (static) | Needs |
|---|---|---|---|
| AF-001 | Plaid cursor durability | `src/server/routes/plaidRoutes.ts` updates `syncCursor` on paginated sync; `Banking.tsx` success path not cross-checked with `bankLines` persistence | Live DB + bank sandbox probe (crash/replay, modified/removed) |
| AF-002 | Label/allocation reconciliation | `src/lib/TransactionTemplates.ts:spreadLabels` rounding of A/R, discounts, tax per label — 1¢ mismatch possible (two $100 labels, $36 tax, $1.01 discount) | Adversarial ledger probe with hand-worked trial balance |
| AF-003 | Statement scope | `AUD-01` / #141 — period/entity must match server JSON, screen, PDF, export, email | Scope parity check across renderers (patch 06 closes the FX half) |
| AF-004 | Tax fact authority | `composeFacts` vs `evaluateRules` vs `resolveSellerProfile` vs `TaxPlaceSuggestion` vs `ilVatReturn`/`usSalesTaxReturn` — mutable customer `taxPlace` vs invoice snapshot (P2 latent at `dc407397`) | Trace entity ownership + conflicting facts to posting |
| AF-005 | Stock as-of | #130/#131 — stock history must reconcile to past dates, no silent valuation change without balanced journal | Historical stock probe |
| AF-006 | RMA + restore | #143 / AUD-02 — server state transition + coherent backup/restore under concurrent writes | Concurrent PG probe |
| AF-007 | Report cache revocation | Member revocation during TTL, post-write freshness | Cache-policy audit |
| AF-008 | DB TLS + deployment parity | `DATABASE_CA_CERT`, daily-job parity Vercel vs standalone | Deployment inspection |
| AF-009 | First-hour journey | Sign-up → setup → bank → invoice → saved reports → logout/login | E2E journey |

None claimed verified in this short session; AF-001/002/005 are the highest-value next probes for a PG-bearing
agent (see `05-FINAL-REPORT-AND-PATCH-INDEX.md`).

