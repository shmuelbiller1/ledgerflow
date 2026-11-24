# MASTER_RECOVERY_INDEX — Agent #7 addendum, 2026-11-23 (F-9 / F-13 / F-22-client)

> Append/prepend pointer for the canonical [MASTER_RECOVERY_INDEX.md](https://drive.google.com/file/d/1pTGxQhLdqBvH4sLoR-0MZ0XuvKtTP86F/view). Dated, self-contained addendum; earlier agents' sections are preserved unchanged. This session did not rewrite the canonical index.

## Current session

- **Agent:** #7 (Arena), stability lane. **Base branch/commit:** `arena/468a7e48-ledgerflow` at upstream `main` **`9c7f9fbd1f881a5915c030e066ded6f596113938`** (merge PR #1031).
- **Work branch:** `ai7/stability-f9-f13-f22-guards`, commit **`7aaced0`** (from `9c7f9fb`).
- **New PR:** [#1033](https://github.com/shmuelbiller1/ledgerflow/pull/1033) — "Stability: unsaved-changes guards on all forms, realtime recovery, request ids in errors (F-9/F-13/F-22)". Open, never merged by this agent. At writing, checks were still pending — use the live PR for the final result.
- **Scope held:** no money, posting, tax maths or `src/server/` change. The server half of F-22 is reported to AI #1 instead.

## Fixed and verified this session

| ID | Fix | Files |
|---|---|---|
| F-9 / P2-63 | `useUnsavedChangesGuard(dirty, message)` registers `beforeunload` only while a form is dirty; wired into invoice, bill and journal-entry dialogs. JournalEntryModal also asks before discarding on Close/backdrop/Discard (previously it had no guard at all). | new `src/hooks/useUnsavedChangesGuard.ts`; `src/components/sales/InvoiceModal.tsx`; `src/components/purchases/BillModal.tsx`; `src/components/ledger/JournalEntryModal.tsx`; new `src/tests/unsaved-changes-guard.test.tsx` |
| F-13 | A realtime channel that reaches `CHANNEL_ERROR`/`CLOSED`/`TIMED_OUT` now triggers a full reload instead of leaving the list silently stale. | `src/lib/db/firestore.ts`; `src/tests/live-snapshot.test.ts` |
| F-22 (client half) | `ServerCommandError` carries the response's `x-request-id`; `errorReference()` and `reportError` quote `(Reference …)` beside the remedy. No invented reference when there was none. | `src/lib/runCommand.ts`; `src/lib/utils.ts`; `src/tests/run-command.test.ts`; `src/tests/error-remedies.test.ts` |

Local verification (sandbox Node v22 vs required 24 — environment limit): ~240 focused tests green across 30 suites including every suite that renders the three modals; `tsc --noEmit` clean; ESLint clean on changed files. Full suite / DB / Playwright / build gates belong to CI; Vercel preview redness is deployment protection and not a code signal.

## Reported, not patched (reserved lanes)

- **F-22 server half:** `src/server/http/requestContext.ts` emits `x-request-id` and logs it, but `serverKit.ts` `sendError(...)` does not return it in the body. Client can only quote what it receives → owner AI #1.
- **F-26 client gap:** `src/services/aiService.ts` `callBackend` has no timeout/AbortController (the server side already uses `safeFetch`, 10 s). Candidate fix, not applied this session.

## Verified Drive artifacts (uploaded, then opened)

| Artifact | Folder | File ID |
|---|---|---|
| Checkpoint 2026-11-23 (this session) | `03 Progress Checkpoints` (`15St3Aqq7LaQDTcqrtv05nvtF8Nu6gpGn`) | `15jZojKHDUcPLGXuyaQG3Ko3Eeziqkjzq` |
| Prior addendum (#917, #882) | — | `1LBmlqW3QIzQPrZ87-TtYYhZ6TH-g7wi_` |
| Canonical index (do not rewrite) | — | `1pTGxQhLdqBvH4sLoR-0MZ0XuvKtTP86F` |
| Recovery root | — | `1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK` |

## Open queue remaining (AI #7, from COORDINATION.md ~669–709)

F-8 retry-on-save UX · F-10 long-list virtualisation >500 rows · F-11 startup bundle split · F-12 dashboard memory-leak check · F-15/P2-23 one money-input component · F-18 print <3 s/200 lines · F-19 mobile bottom-sheet sidebar · F-20 dark-mode contrast · F-24 background job runner (design with AI #1) · F-27 FX/AI retry with backoff · F-29 startup env-var page · F-31 long-session memory check.
