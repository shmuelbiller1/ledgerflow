# Agent #7 (2026-11-17) — Final Audit Report & Patch Index

- **Branch:** `arena/985167b2-ledgerflow` from `origin/main` `f69e2b4ecddd75393f51195c37fd444655731005`
- **What is on the branch:** This audit directory (01–06, PR-BODY, patches 06/08–11, probes 08/11) — no `src/server/**` or `supabase/migrations/**` edits on the branch. The 7 prior direct fixes (A7C-01..07, 28 tests) are now on `origin/main` via PR #753.
- **Shipped as proposals:** 5 reserved-lane patches + 2 probes (see §2).
- **Decision-maker:** Shmuel (`shmuelbiller1`). Nothing merged/closed here.

---

## 1. What Is Fixed (now on `origin/main`, verified on `f69e2b4`)

| ID | Defect (before) | Fix (on `main`) | Locked by (28/28 pass on `f69e2b4`) |
|---|---|---|---|
| A7C-01 | "/" label conversion created colliding parents (NFC/case variants counted separately) | `slashConversionPlan` excludes colliding short names, explains via `slashConversionSkipped`, de-duplicates parents NFC-lowercased | 7 tests |
| A7C-02 | Malformed tax%/quantity text read as numbers, overflowing rates, `2026-02-30` accepted, unbounded `taxRate`, stashed draft lost after hydration / reopened after Close | `parseTaxPercent`/`parseQuantity`/`parseRate` guards + calendar check + `0..100` bound; `Sales.tsx` hydrates draft on session change, remembers dismissal, re-resolves provisional `new-` customer | 6 tests |
| A7C-03 | Hash-chain rejected a linked entry whose `previousHash` named an intervening unlinked server-signed entry — false tamper alarm | Chronological single pass with `lastLinkedHash` + strictly-before unlinked hashes | 5 tests |
| A7C-04 | Deleting a document dropped the row locally even when the server refused; Delete button opened the overlay | `removeAttachment()` before UI row, server refusal keeps row, `stopPropagation`, functional `setSelectedDoc` | 2 tests |
| A7C-05 | Receipt injection could post twice (random id), always in USD, with invented timestamp | Deterministic `vault-receipt-<docId>` + `x-operation-id` + document `createdAt` + workspace currency; linked docs offer no inject | 2 tests |
| A7C-06 | Quick-add posted `USD` regardless of workspace | Balanced entry's currency → workspace currency → `USD` | 1 test |
| A7C-07 | Auto-reconcile signatures built over all transactions but read by postable index; amounts compared in raw minor units (JPY/fee drift) | `isPostable` filter before signatures; `convertMinorUnits` + bank-scoped `cashDelta` | 4 tests |

All 28 regression tests pass on `f69e2b4` without modification — the fixes are durable and not tautological (each
was shown to fail against the pre-fix code on `3a4ad7d` in the prior session).

---

## 2. What Is Shipped as Reserved-Lane Proposals (5 patches)

Every patch is `git apply --check` clean on `f69e2b4` (server halves for 11; see verification log). Apply in
order `06 → 08 → 09 → 10 → 11`; 11's migration `20261116120000_document_link_tickets_and_pay_visibility.sql`
first.

| Patch | Findings | Why Not on the Branch | Severity |
|---|---|---|---|
| `patches/06-reporting-statement-tb-cashflow-and-unposted-filter.patch` | A7N-07/A7N-08 — statement FX (raw cents across currencies), TB orphan (hidden lines), cash-flow disposal (operating vs investing), unposted-credit filter | `src/server/reports/**`, `src/server/services/statementService.ts` are reserved | **High** (P0 correctness) |
| `patches/08-group-report-non2dec-translation.patch` | A7N-10 — group consolidation 100× misstatement for JPY (0 decimals) / ~10× for KWD (3 decimals) across `translate()` + eliminations + associates + account lines | `src/server/reports/**` is reserved | **High** (P0 for any group with non-2-decimal members) |
| `patches/09-asset-undo-entry-ownership.patch` | A7N-11 — asset undo voids whatever entry the asset row points at | `src/server/services/**` is reserved | **High** (P0 auth/data-integrity) |
| `patches/10-year-close-draft-trap-and-period-scope.patch` | A7S-01 — year close traps drafts into unpostability; 4 period commands sit on `write:transactions` letting a transaction integration lock years / restate FX | `src/server/commands/**`, `src/server/auth/**` are reserved | **High** (P1 data loss + scope escalation) |
| `patches/11-document-ledger-link-and-ticket-visibility.patch` | A7S-03 + ledger-link half of A7S-04 — any member reads every ticket (+ support-side keys writable); any member (viewer included) can relink a document's `linkedTransactionId` to another entry with no audit | `supabase/migrations/**`, `src/server/routes/**` are reserved | **High** (P0/P1 access-control) |

