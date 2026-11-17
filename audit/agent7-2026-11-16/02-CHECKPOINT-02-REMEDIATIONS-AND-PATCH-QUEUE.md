# Agent #7 Session (2026-11-16) — Checkpoint 02: Direct-Lane Remediations, Reserved-Lane Patch Queue & Verification

- **Date (UTC):** 2026-11-16
- **Agent:** Agent #7 (Maximum-Capability Engineering, Accounting, Security & Launch-Readiness Audit)
- **Repository:** `shmuelbiller1/ledgerflow`
- **Branch:** `arena/93656b5f-ledgerflow` — rebased onto `origin/main` `3a4ad7d` (`chore(vercel): build only main, not PR branches (#750)`)
- **Final decision-maker:** Shmuel (`shmuelbiller1`). Nothing here is merged, closed or released without his explicit instruction.

> **Why this checkpoint exists.** Between Checkpoint 01 and now, the sandbox was re-cloned onto a *newer*
> `main` (`3a4ad7d`) whose history already contains PRs `#746` (independent security & accounting audit),
> `#750` and the `EU-I3`/`EU-E3` work this session had been carrying locally. The working tree was therefore
> re-based by hand: the seven direct fixes were re-applied onto the new base, three of the reserved-lane
> patches were regenerated (two of them because `#746` had already fixed the same defect), and one patch was
> withdrawn as obsolete. This document records the reconciled state; Checkpoint 01 remains the instruction
> and conflict record.

---

## 1. What changed since Checkpoint 01

| Item | Checkpoint 01 | Now |
|---|---|---|
| Base commit | `9c859dd` (no longer an object in this clone) | `3a4ad7d` (current `origin/main`) |
| Upstream audit PR | — | `#746` "Independent security & accounting audit: 26 P0/P1 RLS, MFA, FX, posting & restore fixes" merged |
| Direct fixes (`A7C-01`..`A7C-07`) | 9 files, verified | same 9 files, re-applied on `3a4ad7d`, all gates re-run |
| Regression tests | written | 2 files, 28 tests, all failing on the pre-fix code and passing now |
| Reserved-lane patches | 07..11 drafted | `07` withdrawn (fixed by `#746`), `08`/`09`/`10` regenerated, `11` rebuilt around what `#746` left open |
| Reserved-lane probes | none | `probe-08` (pure, live code) and `probe-11` (live PostgreSQL 16.2, RLS as the browser role) |

## 2. Direct fixes carried on the branch (authorized lane)

All nine edits are in `src/components/**`, non-money `src/lib/**`, `src/hooks/**` and `src/services/auditor.ts`;
none touches `src/server/**`, `supabase/migrations/**`, money/tax math, or any file owned by an open PR.

| ID | Files | Defect closed |
|---|---|---|
| `A7C-01` | `src/lib/labelTree.ts`, `LabelTreeControls.tsx` | The "/" label conversion could create a parent whose name a sibling short name already uses (NFC/case variants counted separately), so two values ended up as one label. Plan now excludes colliding short names, parent creation de-duplicates by NFC-lowercased name, and the offer lists what it skipped and why. |
| `A7C-02` | `src/lib/freeInvoice.ts`, `FreeInvoiceMaker.tsx`, `Sales.tsx` | Malformed tax %/quantity text was silently read as a number, rates beyond safe-integer bounds overflowed, `2026-02-30` passed the date regex, `taxRate` was unbounded, and a stashed draft opened only when the screen happened to mount with a session (never after hydration, and it reopened after Close). |
| `A7C-03` | `src/services/auditor.ts` | Hash-chain verification rejected a linked entry whose `previousHash` named an *unlinked but server-signed* entry posted in between — a false tamper alarm. Now a single chronological pass accepts only hashes strictly before the entry, and still catches self-links, future links and stale links. |
| `A7C-04` | `Vault.tsx` | Deleting a signed-in user's document removed the row locally and reported success even when the server refused; it now calls `removeAttachment(workspaceId, id)` and surfaces the real error. The card's Delete button also stopped opening the document overlay (it never stopped propagation, so a delete left the overlay showing a document that no longer existed). |
| `A7C-05` | `Vault.tsx` | Receipt injection could post the same receipt twice (random id, retry-unsafe) and always booked USD. It now uses a deterministic `vault-receipt-<docId>` id + `x-operation-id`, the document's own `createdAt`, and the workspace `homeCurrency`; an already-linked document offers no scan or inject. |
| `A7C-06` | `entryActions.ts` | Quick-add fell back to `'USD'` when the caller passed no currency; it now uses the balanced entry's currency, then the workspace currency. |
| `A7C-07` | `reconcileActions.ts` | Auto-reconcile built signatures over *all* transactions but indexed them by *postable* ones (draft rows shifted the list), and compared raw minor units, so a JPY entry or a fee-netted deposit never matched its bank line. |

