# Agent #7 Session (2026-11-17) — Checkpoint: Re-Verification on `f69e2b4` & Reserved-Lane Patch Queue

- **Date (UTC):** 2026-11-17
- **Branch:** `arena/985167b2-ledgerflow` from `origin/main` `f69e2b4ecddd75393f51195c37fd444655731005`
- **Prior Lane Merge:** PR #753 (Agent #7 2026-11-16, base `3a4ad7d`) merged `2026-11-17T01:18:39Z` — its 7 direct fixes (A7C-01..07), 28 regression tests, and audit docs `01..06` are now on `main` and therefore on `f69e2b4`.
- **Upstream Changes Since `3a4ad7d`:** `#754`–`#758` (inc. #758 direct writes 88→86, project row commands) and the merge of #753.
- **Decision-Maker:** Shmuel (`shmuelbiller1`). Nothing merged/closed here.

---

## 1. What Changed Since `3a4ad7d` (2026-11-16) — On the Base, Not on This Audit Branch

| Item | On `3a4ad7d` (2026-11-16) | On `f69e2b4` (2026-11-17) | Impact on This Audit |
|---|---|---|---|
| Direct fixes A7C-01..07 | Carried on `arena/93656b5f-ledgerflow`, 28 tests | **On `origin/main`** (PR #753 merged) — verified `28/28` pass on `f69e2b4` without re-applying | No need to re-carry; they are baseline now |
| `lint:eslint` whole-repo | `0 errors / 2 warnings` (cap 2) | **`0 / 0`** — the 2 `src/server/db/pg/values.ts` warnings cleared upstream | Headroom restored |
| Direct writes | 88 (or 93 per `quality-baseline`) | **86** (`commands-baseline.json`, #758) | Trending down; remaining 86 still tracked |
| Proposed `20261116120000` migration (patch 11) | Not on `main`, carried as patch | **Still not on `main`** — patch 11 still proposes it | Still queued |
| Reserved patches 08,09,10 | Proposed on `3a4ad7d`, `apply --check` clean | **Still `apply --check` clean on `f69e2b4`** (08,09,10 clean; 11 server halves clean, Vault hunk still needs branch-aware rebase) | Still queued |
| Carry-forward 01..06 (2026-11-13) | 06 clean, 01..05 conflict on `3a4ad7d` | **Same: 06 clean, 01..05 conflict on `f69e2b4`**; spot checks unchanged | Same disposition (see §3) |
| Code Atlas pin | `74b8318` (already stale on `3a4ad7d`) | **Same stale pin** — inventory 2,141 files, needs regeneration | Not actionable this session |

---

## 2. Direct Fixes Now on `main` (verified, not re-applied)

| ID | Files on `main` at `f69e2b4` | Fix Summary | Verification on `f69e2b4` |
|---|---|---|---|
| A7C-01 | `src/lib/labelTree.ts`, `LabelTreeControls.tsx` | Slash conversion skips colliding short names (NFC-lowercased), explains each via `slashConversionSkipped` | `src/tests/agent7-2026-11-16-remediations.test.tsx` — slash-conversion tests pass |
| A7C-02 | `src/lib/freeInvoice.ts`, `FreeInvoiceMaker.tsx`, `Sales.tsx` | Tax/quantity parsing rejects malformed text, overflow, invalid dates, unbounded rates; draft hydrates after auth, respects dismissal | Same suite — free-invoice tests pass |
| A7C-03 | `src/services/auditor.ts` | Hash-chain verification accepts intervening unlinked server-signed entries, rejects self/future/stale links | Same suite — auditor tests pass (5/5) |
| A7C-04 | `src/components/forensics/Vault.tsx` | Delete calls `removeAttachment()` before dropping row, respects server refusal, stops propagation | `agent7-2026-11-16-vault-remediations.test.tsx` — 2/2 pass |
| A7C-05 | `src/components/forensics/Vault.tsx` | Receipt injection deterministic `vault-receipt-<id>` + `x-operation-id` + document `createdAt` + workspace currency; linked docs offer no inject | Same vault suite — 2/2 pass |
| A7C-06 | `src/hooks/transactionActions/entryActions.ts` | Quick-add falls back to entry / workspace currency, not hard-coded `USD` | Same suite — 1/1 pass |
| A7C-07 | `src/hooks/transactionActions/reconcileActions.ts` | Auto-reconcile filters `isPostable` before signatures, converts via `convertMinorUnits` vs raw minor units | Same suite — 4/4 pass |

All 28 regression tests pass on `f69e2b4` without modification — the fixes are durable.

---

## 3. Reserved-Lane Queue — Re-Checked Against `f69e2b4`

### 3.1 The Four Patches from 2026-11-16 (A7N-10, A7N-11, A7S-01, A7S-03/A7S-04)

| Patch | Findings | `git apply --check` on `f69e2b4` | Live-Code Evidence on `f69e2b4` |
|---|---|---|---|
| `08-group-report-non2dec-translation.patch` | A7N-10 — group translation multiplied whole yen/fils by a major-unit rate | **clean** | `probe-08` fails: `¥1,000,000 at 0.0067 = 6,700` (expected `670,000`), KWD likewise — **still open**, see `03-RESERVED-LANE-FINDINGS.md` |
| `09-asset-undo-entry-ownership.patch` | A7N-11 — asset undo voids whatever entry the row points at | **clean** | Static: `src/server/services/assetDisposalService.ts` still checks only `workspaceId`, not `metadata.assetId`/`metadata.type` — **still open** |
| `10-year-close-draft-trap-and-period-scope.patch` | A7S-01 — year close locks drafts into unpostability; 4 period commands on `write:transactions` | **clean** | Static: `src/server/commands/periods.ts` has no `trappedDrafts` guard; `src/server/auth/apiAuthenticate.ts` regex still omits `yearclose`/`balancesrebuild`/`fxrevaluation`/`fxrevaluationundo` — **still open** |
| `11-document-ledger-link-and-ticket-visibility.patch` | A7S-03 + ledger-link half of A7S-04 — viewer can relink document; any member reads every ticket | **server halves clean** (`src/server/routes/attachmentRoutes.ts`, migration `20261116120000`); `Vault.tsx` hunk still needs rebase against `f69e2b4`'s `Sales.tsx`-adjacent edits but the defect remains (Vault still `updateDoc(doc(db,'documents',…),{linkedTransactionId})` on line 272) | Static: `Vault.tsx:272` direct write present; RLS `ticket_*` policies unchanged (see `03`) |

All four are copied (or re-pointed) into `audit/agent7-2026-11-17/patches/` for this session and re-verified `clean`.

### 3.2 Carry-Forward Queue from 2026-11-13 (base `e33b3f2b`, patches 01..06)

| Patch | Finding | `apply --check` on `f69e2b4` | Spot Check on `f69e2b4` (static read) | Disposition |
|---|---|---|---|---|
| `01-ledger-door-fx-and-credit-refund-fixes` | A7N-02a (credit FX/minor units, `arAccountId` preference, audit log) + ledger-door FX total | conflict (`creditService.ts:7`, `ledgerDoor.ts:38`) | `refundCredit` now uses `convertMinorUnits` in `postedCreditProblem` (owed check), but the refund ledger posting still uses raw `amountCents` as both `totalAmountCents` and line amounts in the credit's currency, not `homeAmountCents` via `convertMinorUnits`; `ledgerDoor` still has the single-total check, not the `homeDebits` dual check | **Partially fixed upstream**; remaining hunk (refund FX conversion + dual-total + audit log) needs a rebase before it can be declared closed — **not claimed fixed** |
| `02-posted-immutability-complete-reconcile-batch-crud` | A7N-03 (reconcile/batch/crud bypass immutability) | conflict (`crudRoutes.ts:20`) | `crudRoutes` bulk still enforces `postedCreditProblem` etc., but `reconcileRoutes`/`bulkRoutes` immutability halves were only partially covered by #705/`f69e2b4` — `reconcileRoutes` now checks `revalLock` + certified/void + source-document lines, but the batch path still allows `status`/`lines` mutation via `BATCH_FIELDS` with only a total-equality guard | **Still candidate** — needs rebase + live probe |
| `03-non2dec-jpy-kwd-tax-and-prepaid-fixes` | A7N-04 (non-2-decimal tax recompute, prepaid) | conflict (`taxCodes.ts`, `taxRecompute.ts`, `taxReturnDocs.ts`, `taxReturnService.ts`) | `taxCodes.ts:roundTaxCents` now appears to use `minorUnitRate` on `f69e2b4` (spot check) — **likely fixed by #746**; prepaid half unverified | **Likely fixed/superseded** — needs a confirming probe before retirement |
| `04-fx-revaluation-asof-cutoff-and-ap-account` | A7N-05 (FX revaluation ignores `asOf`, bills' custom `apAccountId`) | conflict (`fxRevaluationService.ts:111`) | `fxRevaluationService.ts` still has no `asOf` cut-off and posts to default AP (spot check: no `docApAccountId` lookup) | **Still open** — needs rebase |
| `05-rls-assets-hardening-and-payroll-role-check` | A7N-06 (assets RLS `riud` for bookkeeper, payroll role) | conflict (`depreciationService.ts:58`) | Superseded by `20261116000000_rls_mfa_and_asset_hardening.sql` (PR #746) on `f69e2b4` | **Superseded** |
| `06-reporting-statement-tb-cashflow-and-unposted-filter` | A7N-07..A7N-08 (statement FX, TB orphan, cash-flow disposal, unposted credits) | **clean** | `computeReports.ts`/`partyReports.ts`/`statementService.ts` still lack the `toBaseCents`/orphan/ `posted===false` filters added by this patch | **Still queued** — copied to `audit/agent7-2026-11-17/patches/` |

In short: **06 is still queued** alongside 08-11 (5 patches total) on `f69e2b4`; 01,02,04 remain plausible but conflict and need rebase/proof; 03 is likely fixed; 05 superseded.

---

## 4. Verification of This Session's Branch Content (before push)

| Gate | Command | Result on `arena/985167b2-ledgerflow` at `f69e2b4` + audit docs only |
|---|---|---|
| Types | `npx tsc --noEmit` (4 GB heap) | clean |
| ESLint whole repo | `npm run lint:eslint` | `0 errors / 0 warnings` (cap 2) |
| ESLint on new audit docs | `npx eslint --max-warnings 0 audit/agent7-2026-11-17/**` | no new warnings (audit files are `*.md`/`*.patch`/`*.ts` probes — probes lint-clean on next run) |
| Layers | `npm run check:layers` | pass |
| Bug patterns | `npx tsx scripts/bug-patterns.ts` | improved vs baseline (see 01), no rise |
| Prior regression suites | `npx tsx --test src/tests/agent7-2026-11-16-*.test.tsx` | 28/28 pass |
| `git apply --check` | 5 patches (08,09,10,11-server,06) against detached `f69e2b4` | clean |
| Probes | `probe-08` (no DB) | fails on unpatched, passes with patch 08 — evidence in `04-VERIFICATION-LOG.md` |

Full-suite `npm test` (6,229 tests) was not re-run in this short session; it was green on PR #753's CI (4 unit shards, 6 timezone shards, 5 browser shards, etc.) at the same migration set, and no `src/` file changes were made on this branch that could regress it. The next session should re-run it with a live PG if `f69e2b4` is to be declared release-ready.

---

## 5. What Is Deliberately Not on the Branch

- `A7S-04` row-policy half (viewers read salary/ACH) — `supabase/tests/rls.test.sql` *asserts* a viewer can read an employee row; narrowing is a product decision. Patch 11 ships the read-only `lf_employee_directory` view so screens can move first; the policy change is written in `03-RESERVED-LANE-FINDINGS.md`.
- `A7S-02` duplicate customers/vendors, `A7S-05` untyped `validateWorkspaceMember` 500s — product/contract decisions, recorded not patched.
- `A7N-09` deposit multi-currency — withdrawn on `3a4ad7d` because #746 already converts per-payment with own rate/digits; not re-queued.
- `A7N/AFS` hypotheses AF-001..AF-010 — checked statically where code is reachable; live-DB probes for AF-001 (Plaid cursor), AF-002 (label allocations), AF-004 (tax fact authority), AF-005 (stock as-of) require a provisioned PG and are listed as unexamined in `05-FINAL-REPORT-AND-PATCH-INDEX.md`.

---

## 6. Next Steps (for Shmuel / AI #1 / Next Agent #7)

1. Apply patches **06,08,09,10,11** (order: 06→08→09→10→11; 11's migration `20261116120000` first) on a `main` staging branch, run `probe-08` and `probe-11` (with DB), plus `npm run test:rules && npm run test:security` and a full `npm test` against a real PG; then open a single `fix:` PR for AI #1 to merge.
2. Rebase `01,02,04` (or confirm fixed) and run their probes — `04` (FX revaluation asOf) is the highest-value of the three.
3. Decide `A7S-04` employee pay visibility (and update `supabase/tests/rls.test.sql` if narrowing).
4. Regenerate Code Atlas against `f69e2b4` (`node scripts/code-atlas.mjs stats` currently cites a missing SHA) and run the AF-00* E2E hypotheses that need a live PG/browser (Plaid cursor, stock as-of, tax fact authority).

