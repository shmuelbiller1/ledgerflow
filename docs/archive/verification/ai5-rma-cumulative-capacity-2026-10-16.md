# AI #5 — RMA cumulative quantity guard (16 Oct 2026)

## Source inspection corrected an earlier assessment
- The **merged** `ReturnAuthorizationsPanel.tsx` already resets `requestPending.current` and `savingRequest` in `finally`. The earlier claim of a permanently stuck save was based on an older patch, not current main.
- The shared `updateEntity()` catches storage errors and passes them to `handleFirestoreError()`, which **throws** after reporting them. Thus the warehouse screen's catch block does receive a failed save. No broad shared-hook behavior was modified.

## Confirmed defect
`returnAuthorizationRequestProblem` checked each requested line against the originally sold quantity but did **not** account for other RMAs already requested or returned against that same customer/invoice/invoice line. For example, a sold quantity of 5 could yield two separately valid pending requests of 3 each. This creates a misleading warehouse workflow and risks double credit if an operator processes both.

## Scope of fix
- Pure `returnAuthorizationCapacityProblem` sums the invoice-line quantities reserved by **requested, approved, received and closed** RMAs and frees quantities only after a **declined** RMA.
- Scopes by workspace, customer and invoice. Checks two-decimal quantity precision and safe integer hundredths; refuses unknown or unsafe totals.
- RMA request screen rejects an over-cap request while preserving its draft and showing a specific error before issuing any write.
- Adds a local pending-cache guard so a second request made just after a successful save cannot use the stale customer-list snapshot to overlap the first.
- Pure tests cover status lifecycle, multiple requests, tenant/customer/invoice isolation, decimal arithmetic and bad values. Component tests exercise an earlier RMA and a back-to-back submission before cache refresh.

## Scope limits — not a server authorization or concurrency guarantee
This is a **browser preflight improvement** only. RMA status/history metadata is currently edited through the general client write path. It does **not** implement a database-enforced two-person approval, atomic compare-and-swap across users/tabs, immutable history, or the authoritative returns/credit-posting contract. Concurrent clients could still race. Those prerequisites remain in AI #1 / acting lead's reserved security/server/database work (see PR #140 handoff for A-66). The normal Sales return/credit-note system remains responsible for stock/financial effects; no ledger, inventory, server or migrations were changed.

## Merge/test safety
Code is on a standalone AI #5 PR from main. PR #140 (AI #3's warehouse audit) is open and also edits the RMA UI; the acting lead should reconcile the non-overlapping changes before merging. `npm ci`, types, unit, Postgres, production build and E2E should be run in GitHub. No claim of local complete verification from this tool session.