## 3. Verification, as run on `3a4ad7d`

| Gate | Command | Result |
|---|---|---|
| Types | `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` | clean |
| ESLint (scoped to the 9 edited files + 2 tests) | `npx eslint --max-warnings 0 …` | 0 errors, 0 warnings |
| New regression suite | `tsx --test src/tests/agent7-2026-11-16-remediations.test.tsx src/tests/agent7-2026-11-16-vault-remediations.test.tsx` | 28/28 pass |
| Related suites | `eu-e3-label-tree`, `eu-i3-free-invoice`, `auditor-hash-chain`, `reconciliation-screen`, `attachments-ui`, `invoice-modal`, `estimate-deposit-ui` | 55/55 pass |
| RLS suite with the proposed migration applied | `npm run db:test-setup && npm run test:rules` | `ALL RLS TESTS PASSED` |
| Reserved-lane probes | `probe-08`, `probe-11` | see `04-VERIFICATION-LOG.md` |

**The regression tests are not tautological.** Every behavioural test was run against the pre-fix code and
fails there:

| Test | Pre-fix result |
|---|---|
| `A7C-03` intervening signed entry / self-link | 2 failures |
| `A7C-06` quick-add currency | 1 failure (`USD` posted, not `ILS`) |
| `A7C-07` JPY minor units / fee-netted cash | 2 failures |
| `A7C-02` stashed draft after hydration | 1 failure |
| Vault suite (`A7C-04`/`A7C-05`) | 3 of 4 failures |
| `A7C-01`/`A7C-02` pure libraries | do not compile against the pre-fix base (the exports they lock did not exist) |

`A7C-07`'s alignment case is a **guard**, not a discriminator: measured against the real scorer, a draft's
signature (MinHash 1.000 instead of 0.203) can only shift the combined score by 0.3 weight, and
Jaro-Winkler never falls far enough for the 0.35 gate to flip in that scenario. It is kept because it pins
the invariant (`txSignatures[i]` describes `tx[i]`), and the audit note says so rather than implying the
old code produced a wrong reconciliation in that case.

## 4. Reserved-lane queue (patches, not branch commits)

| Patch | Findings | State |
|---|---|---|
| `08-group-report-non2dec-translation.patch` | `A7N-10` | new — group translation multiplied whole yen by a major-unit rate |
| `09-asset-undo-entry-ownership.patch` | `A7N-11` | new — asset undo trusted a client-writable entry pointer |
| `10-year-close-draft-trap-and-period-scope.patch` | `A7S-01` | new — year close locked drafts into an unpostable year; four period commands sat on `write:transactions` |
| `11-document-ledger-link-and-ticket-visibility.patch` | `A7S-03`, part of `A7S-04` | new — a viewer could relink a document; a member could read every colleague's ticket |
| `07-deposit-multicurrency-total.patch` | `A7N-09` | **withdrawn** — `#746` already converts each payment with its own rate and digits |
| `audit/agent7-2026-11-13/patches/01..06` | carry-forward | `06` still applies; `01`–`05` conflict with `3a4ad7d`; spot checks show `01` and `03` behaviours now present upstream, `05` superseded by `20261116000000_rls_mfa_and_asset_hardening.sql` |

## 5. What is deliberately *not* applied

`A7S-04`'s row-policy half (a viewer may `select` every employee row, salary and ACH details included) is
**not** applied: `supabase/tests/rls.test.sql` asserts that a viewer can read an employee row, so narrowing
it is a product decision. The read-only `lf_employee_directory` view ships in patch 11 so a screen can be
moved onto it first; the policy change is written out in `03-RESERVED-LANE-FINDINGS.md` for Shmuel to call.

## 6. Open items for the next checkpoint

1. Rebase `audit/agent7-2026-11-13/patches/01`–`05` onto `3a4ad7d` (or confirm each finding fixed by
   `#746` and retire it) — they are carry-forward proposals and currently do not apply.
2. Decide `A7S-04` (employee pay visibility) and, if approved, apply the policy narrowing together with the
   `rls.test.sql` change the same patch must carry.
3. `probe-11` proves the three rules gaps and their closure; `probe-08` proves the group/API-scope fixes.
   The year-close (`A7S-01` draft trap) and asset-undo (`A7N-11`) halves are proven by reading the command
   path only — a server-harness probe is still worth writing before either patch is applied.
