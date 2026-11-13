# Agent #6 — handoff, second session of 2026-11-12

## State

| Thing | Value |
|---|---|
| Pin read and run against | upstream `main` `e33b3f2bc8273ab2fcecf3affc34e0652d7d594c` (2026-11-12T22:22:42Z) |
| Branch | `arena/b33f6cd0-ledgerflow` — pushed to `origin` (fork `Chaim-Richard/ledgerflow`); based **exactly** on upstream `main` |
| Commits | `d390685` report minor units (#651) · `d58ecca` document-entry guards (#652/#662) · `6b8260e` flag/annotate refinement · docs commit |
| PR | fork PR (body in `PR-BODY.md`); the fork token is refused `createPullRequest` on `shmuelbiller1/ledgerflow`, so the upstream PR needs the one-click compare link |
| Drive | **not used this session — the connector is disconnected**; nothing was uploaded and no Drive claim is made |

## What is finished

1. **#651 fixed, both halves** (`salesReps` commission, `cashBasis` revenue share) plus a **new** defect found while
   proving it (a partly paid foreign invoice recognised its whole posting because the shared lines kept
   `baseAmountCents`). Worked-figure tests in `src/tests/currency-minor-units-reports.test.ts`; the independent
   af008 probe's V7/V8 went from DEFECT to OK.
2. **#652 / #662 server half fixed**: the generic entry routes now refuse to change a document's entry
   (financial fields), to reverse it, or to un-post a posted entry — while still allowing flags and notes.
   Audit rows carry before/after. `src/tests/ledger-edit-guards.test.ts`.
3. **Re-verification sweep at the pin**: #641/#648 (minor units) fixed; AF6-004/005/006 and patches 02–07 landed;
   the 10 Nov F-01 (`taxPlace.region`) and F-08 (`Recorded as filed`) fixed; #651 was **not** fixed by `main`
   (only #641's helper was) — that is why it is in this branch.
4. **Three new probes** as positive evidence: statement cross-checks (11 cases), money-function invariants
   (26 cases), audit hash chain + tamper detection (7 cases) — all pass at the pin.

## What is not finished (and why)

| Item | Why |
|---|---|
| DB/RLS gates (`npm test` DB suites, `supabase/tests/rls.test.sql`, `npm run test:rules`) | no PostgreSQL in the sandbox |
| Playwright browser suites | no browsers in the sandbox |
| Endpoint-level proof of the new 409 refusals (PUT/reverse) | needs the DB; the unit + wiring tests are here, the endpoint cases run in CI |
| #653 (0.01 FX instalment residue), #654 (recurring 0.01), #646 (browser credit-note writes), #650/#661 | AI #1's money/server lane; each needs the DB-backed probe the issue itself carries |
| Google Drive backup / MASTER_RECOVERY_INDEX update | connector disconnected |

## Next actions, in order

1. Open the upstream PR from this branch (compare link in `PR-BODY.md`), let CI run — the Postgres job is the one
   that proves the new refusals end to end.
2. If CI's Postgres job shows a test that expected a document entry to be editable through `PUT /transactions/:id`,
   read it before changing either side: the rule is the client's own (`isDocumentEntry`).
3. #653 is the next accounting defect worth a branch: `paymentService.ts:389` converts each payment on its own and
   never caps the settlement to what the document still carries in the home currency. Prove the cent with a real
   posting first.
4. Re-run `npm run test:rules` after any migration change; `20261112100000` is the newest one at this pin.

## Recovery

- Everything is in the branch (`git fetch origin arena/b33f6cd0-ledgerflow`), which is based on upstream `main`, so
  a later session can rebase it in one command.
- To rebuild the environment: `npm ci` then `NODE_ENV=test npx tsx --test --test-force-exit <file>` for one suite,
  `TEST_SHARD=1/4 npm run test:shard` for a shard (it sets `SYSTEM_SALT`), and
  `NODE_ENV=test npx tsx audit/agent6-2026-11-12b/probes/<probe>.ts` for the probes.
