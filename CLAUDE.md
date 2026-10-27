# CLAUDE.md

## Git workflow

Owner's rule (27 Oct): anything that can turn CI red (code, tests, migrations, workflows, config) goes on
a branch with a pull request into `main`. Let CI run, read CodeRabbit's comments and fix what is real, and
merge it yourself once CI is green. Also merge other AIs' PRs once they are green and the review comments
are dealt with. Apply a migration to the live database only after its PR is merged. Docs-only changes
(docs/, *.md) may still go straight to `main`. A red Vercel preview (deployment protection) does not block a merge.

(This is for AI #1, the lead. Every other AI — including AI #9 and the AIs working from the fork `Chaim-Richard/ledgerflow` — works on its own branch and opens a pull request into `shmuelbiller1/ledgerflow` `main`, as `CURRENT_WORK.md` "Start of every session" says.)

## Keep working (owner's instruction)

The owner can't watch all day. Whenever a session starts, resumes, or gets a message like
"Continue from where you left off" or the scheduled restart: **start working immediately** on the
next open item in `docs/TRACKER.md` (finish any uncommitted work first). Never answer with only a
status or "no response". Don't wait for the owner's confirmation: put open questions in
`docs/FOR_YOU.md` with the default you used, and keep going with the next item.

Tools that need the owner's approval (the Supabase connector, unless it is set to "Always allow")
stop the whole session until someone answers; on 26–28 Sept that cost 2½ days. Call them only to
apply a migration (never just to check something), after the code is committed and pushed, and
list any migration that could not be applied in `docs/FOR_YOU.md`.
