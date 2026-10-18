# Architecture and Strategy Review

**Target:** `main` at `9aed5466c4691c5c55c6d4dbec0565d88dbc8462`  
**Decision:** Preserve the existing architecture. The highest leverage is completing trust/scope/retry handoffs and proving them at the real database/browser boundaries—not rewriting the stack or adding another generic ERP layer.

## Executive assessment

LedgerFlow is a substantial financial application with a mature set of existing posting, reporting, inventory, tax and administration workflows. Its dominant risk is not a missing framework; it is **inconsistent authority and scope across adjacent layers**:

- the browser may calculate a financial action from a cache that is not the server's current state;
- a locally accepted/posted response can leave stale or duplicate client state;
- a report/export can present a different period or completeness level than its heading suggests;
- business rules are sometimes present in UI metadata paths without equivalent server transition authority;
- server/database, Vercel and standalone background-job paths have distinct operational behavior;
- a checked-in migration or test does not establish that the target database has the migration or that the browser journey was exercised.

The repository already has sound architectural pieces to connect: a single posting service family, server-side schema/ledger checks, transactional bulk mutations, idempotency helpers, workspace role middleware, report calculators, shared CSV utilities, work queues and extensive focused unit tests. Keep these boundaries and improve their contracts rather than duplicating them.

## Architecture snapshot at the pinned revision

### Application and persistence

- React screens are assembled through `src/config/registry.tsx`; shared state is held in stores/hooks, with lazy collection loading and workspace changes intended to clear scoped data.
- Browser data access is routed through `src/lib/db/firestore.ts`/the Supabase client/RPC and RLS boundary. Server access is routed through `src/server/db/firestore.ts` and `src/server/db/pgFirestore.ts`, which provide Firestore-like service interfaces over PostgreSQL. The server uses privileged database access, so RLS is not the sole enforcement layer; route and service invariants remain essential.
- `server.ts` composes Express middleware/routes in the shared `createApp()` used by the standalone server and Vercel adapter. `server/http/serveApp.ts` adds the standalone Vite/static-serving and timer behavior. Cron work is exposed separately through `src/server/routes/cronRoutes.ts` and `vercel.json`.
- Financial-document changes generally pass through `useEntityOperations` → a `LedgerPostService` posting module → `/api/v1/transactions/bulk`, where the entity mutation and journal rows are committed together. Payments use atomic/idempotent server services. Some work remains client-derived or cache-sensitive; these are the specific audit findings, not a reason to replace the architecture.

### Structural coverage measures (not correctness claims)

- **2,178 tracked paths** at the target revision. The inventory includes source, tests, docs, configuration, generated/support files and non-code assets; it does not include dependencies or build output.
- **29,662 function-like AST nodes:** 18,742 in production paths and 10,920 in test/e2e paths; zero TypeScript parser diagnostics. A function row is structural presence, not behavior reviewed.
- **121,619 candidate call-edge rows:** 27,121 uniquely resolved function edges, 202 ambiguous and 94,004 unresolved/external candidates. Method dispatch, callbacks, registries and dynamic names are not all resolved.
- **3,440 interactive JSX declarations:** 2,313 handlers statically resolved, 1,127 unresolved/prop/dynamic. This is not the number of controls rendered in a real session.
- **282 statically reconstructed path/method patterns** versus 279 live Express route objects. Three excess static patterns are array-path variants. The direct client probe covered 169 concrete URL patterns; two public GET 404s were expected invalid-token responses, not missing routes. Fifteen dynamic URL callsites were not assigned a concrete probe path.
- **1,403 database-operation candidates** are syntactic callsites, not individually reviewed DB queries or proof of deployed SQL/RLS behavior.
- Current Atlas revalidation resolved all 215 references in 18 prior workflow traces; that checks references, not workflow correctness.

The corresponding durable maps are `COMPLETE_FILE_INVENTORY.csv`, `COMPLETE_FUNCTION_MAP.csv`, `COMPLETE_CALL_EDGE_MAP.csv`, `EVERY_UI_ACTION_MAP.csv`, `BACKEND_FUNCTIONALITY_MAP.csv`, `DATABASE_OPERATION_MAP.csv`, `FEATURE_COMPLETENESS_MATRIX.csv` and `END_TO_END_WORKFLOW_MAP.md`.

