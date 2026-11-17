# Agent #6 checkpoint 01 — initial investigation and handoff baseline

**Date:** 2026-11-17 UTC  
**Current branch:** `arena/aed2bcd0-ledgerflow` (Arena-assigned; do not switch branches)  
**Base / initial HEAD:** `4c87916df6f87fcad768a898ba39b268d3d5f7ac` (`main`, merged PR #749)  
**Initial worktree:** clean; no branch ref exists on `origin` yet; no PR belongs to this branch.  
**Assignment:** Agent #6 security lane; continue the owner's SEC-SCAN-1 work without redoing the already-merged PR #748.

## Instruction and coordination sources examined

- Root `AGENTS.md`, `CLAUDE.md`, `CURRENT_WORK.md`; scoped `src/AGENTS.md` and `src/tests/AGENTS.md`.
- `docs/COORDINATION.md`: AI #6 queue, fork/PR rules, SEC-SCAN-1 assignment and messages through 16 Nov; `docs/FOR_YOU.md` owner decision (“so add it”, local-only scans), `docs/prompts/SEC-SCAN-1-api-and-web-scans.md`, and `docs/RELEASE_GATE.md`.
- Prior Agent #6 reports `audit/agent6-2026-11-16/01-INSTRUCTIONS-CONFLICTS-AND-BASELINE.md`, `02-LIVE-AUDIT-FINDINGS-AND-SCAN-RESULTS.md`, `03-FINAL-AUDIT-REPORT-AND-REMEDIATION-PACK.md`, their patch inventory, and the Drive Agent #6 recovery addendum.
- Google Drive `MASTER_RECOVERY_INDEX.md` (file `1pTGxQhLdqBvH4sLoR-0MZ0XuvKtTP86F`) and the Agent #6 recovery addendum for PR #748 (file `1DE6xOxNwZkapF41sD1W_B6OlDP-f7BKM`). The index is too large for one connector response; the targeted Agent #6 addendum was read completely.
- GitHub open PR list, PR #748 (merged) description, all checks, Gitar finding/thread and resolution; recent open PRs #751–#754 and their checks/reviews/comments. These are tracked as separate agents' work; this branch will not modify their source files.

### Authority / scope resolution

The current Arena branch is fixed by the session rules and supersedes the prior Agent #6 branch note. Stay on `arena/aed2bcd0-ledgerflow`, push only that branch, never merge. Root `AGENTS.md` reserves `src/server/**`, money, posting, taxes and migrations to AI #1; the new patch stays in scanner workflows and their tests/docs. No specialized subagent tool is available in this session. No production endpoint or database was scanned or modified.

## Repository and tool baseline

- Checkout contains **4,169 tracked files**; source tree is a >4,000-file repository. `git status --short --branch` was clean at the initial pin.
- Runtime tools at start: Node `v22.22.3`, npm `10.9.8`, Python `3.11.2`; `node_modules`, Docker and `psql` are absent. No tests have yet been claimed as run in this checkpoint.
- `origin` is `https://github.com/shmuelbiller1/ledgerflow.git`. Current branch has no remote ref yet.

## Prior task status and independently observed regression

PR [#748](https://github.com/shmuelbiller1/ledgerflow/pull/748), the prior Agent #6 SEC-SCAN-1 and API-hardening delivery, merged at `225b225ca3b0781f8250343af04a095c77449a71`; its head was `0c0e5f70df4fd08c933678e9509c92f2aa7be96a`. Its existing CI checks passed. The Gitar rate-limit bypass finding was answered in code (skip IP buckets only when `req.user.usedApiKeyId` proves the key was authenticated) and its review thread is resolved. A Vercel free-deployment-rate error was later followed by a ready preview; it is not treated as an app defect.

The newly merged scanner workflow is **not yet delivering its intended CI coverage**:

- The active workflow id `420710700` is shown by GitHub as `.github/workflows/api-fuzz.yml` rather than its declared name. The last 9 runs of this workflow (including `main` `4c87916`, `main` merge `225b225`, and open-PR head pushes) all concluded `failure` in 0 seconds.
- For the most recent run `43985628463`, GitHub's run-jobs endpoint returned `total_count: 0`, no check runs or artifacts exist, and the logs endpoint returned 404. The same 0-job/0-second signature is present in the run list for preceding commits.
- The API YAML on `main` contains `pull_request` and `workflow_dispatch`, but no API-fuzz check appears on PR #754. A manual `gh workflow run api-fuzz.yml --ref main` returned HTTP 422, “Workflow does not have 'workflow_dispatch' trigger.” This proves a workflow-registration/trigger discrepancy. The precise GitHub-side parsing/indexing cause is not yet confirmed.
- The scanner YAML also contradicts SEC-SCAN-1's exact-pinning requirement: it uses mutable `@v4`/`@v5` action refs and moving Node/Python/PostgreSQL major/minor tags. Its unit guard currently blesses `actions/upload-artifact@v4` rather than checking immutable pins.
- ZAP's workflow builds the production bundle but starts `tsx server.ts`, so the scan target is source-run rather than the just-built `build/server.cjs`; this weakens production-build scan fidelity.

These are the current Agent #6 work items, not claims that the whole app is audited. ZAP's `INFO` rule action was independently checked against the official ZAP baseline source and is valid; it is not a finding.

## Other agents' live PR feedback observed (not modified here)

- #751: CI and Sonar passed; the Israeli invoice-PDF preview/download finding has a code workaround on its latest head and the Gitar thread is resolved.
- #752: CI was still running at the observed head. Gitar has two unresolved, actionable findings: inventory command services plus command executor can produce duplicate audit log rows; `GET /deliveries/:deliveryId/note` gets rejected by `stockGate` because the gate ignores `req.query.workspaceId`.
- #753: CI passed but Gitar's free-invoice-maker customer-resolution change has an unresolved draft-reset finding.
- #754: CI was still running; Gitar flags a minor AI #1 `src/server/` ownership/reservation concern. Codex review did not complete because its configured review usage was exhausted. These belong to their PR owners / AI #1, not this branch.

## Next steps

1. Fix SEC-SCAN-1 workflow triggers so GitHub actually starts the scan for pull requests and manual dispatch; confirm the trigger behavior on the PR, not just by regex.
2. Pin each action to its full commit SHA; pin Node, Python and PostgreSQL to exact versions supported by the repository. Preserve the scanner's local-only target and Phase 1 report-only behavior.
3. Boot the actual built production server for ZAP; strengthen regression tests for trigger shape, action/version pins and production target.
4. Install dependencies and run relevant tests/type/lint/build. Use a disposable local PostgreSQL if available; Docker/psql are absent at baseline. Record exact pass/fail/skip results.
5. Create the detailed findings register, final checkpoint and handoff; update `docs/COORDINATION.md` with non-overlapping cross-agent escalations as appropriate; upload artifacts and update/verify Drive `MASTER_RECOVERY_INDEX.md`.
6. Commit/push only the Arena-assigned branch, open a separate PR, inspect all review feedback and verify actual CI on its latest commit. Do not claim green until the scanner run itself has jobs and completes.

## Preservation references

- Prior Agent #6 Drive recovery folder: `1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK`.
- Master index: `1pTGxQhLdqBvH4sLoR-0MZ0XuvKtTP86F`.
- Progress Checkpoints folder: `175Q9aRG6-_Q31WK4tmHbna6NA0_-xJ6f`.
- Prior Agent #6 reports and patches remain in `audit/agent6-2026-11-16/`; do not replace them.
