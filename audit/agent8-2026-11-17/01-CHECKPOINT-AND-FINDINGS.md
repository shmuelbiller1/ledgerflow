# Agent #8 — checkpoint 1 and findings register (17 Nov 2026)

Review lane only. **No product code is changed by this checkpoint**: everything here is under
`audit/agent8-2026-11-17/`. Money, posting, tax maths and `src/server/` belong to AI #1; the server
findings below are reported to AI #1 with runnable evidence, not patched.

| | |
|---|---|
| Repository | `shmuelbiller1/ledgerflow` (public) |
| Branch | `arena/8780265e-ledgerflow` |
| Pinned revision | `f69e2b4ecddd75393f51195c37fd444655731005` (`main` at the start of the session; merge of #758) |
| Runtime used | Node `v24.22.3`; PostgreSQL 17.6 on loopback (isolated, disposable; stub + every migration through `20261116000000`) |
| Not available here | Chromium (no browser test was run), Docker, the deployed site, production data |

## 1. What was executed in this session (not carried over, not inferred)

| Check | Result | Notes |
|---|---|---|
| `npm run lint:eslint` (Node 24) | pass, 0 errors, 2 warnings (the cap) | `src/server/auth/supabaseAuth.ts:21`, `src/server/db/pg/values.ts:7` |
| `npm run lint:types` (Node 24, 4 GB heap) | pass | a first run alongside ESLint ran out of memory; rerun alone passed |
| `node scripts/code-atlas.mjs validate` | pass | after fetching two historical commits the shallow clone lacked |
| `npm run db:test-setup` | pass | plain-Postgres stub + all migrations applied to the isolated database |
| `npm run test:rules` (RLS suite, real PostgreSQL) | **ALL RLS TESTS PASSED** | |
| 4 targeted DB suites (`agent8-2026-11-16-p0-audit`, `workspace-restore`, `backup-restore`, `l94-step2b-documents`) | **29 / 29 pass**, 0 skipped | real PostgreSQL |
| Reproduction `repro/a8n-01-…` | 4 / 4 pass = defect observed in 3 scenarios + 1 control | real PostgreSQL, real HTTP routers |
| Reproduction `repro/a8n-02-…` | 8 / 8 pass = defect observed in 6 cases + 2 controls | real PostgreSQL, real services |
| Reproduction `repro/a8n-03-…` | 2 / 2 pass = defect observed + 1 control | real PostgreSQL, real service |
| Full unit suite with the database (`src/tests/*.test.ts(x)`, `src/lib/*.test.ts`, `src/server/utils/*.test.ts`; `CI` not set) | **6,270 tests: 6,267 pass, 2 fail, 1 skipped** (13 min 51 s) | the 2 failures are speed budgets, see A8N-06; the 1 skip is the baseline writer that runs only with `LF_SECURITY_WRITE_BASELINE=1`; **no database-gated test was skipped** |

The reproductions assert what the code **does today**. When a guard is added they fail with "now refused",
which is the signal to re-verify and close the finding. They are outside the CI glob (`src/tests/*.test.ts`).

How to run any of them:

```bash
# an isolated, disposable PostgreSQL only — never a real database
export LF_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/lf_test
npm run db:test-setup
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  npx tsx --test --test-force-exit audit/agent8-2026-11-17/repro/a8n-01-applied-credit-delete-edit.repro.ts
```

## 2. Findings register (new in this session)

Severity is about consequence for a real set of books. "Confirmed" means reproduced by running the code;
"source" means read in the code and not run.

### A8N-01 — High — confirmed — an applied credit can still be deleted, or shrunk below what was applied

- **Type:** bug (missing guard); it contradicts a rule the product already enforces elsewhere.
- **Where:** `src/server/services/documentPostService.ts:133-140` (delete) and `:154-181` (update) read
  `appliedTo`; nothing in the product ever writes `appliedTo` (checked: outside tests the name occurs only
  in that file — the two reads and the list of fields the server strips from input, `:94`). Applying a credit only lowers
  `remainingCents` (`src/server/services/creditService.ts:255` and `:359`). The same file's status guard
  (`:160`) and the posting layer (`src/services/ledgerPost/creditPosting.ts:86-92`, `:232-238`) already
  refuse **void** and **draft** for an applied credit with the words "that would undo money that moved".
  Delete does the same reversal and is not refused. The code comment at `:133` records it as a known gap
  left for the owner after PR #746.
- **Evidence:** `repro/a8n-01-applied-credit-delete-edit.repro.ts`, observed values in
  `evidence/a8n-01-observed.json`. Every step goes through the HTTP routers a browser calls
  (`/api/v1/documents/…/post`, `/api/v1/commands/creditnote.*`, `/api/v1/payments/credits/apply|refund`).
  The delete, the shrink and the refund were done as a **bookkeeper**, not the owner.

| Scenario | Steps | Before | After | What no record explains |
|---|---|---|---|---|
| A | INV-A 330.00; CN-A 110.00 applied in full; delete CN-A (200 OK) | A/R ledger 220.00 = invoice due 220.00 | A/R ledger **330.00**, invoice still "110.00 paid" (due 220.00); revenue back to 300.00, VAT back to 30.00; the payment-ledger row still points at the deleted credit | **110.00** |
| B | INV-B 330.00; CN-B 110.00, 60.00 applied; total lowered to 50.00 (200 OK); the 50.00 "left" refunded from the bank (200 OK) | credit 110.00, 50.00 left | customer has had 60.00 off the invoice **and** 50.00 cash against a credit note that is 50.00 in the books | **60.00** |
| C | BILL-C 118.00; VC-C 118.00 applied in full; delete VC-C (200 OK) | A/P 0.00, bill paid | A/P ledger **118.00** owed, bill still "paid" | **118.00** |
| Control | same credit, `status: void` and `status: draft` | | both refused, 409 | — |

- **Consequences:** the receivable/payable account and the open documents no longer agree, and nothing in the
  product can bring them back: after scenario A the invoice can be neither deleted nor voided (both 409,
  "Void or unapply settlements first") and there is no unapply. In B, cash leaves the bank for a credit the
  ledger no longer carries. In C the books owe a vendor money that no bill asks anyone to pay.
- **What already limits it:** the Data Health check `control-balance` reports each difference afterwards
  ("Accounts receivable is $330.00, the open invoices add up to $220.00"). It detects; it does not prevent.
  A signed-in ledger writer of that workspace is needed; nothing crosses workspaces.
- **Recommended correction (AI #1's lane):** refuse delete, and refuse lowering the total below
  `amount − remaining`, whenever `remainingCents < amountCents` (the test the void rule already uses) or a
  live `credit` payment-ledger row names the credit; decide at the same time whether an "unapply" is wanted.
  `src/tests/l94-step2b-documents.test.ts:120-166` builds credits that are "partially_applied" from the start
  and edits and deletes them, so those fixtures need a credit that is open and unapplied.
- **Status:** open, reported to AI #1. **Tests performed:** the reproduction above. **Remaining risk:** FX
  credits (a `credit-application-fx` entry would also be left behind) were not run.

### A8N-02 — Medium — confirmed — an unsigned backup can change closed months (the A8-017 rule is incomplete)

- **Type:** bug. It reopens A8-017, which my 16 Nov report (PR #746) listed as fixed. That statement was too
  broad: the two cases the existing tests cover are refused; the cases below are not.
- **Where:** `src/server/services/workspaceRestoreService.ts:327-340`. For a backup without a verified
  signature, each **existing** posted closed-period entry must come back with the same
  `canonicalTxFingerprint` (`:26-42`: date, status, total, currency, rate, lines). Three gaps:
  1. the fingerprint leaves out the fields that decide whether an entry counts in reports
     (`deletedAt`, `type`, `metadata.isGhost` — `isPostable`, `src/lib/txFilters.ts:6-52`);
  2. only existing entries are looped over (`:330`), so a **new** entry dated in a closed month is never looked at;
  3. an existing entry that is not posted (void) is skipped (`:333`), so it can come back as `completed`.
  The signature does not help: removing `metadata.checksum` and `metadata.lockSignature` turns a signed file
  into an unsigned one, and `workspace.lockDate` in an unsigned file is whatever the file says (`:274`).
- **Evidence:** `repro/a8n-02-restore-closed-period.repro.ts`, `evidence/a8n-02-observed.json`. Books closed
  through 2026-05-31; May's profit and loss (the server's `computeProfitAndLoss`) is income 1,000.00, expense
  400.00, net 600.00.

| Case | Unsigned file | Result | May net profit afterwards |
|---|---|---|---|
| control-a | the 400.00 entry left out | refused 409 | 600.00 |
| control-b | its amounts changed | refused 409 | 600.00 |
| 1 | same entry + `deletedAt` | **accepted** | **1,000.00** |
| 2 | same entry + `type: "forecast"` | **accepted** | **1,000.00** |
| 3 | same entry + `metadata.isGhost` | **accepted** | **1,000.00** |
| 4 | a new 5,000.00 expense dated 28 May | **accepted** | **−4,400.00** |
| 5 | the voided 9,999.00 sale as `completed` | **accepted** | **10,599.00** |
| 6a | genuine signed export, edited, checksum kept | refused 400 | 600.00 |
| 6b | the same file with checksum and signature removed | **accepted** | **1,000.00** |

  In every accepted case `lockDate` still reads 2026-05-31 afterwards.
- **Consequences:** figures of a closed (possibly filed) period change while the books still say they are closed.
- **What already limits it:** only the workspace **owner** can restore (`workspaceApiRoutes.ts:229`, and the
  existing owner-only test passes); an owner can also reopen a month the normal way. What the restore path
  adds is that it leaves no trace (A8N-05). Nothing crosses workspaces.
- **Recommended correction (AI #1's lane):** for an unsigned file compare closed months as sets — every
  entry dated on or before the close, posted or not, existing or incoming, must be present on both sides and
  equal on every field `isPostable` and the reports read; or simpler, refuse any unsigned file once a month is
  closed and keep the signed path only.
- **Status:** open, reported to AI #1. **Remaining risk not run:** documents (invoices, bills, payments) of a
  closed month are not compared at all by this rule.

### A8N-03 — High — confirmed at the service; browser path read, not run — a partial "offline backup" restores as a full one and deletes the rest

- **Type:** bug (data loss).
- **Where:** `src/components/platform/settings/BackupExportSettings.tsx:56-102`: when the server export call
  fails for **any** reason, the screen builds the backup from the browser store (the lists the page had
  loaded — `AGENTS.md` §2 says these can be incomplete, and invoices, bills, customers, payments load only
  when a screen asks). The file gets a valid checksum, `metadata.serverAuthoritative: false`, the **same file
  name** as a full backup, and is recorded as a completed backup (`:115`). A toast warns at that moment only.
  Later, `handleFileSelect` (`:128-187`) accepts it — schema version, checksum and two arrays are all it
  checks — and posts it **as soon as the file is chosen, with no confirmation**. The server
  (`workspaceRestoreService.ts:316-369`) never reads `serverAuthoritative`; it deletes every row of every
  restorable table and writes the file.
- **Evidence:** `repro/a8n-03-partial-offline-backup-restore.repro.ts`, `evidence/a8n-03-observed.json`.
  A payload with exactly the keys the fallback builds, from a page that had loaded 1 of 3 entries:

| Table | Before | After the restore |
|---|---|---|
| ledger entries | 3 | **1** |
| invoices | 2 | **0** |
| customers | 1 | **0** |
| payments | 1 | **0** |
| credit notes | 1 | **0** |
| bank lines | 1 | **0** |
| payment-ledger rows | 1 | **0** |

- **Consequences:** permanent loss of most of a workspace from one click on a file the product itself made
  and named as a backup.
- **What already limits it:** once any month is closed the file is refused (it carries no close date) —
  confirmed in the reproduction. New users, who have closed nothing, have no such protection.
- **Recommended correction:** server (AI #1): refuse `serverAuthoritative === false`, or restore only the
  tables the file carries and never delete rows of the others. Screen (my lane, proposed in §4): name the
  fallback file as partial, refuse or loudly confirm it at restore, and ask before any restore.
- **Status:** open. **Not run:** the browser steps (no Chromium here).

### A8N-04 — Medium — source — the Backup screen states protections nobody has checked

- **Type:** misleading statement to users.
- **Where:** `src/components/platform/settings/BackupExportSettings.tsx:270-315`, fixed text: "Firestore
  Point-In-Time Recovery (PITR) & Automated Backups", a green **"PITR Active"** badge, "7 Days Continuous",
  "02:00 UTC Daily / 14-day snapshot retention", **"RPO < 1s | RTO < 5m — Zero data-loss architecture"**, a
  `gcloud firestore` command, and a **"Verify Backup Policy"** button whose only action is
  `toast.success('PITR Policy verified active on Google Cloud Firestore database')`.
- **Why it is wrong:** the data is in Supabase Postgres (`AGENTS.md` §5), not Firestore; nothing reads the
  provider's backup settings; the button verifies nothing. `docs/FOR_YOU.md` item 44(b) still asks the owner
  to check that point-in-time recovery is on, and S-19 (a backup-verification job) is open in
  `docs/COORDINATION.md:608`.
- **Consequences:** a customer is told their books are continuously protected when that is unknown.
- **Recommended correction:** remove the panel, or replace it with what is true and checked. Proposed in §4.
- **Status:** open.

### A8N-05 — Medium — confirmed at the service, route read — a restore leaves no audit-log row

- **Where:** `src/server/routes/workspaceApiRoutes.ts:229-239` and `workspaceRestoreService.ts`: neither
  calls `writeServerAuditLog`. After every accepted restore in the A8N-02 and A8N-03 runs the workspace had
  **0** `auditLogs` rows. The backup deliberately never carries the audit trail ("kept as it is").
- **Consequences:** the one action that replaces every record of a workspace is the one the audit trail does
  not show: who, when, and from which file.
- **Recommended correction (AI #1's lane):** write a `WORKSPACE_RESTORED` row (actor, counts per table, the
  file's checksum, whether it was signed) in the same transaction; the export could log too.
- **Status:** open.

### A8N-06 — Low — confirmed on this machine only — two speed budgets are not met without the CI allowance

- **Type:** observation (performance margin and what the gate proves).
- **Where:** `src/tests/r5-every-report-speed.test.tsx:22` and `src/tests/report-speed-12m.test.tsx:22`, `:221`:
  the budgets are **three times larger when `CI` is set** (1,000 → 3,000 ms per report view; 1,500 → 4,500 ms
  for loading the ten busiest screens).
- **Evidence (3 runs each on a 2-vCPU, 3 GB sandbox, `CI` not set; once inside the full suite, twice alone,
  the last with the machine idle):**

| Budget (as the test names state it) | Measured | Result |
|---|---|---|
| every report view opens under 1,000 ms (5,000-entry year) | `TopPartiesReportView` 1,241 / 1,100 / 1,092 ms; the next slowest is `InboxView` at about 830 ms | fail 3 of 3 |
| the ten busiest screens' modules load under 1,500 ms | 2,434 / 1,904 / 1,880 ms | fail 3 of 3 |

- **What this does and does not show:** CI run `44005269986` on this commit finished green, and GitHub
  Actions sets `CI`, so the 3× allowance applies there (I did not read these two tests' own lines in that log).
  These are Node/jsdom mount timings on a 2-vCPU sandbox, not a browser on a customer's computer; the figures
  may be better on other hardware. So this is **not** evidence that customers see slow screens. It is evidence
  that (a) a green CI shows 3,000 ms and 4,500 ms are met, not the 1,000 ms and 1,500 ms the test names state,
  and (b) one report view is about 30 % slower than every other and is the one to look at first.
- **Recommended:** say in `docs/` which figure CI enforces; look at `TopPartiesReportView` on the 5,000-entry year.
- **Status:** open, low priority.

## 3. Earlier Agent #8 statements corrected by this session

- "A8-017 fixed" (16 Nov report, PR #746) → **partly fixed**; see A8N-02.
- "26 fixes" in PR #746 included the credit guard as A8-005/A8-008. For credits that were **refunded** the
  guard works (its tests pass here); for credits that were **applied** it does not; see A8N-01.

## 4. Proposed next steps in my own lane (screens and tests only)

1. `BackupExportSettings.tsx`: a confirmation before any restore; a named, explicit warning (or refusal) for a
   file with `serverAuthoritative: false`; a distinct file name for the fallback; remove or correct the PITR
   panel. With component tests, and the W10 browser journey kept passing.
2. Tested patch proposals for A8N-01, A8N-02 and A8N-05 as `.patch` files for AI #1 (not applied here).

## 5. Coverage, honestly

This is a targeted continuation, not a function-by-function audit of ~3,000 files. Areas read and run this
session: credit application/edit/delete, document posting guards, workspace backup/restore/export, the Backup
screen, the `control-balance` and `settlement-ledger` checks, RLS suite. Everything else rests on earlier
reports and on CI, and is listed as not re-verified in the final report of this session.

**Full unit suite with the database (Node 24, PostgreSQL 17.6):** 6,270 tests, 6,267 pass, 2 fail (A8N-06),
1 skipped (by design). It ran at the pinned revision with only the files of this folder added. A passing
suite shows the tests that exist pass; A8N-01, A8N-02, A8N-03 and A8N-05 are behaviours no existing test covers.

**Not run in this session:** any browser test (no Chromium), `npm run test:security`, the coverage gate, the
production build, the two time-zone shards (Pacific/Auckland, America/Los_Angeles).

## 6. Open items carried forward

- Nightly ZAP run `44006270355` on `main` failed at the boot/scan step and the report-check step; logs and
  artifact could not be downloaded (EOF), so neither an alert nor a cause is established.
- No Chromium: the browser gates (W-rows "browser-tested", F-49 fresh-browser check) are not re-verified.
- Residuals from earlier reports still to reproduce or close: A7N-02, A7N-03, A7N-08, A7N-09, A8-020, A8-025, A8-026.
