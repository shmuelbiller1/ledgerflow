# AI #5 — S-01 extraction from PR #254 (owner-directed)

**Scope:** new PR from upstream `main`; do not merge original #254. Only authentication and AI Brain use the new shared limiter in this change. Public invoice/PDF, per-API-key, app-wide limiters and unrelated CSP/headers/SBOM/restore/auditing changes remain unchanged and belong to later, reviewed PRs.

## Source-traced changes
- `rateLimitEntries` is a **server-only** Postgres table. Quotes preserve case; it has RLS enabled, revokes browser-role table access, and intentionally has **no browser policies**.
- `lf_rules` registration is essential for `src/server/db/pgFirestore.ts` `tables()`, `readDocs()` and `executeOps()`; it is **not** a grant or a browser RLS policy.
- Each namespace/workspace/identifier is stored only as a SHA-256-based document id; identifier is not written in raw form. Every rate-limit check is a single SERIALIZABLE `db.runTransaction` read/check/write, retried on concurrent updates, with no count increments after denial.
- Auth and Brain exports now call this middleware. Database failure returns HTTP 503 rather than silently allowing requests (this implies migration deployment must occur before enabling the new code).
- Auth rate: 5/15 min per IP; Brain rate: 20/min per user if available, otherwise IP. Other limiters remain process-local and are not claimed to be global.
- No tax, posting, balance, workspace permission, invoice or payment code changed.

## Tests added
- `src/tests/shared-rate-limiter-postgres.test.ts`: two actual Postgres-backed instances, 20 simultaneous requests with max 5 => exactly 5 accepted / 15 denied; scope isolation; database persistence and hashed ids; RLS enabled and no browser policies/grants. Requires `LF_TEST_DATABASE_URL` + migrated disposable Postgres.
- `src/tests/shared-rate-limiter-middleware.test.ts`: simulated database outage returns 503 and never runs the protected route.

## Verification still mandatory
This connector session has **no GitHub checkout/network**, Node dependencies or local PostgreSQL test database. It can push through the GitHub connector but cannot honestly report local test counts. **CI must run** and AI #1 must verify the focused tests, full unit suite with `LF_TEST_DATABASE_URL`, `npm run lint:types`, `npm run lint:eslint` (0 errors, warnings <=207), `npm run test:rules` and any relevant auth/Brain browser smoke. Do not mark production protected until migration applied and tested on the target environment.

Cross-fork: agent #6's PR #254 stays open; owner requested an independently reviewable replacement because that fork is read-only through this GitHub connection. Agent #1 owns the final merge and must reconcile overlap with Agent #6.
