# Agent #8 — checkpoint 02 (2026-11-19)

**Branch:** `arena/74a5c64e-ledgerflow` · **Base:** `5eacf71f633f00a5db7ae44d3fdba75b4d3700cf`
**Commits:** `932c6f5` (G-19/#893 + #909 fixes, tests) → `3ad070f` (register + checkpoint 01) →
`6e2ddc0` (index addendum) → `1c74662` (A8-034 role gate + test)
**PR:** [#911](https://github.com/shmuelbiller1/ledgerflow/pull/911) — open, unmerged.

## New since checkpoint 01

- **A8-034 fixed** — the bill dialog offered *Approve Bill* to every role; it now offers the decision only to an
  owner, an accountant, a member named to approve in their place (BG-07), a guest, or an unidentified session
  (demo/fixtures). Any other signed-in role sees “An owner or accountant approves a bill”. Test in
  `src/tests/bill-modal.test.tsx` covers bookkeeper / accountant / delegate.
- **A8-035 reported** — with a negative net, every share in Income-by-source and Expense-by-category reads
  `0.0 %` (`reportGenerators.ts:105-107`). Proven with a local probe; **not patched** because
  `src/server/services/balanceService.ts:63` imports the same module (shared money maths → AI #1).
- **A8-029 extended** — purchase orders share the gap: `poOrderNeedsApproval` is referenced only by
  `src/components/purchases/PurchaseOrdersView.tsx:81`; no server file reads `poEnabled`/`poThresholdCents`.

## Verification actually run (this checkpoint)

| Check | Result |
| --- | --- |
| `tsc --noEmit` (4 GB heap) | pass |
| `eslint` touched files `--max-warnings 2` | pass |
| `bill-modal` + `share-bar-clamp` | 14 + 2 tests, pass |
| `bill-modal` + `share-bar-clamp` + `allocation-rules` + `document-more-options` + `contact-extras` | 40/40 pass |
| `bill-stock-ui`, `document-defaults-forms`, `dimension-inline-workflow`, `dimension-inline-concurrency`, `exchange-rate-fill` | 64/64 pass |
| invoice-approval (server/UI/lib), bill-record-page, approval-delegation, approval-notifications | 63/63 pass |
| Same tests with the component changes stashed | the new cases fail → load-bearing |
| Hosted CI | re-running on `1c74662` (checks were still being created when this was written) |

## Deliberate scoping decisions

- Nothing under `src/server/**`, `supabase/**`, `src/lib/tax*`, `src/lib/fx*`, `reportGenerators` money maths was
  modified (AGENTS.md lane rule) — those findings are reported instead (A8-029, A8-030, A8-035).
- #906 is fixed in PR #889 and #910's patch depends on the #889 helper: neither was re-implemented.
- The client role gate is described as **UI parity, not authorization** in the code comment, the PR body and the
  register, because the server still does not enforce it for bills (A8-029).

## Next

1. Confirm all required checks green on `1c74662`; re-check for review/bot comments afterwards.
2. Re-read `docs/COORDINATION.md` in chunks (284 KB, truncates when read whole) for Agent #8 queue items.
3. Continue the sweep outside the reserved lane: attachments/permissions surfaces, client write-path error
   handling, reconciliations UI, expected/duplicate bills.
4. Refresh the Drive copies (register now carries A8-034/A8-035) and note the addendum pointer.

## Recovery

`git checkout arena/74a5c64e-ledgerflow` (HEAD `1c74662` or later), `npm ci --ignore-scripts`,
`NODE_OPTIONS=--max-old-space-size=4096 npm run lint:types`, then the test commands in the table above.
Findings register: `audit/agent8-2026-11-19/01-FINDINGS-REGISTER.md` (Drive copy listed in the addendum).