## What is working architecturally

1. **A meaningful posting boundary exists.** `LedgerPostService` and the invoice/bill/payment/credit posting modules centralize much of the accounting impact instead of relying on arbitrary components to write journals directly.
2. **Server-side transaction and schema checks exist.** The bulk route validates transactions, workspace/account ownership, locks and allowed document mutations; its transaction writes entity and ledger changes together. The restore path now rejects unbalanced ledger records before writes. These should be completed and tested, not bypassed.
3. **Idempotency has useful building blocks.** `requestPayloadHash`, `assertSameRequest`, `executeCommand` and the payment idempotent service bind an operation to actor and request in the stronger paths. Remaining direct callsites and document-level retry identity are specific gaps.
4. **Reporting calculations are separated from many screens.** `computeReports`, `reportColumns`, `txFilters`, statement and tax helpers can support a shared scope/provenance contract without moving formulas into UI components.
5. **Existing work is discoverable.** Registry views, capability rows, migrations, tests and server routes already expose a broad product surface. Incomplete pieces should remain visible with accurate status rather than being hidden.
6. **Build and unit quality checks currently pass.** On Node 24.22.0, the unit command passed 2,799 tests, lint passed with 0 errors / 210 warnings under the 212-warning cap, the production build passed and the Code Atlas test suite passed. The database skip notices, unavailable browser and absent providers are not passes.

## Main architectural risks

### A. Client-derived posting state is not a concurrency contract

`postInvoiceLedger` identifies prior entries from the client-loaded transaction list; a stale list can cause a retried invoice to mint new IDs and idempotency keys. The server's unique transaction-ID check prevents duplicate IDs, not duplicate business intent across fresh IDs. Adopt a stable server-owned invoice revision/action identity or CAS and a replay response that is atomically tied to the durable mutation. Keep the server's current transaction boundary.

### B. Monetary validation has two different balance domains

`DoubleEntryValidator` checks raw line cents. `lineAmount` later converts per-line FX values. The synthetic BUG-07 fixture passes raw balance but has a one-cent converted residual. The accounting owner must first decide whether transaction-currency balance, base-currency balance, rounding adjustment or an explicit FX-clearing line is authoritative. Then encode that single policy at the server boundary and in test fixtures. Do not independently “fix” reports and posting with inconsistent rounding.

### C. Report and delivery scopes are not a shared value

The report hook returns `null` on failure; report screens can keep an old authoritative answer. The statement screen and PDF/email loader use different date scopes. Introduce a typed `ReportScope`/`StatementScope` plus source/completeness/error metadata and pass it through visible values, comparative columns, drill-downs, CSV/PDF/email. Scope changes must invalidate or explicitly label last-good data.

### D. Privileged server and browser persistence have separate invariants

RLS protects browser/RPC operations, but the service database connection is privileged. A future mutation must be reviewed at every layer: authentication, workspace membership, role, period lock, schema, account/doc ownership, business invariant, transaction, audit log, idempotency and error handling. The 2,799 unit pass is not a substitute for PostgreSQL/RLS execution.

### E. Background work has deployment-specific behavior

Vercel runs a larger cron registry than standalone timers. Scheduled reports mark a period before send, so a failure can lose delivery. Define a shared job registry and durable per-recipient outbox/lease/retry states, plus clear deploy mode. Do not simply turn on the Vercel list in every server process and create duplicate jobs.

### F. Security configuration has cross-layer drift

- Remote PostgreSQL configuration can select `rejectUnauthorized: false` when no CA is supplied; production config was not inspected.
- `safeFetch` validates DNS and then ordinary `fetch` performs its own resolution; rebinding/pinning was not tested.
- `vercel.json` statically hard-codes one Supabase CSP host while other code supports configuration.
- Async auth-derived admin state can resolve after identity changes; no server escalation was demonstrated.

These require targeted configuration/identity tests. They do not imply an observed production compromise.

### G. Product breadth and connection backlog outpace readiness evidence

