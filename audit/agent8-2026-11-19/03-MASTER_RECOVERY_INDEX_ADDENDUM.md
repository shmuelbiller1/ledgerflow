# MASTER_RECOVERY_INDEX — Agent #8 addendum, 2026-11-19 (PR #911)

This addendum follows the convention used for the previous Agent #8 session
([`2026-11-18_Agent8_PR885_7eab282_MASTER_RECOVERY_INDEX_ADDENDUM.md`](https://drive.google.com/file/d/1ZJcC5QEykxUGrwyCDhcKtYcUmDwr2Y-3/view)):
the canonical index (`1pTGxQhLdqBvH4sLoR-0MZ0XuvKtTP86F`, 87 KB, last updated by Agent #6) is **not** rewritten
here, so no other agent's section can be lost. Read this page together with the canonical index.

## Session facts

| Item | Value |
| --- | --- |
| Agent | #8 (independent audit — engineering, accounting, security, launch) |
| Date | 2026-11-19 |
| Branch | `arena/74a5c64e-ledgerflow` (pushed to `origin`) |
| Base | `5eacf71f633f00a5db7ae44d3fdba75b4d3700cf` (`main`) |
| Commits | `932c6f5` (fixes + tests), `3ad070f` (register + checkpoint) |
| PR | [#911](https://github.com/shmuelbiller1/ledgerflow/pull/911) — open, unmerged (Shmuel decides) |
| Lane discipline | **zero** edits under `src/server/**`, `supabase/**`, `src/lib/tax*`, `src/lib/fx*`, or money maths |

## Fixed on this branch (verified, with tests)

1. **A8-031 / G-19 / [#893](https://github.com/shmuelbiller1/ledgerflow/issues/893)** — `BillModal` re-applied
   the hard-coded $5,000 submission threshold when a reviewer approved an already-`pending` bill, forcing it
   back to `pending` for ever. The threshold now gates new/draft submissions only.
   Test: `src/tests/bill-modal.test.tsx` → “G-19: approving an already-pending bill over the threshold finishes
   the decision” (fails on `5eacf71`).
2. **A8-032 / [#909](https://github.com/shmuelbiller1/ledgerflow/issues/909)** — negative shares in
   Income-by-source / Expense-by-category produced a negative CSS width; browsers reject it, the block fell back
   to `auto` and a refund rendered as a full 100 % bar. Now clamped to `[0, 100]`.
   Test: `src/tests/share-bar-clamp.test.tsx` (hand-worked books, both components).

## Reported, deliberately not patched

- **A8-029 (High, AI #1 lane)** — bills have **no** server-side approval enforcement or approval record:
  `src/server/services/ledgerBulkCommit.ts:386` applies `serverApproval` only when
  `collection === 'invoices'`; `bill.update` (`src/server/commands/documents.ts:426`, roles at `:125`) writes
  whatever `status` the request carries; `BillSchema` (`src/schemas.ts:294`) has no `approval` field although
  `InvoiceSchema` (`:282`) does; `auditFor` (`:245`) logs only “Update bill …”. Consequence: a bookkeeper can
  approve their own bill above any threshold, the two-person rule and delegation never apply to payables, and
  no record says who approved. Related issue: **#857** (PR #908 handles only the expense-claim part).
- **A8-030 (Medium)** — `src/lib/approvalWorkflow.ts` (`ApprovalRequest`, `approveRequest`, `rejectRequest`,
  `ApprovalRule`) has **no callers**; the effective rule is a literal in `BillModal.tsx:214`; no approval
  collection exists. Payable thresholds are therefore unconfigurable and decisions are not durable.
- **A8-033 (Low)** — `splitRules` accepts arbitrary records (`src/schemas.ts:363`) and
  `ProjectsView.tsx:279` renders the percentage unclamped; display-only today, no payout maths consumes it.

## Duplicate work avoided

- **#906** (inventory CSV decimals) is already fixed in open **PR #889** (`csvMoneyForCurrency`).
- **#910** (four account-report CSVs) has a caller-only patch on Drive,
  [`Agent7-910-after-889.patch`](https://drive.google.com/file/d/1F1mGs94YIyUtY2L09bYptWtd2YdgoyEU/view),
  which imports the #889 helper and cannot apply before #889 lands. Not re-implemented.
- **#909** had an independent proposal (`Agent7-909`); the clamp implemented here reaches the same result.

## Verified Drive artifacts for this session

| Artifact | File | ID | Size |
| --- | --- | --- | --- |
| Findings register A8-029…A8-033 | `2026-11-19_Agent8_PR911_Findings_Register_A8-029_A8-033.md` | `1mADwSkkzmKm67zEhXj3mHxKPpkh812iQ` | 12,443 B |
| Checkpoint 01 | `2026-11-19_Agent8_PR911_Checkpoint01.md` | `1KoAjV7N09l33iJQx2tfLxgvDB1PIlC8l` | 4,529 B |
| Full recovery patch (`932c6f5` + `3ad070f`) | `2026-11-19_Agent8_PR911_3ad070f_Full.patch` | `1OsfYXckTyegMYaWmjAoO9B2lXQx_7hvw` | 29,837 B, MD5 `833818687fa79ced50895f9703528778` |
| This addendum | `2026-11-19_Agent8_PR911_MASTER_RECOVERY_INDEX_ADDENDUM.md` | *(this file)* | — |

All three were re-opened after upload and their content verified (the register's header and table read back
correctly; the patch size and MD5 match the local file).

## Resume instructions

```bash
git fetch origin arena/74a5c64e-ledgerflow
git checkout arena/74a5c64e-ledgerflow      # HEAD should be 3ad070f or later
npm ci --ignore-scripts
NODE_OPTIONS=--max-old-space-size=4096 npm run lint:types
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  npx tsx --test --test-force-exit src/tests/bill-modal.test.tsx src/tests/share-bar-clamp.test.tsx
gh pr checks 911
```

Sandbox note: `tsc --noEmit` OOMs with the default heap (~1.9 GB) in this environment; `NODE_OPTIONS=--max-old-space-size=4096` is required. This is an environment limit, not a code defect.

## Next Agent #8 work

1. Confirm PR #911 all-green on the latest commit; re-check for review/bot comments after the run.
2. Re-read `docs/COORDINATION.md` in chunks (the file is 284 KB and truncates when read whole) for queue items
   addressed to Agent #8 — **not yet verified this session**.
3. Continue the independent sweep outside `src/server/**`: purchase-order approval parity, attachment and
   permission surfaces, client write-path error handling, reconciliations UI.
