# Audit index — Agent #6 (security lane) — 2026-11-20

**Branch:** `arena/b1a560b0-ledgerflow`
**Base commit:** `d1f2c8dda3d8378270117d9c30d8aae3ee0337a6` (`main`, "Merge pull request #925 …")
**Date:** 2026-11-20 (UTC)
**Agent:** #6 — security lane (S-* queue + SEC-SCAN-1), independent verification, no money/posting/server edits

---

## Contents

| # | File | Purpose |
|---|------|---------|
| 00 | `00-INDEX.md` | This index (how to resume) |
| 01 | `01-FINDINGS-REGISTER.md` | Findings with evidence, reproduction and status |
| 02 | `02-GATES-AND-EVIDENCE.md` | Exact local gate results, what CI owns, what was not run and why |
| 03 | `03-LAUNCH-READINESS.md` | Slice assessment + what still blocks real-money launch |
| `patches/` | `01-workspace-csv-export-formula-and-currency.patch` | Server/money-lane fix for AI #1 (`git apply --check` verified) |
| `repro/` | `workspace-csv-export.mjs` | Before/after bytes for that patch, run with `npx tsx` |
| — | `docs/verification/ai6-2026-11-20.md` | Human-readable verification + Drive/handoff pointers |

---

## How to resume

1. `git status` — the branch must be clean; `git log --oneline -1` is the last intended commit.
2. Read `01-FINDINGS-REGISTER.md` (what is fixed here, what is filed for the lead).
3. Read `02-GATES-AND-EVIDENCE.md` — the commands that were run and the ones CI owns.
4. Read `03-LAUNCH-READINESS.md` before making any claim about launch.
5. For the server-lane defect: `git apply --check audit/agent6-2026-11-20/patches/01-*.patch` then
   `npx tsx audit/agent6-2026-11-20/repro/workspace-csv-export.mjs` (before/after bytes).
6. GitHub: the PR from this branch into `shmuelbiller1/ledgerflow:main`, and issues **#941–#945**
   (filed 19 Nov, still open) plus the new issue filed from this session for AF6-20261120-01.

## Lanes respected

- `src/server/**` money/posting code, `supabase/migrations/**`, tax maths: **AI #1**. Nothing there is
  edited on this branch; the confirmed defect is delivered as a verified patch + reproduction + issue.
- `src/server/http/contentSecurityPolicy.ts` and `scripts/check-security-headers.ts` **are** edited:
  they are the S-23/S-6 security-header surface this agent owns (precedent: the merged
  `Permissions-Policy` change from `arena/6e749e1a-ledgerflow`), and the change is required for
  AF6-20261120-03 (a stale CSP hash would otherwise report a violation on every page).
