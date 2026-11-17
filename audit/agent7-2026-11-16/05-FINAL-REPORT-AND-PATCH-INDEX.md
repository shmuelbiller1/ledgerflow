# Agent #7 (2026-11-16) — Final Report & Patch Index

- **Branch:** `arena/93656b5f-ledgerflow` at `origin/main` `3a4ad7d`
- **Scope actually changed on the branch:** 9 source files (authorized lane) + 2 new regression-test files +
  this audit directory. Nothing in `src/server/**`, `supabase/migrations/**`, money/tax math, or any file
  owned by an open PR.
- **Shipped as proposals:** 4 patches and 2 probes for reserved-lane defects (see §4).
- **Decision-maker:** Shmuel (`shmuelbiller1`). Nothing is merged, closed or released here.

---

## 1. Findings fixed on the branch

| ID | Defect (before) | Fix | Locked by |
|---|---|---|---|
| `A7C-01` | "/" label conversion could make a parent whose name a sibling short name already uses; NFC and case variants were counted as different names, so one label ended up with two meanings | `slashConversionPlan` excludes colliding short names; `slashConversionSkipped` explains each; parent creation de-duplicates by NFC-lowercased name | 7 tests (4 pure, 1 offer render, 1 convert flow, 1 non-colliding regression) |
| `A7C-02` | `17,5` read as a rate, overflowing rates wrapped, `2026-02-30` accepted, `taxRate` unbounded, draft lost after hydration and reopened after Close | `parseTaxPercent`, `parseQuantity`, safe-integer `parseRate`, calendar check, `0..100` bound; `Sales.tsx` hydrates the draft on session change, remembers a dismissal, and re-resolves a provisional `new-` customer | 6 tests |
| `A7C-03` | A correctly linked entry was reported as tampered because a server-signed unlinked entry sat between it and its predecessor | single-pass chronological chain check (`lastLinkedHash` + strictly-before unlinked hashes) | 5 tests |
| `A7C-04` | Deleting a document reported success and dropped the row even when the server refused; the Delete button also opened the overlay | `removeAttachment()` before the UI row goes; refusal keeps the row; click stops propagation and a functional `setSelectedDoc` closes the overlay | 2 tests |
| `A7C-05` | Receipt injection could post twice, always in USD, with a made-up timestamp | deterministic `vault-receipt-<id>` + `x-operation-id` + document `createdAt` + workspace currency; already-linked documents offer no inject | 2 tests |
| `A7C-06` | Quick-add posted `USD` regardless of the workspace | balanced entry's currency → workspace currency → `USD` | 1 test |
| `A7C-07` | Auto-reconcile's signatures were built over all transactions but read by postable index; amounts compared in raw minor units | `isPostable` filter before signatures; `convertMinorUnits` + bank-scoped `cashDelta` | 4 tests |

## 2. Findings shipped as reserved-lane proposals

| Patch | Finding | Why not on the branch |
|---|---|---|
| `patches/08-group-report-non2dec-translation.patch` | `A7N-10` — group translation multiplied whole yen (and KWD fils) by a major-unit rate | `src/server/reports/**` is reserved |
| `patches/09-asset-undo-entry-ownership.patch` | `A7N-11` — asset undo voids whatever entry the asset row points at | `src/server/services/**` is reserved |
| `patches/10-year-close-draft-trap-and-period-scope.patch` | `A7S-01` — year close locks drafts into an unpostable year; four period commands sit on `write:transactions` | `src/server/commands/**`, `src/server/auth/**` are reserved |
| `patches/11-document-ledger-link-and-ticket-visibility.patch` | `A7S-03` + ledger-link half of `A7S-04` — a viewer can relink a document; any member reads every colleague's ticket | `supabase/migrations/**` + `src/server/routes/**` are reserved |
| *(withdrawn)* `07-deposit-multicurrency-total` | `A7N-09` — deposit mixed currencies | fixed upstream by `#746`; withdrawn rather than shipped stale |

