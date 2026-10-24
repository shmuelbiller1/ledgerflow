# Current work — read this first (every AI, every session)

Updated 23 Oct 2026 by AI #5 (Arena) — E-35 receipt fixtures; AI #2 closed the screen-wiring lane on 21 Oct (see Messages in COORDINATION). The E-32/E-36–E-40 batch is in PR #355; verification evidence: [`docs/verification/ai5-e32-e40-2026-10-23.md`](docs/verification/ai5-e32-e40-2026-10-23.md). This page is the one place for **what to do now**. Status of the
product is in [`docs/RELEASE_GATE.md`](docs/RELEASE_GATE.md) (14 workflows: connected / checked against worked
figures / browser-tested). Full task wording is in your queue in [`docs/COORDINATION.md`](docs/COORDINATION.md).
History (finished tasks, old messages) is in [`docs/archive/`](docs/archive/) — read it only when you need it.

## Not done yet — the short list (updated every merge)

Everything below is open. Finished items leave this list. Full wording is in COORDINATION (other AIs) and TRACKER (AI #1).

**Stage A (synthetic bookkeeping beta) is READY.** All 9 workflows (W1, W2, W3, W4, W5, W6, W9, W10, W14) are Connected, Verified with worked figures, and Browser-tested. See [`audit/LAUNCH_READINESS_FINAL_AUDIT_2026-10-23.md`](audit/LAUNCH_READINESS_FINAL_AUDIT_2026-10-23.md) and [`docs/RELEASE_GATE.md`](docs/RELEASE_GATE.md).

| Workflow / Gate | Status | Who |
|---|---|---|
| Done for A | **W1, W2, W3, W4, W5, W6, W9, W10, W14** (all 9 Yes/Yes/Yes; D-98 and D-99 browser journeys merged in #324; L-123 server balances merged in #334, #345, #351; G-24 journey merged in #282) | — |
| Owner launch actions | Paste L-123 migration in Supabase, set `DATABASE_CA_CERT` in Vercel, rotate 4 secrets (items in `docs/FOR_YOU.md`) | Owner |
| Stage B: W11 QuickBooks/CSV | Import acceptance matched to source (AU-4) | AI #5 / AI #9 |
| Stage B: W13 stock | Full stock browser journey (W13-GOLD figures verified #281) | AI #4 / AI #9 |
| Stage B: ERPNext depth | Repost engine (EG-1 #348 design), Payment ledger (EG-2), Period closing voucher (EG-3), Stock snapshots (EG-7) | AI #1 / AI #9 |

**Pull request for this branch**

| PR | State |
|---|---|
| #355 | E-32 and E-36–E-40 accountant/contact/ISO batch from `arena/981150a6-ledgerflow` |

**Waiting on you (owner)** — details in `docs/FOR_YOU.md`
- Replace the four generated secrets (item 2), try sign-up on the live site (3), deployment protection (4).
- Email sender + provider (5, 7), database certificate (6), Stripe last 2 steps (8), privacy papers (17).
- GitHub: require CI before merging to `main` (L-67).

**After stage A (stage B)**: W11 QuickBooks/CSV import matched to the source (AU-4), W13 stock journey, Israeli allocation numbers, production gates. W12's group-report browser gate is complete in PR #370. **Stage C**: tax filing automation, payroll processing. The ~400 "LATER" ideas stay in TRACKER and are not on this list.

## Start of every session

0. **Where you push.** Run `git remote -v`. If `origin` is **`Chaim-Richard/ledgerflow`** (a fork — AI #6, #7, #8 work
   there), your work reaches the owner only as a **pull request from the fork into `shmuelbiller1/ledgerflow`, base
   `main`**, with "Allow edits by maintainers" ticked. Start every task from the owner's latest main, not the fork's:
   `git remote add upstream https://github.com/shmuelbiller1/ledgerflow.git` (once), then
   `git fetch upstream && git checkout -b ai<N>/<task-id> upstream/main`; push with `git push origin ai<N>/<task-id>`.
   Full steps: COORDINATION "AIs that work from the fork". If `origin` is `shmuelbiller1/ledgerflow`, push your
   branch there and open the PR as usual. Only AI #1 pushes to `main`.
1. Look at **your own open PRs** first (on `shmuelbiller1/ledgerflow`, including ones from the fork). Fix the ones AI #1 sent back (push to the same branch). A task in an open
   PR is not free to start again; if your next task needs that code, branch from that PR and say "builds on #NNN".
2. Then take the next task below, from the latest `main`.

## Rules that never change

- **AI #9 (Opus)** may change money/tax/stock code **in its lane only** (files listed in COORDINATION "AI #9"), always through a PR that AI #1 reviews; every money change comes with a test of worked figures.
- **AI #1 (Claude)** is the lead: pushes straight to `main`, merges everyone's PRs, owns money, posting, tax maths,
  statements/PDFs and `src/server/`. **Every other AI** works on its own branch and opens a PR; never merge your own.
- Problems in AI #1's area → write them under Messages in COORDINATION; don't patch them.
- Before opening a PR run: the type check, **the whole unit suite** (`npm test` with the local test database), ESLint
  (0 errors, warnings ≤ 205), the browser spec(s) you touched, and `npm run test:rules` if you touched SQL.
  Say the pass counts in the PR. A PR that fails its own test is sent back.
- Screens follow [`docs/UI_GUIDE.md`](docs/UI_GUIDE.md); every button's visible text is part of its name (axe).
- Plan: [`docs/PLAN.md`](docs/PLAN.md) **§17 bookkeeping first** (stages A/B/C, P0/P1/P2) — do P0 work first; tax automation and payroll processing are stage C; skip `[P]` (parked) tasks.
- Copilot "Potential fix for code scanning alert" PRs are reviewed by AI #1 like any other PR.

## Each AI's next tasks

| AI | Do next, in order — **P0 for stage A first** (PLAN §17) | Open PRs / blocked |
|---|---|---|
| #1 Claude (lead) | Reviews/merges and the plan; wire A-77 branding into PDFs when AI #3's resolver lands; L-94 server-side document postings (design) | — |
| #9 Opus (money lane) | **P0:** L94-STEP2 (the server builds invoice/bill entries); then ISS-160, PREV-5, AUD-15, L94-STEP2B, W7-GOLD, W8-GOLD, PREV-6, AUD-13, ISS-143+AUD-03, AUD-10, … (24 open, about 3 days; full order in COORDINATION). FIFO/lot costing waits for the owner | — |
| #7 (fork: Chaim-Richard) | Not active recently — its stage-A tasks moved to AI #4. When active: F-48/F-49 flakes, stability queue (F-*). How to send work: COORDINATION "AIs that work from the fork" | — |
| #3 Arena | **FINAL A-queue sweep complete** (`arena/7456594f-ledgerflow`, builds on `#356`): **all 11 unblocked `[ ]` A-tasks completed on screens with tests** (`A-119`, `A-122`, `A-124`, `A-126`, `A-127`, `A-134`, `A-136`, `A-140`, `A-155`, `A-169`, `A-189`) + **5 `[~]` tasks closed `[x]`** (`A-66`, `A-69`, `A-120`, `A-132`, `A-178`) + **`A-123` client engine & report done (`[~]`)** + `#356` review polish (`A-138`, `A-107`). **99 A-tasks:** **54 `[x]` done**, **13 `[~]` partial** (wait on AI #1 reserved screens/server or live-DB e2e), **1 `[ ]` blocked on AI #1** (`A-72` statement scope/PDF), **31 `[P]` parked**. Evidence: [`docs/verification/ai3-launch-readiness-audit-2026-10-23.md`](docs/verification/ai3-launch-readiness-audit-2026-10-23.md) | PR from `arena/7456594f-ledgerflow` (supersedes/includes `#356`); **0 unblocked `[ ]` tasks left** |
| #5 | **E-35 is on this branch (ready for review):** the receipt fixture set for D-31 — 20 invented receipts (9 English, 8 Hebrew, 3 mixed; US and Israel) as images + answer key in `src/tests/fixtures/receipts/`, a per-field scorer with no single accuracy number (`src/lib/receiptFixtures.ts`), `npm run eval:receipts` writing the dated baseline (`docs/eval/2026-10-23-receipt-fixture-baseline.md`), 10/10 tests. Merged earlier: E-58, E-26/E-43, E-28, E-29 and the E-32/E-36–E-40 batch (#355). **Next:** E-44, E-45, E-46, E-47 (Xero/Wave/Zoho/Sage CSV imports, imports lane), then E-48/E-49, E-50/E-51. E-17 stays open pending the authority's fixed-width specification; E-33/E-34 deferred until their specifications are verified. A re-read of the whole queue (E-17…E-57) with what is actually delivered — E-49 and E-52 turned out to be already shipped and are ticked — is in [`docs/verification/ai5-queue-audit-2026-10-23.md`](docs/verification/ai5-queue-audit-2026-10-23.md); E-53 (IIF export) is the next real task. Evidence: [`docs/verification/ai5-e35-2026-10-23.md`](docs/verification/ai5-e35-2026-10-23.md). | `arena/52a8a8be-ledgerflow` |
| #4 | PR #370 completes D-47 per-user report preference sync and F-47/W12 desktop/phone browser evidence; full CI green on `944ecb8`. Next: W13 full stock browser journey. D-99's fully authenticated four-account journey and real authenticated W14 proof remain open. | PR #370, `arena/65913fb1-ledgerflow` |
| #2 Codex | **Screen wiring C-102…C-126 is done** (21 Oct: all 50 modules in `workspaceExports.ts` reach a screen; C-115/C-117/C-120/C-121/C-122 ticked). Next: C-35 access review, C-36 audit evidence pack, then C-54/C-71 empty states and C-67/C-89 column chooser — check each against `main` first, several older rows are already built. No new tax screens (stage C) | — |
| #6 (fork: Chaim-Richard) | S-01–S-05 merged 21 Oct (#266–#270); next: S-1 onward in its queue. How to send work: COORDINATION "AIs that work from the fork" | — |
| #8 (fork: Chaim-Richard) | Works now and then: G-9 sample companies (IL + US), then its G-queue. How to send work: COORDINATION "AIs that work from the fork" | — |

## Where things are

| What | File |
|---|---|
| Product status, what blocks release | `docs/RELEASE_GATE.md` |
| Your full queue (task wording) and Messages | `docs/COORDINATION.md` |
| AI #1's own list | `docs/TRACKER.md` (open items only) |
| Questions for the owner | `docs/FOR_YOU.md` |
| Architecture and data rules | `AGENTS.md` |
| Finished tasks, old messages, old plans | `docs/archive/` |
