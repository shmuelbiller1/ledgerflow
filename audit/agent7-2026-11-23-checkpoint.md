# Agent #7 — checkpoint, 2026-11-23 (F-9 / F-13 / F-22-client)

> Dated checkpoint for the permanent Drive record. Branch `arena/468a7e48-ledgerflow` (base `9c7f9fb`, `origin/main`), new work on `ai7/stability-f9-f13-f22-guards`. Not merged by this agent; never merge own PRs.

## What was examined (2026-11-23 session)

- Repo rules: `AGENTS.md`, `CURRENT_WORK.md`; queue and Messages log in `docs/COORDINATION.md` (AI #7 stability queue ~lines 669–709); status docs `docs/TRACKER.md`, `docs/TODO_2.md`, `docs/RELEASE_GATE.md`, `docs/FIRST_TESTERS_GATE.md`, `docs/verification/`; prior audits `audit/agent7-2026-11-19/`, `audit/agent7-2026-11-{10,11,13,16,17}`.
- GitHub: `gh pr list` (one open PR: #1002, owner's DO-NOT-MERGE accounting audit), `gh issue list` open (13), full bodies/comments of #953/#834/#833, PR #946 bot tail (Gitar Approved, Sonar passed).
- Google Drive: canonical index `1pTGxQhLdqBvH4sLoR-0MZ0XuvKtTP86F` (121,635 B; latest entry Agent #6 2026-11-18), session-2 addendum `1LBmlqW3QIzQPrZ87-TtYYhZ6TH-g7wi_`, recovery root `1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK`.
- Code read this session: `src/hooks/useFormDraft.tsx`, `useDialog.ts`, `src/lib/{runCommand,utils,errorRemedies,firebaseUtils,inBackground}.ts`, `src/lib/db/{firestore,client}.ts`, `src/services/aiService.ts`, `src/server/http/serverKit.ts`, `src/server/http/requestContext.ts`, `src/server/utils/safeFetch.ts`, `src/components/ui/AsyncButton.tsx`, the three primary modals, plus the tests listed below.

## Completed this session

| ID | Finding | Disposition |
|---|---|---|
| F-9 / P2-63 | Only invoice and bill dialogs guarded against losing a typed form; refresh/back/tab-close could still discard any form, and the journal-entry dialog had no confirm before discarding on Close/backdrop/Discard. | **Fixed** — new `src/hooks/useUnsavedChangesGuard.ts` (`beforeunload` while dirty) wired into InvoiceModal, BillModal, JournalEntryModal; journal Close/backdrop/Discard routed through `requestClose` with the same I-07 wording as invoice/bill. |
| F-13 | A realtime channel that reached a terminal state left the list silently stale — nothing else triggers a read. | **Fixed** — `src/lib/db/firestore.ts` `subscribe(status)` reloads in full on `CHANNEL_ERROR`/`CLOSED`/`TIMED_OUT`. |
| F-22 (client half) | The server logs and answers an `x-request-id` but the client discarded it, so a user-visible 5xx could not be quoted or traced. | **Fixed** — `ServerCommandError.requestId` + `errorReference()` + toast suffix `(Reference …)`. Server-side body change is reported to AI #1 instead (see messages). |
| F-26 (client gap) | `aiService.callBackend` has no timeout/AbortController. | **Reported** — candidate; not changed this session (see next steps). |

## Tests run locally (sandbox Node v22.22.3 vs required 24.x — environment limit, not a repo defect)

Focused suites, all green: `unsaved-changes-guard.test.tsx` (new, 3), `live-snapshot.test.ts` (incl. new dead-channel case), `run-command.test.ts` (24, incl. request-id cases), `error-remedies.test.ts` (4, incl. toast reference), `error-remedies-hebrew.test.tsx` (13), `save-failures-books.test.tsx` + `journal-entry-rates` + `invoice-modal` (37), and every suite rendering these modals: `agent6-security-and-fx-audit`, `agent7-ui-and-export-regressions`, `auto-reversal`, `dimension-inline-workflow`, `journal-templates`, `journal-view`, `required-labels`, `stable-editor-keys`, `use-dialog` (68), `bill-modal`, `allocation-rules`, `attachments-ui`, `bill-stock-ui`, `contact-extras` (41), `dimension-inline-concurrency`, `document-defaults-forms`, `document-more-options`, `eg5-credit-limit-ui`, `exchange-rate-fill`, `invoice-destination` (40), `item-type`, `line-labels`, `price-lists`, `rate-history`, `repeat-document`, `sale-receipt`, `unbilled-goods` (38), `polling-and-subscriptions`, `eu-b3-form-draft` (12).

- `npx tsc --noEmit` clean (needed `NODE_OPTIONS=--max-old-space-size=3072` on 3 GiB).
- ESLint clean on every changed file (0 errors / 0 warnings).
- Not verified locally: full suite, DB/RLS gates, Playwright browser shards, production build — CI is the authority. Vercel preview redness is deployment protection, not a code signal.

## PR

- **#1033** — "[AI #7] Stability: unsaved-changes guards on all forms, realtime recovery, request ids in errors (F-9/F-13/F-22)", base `main`, head `ai7/stability-f9-f13-f22-guards`, commit `7aaced0`. Open; checks were pending at writing — re-check live before anyone merges.

## Unfinished / next steps

1. CI results on #1033; answer any bot review comments (Gitar/SonarCloud) without weakening checks.
2. Report the server half of F-22 (returning the id in the error body) to AI #1 under Messages in COORDINATION — `src/server/` is off-limits to this lane.
3. Client half of F-26: add a timeout/AbortController to `src/services/aiService.ts` (candidate fix; design to avoid changing retry/posting semantics).
4. Open-queue items not yet started: F-10 long-list virtualisation >500 rows, F-11 startup bundle split, F-12 dashboard memory-leak check, F-18 print <3 s/200 lines, F-19 mobile bottom-sheet sidebar, F-20 dark-mode contrast, F-27 FX/AI retry with backoff, F-29 startup env-var page, F-31 long-session memory check.

## Lane reminder

Money, posting, tax maths and `src/server/` are AI #1's (and AI #9's where applicable): report, do not patch.
