# 2026-11-16 — Agent #7 addendum to `MASTER_RECOVERY_INDEX.md`

This addendum is **additive**. It does not restate, replace or reorder any earlier agent's entries in
`MASTER_RECOVERY_INDEX.md`; read it together with the section the index already carries for Agent #7
(2026-11-11, pin `39b0012`). Where the two differ about **this** session, this file is the current one.

## Session

| | |
|---|---|
| Branch | `arena/93656b5f-ledgerflow` on `shmuelbiller1/ledgerflow` |
| Base | upstream `main` **`3a4ad7d`** |
| Status | active; work pushed to that branch only, nothing merged, nothing closed |
| Lane | authorized lane only: 9 source files + 2 new test files + `audit/agent7-2026-11-16/`. No edits to `src/server/**`, `supabase/migrations/**`, money/tax math, or files owned by open PRs `#743`, `#744`, `#746`, `#750`. |
| Audit dir | `audit/agent7-2026-11-16/` (Checkpoint 01, Checkpoint 02, reserved-lane findings, verification log, final report, `patches/`, `probes/`) |

## Direct fixes on the branch (each pinned by a test that fails without it)

`A7C-01` label-tree "/" conversion collisions · `A7C-02` free-invoice/tax-rate/quantity parsing + Sales
draft hydration · `A7C-03` auditor false "tampered" on correctly linked entries · `A7C-04` Vault delete that
lies · `A7C-05` receipt injection posting twice in the wrong currency · `A7C-06` quick-add always `USD` ·
`A7C-07` auto-reconcile signature/amount drift.

## Reserved-lane proposals (4 patches + 2 probes, none applied)

| Patch | Finding | One line |
|---|---|---|
| `08-group-report-non2dec-translation` | `A7N-10` | Group reporting renders a ¥1,000,000 group as `$67.00` (`6700` cents instead of `670000`) |
| `09-asset-undo-entry-ownership` | `A7N-11` | Asset undo voids whatever entry the asset row points at, then rewinds from that entry's metadata |
| `10-year-close-draft-trap-and-period-scope` | `A7S-01` | Year close locks drafts into an unpostable year; four `period.*` commands sit on `write:transactions` |
| `11-document-ledger-link-and-ticket-visibility` | `A7S-03` + link half of `A7S-04` | A viewer can relink a document to another entry; any member reads every colleague's ticket |
| *(withdrawn)* `07` | `A7N-09` | Deposit currency mixing — fixed upstream by `#746` |

Decisions waiting on Shmuel: `A7S-04` row-policy half (a viewer can read every colleague's salary and ACH
details — the RLS suite currently *asserts* viewers may read an employee row, so changing it changes the
product contract), `A7S-02` duplicate customers/vendors, `A7S-05` untyped `validateWorkspaceMember` errors.

## Carry-forward queue from `audit/agent7-2026-11-13/`

On `3a4ad7d` only `patches/06` still applies. `01`/`03` look fixed upstream (`#746`), `05` is superseded by
`20261116000000_rls_mfa_and_asset_hardening.sql`, `02` needs a rebase to say what remains, and `04` (FX
revaluation `asOf` cut-off/AP account) appears still open. Do not re-apply `01`–`05` blindly.

## Gates (this session)

`tsc --noEmit` (4 GB heap) clean · ESLint scoped to the changed files 0 problems · 28/28 new regression tests ·
55/55 related suites · `check:layers` pass · `test:security` 4 pass/0 fail/1 skipped by the script ·
`test:rules` `ALL RLS TESTS PASSED` with patch 11's migration applied (three consecutive runs).

## Drive artifacts for this session

| Item | Folder | File |
|---|---|---|
| Checkpoint 02 | `03 Progress Checkpoints` | [2026-11-16_Agent7_Checkpoint02_Remediations-and-Patch-Queue.md](https://drive.google.com/file/d/1_ss0Zf0UbgkNJ3uUUvL32Ad5IitQbAx-/view) |
| Reserved-lane findings | `04 Accounting Findings` | [2026-11-16_Agent7_Reserved-Lane-Findings.md](https://drive.google.com/file/d/1aeRY3qqQhGvT4cTaToaLDrz2qhnFq_bg/view) |
| Final report & patch index | `02 Agent Reports` | [2026-11-16_Agent7_FINAL-Report-and-Patch-Index.md](https://drive.google.com/file/d/1Oh3dsptOwiBZxw7WnD6sKT9VdUGf9_jg/view) |
| Verification log | `06 Testing and CI` | [2026-11-16_Agent7_Verification-Log.md](https://drive.google.com/file/d/1NpJV5tbWHUAWDIKWWPB6EDmhLEGcFAGp/view) |
| Patch 08 | `05 Code Changes and Recovery Patches` | [08-group-report-non2dec-translation.patch](https://drive.google.com/file/d/1n-VU4cPxVoPcTNOnbM8W62_wddbJa625/view) |
| Patch 09 | same | [09-asset-undo-entry-ownership.patch](https://drive.google.com/file/d/1ItnIhbNRYzaXbIPWLzNsyrChSB7RK1eD/view) |
| Patch 10 | same | [10-year-close-draft-trap-and-period-scope.patch](https://drive.google.com/file/d/1HXKbMISc_jaPuYqTZyFRYDK-XEFSTfGT/view) |
| Patch 11 | same | [11-document-ledger-link-and-ticket-visibility.patch](https://drive.google.com/file/d/1-BF96TNahSxKBsHriayu9v40pTdN8Y0r/view) |
| Probe 08 | same | [probe-08-translation-and-api-scope.ts.txt](https://drive.google.com/file/d/1mV7zNmo4Dizd_2VmJY0OOazMUXG8sesj/view) |
| Probe 11 | same | [probe-11-document-links-and-ticket-visibility.ts.txt](https://drive.google.com/file/d/1fiJz8V0A0GIxbbe8j1MjSXWd4n2z_IQ9/view) |