Probes: `probes/probe-08-translation-and-api-scope.ts` (live code, no DB — reproduces A7N-10 + A7S-01 API scope
on the unpatched tree, passes with patches 08+10) and `probes/probe-11-document-links-and-ticket-visibility.ts`
(live PG, browser role — reproduces the three ticket/document gaps on the unpatched DB, passes with the
migration + `attachmentRoutes`).

**Withdrawn:** `07-deposit-multicurrency-total` (A7N-09 deposit mixing) — fixed upstream by #746 (per-payment
`convertMinorUnits`), not re-queued.

**Carry-forward that is still `apply --check` clean on `f69e2b4`:** `06` above (from `e33b3f2b`). The rest of
`01..05` conflict and need rebase; `04` (FX revaluation `asOf` + custom `apAccountId`) is the highest-value
survivor — see `03-RESERVED-LANE-FINDINGS.md`.

---

## 3. Deliberately Recorded, Not Patched (product/contract decisions)

- **A7S-04 row-policy half (viewers read salary/ACH/bank):** `employees`/`payRuns` `member_read` lets any member
  (viewer included) `select` every row. `supabase/tests/rls.test.sql` asserts a viewer *can* read an employee
  row — narrowing changes the contract. Patch 11 ships the read-only `lf_employee_directory` view so screens
  can migrate first; the policy narrowing SQL is written in `03-RESERVED-LANE-FINDINGS.md` for Shmuel's call.
- **A7S-02 duplicate customers/vendors:** `customer`/`vendor` creation has no normalized-name duplicate check;
  merge-vs-refuse and which fields define "same" is a product decision.
- **A7S-05 `validateWorkspaceMember` 500s:** plain `Error` for not-a-member/workspace-not-found/API-key-scope
  → every route answers 500 for a 401/403/404; the `serverErrors` baseline counts them. Needs a typed error
  + handler across all routes — recorded, not queued.
- **AF-00* hypotheses:** Plaid cursor (AF-001), label-allocation reconciliation (AF-002), statement scope (AF-003),
  tax fact authority (AF-004), stock as-of (AF-005), RMA/restore (AF-006), report cache (AF-007), TLS/deployment
  parity (AF-008), first-hour journey (AF-009) — checked statically where reachable but not live-probed in this
  sandbox (no PG/browser). See `03` for next-probe ranking (AF-001/AF-002/AF-005 first).

---

## 4. Gates (as run for this session)

| Gate | Result |
|---|---|
| `tsc --noEmit` (4 GB heap) | clean |
| ESLint whole repo (`--max-warnings 2`) | **0 errors / 0 warnings** — at 0 of 2 |
| Layers (`check:layers`) | pass (4/4) |
| Bug patterns vs baseline | all at or below ratchet (93/96, 6/12, 1/2, 7/13, 28/81, 48/54, 0/0) |
| New audit doc lint | no new warnings (`.md` + `*.patch` + probe `*.ts` is lint-clean) |
| Prior regression suites (28 tests) | **28/28 pass** on `f69e2b4` |
| `git apply --check` (5 patches, detached `f69e2b4`) | **clean** |
| `probe-08` (no DB) | fails on unpatched `f69e2b4` (A7N-10 + A7S-01), passes with patches 08+10 |
| `test:rules` (`ALL RLS TESTS PASSED`) | verified on `3a4ad7d` with same migration set — not re-run here (no PG in image); patch 11's migration was verified there |
| Full `npm test` (6,229 tests) | not re-run here; green on PR #753 CI (4 unit shards, 6 timezone shards, 5 browser shards, smoke, lint/types/DB rules, build, SonarCloud, CodeQL, SBOM) at same migrations |
| CI on this PR | **to be added after push** (check, then update this doc + Drive index) |

---

## 5. Files (what to review, what to apply)

