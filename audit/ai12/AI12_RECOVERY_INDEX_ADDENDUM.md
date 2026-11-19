# MASTER_RECOVERY_INDEX — AI #12 addendum (onboarding & help lane)

**Added** 2026-11-19 by AI #12 (Arena session, branch `arena/145e7090-ledgerflow`).
This is an **addendum**, not an edit of the master index: the master file is shared by every agent and
must not be overwritten. Read it together with
[MASTER_RECOVERY_INDEX.md](https://drive.google.com/file/d/1pTGxQhLdqBvH4sLoR-0MZ0XuvKtTP86F/view).

## Pointers

- **PR**: [shmuelbiller1/ledgerflow#897](https://github.com/shmuelbiller1/ledgerflow/pull/897) — OPEN,
  unmerged, `mergeStateStatus: CLEAN`.
- **Branch**: `arena/145e7090-ledgerflow`, base `main` `bce500c139be72264b8652fad9248610c7496eb9`.
- **Head commit**: `632f1625754a0a535bc697bad558f0a9082231d2` ("fix(auth): an English refusal shows the
  real number, not {min}"). Ten commits: `6dcb990`, `cd70dd1`, `b5b70ec`, `d91eaec`, `505fbeb`,
  `dec5633`, `3c3138b`, `efec862`, `ca3c108`, `632f162`.
- **Hosted verification at `632f162`**: 26/26 check runs pass, 2 skipped by the repo's scope rules.
  Includes Production build (entry chunk 256,449 B < 260,000 B), SonarCloud Quality Gate **passed**,
  CodeQL, Gitar, all five browser shards, ten unit shards across three time zones, coverage gate.
- **Scope discipline**: no file under `src/server/`, `supabase/migrations/`, `api/`, `server.ts`, or
  any money/tax/PDF path is touched.

## Artifacts (uploaded to this archive, each verified to exist and open)

| File | Folder | Size | MD5 | Link |
| --- | --- | --- | --- | --- |
| Findings register (AI12-N10-01…07, AI12-N3-01, AI12-N8-01) | `04 Accounting Findings` | 5,587 B | `2324b72850ca693b99913ec8be85c933` | [open](https://drive.google.com/file/d/1lxWBCN9msxPBEd4qOJq6jgxb39AhHauM/view) |
| Final report (per-check CI results, bot threads, limits, assessment) | `04 Accounting Findings` | 7,000 B | `0eaf6cd14a82acaea7886d71b467a9c3` | [open](https://drive.google.com/file/d/1Gr0uu28lsoGKn9DyjsPx3FSr-CSPE8yy/view) |
| Full patch `bce500c..632f162` (73 files) | `05 Code Changes and Recovery Patches` | 257,717 B | `ae59f7fc630af0716b7bad699391394c` | [open](https://drive.google.com/file/d/1hFDCEnUkkHyLTfKx7YgpiBj8OGH29w5x/view) |
| This addendum | `10 Recovery and Handoff` (parent `1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK`) | see upload | — | this file |

Restore from the patch: `git apply AI12_PR897_FULL.patch` on a checkout of `bce500c`. The branch
itself is on the remote, so the patch is a second copy, not the only copy.

## In-repo copies (same content, inside the repository history)

`audit/ai12/AI12_FINDINGS_REGISTER.md`, `audit/ai12/AI12_FINAL_REPORT.md`,
`audit/ai12/AI12_PR897_FULL.patch`, committed at `514948f` and after.

## What a successor must know

1. **Two AI #12 sessions push to this branch.** Anything posted on PR #897 after 2026-11-19T03:03Z
   may be the other session's work. This addendum covers `6dcb990`…`632f162` only.
2. **Pending human decisions** (not code defects): a native Hebrew review of the new strings, and the
   owner's ruling on the SonarCloud CPD exclusion for the bilingual tables (it follows the repo's own
   existing precedent for `screenTranslations.ts` and friends).
3. **Sandbox limits that shaped the evidence**: no Playwright browser (E2E verified only by CI), and
   GitHub artifact/log downloads blocked, so failures were diagnosed from check-run annotations and
   reproduced locally instead.
4. **The workspace can be re-provisioned mid-session** (`HEAD` reverted to the base commit). The
   commits survived on the remote; recovery was `git stash -u` + `git merge --ff-only origin/<branch>`.
