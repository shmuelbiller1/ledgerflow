# Agent #8 — findings register (2026-11-19)

Branch `arena/74a5c64e-ledgerflow`, base `5eacf71f633f00a5db7ae44d3fdba75b4d3700cf` (upstream `main`),
PR **[#911](https://github.com/shmuelbiller1/ledgerflow/pull/911)**.

ID range continues the existing Agent #8 series (`A8-001`…`A8-028` in
`audit/agent8-2026-11-16/`), so this register starts at **A8-029**.

Legend — **Confirmed**: reproduced or proven by code path + test. **Suspected**: evidence suggests a defect but
the harmful path is not reachable / not proven. **Fixed**: change is on this branch and verified. **Reported**:
evidence delivered, deliberately not patched (owned by another agent's lane, or needs an owner decision).

| ID | Severity | Kind | Status | Area |
| --- | --- | --- | --- | --- |
| A8-029 | High | Control gap (segregation of duties) | Reported — `src/server/` lane (AI #1) | Bill approval on the server |
| A8-030 | Medium | Missing functionality / dead code | Reported — owner decision | Approval rules & records |
| A8-031 | High | Confirmed bug | **Fixed** (PR #911) | G-19 / #893 pending-bill approval loop |
| A8-032 | Medium | Confirmed bug | **Fixed** (PR #911) | #909 negative share bars |
| A8-033 | Low | Robustness | Reported | Project split-rule percentages |
| A8-034 | Medium | Confirmed bug (UI authorization) | **Fixed** (PR #911) | Bill dialog offered approval to every role |
| A8-035 | Low | Confirmed display defect | Reported — shared with `src/server/` (AI #1) | Every share reads 0.0 % when the net is negative |

---

## A8-029 — High — bills have no server-side approval enforcement or approval record (invoice parity gap)

**Status:** Confirmed, **not fixed here**: the fix belongs in `src/server/**`, which AGENTS.md reserves to AI #1.
Cross-reference: issue **#857** ("bill.update approval bypass"). PR #908 addresses a *different* part of #857
(submitted expense claims, `src/tests/expense-claim-guard-857.test.ts`), not the bill approval path.

**Exact locations**

- `src/server/services/ledgerBulkCommit.ts:386-395` — the approval guard runs **only** for invoices:
  `if (entityMutation.collection === 'invoices') { Object.assign(validatedData, serverApproval(...)) }`.
  For `bills` the branch is skipped and line 397 writes whatever the request carried:
  `t.set(entityRef, { ...validatedData, uid: user.uid, updatedAt: ... }, { merge: true })`.
- `src/server/services/invoiceApprovalGuard.ts:1-52` — the invoice guard: approver role check
  (`isApproverRole`), two-person rule (`mayApprove`), delegation (`approvesInPlace`), and a server-stamped
  `decidedBy`/`decidedAt`. Nothing equivalent is invoked for `bills`.
- `src/server/commands/documents.ts:125` — `const ROLES = ['owner', 'accountant', 'bookkeeper']` is the only
  gate on `bill.update` (`:426`). A **bookkeeper** may therefore write `status: 'approved'`.
- `src/schemas.ts:294-311` — `BillSchema` has a `status` enum that includes `approved`, but **no `approval`
  field** (compare `InvoiceSchema:281-282`, which does).
- `src/server/commands/documents.ts:245-258` — `auditFor()` records only
  `BILL_UPDATED` / "Update bill BILL-123" plus transaction ids. No approver, no before/after status, no note.
- `src/components/purchases/BillModal.tsx:212-227` — the threshold and the approver roles are a hard-coded
  client literal (`thresholdCents: 500000`, `approverRoles: ['owner','accountant']`); nothing is persisted, so
  the server never sees the rule.
- `src/hooks/useEntityOperations.ts:509` — the client save path is exactly `runDocumentCommand('bill.update', …)`.

**Evidence that the gap is real and reachable**

1. `bill.update` accepts a partial bill, `status` included (`documents.ts:67`, `:81`), and performs no approval
   check anywhere in `documents.ts` (`grep -n approval src/server/commands/documents.ts` → no matches).
2. Only invoices get `serverApproval`; the `invoices` branch is a literal collection check, so bills, credit
   notes and vendor credits fall through.
3. `src/lib/twoPersonRule.ts` and `src/lib/approvalDelegation.ts` are consumed **only** by the invoice guard
   (`grep -rn "twoPersonOn\|approvesInPlace\|mayApprove" src` → `invoiceApprovalGuard.ts` and tests).
4. `src/lib/approvalWorkflow.ts`'s `ApprovalRequest` / `approveRequest` / `rejectRequest` have **no callers**
   anywhere in `src/` (see A8-030), so nothing else records a decision.

**Consequences**

- A bookkeeper can approve a bill they entered, above any threshold, by saving `status: 'approved'` —
  segregation of duties and the approval control do not exist server-side for payables.
- Any authenticated caller with a bookkeeper seat bypasses the $5,000 rule entirely; the rule lives only in a
  React component, so an API/automation caller, a stale client, or the record page's own save path is unguarded.
- The two-person rule (P-05) and approval delegation (BG-07) apply to receivables but not payables.
- An already-approved bill's amount/date can be rewritten while it stays `approved`, with no re-approval.
- There is no record of **who** approved a bill or **when**; the only trace is a generic "Update bill" entry,
  which is insufficient for an audit trail.

**Recommended correction (AI #1 lane)**

Generalize `serverApproval` to bills: add an `approval` record to `BillSchema` (mirroring `InvoiceSchema`),
call a bill guard in `ledgerBulkCommit`'s `entityMutation` branch when `collection === 'bills'`, restrict
approve/send-back to owner/accountant (+ delegation), apply the two-person rule, and stamp `decidedBy`/
`decidedAt` from the server. Reuse `src/lib/approvalWorkflow.ts` or delete it (A8-030).

**Reproduction (unit level, no database)**

`serverApproval` is a pure function; the bill path calls nothing. A test that mirrors
`src/tests/invoice-approval-server.test.ts` for bills has no function to call — the guard's absence is the
defect. End-to-end: as a bookkeeper POST `bill.update` with `{ id, data: { status: 'approved' } }` for a
$6,000 pending bill; the document is stored approved and no `approval` field exists.

**Tests performed:** static trace of every write path for `bills`; `grep` for approval consumers;
`src/tests/invoice-approval-server.test.ts` + `invoice-approval.test.ts` + `invoice-approval-ui.test.tsx` +
`bill-record-page.test.tsx` + `approval-delegation.test.tsx` + `approval-notifications.test.ts` all pass
(63/63) — i.e. the suite documents invoice enforcement and never asserts anything for bills.

**Remaining risk:** unsupported until the server guard lands; the client fix in A8-031 only stops the *browser*
from destroying a legitimate decision — it does not add authorization.

---

## A8-030 — Medium — approval rules are never persisted; `approvalWorkflow` is dead code

**Status:** Confirmed, **not fixed** (needs an owner decision on configuration UI/API).

- `src/lib/approvalWorkflow.ts:1-58` — `ApprovalRule`, `ApprovalRequest`, `approveRequest`, `rejectRequest`
  are exported and referenced nowhere: `grep -rn "approveRequest\|rejectRequest\|ApprovalRequest" src` returns
  only the file itself.
- The rule used in practice is a literal in `BillModal.tsx:214` (`thresholdCents: 500000`,
  `approverRoles: ['owner','accountant'], autoApproveBelowThreshold: true`), duplicated intent with
  `workspace.invoiceApproval` (invoices) and `normalizePoApproval` (purchase orders, `po-approval-thresholds`).
- No collection/table stores an approval request: `grep -rln "approval_request\|approval_rule" supabase/`
  → nothing.

**Consequence:** the "$5,000 bill approval limit" is a hard-coded constant in the browser. A workspace cannot
configure its own payable threshold (unlike invoices, `workspace.invoiceApproval`, and unlike POs), and no
approval decision is durable. Combined with A8-029, payables approval is currently a display convention, not a
control.

**Recommended correction:** decide the source of truth — extend `workspace` with `billApproval` (mirroring
`invoiceApproval`) and read it in the guard; then either wire `approvalWorkflow.ts` into the flow or delete it
so it stops implying a feature that does not exist.

---

## A8-031 — High — (G-19 / #893) a bill held for approval could never be approved — **FIXED**

**Location:** `src/components/purchases/BillModal.tsx:212-227` (fix), `src/tests/bill-modal.test.tsx` (test).

**Defect:** `BillRecordPage`'s next step for a `pending` bill is *Review and approve* → `onEdit(bill)` →
`BillModal` with `initialBill.status === 'pending'`. On **Approve Bill**, `handleAction('approved')` re-ran
`evaluateApprovalRequirement` against the hard-coded $5,000 rule and forced `finalStatus = 'pending'` for any
bill ≥ $5,000. The reviewer's decision was discarded, the record page still offered *Review and approve*, and
the bill could never leave `pending` — an infinite review loop with no other exit
(`approveRequest`/`rejectRequest` have no callers, A8-030).

**Fix:** the threshold now gates new/draft submissions only. `isReviewingPending = initialBill?.status ===
'pending'` suppresses the re-application when the bill being saved is already pending, so the reviewer's
decision stands. No other behaviour changed; unapproved drafts still go to `pending` above the limit.

**Test:** `G-19: approving an already-pending bill over the threshold finishes the decision`
(`src/tests/bill-modal.test.tsx`) — 600,000-cent pending bill, *Approve Bill* must save `approved`. Fails on
`5eacf71` (saves `pending`), passes with the fix.

**Residual risk:** authorization is still A8-029; this fix makes the *intended* flow work, it does not decide
who may press the button.

---

## A8-032 — Medium — (#909) a negative share rendered as a full positive bar — **FIXED**

**Locations:** `src/components/reporting/IncomeBySourceReportView.tsx:42`,
`src/components/reporting/ExpenseByCategoryReportView.tsx:63`; test `src/tests/share-bar-clamp.test.tsx`.

**Defect:** the decorative share track used only `Math.min(100, pct)`. A net-negative group (a refund larger
than its category's charges, a customer with credits only) produced `width: -19.1%`; browsers reject a negative
CSS width, so the block fell back to `auto` and filled the track — a refund looked like a 100 % contribution
while the signed text next to it said −19.1 %.

**Fix:** clamp the decorative width to `[0, 100]`. Signed labels, share text, grid data and CSV untouched.

**Test:** hand-worked books — expenses Rent 12,445 + Rebate −2,000 (net 10,445 → 119.1 % / −19.1 %), income
Acme 27,680 + Bob −2,345 (net 25,335 → 109.3 % / −9.3 %). Asserts the track is exactly `100%` for >100 % and
`0%` for the negative row, and that the signed labels still render. Both cases fail on `5eacf71`.

**Cross-check:** the independently drafted `Agent7-909` proposal on Drive reaches the same clamp
(−50 % → 0/96 px, 30 % unchanged, 120 % label preserved). Same conclusion reached independently.

---

## A8-033 — Low — project split-rule percentages are unvalidated and render unclamped

**Status:** Reported (no harmful path reachable through the app today — kept as a robustness item).

- `src/schemas.ts:363` — `splitRules: z.array(z.record(z.string(), z.any())).optional()`: no shape, no range,
  no requirement that the shares total 100.
- `src/components/projects/ProjectsView.tsx:279` — `style={{ width: `${rule.percentage}%` }}` with no clamp, so
  a negative or >100 value from an API write or an import renders a broken/full bar (same class as A8-032).
- No UI creates `splitRules` (`grep -rn splitRules src` → the model type, the two display sites and the schema),
  and no calculation consumes them, so profit is **not** mis-distributed today.

**Recommended correction:** validate on write (0 < pct ≤ 100, and a sum check when rules are used for a
payout), and clamp the bar. Revisit before any partner-distribution feature ships.

---

## A8-034 — Medium — the bill dialog offered the approval decision to every role — **FIXED**

**Location:** `src/components/purchases/BillModal.tsx:58-66` (gate) and the action row (the *Approve Bill*
button), test `src/tests/bill-modal.test.tsx` → “A8-034: a bookkeeper is not offered the approval decision; an
accountant and a named delegate are”.

**Defect:** invoices refuse to show the decision to someone who may not make it
(`InvoiceApprovalFlag` → `canDecide` / `approvesInPlace` / `mayApprove`), but the bill dialog rendered
**Approve Bill** to everyone — a viewer opening a bill saw an approval button, and a bookkeeper could sign off a
bill they entered. Combined with A8-029 (no server guard for bills) nothing else stopped them.

**Fix:** the dialog now offers *Approve Bill* only to an owner or an accountant, or to someone named to approve
in their place until a date (`approvesInPlace`, BG-07). Guests/demo workspaces keep the button; every other
role sees “An owner or accountant approves a bill” instead. This is UI parity with the invoice surface — it is
**not** authorization, which must land server-side (A8-029).

**Test:** bookkeeper → no button and the explanatory text; accountant → button; delegated bookkeeper → button.
Passes with the change; the file fails on the unfixed component.

## A8-035 — Low — every share reads 0.0 % when the net is negative

**Status:** Confirmed empirically, **reported not patched** — `src/lib/reportGenerators.ts` is imported by
`src/server/services/balanceService.ts:63`, so changing its percentage semantics is shared money maths (AI #1
lane; same reason PR #882/#889 are handling the report inputs/formatters).

- `src/lib/reportGenerators.ts:105-107` (expense by category) and the matching block in
  `computeIncomeBySource` compute `percentage: grandTotal > 0 ? (total / grandTotal) * 100 : 0`.
- When refunds exceed charges in a period the net is negative, so **every** row is rendered with `0.0 %` while
  its amount stays correct — the share column contradicts the amounts instead of showing the true overshoot.

**Reproduction (run locally, output verbatim)**

```text
npx tsx /tmp/probe-pct.ts
expense rows (negative net): [{"category":"Occupancy","totalAmountCents":10000,"transactionCount":1,"percentage":0},
                              {"category":"Rebates","totalAmountCents":-200000,"transactionCount":1,"percentage":0}]
```

(One 100.00 charge and a 2,000.00 refund → net −1,900.00; the table shows 0.0 % for both rows.)

**Recommended correction:** decide the semantics centrally — `total > 0 ? total/grand*100 : (abs(grand) > 0 ?
total/abs(grand)*100 : 0)` gives −5.3 % / 105.3 % for the case above and keeps the sign; alternatively hide the
share column when the net is ≤ 0 with an explanation. Either way it must change in `reportGenerators` (server
and client read the same function), so it is AI #1's call. The CSV column would follow automatically.

**Tests performed:** the probe above; the existing `report-views`, `l123-step4de-breakdowns` and
`report-generators` suites pass, i.e. no test covers a negative net total.

## Verified — not defects (checked and dismissed, recorded so they are not re-reported)

- `src/components/planning/BudgetManager.tsx:274` `Math.min(b.percentUsed, 100)` looks like the A8-032 class,
  but `actualCents` sums `Math.max(0, lineAmount(...))` (`:137-140`), so `percentUsed ≥ 0` always.
- `src/components/transactions/PivotView.tsx:38` already uses `Math.abs(item.value)`.
- `src/components/finance/TaxReserveWidget.tsx:466-467` already clamps both directions.
- #906 (inventory CSV decimals) is **already fixed in open PR #889** (`csvMoneyForCurrency`); #910's four
  account reports have a caller-only patch on Drive (`Agent7-910-after-889.patch`) that imports the #889
  helper. Neither is duplicated here: applying them now would collide with #889 or leave the branch unbuildable.
