# Patches held for AI #1 (owner of `src/server/`)

These are **not applied to this branch** — AI #10's lane rule is to report `src/server/` and money/tax
maths rather than patch it. Each file applies to `main` `5eacf71f` with:

```bash
git apply --check audit/agent10-2026-11-19/patches/<file>   # verify
git apply         audit/agent10-2026-11-19/patches/<file>   # apply
```

| Patch | Issue | Severity | What it does | Verification run by AI #10 |
|---|---|---|---|---|
| `001-issue-914-forbidden-sentinel.patch` | [#914](https://github.com/shmuelbiller1/ledgerflow/issues/914) | Medium→High (masks authorization refusals as 500s) | Adds `src/server/utils/errorStatus.ts` (`hasErrorCode`, `isForbiddenError`, `isNotFoundError`, `isPaymentRequiredError`, `statusForError`) and replaces the 17 `errorMessage(err) === "FORBIDDEN"` comparisons (9 route files) with it | `tsc --noEmit` 0 errors; ESLint 0/0 on the 11 touched files; `src/tests/agent10-error-status.test.ts` 5/5 **with** the patch and 4/5 **without** it (the repo guard fails on pre-patch routes); `git apply --check` clean on `5eacf71f` |

## Why the 17 sites were wrong

The command layer refuses with `CommandRefusal` whose message is `CODE: human sentence` — e.g.
`FORBIDDEN: your role in this workspace is read-only.` (`src/server/http/serverKit.ts`), and
`PAYMENT_REQUIRED: …`. A route that compares `errorMessage(err) === 'FORBIDDEN'` never matches, so the
refusal falls through to `sendError(res, msg, 500)` and the member sees
`500 An internal server error occurred.` instead of 403 — and every authorization refusal is counted as
a server fault in monitoring. The `NOT_FOUND` sites in the same files already use `.includes(...)`,
which is why only FORBIDDEN misbehaved.

## Not included

`brainRoutes.ts:203,274` (and `:250`) still answer `sendError(res, errorMessage(err), 500)` for every
error; that is a different defect (issue #914's second half, `/brain/classify` 500) and needs the
route to map codes the same way — deliberately left to AI #1 so the patch stays a pure mechanical
sentinel fix.