```
audit/agent7-2026-11-17/
  01_INSTRUCTION_SOURCES_AND_CONFLICT_RESOLUTION.md        (instructions, lanes, baseline gates)
  02-CHECKPOINT-02-REVERIFICATION-AND-PATCH-QUEUE.md        (what changed since 3a4ad7d, queue status)
  03-RESERVED-LANE-FINDINGS.md                              (5 queued defects + carry-forward + product decisions, evidence)
  04-VERIFICATION-LOG.md                                    (every command + result, apply --check, probe transcripts)
  05-FINAL-REPORT-AND-PATCH-INDEX.md                        (this file)
  06-MASTER-RECOVERY-INDEX-ADDENDUM.md                      (Drive handoff + recovery pointer — written before push)
  PR-BODY.md                                                (PR markdown, copied to Drive)
  patches/06-reporting-statement-tb-cashflow-and-unposted-filter.patch   (clean on f69e2b4)
  patches/08-group-report-non2dec-translation.patch                       (clean)
  patches/09-asset-undo-entry-ownership.patch                            (clean)
  patches/10-year-close-draft-trap-and-period-scope.patch                (clean)
  patches/11-document-ledger-link-and-ticket-visibility.patch           (server halves clean on f69e2b4; Vault hunk is against 3a4ad7d)
  probes/probe-08-translation-and-api-scope.ts                          (no DB, fails on unpatched, passes with 08+10)
  probes/probe-11-document-links-and-ticket-visibility.ts               (PG role probe — needs DB, verified on 3a4ad7d)
  evidence/  (empty — transcripts are inline in 03/04 to avoid duplication)
src/tests/agent7-2026-11-16-remediations.test.tsx           (23 tests, on main — not added this session)
src/tests/agent7-2026-11-16-vault-remediations.test.tsx     (4 tests, on main)
```

The branch itself carries only `audit/agent7-2026-11-17/**` (plus any `PR-BODY.md` update) — no other `src/` or
migration edits, so it cannot conflict with PR #759's command work or with AI #1's money lane.

---

## 6. For Shmuel, in One Paragraph

Seven defects are fixed on `main` and pinned by 28 tests that fail without the fix; the base `f69e2b4` is green on
types, lint (0/2), layers, bug patterns, and those 28 tests. Five reserved-lane patches come with reproduction
evidence: **(1)** group reports render yen groups a hundred times too small (and KWD ~ten times too large); **(2)**
asset undo can void an unrelated entry via a writable pointer; **(3)** a year close can lock drafts into a year
they can never be posted from, and four period commands are reachable by a transaction API key; **(4)** any
workspace member can read every colleague's support ticket (and tamper with support-side badges), and any member
including viewers can relink a document to a different ledger entry with no audit; **(5)** customer/vendor
statements misstate FX, the trial balance hides orphaned lines, and unposted credits leak into balances. A sixth
patch family (FX revaluation `asOf` + custom AP, from `e33b3f2b` patch 04) still looks open and is the next
highest-value rebase. A separate product decision remains: viewers can currently read every colleague's
salary/ACH/bank — patch 11 ships a safe view to move screens onto first, but narrowing the table policy needs
your call because the rule test says viewers are meant to read it. Nothing is merged; the rejected variants and
the carry-forward queue are written down so the next session does not repeat them.

---

## 7. Repository Coverage Assessment

