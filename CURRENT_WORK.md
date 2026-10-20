# Current work — read this first (every AI, every session)

Updated 20 Oct 2026 by AI #1 (Claude). This page is the one place for **what to do now**. Status of the
product is in [`docs/RELEASE_GATE.md`](docs/RELEASE_GATE.md) (14 workflows: connected / checked against worked
figures / browser-tested). Full task wording is in your queue in [`docs/COORDINATION.md`](docs/COORDINATION.md).
History (finished tasks, old messages) is in [`docs/archive/`](docs/archive/) — read it only when you need it.

## Start of every session

1. Look at **your own open PRs** first. Fix the ones AI #1 sent back (push to the same branch). A task in an open
   PR is not free to start again; if your next task needs that code, branch from that PR and say "builds on #NNN".
2. Then take the next task below, from the latest `main`.

## Rules that never change

- **AI #9 (Opus)** may change money/tax/stock code **in its lane only** (files listed in COORDINATION "AI #9"), always through a PR that AI #1 reviews; every money change comes with a test of worked figures.
- **AI #1 (Claude)** is the lead: pushes straight to `main`, merges everyone's PRs, owns money, posting, tax maths,
  statements/PDFs and `src/server/`. **Every other AI** works on its own branch and opens a PR; never merge your own.
- Problems in AI #1's area → write them under Messages in COORDINATION; don't patch them.
- Before opening a PR run: the type check, **the whole unit suite** (`npm test` with the local test database), ESLint
  (0 errors, warnings ≤ 210), the browser spec(s) you touched, and `npm run test:rules` if you touched SQL.
  Say the pass counts in the PR. A PR that fails its own test is sent back.
- Screens follow [`docs/UI_GUIDE.md`](docs/UI_GUIDE.md); every button's visible text is part of its name (axe).
- Plan: [`docs/PLAN.md`](docs/PLAN.md) §15–16 — stage 1, tax is **US + Israel only**, skip `[P]` (parked) tasks.
- Copilot "Potential fix for code scanning alert" PRs are reviewed by AI #1 like any other PR.

## Each AI's next tasks

| AI | Do next, in order | Open PRs / blocked |
|---|---|---|
| #1 Claude (lead) | Reviews and merges, the plan; DIM-1 for payment records, AU-4 import totals check, INT-6/7 (Stripe), then the seams AI #3 waits for (A-72, A-75–A-77) | — |
| #9 Opus (tax + stock server lane) | **Tax:** export sales zero-rated (own PR), CON-1 US sales-tax table + item taxability on invoice lines, CON-2 US nexus watch. **Stock:** ISS-130 cost edits go through a revaluation entry, ISS-131 valuation as of a past date, DIM-2 where stock came from / went | — |
| #2 Codex | C-120 tax suggestions on a screen, the rest of C-102…C-126, then C-115, C-117 | — |
| #4 | D-86 invoice form, then D-87 onward (D-95/D-96 done by AI #9, #232) | — |
| #3 Arena | A-112 (stock serial numbers), then A-113, A-115, A-117 | Waiting on AI #1, don't start: A-72, A-75, A-76, A-77 |
| #5 | E-57 import totals proof screen (W11), then E-17 onward | — |
| #6 | Fix #181 and #183 (see the review comments), then S-1 onward | #181, #183 sent back |
| #7 | F-48 flaky Overview contrast scan (quick), F-46 browser test: backup → restore → same reports (W10); F-47 group report (W12); then F-1 onward | — |
| #8 | G-24 first-hour journey test (W1), G-9 sample companies (IL + US) | — |

## Where things are

| What | File |
|---|---|
| Product status, what blocks release | `docs/RELEASE_GATE.md` |
| Your full queue (task wording) and Messages | `docs/COORDINATION.md` |
| AI #1's own list | `docs/TRACKER.md` (open items only) |
| Questions for the owner | `docs/FOR_YOU.md` |
| Architecture and data rules | `AGENTS.md` |
| Finished tasks, old messages, old plans | `docs/archive/` |
