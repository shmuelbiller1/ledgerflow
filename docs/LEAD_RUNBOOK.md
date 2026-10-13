# Lead runbook: how any AI runs LedgerFlow

Written 13 Oct 2026 so the project does not depend on one AI. Claude is AI #1 (the lead) today; any
other AI (Codex, Arena, a new one) can take the lead role by following this file. Helper AIs read
`docs/COORDINATION.md` for their own queue; this file is for whoever is lead.

## The lead's loop (every few hours, or when woken)

1. **Finish what is open.** `git status`; uncommitted work is finished and pushed first.
2. **Merge finished work.** List open PRs. For each with all CI checks green:
   merge it into main locally **one at a time**; on a conflict, resolve it (shared docs: keep both
   sides; images: never take either side blindly — refresh them, step 4); stop if a conflict is in
   money code and ask its author.
3. **Check before pushing:** type check, ESLint (warnings must not rise above the ratchet), the full
   unit suite against a real Postgres (`docs/TRACKER.md` top says how to start it). Push to main.
4. **Screenshots.** If a screen changed on purpose, run Actions → "Refresh visual baselines" with the
   screens' names, then **open the new images and look at them** before calling it done.
5. **Tick what is done.** For every open task: `git log origin/main --grep=<ID>`; done → `[x]` with
   the commit; built but not on a screen → `[~]`.
6. **Refill queues.** Each helper AI keeps at least two weeks of tasks (the daily
   `docs/LINE_COUNT.md` row shows the counts). Take new tasks from List 2 (`docs/TODO_2.md`) and
   from triaged issues (below).
7. **Owner questions** go in `docs/FOR_YOU.md` with the default used. Never wait.
8. **Plan** (`docs/PLAN.md`) is brought up to date when a batch of work lands.

## Fixing bug patterns fast

`npx tsx scripts/bug-patterns.ts` rewrites `docs/BUG_PATTERNS.md`: every place one of the seven
patterns can happen, with file and line. Take one pattern in one area (10–20 places), fix each with the
helper from `src/lib/serverAction.ts`, run the scanner with `--write-baseline` (the counts go down;
the test refuses any rise), push. Fix recipes:
- swallowing-action → return `ActionResult` / `true|false` (or rethrow); callers show success on `ok`.
- success-after-call → check the result first.
- write-in-loop → one server route doing all-or-nothing; or `allSettledWrites` and report failures.
- stale-async → `const scope = workspaceScope(...)` before the await; `if (!scope.isCurrent()) return;` after.
- effect-before-write → do the effect after the write, only for what was accepted.
- unchecked-write → check `res.ok`, throw otherwise.
- silent-catch → show the error, or comment why it is safe to ignore.

## Rules that never change

- **One owner for money.** Posting, tax calculation, payroll calculation and database changes belong
  to the lead (or the money lane, when one is named in COORDINATION). Helper AIs never change how
  money is calculated or posted; they build tables, screens, reports, imports and tests.
- **Done means on a screen.** A library nobody can reach is not done.
- **Main stays green.** A red main is fixed before anything else.
- **No secrets in the repository; no real customer data in tests or issues.**
- **Database changes** go in `supabase/migrations/` and are applied to the live project after the
  code is pushed; anything not applied is listed in FOR_YOU.

## Public issues (anyone can report)

People report on GitHub → Issues → New issue ("Something is wrong" or "Idea"). Security problems go
to the private advisory form, not issues.

**Triage (lead, each loop):** for every issue labelled `needs-triage`:
- a money/tax number is wrong → label `money`, `priority`; the lead fixes it first, with a test from
  the report;
- a clear bug elsewhere → label `ready` and the area (`screens`, `reports`, `imports`…);
- an idea → label `idea`; worth doing → add it to `docs/TODO_2.md` in the right tier and close the
  issue with a link; not worth it → close with a kind one-line reason;
- unclear → ask one question on the issue, label `needs-info`.
Remove `needs-triage` when done.

**Fixing (any AI):** take **a batch of 5–10 `ready` issues in one area** (not one at a time), fix them
on one branch, write `Fixes #N` for each in the PR, add a test per bug. The PR runs CI merged with
main; the lead merges it in step 2. Never fix a `money` issue unless you are the money owner.

## When the lead role moves to another AI

Read, in order: this file, `CLAUDE.md` / `AGENTS.md`, `docs/PLAN.md`, the last 30 lines of
`docs/COORDINATION.md` (Messages), `docs/FOR_YOU.md` sections A–B. Post one line under Messages:
"AI #N is lead from <date>". Keep the same files and rules; nothing here is Claude-specific.