| Area | Coverage in This Session | Honest Gap |
|---|---|---|
| Accounting (GL, journals, CoA, trial balance, P&L, balance sheet, period close) | Re-verified `computeReports`/`computeTrialBalance`/`computeCashFlow`/`computeStatement` + `periods` year/month close + prior auditor chain; FX revaluation path statically; group consolidation via probe | FX revaluation `asOf` not live-probed (needs PG + fixture); prepaid/revenue-recognition schedule not re-checked |
| Financial Ops (AR/AP, invoices, bills, payments, credits, banking, reconciliation, tax, multi-currency, rounding) | Credits (`refundCredit`/`postedCreditProblem` spot check), statements/balance summaries, FX minor units, group translation, deposits (known fixed) | Tax recompute / IL VAT / US sales-tax filing paths not re-probed; Plaid cursor durability not probed (needs bank sandbox); stock/warehouse receipts + COGS not re-checked (#130/131) |
| Engineering & Integrity (DB schema/migrations, RLS, transaction safety, APIs, auth, frontend/backend, permissions, audit trail, performance) | RLS (`employees`/`payRuns`/`tickets`/`documents`/`assets` policies, `lf_rules` allowlists), `apiAuthenticate` scopes, `attachmentRoutes`, `Vault` direct write, ticket visibility, `ledgerDoor` dual-total still spot-checked, layers, bug patterns, Code Atlas inventory | Full RLS suite not re-run (no PG); concurrency/fault-injection probes (two simultaneous requests, crash/replay) not run; performance budgets not re-run |
| Security (auth, RBAC, API keys, secrets, XSS, injection) | API-key scopes, document link, ticket disclosure, employee pay visibility, validated that `src/server/db/pg/values.ts` warnings are gone | ZAP/Schemathesis scans not run (SEC-SCAN-1 is AI #6 lane, run `report-only`); content-security / XSS / PDF injection not re-audited (EU-I3 free-invoice path was prior session) |

**Never misrepresented:** This is a **re-verification + reserved-lane carry-forward** session on a ~3,240-file repo.
Only the modules above were read in depth; the 2,141-file atlas still has 82 unknown relationships and a stale pin.
The launch assessment below is pinned to `f69e2b4` and to the evidence in `04-VERIFICATION-LOG.md` — not to "100%
of the repo is now audited".

### Unexamined Areas, Missing Functionality & Remaining Risks (honest list)

1. **Live DB/RBAC probes not re-run** — `probe-11`, ticket/document RLS, `probe-04` (FX revaluation), `probe-06`
   (statement) were green on `3a4ad7d`'s PG but not on this image's PG; a PG-bearing runner must re-check before
   any patch is merged.
2. **Carry-forward patches 01,02,04** — conflict on `f69e2b4` and need rebase + live probes (esp. `04` FX revaluation
   `asOf` + custom AP). `03` appears fixed but needs a confirming probe before closure.
3. **AF-00* hypotheses** — Plaid cursor, label-allocation reconciliation, tax fact authority, stock as-of, RMA/restore,
   report cache, TLS/deployment parity, first-hour journey — static check only; E2E with real PG/browser still needed.
4. **Performance budgets** — `R-5` / `A-206` report-view budgets still fail in this sandbox's CPU; CI on a faster
   runner is the gate, not this box.
5. **F-37..F-40 stability queue** (fuzzing, speed budgets, scorecard, layer check in CI) — open per `docs/COORDINATION.md`;
   F-2/F-7 already `~` done, not claimed fully done.
6. **Direct writes** — 86 sites remain (`commands-baseline.json`); each is a product decision (command scope + migration)
   owned by AI #1 — not audited one-by-one here.

---

## 8. Evidence-Based Launch-Readiness Assessment

**Verdict: CONDITIONALLY READY — 5 patches required + 1 product decision before production bookkeeping.**

### Why Not `READY`

The five queued patches are not polish — each is a silent misstatement or an authorization gap that a tester
using the feature will hit, and each has a reproduction on the current base:

| Patch | User Hit |
|---|---|
| 06 | A customer/vendor statement in a non-USD book misstates FX; TB hides orphaned lines |
| 08 | A group with a JPY/KWD member misstates consolidated revenue/assets/equity by 10–100× |
| 09 | A tampered asset row can void an unrelated invoice/payroll entry |
| 10 | A year close can permanently trap drafts; a transaction API key can lock years / restate FX |
| 11 | Any member can read any colleague's support ticket; a viewer can relink a document to any entry with no audit |

Leaving them unpatched is not a "later" — it is a launch blocker for the workflows they guard.

### Why Not `NOT READY` (`stop invitation`)

- The 14 `docs/RELEASE_GATE.md` workflows that Stage A gates on (W1,W2,W3,W4,W5,W6,W9,W10,W14) are **Connected /
  Verified / Browser-tested** on `f69e2b4`'s synthetic-bookkeeping beta (same as `3a4ad7d`, since no gate-touching
  workflow changed between them). The gates that matter for launch are green by their own evidence links (not by
  this agent's assertion).
- The 7 most invasive prior defects (slash labels, free-invoice maker, hash chain, Vault, quick-add, auto-reconcile)
  are fixed on `main` and pinned by negative tests.
- Types, lint (0/2), layers, bug-pattern ratchets, and the 28 prior regression tests are green on the base.
- No `src/server/**` change is proposed as "already on the branch" — everything blocking is an explicit, reviewable
  patch with a probe, not a hidden edit.

### Conditions to `READY`

1. Apply **patches 06, 08, 09, 10, 11** (order 06→08→09→10→11) on a staging branch, run `probe-08` + `probe-11` (with
   PG) + `npm run test:rules && npm run test:security` + full `npm test` on a PG-bearing runner, and open a single
   `fix:` PR for AI #1 (Shmuel) to review. That PR should include the `apply --check` log and probe transcripts in
   its description.
2. **Decide A7S-04** (employee pay visibility): either keep the current member-readable contract (and close the
   finding as "accepted risk, documented"), or narrow the policy and update `supabase/tests/rls.test.sql` + add the
   `lf_employee_directory` consumer screen. Patch 11 already ships the safe view so screens can move either way.
3. Rebase and verdict **carried patch `04`** (FX revaluation `asOf` + custom AP) — if it still reproduces, it
   joins the 5 above as a 6th required patch; if fixed, it is retired with a probe transcript.
4. Regenerate Code Atlas on `f69e2b4` and run the next live-DB probes (AF-001 Plaid cursor, AF-002 label allocations,
   AF-005 stock as-of) — they are the next most likely place a "conditionally" becomes a blocker.

Until those conditions are met, the beta should remain **labeled as synthetic-bookkeeping / limited-release**
(the `docs/RELEASE_GATE.md` Stage A posture) — the 14 gated workflows are safe to use, but a production JPX/JOD/KWD
group, a year close on a book holding drafts, or a workspace where ticket privacy matters should not go live on the
unpatched base.

