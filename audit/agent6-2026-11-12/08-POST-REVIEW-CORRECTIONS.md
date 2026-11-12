# PR #673 — Corrections requested after review (2026-11-12)

The original audit was pinned to `main@c82bead4`. This addendum supersedes its recommendations to apply all seven patches.

## Direct code changes now on PR branch
- `src/server/routes/workspaceApiRoutes.ts`: ignore client-provided workspace IDs and privileged creation fields; block workspace-scoped keys; generate IDs on the server; create-only transaction.
- `src/server/routes/developerApiRoutes.ts`: create-only chart accounts and refuse existing IDs (even in a different tenant or for a system account); classify conflict/permission failures.
- `src/lib/txFilters.ts`: preserve fully populated balanced home-currency line values instead of applying the FX rate a second time; reject inconsistent home balance.
- `src/tests/home-currency-balance.test.ts`: regression for a four-line FX entry that previously had a re-conversion residual.
- `src/tests/tenant-create-boundary.test.ts`: source checks plus real PostgreSQL endpoint tests when `LF_TEST_DATABASE_URL` is set.

## Pending / historical patches
- Former patch `01` is archived as `patches/01-p0-tenant-takeover-and-coa-hijack.applied-reference.txt`; do not re-apply.
- The six remaining patches `02`–`07` remain proposals only. Review and test them individually against current `main` before applying.
- Existing baseline audit metrics and earlier assertions describe the previous branch state. Do not treat them as current CI results.

## Merge guidance
Check new CI and confirm the PostgreSQL route regression cases executed, not merely skipped. Do not merge until those results are verified. The product launch verdict remains NOT READY until the remaining independent findings and release gates are satisfied.