The current capability table has 193 numeric rows but only 190 unique numeric IDs, contains contradictions for notes/custom fields, and differs from unchecked C-102…C-126 coordination items. Several tax/locale helpers have unit tests but no direct screen caller; some recent helper functions are directly used by report screens. A “complete” library or E2E test file is not proof of a first-tester workflow. Reconcile the map before adding another layer of screens.

### H. Bundle/performance concern is measured only at build time

The Node 24 production build reports main JS 977.68 kB (301.03 kB gzip), ExcelJS 938.06 kB (271.30 kB gzip), visualization vendor 493.94 kB (131.61 kB gzip), and PWA precache 334 entries / 6,986.69 KiB. These are artifacts, not first-load or Core Web Vitals. Profile representative guest/authenticated routes, slow networks, offline deployment and large datasets before changing chunking. Preserve existing lazy feature imports.

## Strategy: finish existing boundaries in dependency order

### 1. Establish executable evidence first

- Keep exact pinned source revision and map rows stable.
- Run the configured unit-test command on Node 24 and retain the database “not configured” notices separately from pass counts.
- Add a real disposable PostgreSQL/Supabase test environment for RLS, migrations, transaction interleavings and migrations-applied version.
- Add a browser runtime for primary journeys, screenshots and accessibility; use synthetic fixtures and provider sandboxes only.
- Keep a no-production-data rule for audit/fix verification.

### 2. Resolve correctness before presentation polish

- BUG-01 signed reversal flow totals.
- BUG-02 period/request-bound report answers and explicit failures.
- BUG-04 one statement scope across on-screen/PDF/email.
- BUG-07 finance-approved FX rounding/balance rule.
- AUD-19 signed analytical EBIT and cautious score wording.

Add independent expected values first; don't alter old expected amounts to make a bug pass.

### 3. Make mutation retries and authority explicit

- BUG-03 invoice revision/action identity and CAS.
- AUD-07 direct admin idempotency callers receive canonical payload hashes.
- BUG-05 canonical cache upsert plus identity/workspace generation.
- AUD-02 restore owner/version reads and shape/relation checks move into a coherent transaction.
- AUD-03 RMA approval transitions become authenticated, revision-checked and append-only.

### 4. Make operations observable and recoverable

- AUD-04 outbox/claim/retry/delivery state.
- AUD-05 explicit shared scheduler contract per deployment.
- AUD-11 DNS-to-connect strategy and provider allowlist.
- AUD-12 CSP source/config unification.
- AUD-13 identity generation/cancellation for auth-derived state.
- AUD-20 verified remote database TLS defaults.

### 5. Finish existing UI/feature handoffs

- Connect BUG-06 controls to established checkout/export/close paths; where no underlying feature exists, label as incomplete but keep visible.
- Reconcile C-102…C-126 with current screens and true unfinished handoffs.
- Keep estimates, payments, stock movements, tax review, receipts, RMA decisions and document delivery as distinct business events; do not invent combined shortcuts that bypass authority.
- Respect `AGENTS.md`, `docs/COORDINATION.md`, reserved files and release buckets. This audit has not assigned owners or taken implementation work.

### 6. Measure load and reduce friction last

- Collect route-level bundle costs, slow-device/network startup and large workspace list/report timing.
- Use current lazy-loading and stable report components; split only where profiling identifies a real cost and tests prove the boundary.
- Improve findability without adding duplicate navigation or a generic “all tools” screen.

## Release strategy recommendation

- **Development/synthetic QA:** appropriate now, with the explicit caveat that browser and real-Postgres evidence remain open. Keep incomplete features discoverable in test mode.
- **First external testers with synthetic data only:** after the reporting, retry, FX and restore gates are covered by focused tests and the application is deployed to a disposable test database. The current repository snapshot alone is not sufficient evidence for real financial records.
- **Controlled pilot with real records:** only after all P0 financial/restore/TLS and DB authorization acceptance criteria pass on the actual deployment configuration, browser workflows pass with realistic Hebrew/English and multi-currency records, and the owner approves supported tax jurisdictions and recovery procedures.
- **Public release:** do not infer from test volume or build success. Require the pilot evidence, recovery/support ownership and operational scheduler/provider verification.

This sequencing preserves LedgerFlow's architecture and the user's existing work while preventing “more features” from hiding incomplete financial and operational boundaries.
