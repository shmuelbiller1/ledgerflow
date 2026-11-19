# Agent #8 — checkpoint 03 (2026-11-19)

**Branch:** `arena/74a5c64e-ledgerflow` · **PR:** [#911](https://github.com/shmuelbiller1/ledgerflow/pull/911)

| Commit | What |
| --- | --- |
| `932c6f5` | G-19/#893 pending-bill approval loop + #909 negative share bars (+ tests) |
| `3ad070f` | findings register (A8-029…A8-033) + checkpoint 01 |
| `6e2ddc0` | MASTER_RECOVERY_INDEX addendum |
| `1c74662` | A8-034 — approval decision only for owner/accountant/delegate (+ test) |
| `d0b56d1` | checkpoint 02 + A8-035 (negative-net shares read 0.0 %) |
| `2521b05` | Gitar review fixes — real-hold test by amount, locked status for non-approvers (+ 2 tests) |

## PR #911 review feedback — every comment examined

Gitar: *Changes requested, high risk, 2 findings.* **Both genuine; both fixed** in `2521b05`, answered in
[comment 6998369646](https://github.com/shmuelbiller1/ledgerflow/pull/911#issuecomment-6998369646).

1. **Pending ≠ held.** `'pending'` is also the first save of an ordinary bill, so my first fix let a $100 bill be
   reopened at $50,000 and approved in one click. The decision now requires the amount not to have grown since
   the bill was saved; a raise re-applies the threshold and stamps `metadata.approvalHeld` (cleared on decision).
2. **Status select bypass.** Hiding *Approve Bill* still left the status dropdown, so a non-approver could set
   *Unpaid* and save out of review. The select is now disabled/pinned to `pending` for a non-approver on a held
   bill, and `handleAction` refuses approver-only statuses as a second line.

Not adopted verbatim: Gitar's snippet compares against `lineSumCents` (pre-tax) while `total` is tax-inclusive,
which would mis-flag every tax-inclusive bill as “grown”; like is compared with like instead.

SonarCloud: Quality Gate passed, 0 new issues. No other bot or human comments on the PR at this checkpoint.

## Local verification on `2521b05`

| Check | Result |
| --- | --- |
| `tsc --noEmit` (4 GB heap) | clean |
| `eslint` `BillModal.tsx` + `bill-modal.test.tsx` `--max-warnings 2` | clean |
| `bill-modal` (16) + `share-bar-clamp` (2) + allocation-rules + bill-stock-ui + contact-extras + document-more-options + document-defaults-forms + dimension-inline-workflow + bill-record-page + spread-bill | **96/96 pass** |
| Both new Gitar regression tests re-run against the previous logic | both fail → load-bearing |
| Hosted CI on `2521b05` | re-running when written; must be read from the PR |

## State of the findings

- **Fixed on this branch:** A8-031 (G-19/#893), A8-032 (#909), A8-034 (role gate, incl. both bot findings).
- **Reported, not patched:** A8-029 (High — no server-side bill approval enforcement/record; also covers purchase
  orders), A8-030 (approval rules never persisted; `approvalWorkflow.ts` dead code), A8-033 (split-rule
  percentages), A8-035 (negative-net shares read 0.0 %).
- **Not duplicated:** #906 (PR #889), #910 (dependent on #889, patch on Drive).

## Next

1. Read CI to completion on `2521b05`; re-check the PR for new comments after the run.
2. `docs/COORDINATION.md` in chunks — Agent #8 queue items are still **unverified** (file truncates when read whole).
3. Continue the sweep outside `src/server/**` (attachments/permissions, reconciliations, client write errors).
4. Refresh the Drive copies of the register/checkpoints and keep the addendum pointer current.
