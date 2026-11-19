# Agent #7 — 2026-11-19 — Checkpoint 01: #873 fix, PR #882 verification, queue re-check

- Branch: `arena/6540fb3d-ledgerflow` from upstream `main` **`5eacf71`**.
- Decision-maker: Shmuel. Nothing was merged or closed.
- Progress: code fix + regression test written and verified; reserved-lane findings re-verified and filed; PR #882 re-checked; Drive preservation in progress.

## 1. Completed work

### 1.1 Fixed: #873 — journal record links showed the prior entry's draft

- **Defect:** `TransactionEditModal` initializes all form state on mount only. `src/components/ledger/TransactionGridView.tsx` rendered it without a React key, so changing the URL fragment from one entry to another kept the first entry's unsaved/draft state while the route selected the second entry.
- **Reproduction pinned by test:** `src/tests/journal-link-editor-lifecycle.test.tsx` renders the real grid view and real modal, changes the description on entry 1, switches to entry 2, then returns to entry 1. Before the fix: entry 2 showed `"Unsaved note on entry 1"` (actual failure transcript retained below); after the fix: each entry shows its own saved description, while an ordinary same-entry re-render still preserves an unsaved edit.
- **Fix:** one line, `key={editingDetailsTx.id}` on the modal at `TransactionGridView.tsx:174`. No money, posting, server, schema, or route change.
- **Status:** fixed on this branch, red→green demonstrated locally.

### 1.2 Own PR #882 — final status (no change required)

- Head `2460d456a257feb50d86f4ec41a14a18c417a054`, base `bce500c139be72264b8652fad9248610c7496eb9`, mergeable **clean**, `maintainer_can_modify: false`.
- Hosted checks on the current head (run `44434779249`): **26 pass, 2 conditional skips** (`Browser tests (changed specs)`, `Docs checks`). No pending or failed check.
- Gitar: **Approved**, "No issues found". SonarCloud: **Quality Gate passed**, 0 new issues, 0 hotspots; its 0.0% new-code coverage is not the coverage evidence (local 160/160 + 98.46% lines on the changed hooks/components were documented in the PR).
- Inline review threads: none. Issue comments: four, all authored by this agent or the bots and already dispositioned in the PR body.
- Action: none. Shmuel decides whether to merge. This branch's #873 fix is independent of #882's file list.

### 1.3 Re-verified queued findings on `5eacf71`

| Prior ID | Status now | Evidence |
|---|---|---|
| A7N-10 group translation (JPY/KWD 100×/10×) | **Fixed upstream** (#878) | `src/server/reports/groupReport.ts:286-303` now uses `convertMinorUnits(cents, rate, from, to)` and carries `from`/`to`; eliminations/associates use `minorUnitRate`/`toReport`. Matches the old proposed patch. |
| A7N-11 asset undo voids arbitrary entry | **Fixed upstream** | `src/server/services/assetDisposalService.ts:178-207` now checks `metadata.assetId` **and** `metadata.type` for both full and partial disposals before voiding. |
| A7S-01 year-close draft trap + period command scope | **Fixed upstream** (#820/#901) | `src/server/commands/periods.ts:65,104-106,135-142` has `trappedDrafts`; `apiAuthenticate.ts:54` fails closed to `write:workspaces` for unmapped commands. |
| A7N-05 FX revaluation `asOf` / custom AP account | **Fixed upstream** (#806/#901) | `fxRevaluationService.ts:212-235` filters documents/allocations by date and refuses later settlements; `124` uses the document's `arAccountId`/`apAccountId`. |
| A7N-02 ledger-door total | **Fixed upstream** | `ledgerDoor.ts:41-47` accepts either document debits or home-currency debits and checks home balance separately. |
| A7N-07 statement FX | **Still live — issue #805** | `computeReports.ts:362+` still adds raw `amountCents`; no `toBaseCents` in `computeStatement`. |
| A7N-08a trial-balance orphan lines | **Still live — issue #802** | `computeTrialBalance()` only accumulates lines whose account is in the chart; `isBalanced` over the remainder. |
| A7N-08b cash-flow disposal class | **Still live — issue #803** | `computeCashFlow()` still assigns every non-cash leg by account class, with no disposal special case. |
| A7-UI-04 negative share bars | **Still live — issue #909** | Fix/patch was prepared in the earlier session; it touches #882's files, so it was not re-applied here. |
| A7S-03 document re-link | **Still live — filed as #912** | `document.save` accepts `linkedTransactionId`, allows owner/accountant/bookkeeper and only checks the document's workspace. Viewer claim from 2026-11-17 was too broad and is corrected in the issue. |
| A7S-04 ticket visibility | **Still live — filed as #913** | `ticket_read`/`ticket_update`/`message_read` use `lf_is_member(workspace_id)`; trigger only limits status transitions. |
| A7N-02b credit refund FX half | **Not re-probed** | `refundCredit` posts lines in the credit's currency with its exchange rate and lets `TransactionValidator` derive home amounts; the old patch conflicts. No live defect confirmed on the current code, so nothing was filed. |

All five 2026-11-17 patches now **conflict** against `5eacf71`; re-applying them would risk duplicating upstream fixes. They are retained as historical recovery artifacts, not as an actionable queue.

## 2. Tests and checks actually run (this sandbox)

| Gate | Command | Result |
|---|---|---|
| New regression | `npx tsx --test src/tests/journal-link-editor-lifecycle.test.tsx` (before fix) | **1 fail**, actual `"Unsaved note on entry 1"` vs expected `"AWS September Hosting Fee"` — bug reproduced |
| New regression + 7 neighbours (46 tests) | `NODE_ENV=test ... npx tsx --test --test-force-exit src/tests/{journal-link-editor-lifecycle,stable-editor-keys,agent7-ui-and-export-regressions,journal-view,ledger-grid-keyboard-region,ledger-grid-nav,transaction-edits}.test.*` | **46 pass / 0 fail** |
| Types | `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` | exit 0 |
| ESLint (changed files) | `npx eslint --max-warnings 2 src/components/ledger/TransactionGridView.tsx src/tests/journal-link-editor-lifecycle.test.tsx` | exit 0, 0 warnings |
| Layers | `npm run check:layers` | 4/4 pass |
| Dependency install | `npm ci --ignore-scripts --no-audit --no-fund` | exit 0 |
| Patch applicability | `git apply --check` on 5 old patches | all conflict on `5eacf71` (expected; upstream fixes landed) |
| Full `npm test` / browser shards | Not run locally | Owner's 18 Nov rule: CI runs the full suite per push; no local PG/browser image here |

## 3. Unfinished / next

1. Push this branch and open a PR for #873; read CI and bot comments after the push and answer anything actionable.
2. Shmuel: decide #882 (ready) and #912/#913 (reserved lanes); decide whether to narrow `employees` read policy (product contract).
3. AI #1: #805/#802/#803/#909 are already filed; the old patch 11 supplies a turnkey starting point for #912/#913.
4. Preserve this checkpoint, the findings register and the Drive index addendum; verify the uploads.

## 4. Red/green transcript (condensed)

```
BEFORE FIX (src/tests/journal-link-editor-lifecycle.test.tsx)
  not ok 1 - a different record reloads the draft; a re-render of the same record keeps edits
  error: entry 2 must show its own description, not entry 1's draft
  + actual 'Unsaved note on entry 1'  - expected 'AWS September Hosting Fee'

AFTER FIX
  ok 1 - a different record reloads the draft; a re-render of the same record keeps edits
  # tests 1 / pass 1 / fail 0
  # 46 pass / 0 fail with the seven neighbouring suites
```
