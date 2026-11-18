# D-98 · W10 — backup → change → restore, and the reports are exactly what they were

**Task:** D-98 = F-46, P0 for stage A. Browser journey: make a backup, change records, restore it →
P&L, balance sheet and trial balance equal the figures from before the change (exact amounts),
phone and desktop, with axe.

**Spec:** `e2e/w10-backup-restore-reports.spec.ts` (390 px and 1280 px).

## What the journey really does

It drives the app's own Settings → Backup & Export screen
(`src/components/platform/settings/BackupExportSettings.tsx`), not a stand-in:

1. **Make the backup** — clicks **Export JSON Backup**. The screen fetches the server export
   (`GET /api/v1/workspaces/:id/export`) and downloads a file; the test reads the downloaded file
   from disk, so the assertion is on the bytes a user would keep. It re-computes the file's SHA-256
   the same way the restore code does and checks the file is self-consistent.
2. **The backup's own reports** — the real `ProfitAndLossView`, `BalanceSheetView` and
   `TrialBalanceView` are mounted against the app's stores and show the worked figures below.
3. **Change the records** — the extra January expense is added to the store (what the live
   subscription delivers after the server posts it) and each report moves as the arithmetic says.
4. **Restore that file** — the downloaded file is put back through the real **Restore backup file**
   control. The client checks the file and shows its name, the target workspace and the consequences
   of replacement. Escape cancels and restores focus without sending a request. After reselecting the
   same file, **Replace workspace records** sends one POST with the exact JSON text. The test applies
   the restored rows to the store as a subscription would; no server transaction runs in this journey.
5. **Parity** — P&L, balance sheet and trial balance are the backup's figures again, to the cent, and
   the trial balance still says *Balanced Double-Entry*.
6. **A damaged file is refused whole** — one amount in the file is changed and uploaded. The client
   fails the checksum, clears the input, and **nothing is posted** (`/restore` request count
   unchanged).
7. **Axe** — the confirmation dialog and restored trial balance are checked for new serious or
   critical violations; the report’s existing contrast measurements are tracked separately.

Only the HTTP boundary is stubbed: the export body, the restore reply, and report endpoints (500, so
the screens use their own ledger fallback). The posting and the server's restore transaction are
covered elsewhere: `src/tests/backup-restore.test.ts`, `src/server/services/workspaceRestoreService.ts`
and `src/tests/server-write-roles.test.ts`.

## Worked figures (USD cents, January 2026)

Accounts (opening balances): `1000 Cash` asset 1,000,000c; `1200 Accounts Receivable` asset 0;
`2000 Accounts Payable` liability 0; `3000 Retained Earnings` equity 1,000,000c; `4000 Sales`
income 0; `6000 Office Expense` expense 0.

| # | date | entry | debit | credit |
|---|---|---|---|---|
| t1 | 2026-01-05 | sale to Acme | Receivables 360,000 | Sales 360,000 |
| t2 | 2026-01-10 | office rent | Office Expense 60,000 | Cash 60,000 |

**In the backup**

| Report | Working | Figure |
|---|---|---|
| P&L | income 3,600.00 − expense 600.00 | **$3,000.00** |
| Balance sheet | assets Cash 9,400.00 + Receivables 3,600.00 | **$13,000.00** |
| | claims equity 10,000.00 + profit 3,000.00 | **$13,000.00** → balanced |
| Trial balance | debits Cash 9,400 + Receivables 3,600 + Office Expense 600 | **$13,600.00** |
| | credits equity 10,000 + Sales 3,600 | **$13,600.00** → balanced |

**After the change** — t3 2026-01-20 extra office cost 275,000c: Office Expense / Cash

| Report | Working | Figure |
|---|---|---|
| P&L | income 3,600.00 − expense 3,350.00 | **$250.00** |
| Balance sheet | Cash 6,650.00 + Receivables 3,600.00 | **$10,250.00** |
| Trial balance | Cash row 6,650.00, Office Expense row 3,350.00 | total still **$13,600.00** |

The trial-balance total is deliberately unchanged: a posted expense moves money between two
accounts, it does not create or destroy any, so the totals must stay equal. The change is asserted
on the two account rows instead — that is where a restore either brings the money back or does not.

**After the restore** — every figure above is the backup's again ($3,000.00 / $13,000.00 /
$13,600.00 with Cash 9,400.00 and Office Expense 600.00).

## What this does not prove

- The server's restore transaction (a real database) — covered by the server suites named above.
- A real authenticated session against a deployed environment (G-24 / G-01 territory).
- Provider-side recovery. The unverified Firestore PITR panel was removed (#779). Recovery settings,
  backup retention, recovery point/time targets and a restore drill must be verified separately
  against the Supabase setup (S-19 / `docs/FOR_YOU.md`).

## Screen safety regressions (#776 / #779)

The same browser spec checks that a failed full export does not download a file automatically or
advance the reminder. A user can explicitly download a partial copy on a service failure; renaming
it does not make it restorable. Access refusals and invalid successful responses do not produce a
backup. It also checks wrong-workspace refusal, owner-only restore controls, dismissal on workspace
change, stale file validation on a new sign-in, and an exact, single ZIP restore request despite a
repeated click while waiting on a server refusal. These are browser tests with stubbed HTTP, not a
second test of the database restore transaction.

## Accessibility findings on the restored screen (reported, counted, not hidden)

Axe on the restored trial balance finds **serious** issues that are the screen's own, not the
journey's. They are recorded in `e2e/journey-a11y-baseline.json` with counts that may only go down,
and reported to the lead:

| Width | Rule | Nodes | What it is |
|---|---|---|---|
| 390 | `scrollable-region-focusable` | 1 | the trial-balance table scrolls sideways on a phone, but the scrolling area cannot be reached with a keyboard (gated by the baseline) |
| 390 | `color-contrast` | 2 (measured; 4–6 on the P&L) | small upper-case labels / muted figures below the contrast minimum in light mode |
| 1280 | `color-contrast` | 2 | the same labels |

`scrollable-region-focusable` **fails the gate** if it appears anywhere else (baseline
`e2e/journey-a11y-baseline.json`, which may only go down). `color-contrast` is measured and printed on
every run but does not fail it: axe reads the colours at the instant of the scan and these screens fade
their figures in, so the same screen reports 4 nodes on one run and 6 on the next — a gate that fails on
that would only teach people to ignore it. The fix is a display change to the report screens (or its own
contrast baseline entry, like `e2e/contrast-baseline.json`), and it is with the lead.

`e2e/contrast-baseline.json` reads 0 for `light:Reports` because the contrast suite visits the
Reports tab's landing screen, not the statements themselves — the gap this journey found. Fixing the
colours or the scroll container is a display change to the report screens and a visual-baseline
refresh, so it is not done as a side effect of a test task.

## Verified in CI (GitHub Actions, PR #324)

`Browser shard 4/4` — the shard that runs this spec, at 390 px and 1280 px — **passed**, together with
the whole workflow: browser shards 1–4, the four unit shards in UTC, both in `Pacific/Auckland` and
`America/Los_Angeles`, lint/typecheck/database rules, the coverage gate, the production build, CodeQL,
the SBOM and the required "Playwright E2E Smoke Suite" check. This is the first green browser run for
W10; the earlier PR (#323) failed its own lint check and its trial-balance figures were wrong.

The assertions above were also what failed and then passed on the way there — the CI annotations for
the intermediate runs name each failure (figures, then the accessibility gate), which is why the counts
in the accessibility section are the real ones from those runs rather than guesses.