Probes: `probes/probe-08-translation-and-api-scope.ts` (live code, no DB) and
`probes/probe-11-document-links-and-ticket-visibility.ts` (live PostgreSQL, browser role). Both were run
against the unpatched and the patched tree; the unpatched run reproduces the defect. Full transcripts in
`03-RESERVED-LANE-FINDINGS.md` and `04-VERIFICATION-LOG.md`.

## 3. Deliberately recorded, not patched

- `A7S-04` row-policy half (viewers read salary/ACH): the RLS suite asserts a viewer *can* read an employee
  row, so this is a product decision. Patch 11 ships the read-only `lf_employee_directory` view so a screen
  can move first; the policy narrowing and its test change are written out in `03-RESERVED-LANE-FINDINGS.md`.
- `A7S-02` (duplicate customers/vendors): merge-vs-refuse is a product decision.
- `A7S-05` (untyped `validateWorkspaceMember` errors → 500s): needs a typed error across every route's
  contract.
- Carry-forward `audit/agent7-2026-11-13/patches/01`–`05`: no longer apply to `3a4ad7d`; spot checks suggest
  `01`/`03` are fixed upstream and `05` is superseded by `20261116000000_rls_mfa_and_asset_hardening.sql`,
  leaving `04` (FX revaluation cut-off) the clear survivor. They need a rebase before anyone applies them.

## 4. Gates

| Gate | Result |
|---|---|
| `tsc --noEmit` (4 GB heap) | clean |
| ESLint on the 11 changed/new files | 0 problems |
| New regression suites | 28/28 pass; every behavioural test fails on the pre-fix code |
| Related suites (`label-tree`, `free-invoice`, `auditor`, `reconciliation`, `attachments`, `invoice-modal`, `deposit-ui`) | 55/55 pass |
| `check:layers` | pass |
| `test:security` | 4 pass, 0 fail, 1 skipped by the script |
| `test:rules` with the proposed migration applied | `ALL RLS TESTS PASSED` |
| `git apply --check` on patches 08–11 (detached worktree of `3a4ad7d`) | clean |
| full suite `npm test` (6,229 tests) | 6,226 pass, 1 skipped, **2 fail** — both are wall-clock perf budgets (`R-5`, `A-206`) that fail identically on the untouched base `3a4ad7d` in this sandbox; GitHub Actions on the pull request is green end to end (4 unit shards, 6 timezone shards, 5 browser shards, Playwright smoke, lint/types/DB rules, build, SonarCloud, CodeQL) |

## 5. Files

```
audit/agent7-2026-11-16/
  01_INSTRUCTION_SOURCES_AND_CONFLICT_RESOLUTION.md   (Checkpoint 01)
  02-CHECKPOINT-02-REMEDIATIONS-AND-PATCH-QUEUE.md
  03-RESERVED-LANE-FINDINGS.md
  04-VERIFICATION-LOG.md
  05-FINAL-REPORT-AND-PATCH-INDEX.md                  (this file)
  patches/08-group-report-non2dec-translation.patch
  patches/09-asset-undo-entry-ownership.patch
  patches/10-year-close-draft-trap-and-period-scope.patch
  patches/11-document-ledger-link-and-ticket-visibility.patch
  probes/probe-08-translation-and-api-scope.ts
  probes/probe-11-document-links-and-ticket-visibility.ts
src/tests/agent7-2026-11-16-remediations.test.tsx        (23 tests, A7C-01/02/03/06/07)
src/tests/agent7-2026-11-16-vault-remediations.test.tsx  (4 tests, A7C-04/05)
```

## 6. For Shmuel, in one paragraph

Seven defects are fixed on the branch and pinned by tests that fail without the fix; the branch is green on
types, lint, the suites it touches, layers, security and the full suite. Four reserved-lane patches come with
reproduction probes: group reporting renders yen groups a hundred times too small, asset undo can void an
unrelated entry, a year close can lock drafts out of existence, and a viewer can relink a document while any
member can read every colleague's support ticket (and, separately, every colleague's salary — which needs
your call, because the rule test says viewers are meant to read that row). Nothing is merged; the queue and
the rejected approaches are written down so the next session does not repeat them.
