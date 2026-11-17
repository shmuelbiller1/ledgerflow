## What this is

Seven defects found and fixed in the authorized lane (`src/components/**`, `src/hooks/**`, `src/lib/**`,
`src/services/**`), plus the reserved-lane work of this session delivered as **patch proposals** with
reproduction probes. Base: `main` `3a4ad7d`.

Nothing in `src/server/**`, `supabase/migrations/**`, money/tax math, or any file owned by open PRs `#743`,
`#744`, `#746`, `#750` is touched by the branch itself.

## Fixes

| ID | Before | After |
|---|---|---|
| `A7C-01` | "/" label conversion could give a parent a name an existing sibling short name already uses; NFC/case variants counted as different names, so one label got two meanings | `slashConversionPlan` skips colliding short names and says why; parent creation de-duplicates by NFC-lowercased name |
| `A7C-02` | `17,5` read as a rate, overflowing rates wrapped, `2026-02-30` accepted, `taxRate` unbounded, invoice draft lost after hydration and resurrected after Close | strict parsing + calendar check + `0..100` bound; the draft hydrates on session change, remembers dismissal, and re-resolves a provisional `new-` customer |
| `A7C-03` | A correctly linked entry reported as **tampered** whenever a server-signed unlinked entry sat between it and its predecessor | single-pass chronological chain check (`lastLinkedHash` + strictly-before unlinked hashes) |
| `A7C-04` | Deleting a document reported success and dropped the row even when the server refused; the Delete button also opened the overlay | `removeAttachment()` first; refusal keeps the row; click stops propagation and the overlay closes functionally |
| `A7C-05` | Receipt injection could post twice, always in USD, with a made-up timestamp | deterministic `vault-receipt-<id>` + `x-operation-id`, workspace currency, document `createdAt`; linked documents offer no inject |
| `A7C-06` | Quick-add posted `USD` regardless of workspace | balanced entry's currency → workspace currency → `USD` |
| `A7C-07` | Auto-reconcile signed all transactions but read by postable index; amounts compared in raw minor units | `isPostable` before signatures; `convertMinorUnits` + bank-scoped `cashDelta` |

Each fix is pinned by a test that was re-run against the reverted implementation and fails there — see
`audit/agent7-2026-11-16/04-VERIFICATION-LOG.md` §3.

## Reserved-lane proposals (patches are not applied on this branch)

| Patch | Finding | Why it matters |
|---|---|---|
| `08` | `A7N-10` | A ¥1,000,000 group renders as **$67.00** (`6700` cents instead of `670000`); KWD skews 100x the other way. `translate()` and the elimination paths now use `convertMinorUnits`. |
| `09` | `A7N-11` | Asset undo voids whatever entry the asset row points at, then rewinds the asset from that entry's `metadata.before`. Requires the entry to name *this* asset and be the entry type this service writes. |
| `10` | `A7S-01` | `period.yearclose` writes `lockDate` over a whole year without checking drafts — a draft inside that year can then neither be posted nor deleted. Also maps every `period.*` command to `write:workspaces` (four sat on `write:transactions`). |
| `11` | `A7S-03` + link half of `A7S-04` | A **viewer** can detach a receipt from the entry it is evidence for, or point it at another entry, with no audit line. Any member reads every colleague's support ticket, including `unreadForAdmin`/`errorDiagnostics`, and can write those fields. Patch narrows ticket read/update to the owner, extends `lf_documents_kind_guard` with an old-vs-new `linkedTransactionId` comparison, adds `POST /api/v1/workspaces/:id/attachments/:id/link` (writer roles, same-workspace posted entry, audit line) and a read-only `lf_employee_directory` view. |

`07` (deposit currency mixing) was **withdrawn**: `#746` already fixes it per payment.

Probes reproduce each defect against the unpatched tree and pass with the patch:
`probes/probe-08-translation-and-api-scope.ts` (pure code; prints `netIncome: 6700` before, `670000` after) and
`probes/probe-11-document-links-and-ticket-visibility.ts` (live Postgres as the browser role; `A/B/C` open
before, refused after). Patch 11's migration was applied to a real database for `npm run test:rules`:
`ALL RLS TESTS PASSED`.

## Needs your decision (not patched)

- **`A7S-04` row-policy half:** `employees`/`payRuns` use the standard `member_read` policy, so a viewer can
  `select` every colleague's `salaryCents`, deductions, SSN/tax id and ACH routing/account. Not applied because
  `supabase/tests/rls.test.sql` currently **asserts** a viewer may read an employee row — this changes the
  product contract, so the narrowing and its test change are written out in `03-RESERVED-LANE-FINDINGS.md`.
- **`A7S-02`** duplicate customers/vendors (merge vs. refuse is a product decision).
- **`A7S-05`** `validateWorkspaceMember` throws untyped errors, so non-member requests answer 500.

## Gates

`tsc --noEmit` clean (needs a 4 GB heap on this repo) · ESLint scoped to the 11 changed/new files: 0 problems ·
new regression suites **28/28** · related suites **55/55** (`label-tree`, `free-invoice`, `auditor`,
`reconciliation`, `attachments-ui`, `invoice-modal`, `estimate-deposit-ui`) · `check:layers` pass ·
`test:security` 4 pass / 0 fail / 1 skipped by the script · `test:rules` `ALL RLS TESTS PASSED` with the
proposed migration applied · `git apply --check` clean for patches 08–11 against `3a4ad7d`.

## Carry-forward

`audit/agent7-2026-11-13/patches/01`–`05` no longer apply to this base (only `06` does). Spot checks suggest
`01`/`03` are fixed upstream by `#746`, `05` is superseded by `20261116000000_rls_mfa_and_asset_hardening.sql`,
and `04` (FX revaluation `asOf` cut-off / AP account) is still open. Rebase or retire before applying.

Full documentation: `audit/agent7-2026-11-16/` — Checkpoint 01/02, reserved-lane findings, verification log,
final report, addendum for the Drive recovery index.
