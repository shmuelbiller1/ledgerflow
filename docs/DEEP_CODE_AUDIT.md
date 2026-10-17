# LedgerFlow — deep-code findings and forward strategy

**Snapshot:** 16 October 2026 · branch `arena/8476f33d-ledgerflow` · base `8d858165d8853dcad5479b270a52d191b669c631`.
**Scope:** audit and navigation notes only. No application, money, schema, migration, baseline, dependency-lock or workflow changes. This document is a snapshot, not a deployment certification.

## Start here

**Highest-leverage findings:** statement screen/PDF scope mismatch (AUD-01), restore validation/snapshot weaknesses (AUD-02), reproduced analytical reversal-sign error (AUD-19), and remote DB certificate verification default (AUD-20). The other findings explain authority, reliability and workflow gaps around those boundaries.

**Recommendation: finish and prove the existing bookkeeping journeys before increasing feature breadth.** The repository already contains a large operational surface. The next leverage is consistent report scope, authoritative writes, honest partial-data states, reliable background jobs, and navigable ownership—not another generic ERP layer or a rewrite.

**This is the historical strategic review at the base revision above.** The former per-file appendix has moved into the single maintained [Code Intelligence Atlas](CODE_ATLAS.md), with [canonical JSONL](CODE_ATLAS.jsonl) and [generated coverage](CODE_ATLAS_VALIDATION.md). Do not maintain a second per-file database here. Findings, probes and executed checks below retain their original revision; the atlas names its own later input commit.

### Contents

1. [Coverage and method](#coverage-and-method)
2. [Architecture and trust boundaries](#architecture-and-trust-boundaries)
3. [Where to work for a specific change](#where-to-work-for-a-specific-change)
4. [Findings and follow-up acceptance tests](#findings-and-follow-up-acceptance-tests)
5. [Execution strategy](#execution-strategy)
6. [Verification performed for this audit](#verification-performed-for-this-audit)
7. [Hotspots and inventory totals](#hotspots-and-inventory-totals)
8. [Canonical per-file atlas](#canonical-per-file-atlas)

## Coverage and method

- The source snapshot has **2,134 Git-tracked files**, not 2,500+. There are **1,922 TS/TSX/JS/CJS/MJS files**; adding SQL, shell, CSS and HTML gives **1,965 code-related files**. The balance is documentation, config/data, hooks and assets. All 2,134 were included in the original inventory, including historical scripts and non-code assets. Current coverage is derived from the later canonical atlas, not this historical denominator.
- Every tracked textual file was read programmatically. All 1,922 JavaScript/TypeScript-family files were parsed with the installed TypeScript parser: **zero syntactic parse diagnostics**. Extracted evidence includes declarations, named function spans, static and literal dynamic imports, reverse importers, route declarations, collection requests, significant calls, test descriptions, selected metadata and implementation comments. SQL tables/functions/statements and documentation headings were also extracted.
- **This does not mean 1,922 files received an independent line-by-line human-equivalent correctness review.** The per-file atlas is content-derived structural/semantic navigation, supplemented with deeper manual source tracing of bootstrap, state loading, browser/server database adapters, auth/roles, posting, bulk operations, payments, reports/PDF, close, restore, jobs, tax/algorithm contracts, warehouse transitions and CI/deployment. Entries explicitly separate reviewer notes from extracted source intent. Test names and comments describe intended behavior, not proof it works.
- Binary assets were inventoried by path, size and content fingerprint, not visually reviewed or decompiled. Generated `node_modules`, `dist`, `build`, `.git` internals, caches and untracked environment/credential files are outside the source inventory. The new audit itself is excluded from its own snapshot.
- The retired appendix used truncated SHA-256 fingerprints. The canonical atlas instead uses full **Git blob SHAs**, explicit reviewed revisions and dependency-evidence staleness; see the atlas guide. Source line spans remain navigation, not a security attestation.
- Importers are **direct syntactic file references**, including literal `import()` and `require()`, not a whole-program call graph. Type-only imports, test imports and dynamic imports are identified where applicable. A file with no direct importer is **not automatically dead**: CLI entrypoints, Vite glob plugins, configuration, runtime selection and string-based registries need separate reachability checks.
- Route listings are local declarations; combine them with the mount path and middleware in `server.ts` / parent router. A `.use` listing can be a router mount rather than an endpoint. Collection/call mentions show observed code sites, not complete authorization or runtime side-effect analysis. Inspect the canonical entry and source for full syntax and unresolved relationships.
- No production database, provider account, deployment state, current GitHub issue status or live tax authority was inspected. Historical claims in coordination/verification docs remain historical; this audit does not silently promote them to fresh evidence.

## Architecture and trust boundaries

### Actual shape: modular monolith, not just three pure layers

The documented three-layer mental model is useful for algorithms but incomplete for the application. The working system is a React UI plus an Express backend plus a compatibility data layer over Supabase/Postgres, with several parallel calculation and persistence paths.

```text
index.html → src/main.tsx → src/App.tsx
  → src/core/layout/RootLayout.tsx → src/config/registry.tsx → screen/subview
  → useLedgerData + useLedgerCollections → Zustand browser cache
       ↳ src/lib/db/firestore.ts → Supabase client / PostgREST / RLS + RPC
  → document hooks/services → authenticated relative /api/... requests
       ↳ server.ts → mounted middleware/routes → server services
            ↳ src/server/db/firestore.ts → pgFirestore.ts → pg/* → Postgres

Pure report/algorithm helpers can be shared by screen and server.
Standalone: serveApp() serves Vite or dist and installs a subset of timers.
Vercel: api/index.mjs imports build/server.cjs; /api/cron/daily runs the daily job list.
```

**Important naming trap:** `src/firebase.ts`, `FirebaseAuthAdapter.ts`, `firestore.ts`, `getDb()` and Firebase-shaped request fields are compatibility names. The active database/auth implementation is Supabase/Postgres, not a second Firebase database to configure.

### Trust boundaries that must survive every change

| Boundary | Actual authority / files | Rule for future work |
|---|---|---|
| Workspace vs Entity/Location/Project label | `src/model/workspace.ts`, `src/model/ledger.ts`, `src/lib/dimensionUtils.ts`, `src/lib/tax/profile.ts` | Separate legal books require separate workspaces. A dimension filter is not record-level permission, a separate close calendar or consolidation |
| Browser loaded data | `useLedgerData.ts`, `ledgerCollections.ts`, `useDataNeedsStore.ts`, `useLedgerStore.ts` | Cache can be capped, failed or incomplete. Request lazy collections; do not use the cache as authoritative history or approval authority |
| Browser database writes | `src/lib/db/firestore.ts`, initial migration + later SQL migrations | PostgREST RLS, field guards and RPC validation apply. Nested field writes are not server business-state transitions |
| Server database writes | `src/server/db/pgFirestore.ts`, `src/server/db/firestore.ts` | Privileged DB connection bypasses client protections; routes/services must establish scope, role, locks, account ownership and business invariants themselves |
| Ledger invariants | `TransactionValidator.ts`, `DoubleEntryValidator.ts`, `ledgerDoor.ts`, `periodLock.ts`, `txFilters.ts` | Integer minor units, balanced signed lines, absolute totals, valid workspace accounts, correct FX, postable-only reporting, no silent closed-period mutation |
| Document posting | `useEntityOperations.ts` → `LedgerPostService.ts` → `services/ledgerPost/*` → transaction bulk route | Preserve document/journal/stock atomicity and reversal links. A convenient metadata write is not a replacement for posting |
| Payments | `paymentRoutes.ts`, `paymentService.ts`, `onlinePaymentService.ts`, webhook routes | Settlement, invoice, delivery and bank line are different events. Keep replay protection and allocations inside the appropriate transaction |
| Reports | `useFinancialReporting.ts`, `reportRoutes.ts`, `server/reports/*`, local screen computations | One explicit scope must reach screen, drilldown, CSV, PDF and email. Do not silently replace a complete answer with a partial cache answer |
| Third-party effects | `safeFetch.ts`, `mailer.ts`, `aiGateway.ts`, Stripe/Plaid services | Provider mocks prove contracts, not acceptance or delivery. DB commit and external delivery cannot simply be called one atomic transaction |
| UI consistency | `useDialog.ts`, `InlineEdit.tsx`, record drawer helpers, navigation/pins | Preserve draft, pending lock, error/refusal, focus return, workspace reset, keyboard and phone behavior |

### What is already strong

- There is substantial deterministic financial/security testing, SQL RLS testing, property/invariant coverage and browser coverage; these are assets to preserve rather than replace.
- Server Postgres transactions are designed as SERIALIZABLE with conflict retries; the compatibility layer retains cursor, field-transform and create/update semantics. Centralization here offers high leverage but a large blast radius.
- Main transaction routing installs `requireLedgerWriter` before child routes. Auth has separate bearer/API-key logic, workspace scoping and fail-closed quota checks. Do not mistake membership for writer authority elsewhere.
- Lazy collection contracts, capped-data tracking and stale-response checks already exist. Extend them consistently rather than inventing a second store/data-fetch framework.
- Algorithms have typed contexts and registries; previews, rules and tax tables already carry many limitations/source/date notes. Keep preview/legal-review outputs distinct from posting or filing.
- Existing owner roadmap and `TODO_2.md` already point toward journey completion and progressive complexity. The strategic correction is to execute that filter, not add another competing roadmap.

## Where to work for a specific change

Follow left-to-right; run the named boundary tests, then the broader gates. Find exact symbols and related imports in the atlas.

| Desired change | Start here → follow through | Verification focus |
|---|---|---|
| Main navigation / new screen | `config/registry.tsx` → `core/layout/RootLayout.tsx` / layout components → `stores/useUIStore.ts` | reachability, view registry, module visibility, keyboard/pins |
| Add pure analytical tool | `lib/algorithms/<tool>.ts` → `algorithms/index.ts` → `algorithms/types.ts` → `components/intelligence/ToolSandbox.tsx` | hand-number formula tests, input validation, insufficient data; no provider/store I/O in compute |
| Document amount/tax/FX behavior | `lib/documentMath.ts`, `lib/invoiceLines.ts`, `kernel/templates/TransactionTemplates.ts` → `services/ledgerPost/*` → server bulk route | independent minor-unit/FX/reversal fixtures; financial-owner review |
| Invoice/bill save | screen modal → `hooks/useEntityOperations.ts` → `services/LedgerPostService.ts` → `server/routes/transactions/bulkRoutes.ts` | draft vs issued, locks, approval, duplicate save, missing cached original, stock |
| Payment or allocation | `server/routes/paymentRoutes.ts` → `server/services/paymentService.ts` → `afterPayment.ts` / credit/deposit services | atomicity, actor/payload replay conflict, unapplied funds, FX, withholding |
| Banking import / match | `components/ledger/StatementImporter.tsx`, `components/banking/*` → parser/import helpers → `hooks/transactionActions/importActions.ts` → bulk/reconcile routes | exact signs/dates, dedup identity, known bank format, no direct browser bank-line posting |
| Authoritative statement/report | `server/routes/reportRoutes.ts` → `server/reports/*` → `hooks/useFinancialReporting.ts` → report screen | complete-history fixture, fiscal period, basis, labels, cancellation, drilldown/export parity |
| PDF / statement email | `components/ui/PdfPreviewModal.tsx` → `server/routes/documentRoutes.ts` → `statementService.ts` / `pdfService.ts` / document email service | same scope as screen, Hebrew extraction/print, currency, missing/foreign record |
| Month close/reopen | `lib/periodLock.ts`, `lib/closingSnapshot.ts` → `server/services/periodCloseService.ts` → period routes/screens | role/exception, concurrent posting, draft blocking, snapshot invariants |
| Metadata inline edit / related drawer | `components/ui/InlineEdit.tsx`, `RelatedRecordEditButton.tsx` → `lib/inlineRecordFields.ts`, `inlineRecordAdapter.ts` → typed record drawer | allowlisted fields, failure retained draft, nested focus, no money-field shortcut |
| New durable collection | `model/*` / `types.ts` → new SQL migration + rules/policies → adapters → optional `ledgerCollections.ts` / demand hook | real DB/RLS, cross-workspace/role refusal, delete/restore/backup policy |
| Fix Supabase compatibility behavior | browser `lib/db/*` and server `server/db/pg*` independently | RPC/PostgREST vs privileged SQL tests; transforms, cursors, missing fields, concurrent writes |
| Tax rules / country data | `lib/tax/*` → `lib/rules/packs/*`, evaluator/coverage/lint/source tools → tax/report screen | dated authority review, unknown coverage stays unknown; preview ≠ filing |
| Warehouse workflow | `CycleCountReportView.tsx` → `WarehouseOperationsReportView.tsx` → child panels → `warehouseWorkflows.ts` / `warehouseRecords.ts` | metadata persistence only, no stock/money side effects, server RMA handoff |
| Personal navigation preferences | `lib/pinnedPages.ts`, `lib/bookmarks.ts`, `useUIStore.ts`, `useBookmarksStore.ts` | corrupt storage, user/workspace scoping, allowed internal targets |
| Scheduled email/reports | `cronRoutes.ts` → `scheduledReportService.ts`, `reminderService.ts`, mailer | retries, lease/concurrent execution, per-recipient delivery history, standalone parity |
| Runtime/deploy security | `server.ts`, `server/config/*`, `server/http/*`, `api/index.mjs`, `vercel.json` | actual Node 24 build, missing config, CSP project variation, proxy/origin behavior |
| Test/quality infrastructure | `package.json`, `.github/workflows/ci.yml`, `scripts/quality-metrics.ts`, guards/baseline JSON | no weakened gates; distinguish structural counts from behavioral coverage |

## Findings and follow-up acceptance tests

Severity labels are audit recommendations, **not owner-authorized changes to V1 buckets**. `Confirmed` means the stated behavior is visible in source (or measured here), not that all downstream impact was reproduced. `Investigate` is a plausible failure path requiring a targeted test. Preserve the existing coordination ownership/reservations before implementation.

### AUD-01 — Statement screen, server JSON and PDF do not have one scope contract

**Priority: P0 candidate for report correctness · Confirmed source mismatch; already documented historically as A-72 / issue #141.**

- `src/components/reporting/StatementView.tsx` calculates from loaded documents with selected start/end dates; its PDF call sends document kind/contact/workspace, not those dates. It requests collections but does not use the hook's loading result to establish a complete answer.
- `src/server/routes/documentRoutes.ts` calls `loadStatement(db, workspaceId, id)`. `src/server/services/statementService.ts` uses fixed `1970-01-01`–`2099-12-31` dates. `reportRoutes.ts` has separate date-aware JSON statement computation. Neither is a completed entity-aware contract.
- **Impact:** a narrowed screen can disagree with the customer-facing download. Capped browser documents add a second divergence. Do not implement an entity-only browser filter while leaving its PDF all-entity/all-history.
- **Next change:** define a typed statement scope (contact type/id, period, label/entity treatment, currency, allocations/unallocated amounts) once and use authoritative rows for screen/PDF/email.
- **Acceptance:** independent opening balance + in-period invoice/payment/credit + out-of-period rows + multi-entity allocation fixture; compare exact screen/JSON/PDF/email totals and descriptions; test wrong-workspace contact and partial cache. Do not close the existing handoff based on this audit alone.

### AUD-02 — Restore commits atomically, but validation and ownership reads precede the commit transaction

**Priority: P0 investigation / P1 hardening · Service-level invalid-ledger acceptance reproduced; concurrency impact needs DB reproduction.**

- `src/server/services/workspaceRestoreService.ts` validates record IDs, workspace identity and a protected settings denylist; it checks foreign IDs with `db.getAll`, queries rows to delete, and later calls `db.batch().commit()`.
- The server batch is atomic for its queued writes, **not a snapshot transaction containing those earlier reads**. The service also accepts arbitrary record objects rather than validating every restored financial shape through transaction/document schemas. A checksum is not business validation or proof that closed-period history matches.
- **Reproduced at the service boundary (fake DB, no durable writes):** restoring a `completed` transaction with lines `+100` and `−90` returned `counts.transactions = 1` and queued that unbalanced record. This establishes missing service validation, not an end-to-end production exploit.
- **Impact to investigate:** another workspace claims a previously absent ID between precheck and batch set; a concurrent posting is omitted from the deletion snapshot; malformed/unbalanced supplied ledger rows are restored. Backup export reads tables separately, so it is not necessarily a single point-in-time snapshot either.
- **Next change:** explicit maintenance/restore policy and transaction-scoped ownership/version checks, server-side schema/referential/ledger validation, protected-setting allowlist/versioned backup format, coherent export snapshot. Preserve compatibility deliberately.
- **Acceptance:** real Postgres interleaving tests for foreign-ID creation, new posting during restore, and close-date changes; reject malformed ledger/document relations with zero partial writes; restore → re-export → report/stock invariants. Existing backup tests are necessary but not a substitute for these concurrency cases.

### AUD-03 — RMA decisions/history remain editable metadata, not server approval authority

**Priority: P1 · Confirmed, honestly documented limitation (A-66).**

- `ReturnAuthorizationsPanel.tsx` runs pure transition/request checks and writes a nested customer metadata field through `useEntityOperations.updateEntity`. The database enforces who may edit the record, not a trusted RMA decision state machine or actor history.
- **Impact:** UI two-person rules do not establish server-enforced requester/approver separation, CAS or immutable history. Two editors can replace the same metadata record from stale versions.
- **Next change:** dedicated validated transition endpoint/service taking expected revision and authenticated actor; append protected events transactionally. Keep annotations separate from actual receipt/credit/stock posting.
- **Acceptance:** forged actor, requester approval, skipped state, stale revision and two-browser race refused; exactly one event commits; viewer/nonmember refusal; existing financial stock workflow unchanged.

### AUD-04 — Scheduled-report pre-marking trades duplicate avoidance for lost delivery and is not a concurrent claim

**Priority: P1 · Confirmed source behavior; crash/concurrent-run reproduction pending.**

- `scheduledReportService.ts:runScheduledReports` reads the workspace schedule marker, updates `scheduledReportsSent.<id>` **before** rendering/sending, then catches delivery failures. A preexisting period marker causes future daily runs to skip the period. `sendReport` records failed recipients only in its return/log path.
- Marking first is not exactly-once delivery. A crash after the marker loses mail; two runners can both observe the old value before either update. A failed recipient is not automatically retried by the next run of that period.
- **Next change:** durable per-period/per-recipient outbox, atomic claim/lease, retry/backoff and explicit delivered/failed states; use provider idempotency where supported. Say “queued” versus “sent” accurately.
- **Acceptance:** crash before send, provider timeout after acceptance, partial recipient failure, concurrent daily invocations, replay and manual send; report scope/currency preserved.

### AUD-05 — Standalone background-job coverage differs from Vercel

**Priority: P1/P2 deployment correctness · Confirmed.**

- `server/http/serveApp.ts` installs daily maintenance/error-digest timers and a boot-time recurring run. `server/routes/cronRoutes.ts` runs a larger list including reminders, statements, reports, health checks, alerts, watches, notification digest and retention. `vercel.json` schedules that route.
- **Impact:** deploying with `npm start` alone does not schedule the complete Vercel daily behavior. A boot recurring pass is not daily recurrence.
- **Next change:** document the supported scheduler contract per deployment and centralize the job registry without blindly running both timers and cron. Durable claims must tolerate repeated/concurrent invocations.
- **Acceptance:** standalone fixture advances a day and executes every promised job; Vercel and standalone use the same registry; missing CRON_SECRET visibly disables external job access; no duplicate effects across replicas.

### AUD-06 — Security suites are outside ordinary unit-test discovery

**Priority: P1 verification gap · Confirmed by package scripts and direct execution.**

- `npm test` and `test:cov` include `src/tests/*.test.ts`, `src/tests/*.test.tsx`, `src/lib/*.test.ts`. They omit `src/server/utils/safeFetch.test.ts` and `fileValidation.test.ts`.
- `scripts/eslint-warning-ratchet.test.mjs` is also outside `npm test`, but CI runs it explicitly; it is **not** missing from CI. No equivalent explicit CI invocation was found for the two utility suites.
- Those two security suites plus the ratchet suite were run separately here: **14 tests pass on Node 24**, zero skips. Passing now does not fix future discovery.
- **Next change:** explicit test manifest or controlled recursive discovery with guard test. Keep browser tests and scripts out of accidental recursive unit execution.
- **Acceptance:** add a harmless intentional failing fixture in each location to prove CI discovers it, then remove the fixture; check coverage include/exclude rules, runtime and test count expectations.

### AUD-07 — Generic and bulk idempotency have weaker replay identity than payment posting

**Priority: P1 investigation/hardening · Confirmed source differences; endpoint impact requires contract review.**

- `server/utils/idempotency.ts:executeIdempotent` returns a stored successful result for the scoped ID without checking a request-payload hash or matching the current metadata actor. The key includes workspace/operation, which is useful but not complete replay identity.
- `transactions/bulkRoutes.ts` uses `${wsId}_${idempotencyKey}` and cached `body`, without a payload/actor comparison. It correctly has an in-transaction replay check, so it should **not** be described as merely a non-atomic preflight cache. However, that inner check occurs after entity/transaction/stock reads and “ID already exists” checks; simultaneous duplicate requests can reach a different refusal path on retry. Reproduce the exact sequence before promising transparent replay.
- `paymentService.ts:createPaymentIdempotent` is the stronger local example: operation-scoped key, actor and payloadHash checked, result written with payment in the same transaction.
- **Next change:** specify semantics per command; normalize/hash payload deliberately, bind actor, reject conflicting reuse with 409, and check replay before expensive/duplicate-sensitive work within the transaction. Do not break legacy clients silently.
- **Acceptance:** same actor/same payload, changed actor, changed payload, cross-operation key reuse, crash/retry and concurrent duplicate request; one monetary effect and stable replay response.

### AUD-08 — Bulk validation reads workspace locks outside its posting transaction

**Priority: P0 investigation for closed-period race · Investigate, not a reproduced bypass.**

- The bulk route obtains `wsDoc/wsData` and calls `TransactionValidator.validateAndPrepare` before its `db.runTransaction` callback. Contrast `periodCloseService.ts`, which reads workspace and relevant ledger state inside its transaction.
- A SERIALIZABLE transaction cannot detect a conflict on a row read only outside it. Other helpers invoked during posting may add relevant reads, so trace the precise no-stock/simple-journal case rather than assuming every bulk post is affected.
- **Next change:** make the definitive period/role/config validation depend on transaction-scoped workspace state at commit. Keep preflight validation for UX if wanted.
- **Acceptance:** deterministically pause a simple bulk request after validation, hard-close/revoke role, then release it. Prove the chosen serialized order cannot leave a posted entry in a completed closed snapshot. Test concurrent reopen/exception expiry too.

### AUD-09 — Privileged server access means SQL client guards are not a universal safety net

**Priority: P1 architectural control · Confirmed design, not itself a vulnerability.**

- `pgFirestore.ts` uses a privileged DB login; the initial migration's `lf_is_client`/guard logic distinguishes browser claims from trusted server access. Both permissions and field/business invariants therefore need server checks.
- **Next change:** retain a route→auth→workspace→role→lock→schema→service checklist. Harden command services, not just React disabled buttons or RLS. Keep `ledgerDoor` and validator adoption guards; review deliberate restore/import exemptions separately.
- **Acceptance:** every write family tested as nonmember/viewer/wrong-workspace API key, with foreign account IDs, closed dates and invalid input. Success mocks alone are insufficient.

### AUD-10 — Report fallback and cache completeness need one visible provenance contract

**Priority: P1 · Confirmed distributed design; individual screen failure states need further runtime audit.**

- `useFinancialReporting.ts` returns `null` on server errors so callers may retain local calculations. Collection caps include 20,000 transactions, 10,000 invoices/bills/payments, 5,000 contacts and 500 audit logs. Exact cap hits mean “possibly incomplete,” not proof of complete history.
- The statement screen is a concrete gap (AUD-01); other reports use different guards/fallbacks. Do not claim every report is wrong or every cap is unsafe.
- **Next change:** typed `ReportScope` + `{ source, completeness, asOf, error }` envelope; shared report frame; preserve a last-good scoped answer only when clearly labeled. Prevent an old workspace/request from painting the new one.
- **Acceptance:** cap exceeded, collection failure, slow old request, workspace switch, offline server, cash/accrual selection, CSV/PDF/drilldown all carry the same scope and provenance.

### AUD-11 — Safe-fetch DNS validation is not a pinned connection

**Priority: P1 security investigation · Confirmed implementation gap; exploitability not established here.**

- `safeFetch.ts` validates DNS answers, then calls ordinary `fetch(inputUrl)`, which performs its own connection resolution. Redirects are correctly disabled and a timeout exists. There is no visible resolution pinning between check and use.
- The IPv6 helper handles dotted IPv4-mapped forms but not every hexadecimal spelling; URL literal bracket handling and DNS canonicalization need end-to-end tests before asserting an actual bypass.
- **Next change:** narrow destination allowlists for known providers, reviewed IP canonicalization and a connection strategy binding validation to destination (or controlled outbound proxy). Preserve TLS hostname verification and timeout behavior.
- **Acceptance:** deterministic DNS rebinding/change-between-check-and-connect, IPv4-mapped IPv6 encodings, credentials/ports, redirects, timeout and blocked targets; no real internal services required. First fix utility-test discovery (AUD-06).

### AUD-12 — Static Vercel CSP can disagree with the configurable Supabase project

**Priority: P1/P2 deployment portability · Confirmed configuration mismatch, not a tested deployment outage.**

- `lib/db/client.ts` supports `VITE_SUPABASE_URL`; `server/http/securityMiddleware.ts` derives connect-src from server Supabase config. `vercel.json` separately hardcodes one Supabase https/wss project host for all responses.
- **Impact:** changing the client project can produce browser CSP failures on static hosting; server and edge headers can also diverge. Multiple policies restrict cumulatively.
- **Next change:** single reviewed source/generation strategy for deployment headers; verify built frontend and server point at intended matching project. Do not solve portability with unrestricted connect-src.
- **Acceptance:** deploy an alternate test project configuration and assert effective CSP plus browser auth/data/realtime connection; compare static and API headers.

### AUD-13 — Async auth-derived UI state has no identity generation check

**Priority: P1/P2 investigation · Confirmed race opportunity; server escalation not demonstrated.**

- `stores/useAuthStore.ts:setUser` starts `getIdTokenResult().then(set isAdmin)` without verifying that the same user is still current. `checkTokenAdminClaim` has a similar async result path. Workspace changes clear ledger cache, which is good, but sign-out/account-switch timing is a separate axis.
- **Impact:** a late response from the previous account can paint stale admin UI. This is **not evidence of a server authorization bypass**; server auth remains authoritative.
- **Next change:** identity epoch/cancellation and complete sensitive UI/cache cleanup on user change; do not reset shared session state based on an obsolete result.
- **Acceptance:** pending admin token request → sign out → login viewer → old token resolves; no stale privileged UI/data appears and every server action is refused correctly.

### AUD-14 — A registered receipt algorithm is a hard-coded demonstration

**Priority: P1 product honesty / P2 feature completion · Confirmed.**

- `lib/algorithms/receipt-capture.ts` exposes `RECEIPT_CAPTURE_ALGO` and is registered by the algorithm index. Its `compute` uses a hard-coded Home Depot OCR example, with no receipt text input. `parseReceiptOCR` is a real heuristic helper, but the interactive algorithm is not ingesting the user's receipt.
- The insight “90% accuracy” has no evaluation evidence in that file. It should not be presented as a measured production guarantee.
- **Next change:** clearly label it an example or add explicit OCR text input and a representative evaluation corpus. Keep it separate from actual AI receipt ingestion paths; do not conclude that all receipt handling is fake.
- **Acceptance:** two supplied receipts yield independently checked distinct merchant/date/amount outputs; ambiguous totals/date/currency are warnings, not confident posts; remove unsupported accuracy claims or link an evaluation.

### AUD-15 — Client post-success cache inserts request entries rather than a canonical server result

**Priority: P2 investigation · Confirmed source behavior.**

- `services/ledgerPost/postingKit.ts:postTxsServerApi` appends request transactions to the current store after success. There is no ID upsert in that line and no captured user/workspace equality check before the append. Server validation can normalize request data, and the live subscription may also deliver entries.
- **Impact to reproduce:** duplicate cached rows from replay/subscription timing, stale completion repopulating a switched workspace, or transient differences from server-normalized values. Existing workspace resets and live updates may limit duration but do not replace an explicit contract.
- **Next change:** identity/workspace guard plus ID-based upsert of canonical returned entries or scoped invalidation. Never alter durable postings to fix a cache artifact.
- **Acceptance:** fast repeated save, idempotent replay, realtime-before-response, workspace change during request, server-normalized date/lines; cache and report counts remain stable.

### AUD-16 — Planning documents disagree with the code and each other

**Priority: P1 workflow efficiency · Confirmed.**

- Early coordination entries C-102…C-126 still ask to put helpers on screens. Current registry/capability evidence already includes barcode scanning, quote versions, record notes, landed cost, recurring estimates and more. Root AGENTS already warns that its initial five priorities are complete. `TODO_2.md` is intentionally a broad completion list, not fresh per-feature verification.
- **Impact:** a future agent following the first unchecked line can duplicate screens and increase navigation complexity instead of finishing handoffs.
- **Next change:** one current status/owner/evidence/remaining-gap row per capability; archival messages stay historical. Lead validates reachability and behavior before ticking items. Reconcile plans without rewriting history or moving owner release buckets autonomously.
- **Acceptance:** each active queue points to a specific missing boundary and its acceptance test; implemented screen tasks point at registry and runtime evidence; no fresh work starts from a stale unchecked request.

### AUD-17 — The audit/build numbers show a maturity bottleneck, not a shortage of tools

**Priority: P2 incremental architecture/performance · Measured in this audit.**

- Build output: main index chunk about **973 kB uncompressed / 300 kB gzip**, ExcelJS about **938 kB / 271 kB gzip**, vendor visualization about **494 kB / 132 kB gzip**. PWA precache reports **324 entries / 6,916.74 KiB**. These are artifact sizes, not measured first-load or Core Web Vitals.
- Source has large UI/DB/route hotspots and broad shared-store dependencies. A literal file-size ceiling does not establish cohesive behavior; splitting a file merely to satisfy the 800-line ratchet can retain all coupling.
- **Next change:** profile initial authenticated/guest routes and update costs; preserve lazy feature imports; inspect why entry bundle is broad before changing chunks. Use incremental extraction around tested boundaries, not a framework/database rewrite or mass component renaming.
- **Acceptance:** trace/bundle baseline on representative data and slow device/network, no stale offline assets across deployment, measured improvement without broken plugin/navigation/report behavior.

### AUD-18 — Quality ratchets are useful bounds, not launch-readiness metrics

**Priority: P2 process clarity · Confirmed.**

- Package/CI lint cap is 212; actual lint here has 210 warnings. `quality-baseline.json` also contains an `eslintWarnings: 3` metric and `untestedViews: 44`; `scripts/quality-metrics.ts:computeEslintWarnings` actually counts source suppression markers (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`), not ESLint diagnostics. The name is misleading. Do not equate those numbers to the all-repo ESLint total or runtime screen coverage.
- Bug-pattern baseline includes accepted heuristic counts (swallowing action 96, stale async 81, silent catch 54, etc.); those are scanner budgets, **not 96/81/54 independently confirmed defects**. The separate ledger-door baseline is zero direct writes under its scanner definition; special validated/exempt paths still deserve review.
- **Next change:** attach definition/scope/owner to each metric; reduce existing findings with targeted behavior tests, without raising baselines. Keep Node 24 and real Postgres verification distinct from a no-database local pass.
- **Acceptance:** one current evidence table records exact command, runtime, database availability, pass/fail/skip and commit. A historical red E2E job is not waived as “just visual” without comparing exact failures.

### AUD-19 — Altman analytical EBIT loses reversal signs

**Priority: P1 analytical correctness · Reproduced with the actual compute function on Node 24.**

- `src/lib/algorithms/altman-z-score.ts` adds `Math.abs(lineAmount(...))` for revenue and subtracts absolute expense/COGS. A reversing revenue debit is therefore counted as more income rather than undoing the original credit.
- **Independent signed-line fixture:** cash assets 10,000 minor units, liabilities 2,000, equity 8,000; a completed sale has cash `+1,000` / revenue `−1,000`; its separate completed reversing entry has cash `−1,000` / revenue `+1,000`. Both entries pass `isPostable`; together revenue nets to zero.
- **Observed actual outputs:** no entries → EBIT/assets **0.0%**, score **9.45**; sale → **10.0%**, **10.12**; sale plus exact reversal → **20.0%**, **10.79**. The paired result should return to zero EBIT contribution, not double it. This is a compute-only reproduction; no persisted books were touched.
- Also review current-balance vs selected-period input semantics and document the chosen coefficient/cutoff model. The file mixes formula variants in its comments and makes strong statistical-risk statements without calibration evidence here. That model-validation concern is separate from the reproduced sign error.
- **Next change:** financial owner corrects signed revenue/cost contribution with independent hand-number fixtures; trace same pattern in related analytics without assuming every `Math.abs` is wrong. Never “fix” it by changing posting signs or weakening expected amounts.
- **Acceptance:** sale+reversal, expense+reversal, credit/refund, mixed currencies and selected-period/opening-balance fixtures; invalid/insufficient inputs must not produce a confident bankruptcy prediction. Do not treat analytical recommendations as audited solvency advice.

### AUD-20 — Remote database TLS does not authenticate the server unless a CA is supplied

**Priority: P1 security/deployment hardening · Confirmed with the actual pure config function; no network connection made.**

- `src/server/db/pgFirestore.ts:poolConfigFromEnv` sets remote SSL to `{ rejectUnauthorized: false }` when `DATABASE_CA_CERT` is absent. With a CA supplied it uses `{ ca, rejectUnauthorized: true }`. It also removes URL SSL flags so this policy is decisive.
- The pure function was called here with a synthetic remote `.invalid` hostname and no CA: it returned exactly `rejectUnauthorized: false`. Startup assertions do not require the CA, so this is a possible configured production mode, not merely a test-only branch.
- **Impact:** transport encryption without certificate verification does not establish the identity of the database peer. This audit did not observe an interception or inspect production CA settings.
- **Next change:** require verified remote TLS in production via the correct CA/system trust contract; if a development exception is necessary, make it explicit and unavailable in production. Update startup checks/runbook together rather than blindly breaking existing deployment certificates.
- **Acceptance:** valid CA/hostname connects; wrong CA, wrong hostname and untrusted certificate fail; missing production trust configuration fails clearly; isolated local Postgres tests remain supported. No credentials or production endpoints are needed for config-unit tests.

## Execution strategy

### First: make a release decision from evidence, not checkbox volume

This audit recommends sequencing, not implementation authorization. Respect current financial/server/form reservations in `docs/COORDINATION.md`; this audit does not assign those lanes to a new agent.

| Stage | Work package | Exit criteria | Suggested ownership boundary |
|---|---|---|---|
| 0 — establish truth | Reconcile queue/capability gaps; capture exact current CI/E2E failures, applied migrations and verified DB TLS configuration; add omitted utility suites | One current blocker/evidence list; no ambiguous historical “pass”; discovery proved | Lead + verification owner |
| 1 — protect existing answers/writes | Shared statement scope; signed analytical reversal regression (AUD-19); reproduce close/post and restore races; harden restore input/ownership; consistent replay identity | Independent money/scope fixtures + real DB interleaving tests; no changed legacy expected amounts to hide failures | Financial/server owner |
| 2 — finish authoritative workflows | RMA transitions/CAS; durable send outbox and scheduler deployment contract; identity-safe async cache updates | Forged/stale requests refused, retries observable, no duplicate effects, workspace switch safe | Server + scoped UI owner |
| 3 — prove main journeys | First hour, invoice/payment/bank match/report, month close/backup/restore, accountant review | Authenticated persisted browser round trips with refusals and recoveries; 390px/320px and Hebrew mixed data | Journey owner with financial review |
| 4 — reduce friction | Shared report scope/provenance/frame, navigation grouping, consistent input/dialog/error states, explicit demo labels | Same scope through all exports; reachable useful controls; no draft loss; no unsupported claims | UI/report owners |
| 5 — scale selectively | Measure bundles/queries/job duration; complete specific reserved bundle/unit/serial/credit/dunning handoffs | Customer need + measurable outcome + operational boundary tests | Owning feature lane |

Do not allocate dates from this audit without owner/team capacity. Dependency order matters more than an invented estimate: statement PDF contract precedes entity statement UI; RMA authority precedes enforced approval claims; outbox/claim semantics precede promised reliable automated email; restore correctness precedes calling backup a recovery guarantee.

### Definition of done for the next work item

1. User can reach it through an existing registered path; no duplicate screen for a capability already present.
2. Scope (workspace/entity/period/basis/currency/completeness) is explicit from input through output.
3. Authenticated server or DB authority validates mutations; UI-disabled controls are only a convenience.
4. Integer units, FX, reversals, stock, locks and account ownership remain independently verified.
5. Duplicate activation, stale async completion, refused saves and retries retain correct draft/identity behavior.
6. Persist, reload and reopen succeeds against migrated Postgres; viewer/nonmember/foreign-workspace writes fail.
7. Browser evidence covers keyboard/focus, phone and mixed Hebrew data where relevant; provider claims need provider evidence, not mocks alone.
8. Exact commands/runtime/commit and skipped boundaries are recorded; baselines and numeric expectations were not loosened.

### What not to do next

- No database/framework rewrite, second state-management stack or parallel “simple app.” Preserve progressive disclosure within one app.
- No new generic direct financial metadata editor. Existing posting/transition services remain the boundary.
- No automatic cleanup of “unreferenced” files from this import graph; check Vite globs, registries, CLI and deployment entrypoints first.
- No blind screenshot-baseline refresh, warning-budget increase or green-all-suite claim when DB/browser/provider tests were absent.
- No new country filing/compliance promises from dated tables or review worksheets alone. Source availability and formula tests do not certify legal applicability.
- No merging/deploying from this audit. The current changes are documentation only.

### Read-only reproduction recipe for the three observed boundary behaviors

Run from the repository root with dependencies installed and **Node 24**. This invokes pure compute/config functions and a restore service with a fake database. It does not connect to a database/provider, post money, or change application files. This is an audit probe, not a replacement for permanent regression tests.

```bash
NODE_ENV=test node --import tsx --input-type=module <<'JS'
import { ALTMAN_Z_SCORE_ALGO } from './src/lib/algorithms/altman-z-score.ts';
import { restoreWorkspaceBackup } from './src/server/services/workspaceRestoreService.ts';
import { poolConfigFromEnv } from './src/server/db/pgFirestore.ts';

const accounts = [
  { id: 'cash', type: 'asset', balanceCents: 10000, category: 'Cash' },
  { id: 'debt', type: 'liability', balanceCents: -2000, category: 'Payables' },
  { id: 'equity', type: 'equity', balanceCents: -8000 },
  { id: 'sales', type: 'income', balanceCents: 0 },
];
const accounting = {
  isAsset: id => id === 'cash', isCash: id => id === 'cash', isAR: () => false,
  isLiability: id => id === 'debt', isAP: id => id === 'debt',
  isEquity: id => id === 'equity', isRevenue: id => id === 'sales',
  isExpense: () => false, isCOGS: () => false,
};
const entry = {
  id: 'sale', workspaceId: 'audit_fixture', date: '2026-10-01',
  status: 'completed', type: 'income', totalAmountCents: 1000,
  lines: [{ accountId: 'cash', amountCents: 1000 }, { accountId: 'sales', amountCents: -1000 }],
};
const reversal = { ...entry, id: 'reversal', lines: entry.lines.map(l => ({ ...l, amountCents: -l.amountCents })) };
for (const transactions of [[], [entry], [entry, reversal]]) {
  const result = ALTMAN_Z_SCORE_ALGO.compute({ transactions, accounts, accounting,
    asOfDate: '2026-10-16', period: { start: '2026-10-01', end: '2026-10-16', days: 16 },
    reportingCurrency: 'USD' }, {});
  console.log('AUD-19', transactions.length, result.metrics);
}

const writes = [];
const emptyQuery = { where() { return this; }, async get() { return { docs: [] }; } };
const db = {
  collection(name) { return {
    doc(id) { return { id, collection: name, async get() { return { data: () => ({}), exists: true }; } }; },
    where: emptyQuery.where.bind(emptyQuery),
  }; },
  async getAll() { return []; },
  batch() { return { delete() {}, set(ref, data) { writes.push({ ref, data }); }, async commit() {} }; },
};
const restored = await restoreWorkspaceBackup(db, 'audit_fixture', {
  schemaVersion: 1, transactions: [{ ...entry, id: 'bad-entry', totalAmountCents: 100,
    lines: [{ accountId: 'cash', amountCents: 100 }, { accountId: 'sales', amountCents: -90 }] }],
});
console.log('AUD-02 fake-DB acceptance', restored, writes[0]?.data.lines);

const oldCa = process.env.DATABASE_CA_CERT;
try {
  delete process.env.DATABASE_CA_CERT;
  console.log('AUD-20 config only', poolConfigFromEnv({
    connectionString: 'postgresql://audit:example@db.example.invalid:5432/audit',
  }).ssl);
} finally {
  if (oldCa === undefined) delete process.env.DATABASE_CA_CERT;
  else process.env.DATABASE_CA_CERT = oldCa;
}
JS
```

Snapshot output: AUD-19 EBIT/assets `0.0% → 10.0% → 20.0%`; AUD-02 accepts/queues the unbalanced record with `counts.transactions: 1`; AUD-20 returns `{ rejectUnauthorized: false }`. The fake restore DB does not prove durable SQL acceptance; the TLS probe never connects. Preserve these distinctions in later issue reports.

## Verification performed for this audit

All results below belong to the unchanged source snapshot named at the top of this document. No application fixes were applied after a failure or to manufacture a pass.

| Check | Fresh result / limitations |
|---|---|
| Inventory and fingerprints | **2,134 / 2,134 unique entries**; every original file fingerprint matches the still-unchanged checkout; **1,922 JS/TS-family parses**, zero parse diagnostics |
| Dependencies | `HUSKY=0 npm ci --ignore-scripts` completed; package/lock unchanged. Initial sandbox runtime was Node **22.22.3**, not the project's required 24 |
| Typecheck + ESLint | `npm run lint` on initial Node 22: **pass, 0 errors / 210 warnings**, below unchanged cap 212. This is not claimed as a separate Node-24 lint run |
| Production build | `PATH=<external Node24 bin>:$PATH npm run build` on **Node 24.22.0**: **pass**; Vite client/PWA and esbuild server emitted. Artifacts stay ignored |
| Unit suite with standard repository globs | **Node 24.22.0**, `NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic node --import tsx --test --test-concurrency=4 src/tests/*.test.ts src/tests/*.test.tsx src/lib/*.test.ts`: **2,707 tests pass, 0 fail/cancelled, 725 reported suites**, about **481.7 seconds**. No coverage flags used |
| Database-dependent suites | **Not exercised**: `LF_TEST_DATABASE_URL` unset, no local Postgres available. Output contains **124 database-dependent suite skip notices**. Node's final leaf-test summary says `skipped 0`; that must **not** be mistaken for database coverage. Historical 3,095-test real-DB evidence was not rerun here |
| Omitted utility/security suites + warning ratchet | Node 24 direct run of `src/server/utils/safeFetch.test.ts`, `src/server/utils/fileValidation.test.ts`, `scripts/eslint-warning-ratchet.test.mjs`: **14 pass, 0 fail/skips** |
| Focused audit probes | Documented recipe rerun successfully: actual Altman compute sign behavior, fake-DB restore acceptance and pure remote-TLS config behavior reproduced. These are boundary probes, not three new committed regression tests |
| Dependency audit | `npm audit --json`: **2 moderate findings** (`qs`, `typed-rest-client`), **0 high/critical**; `npm audit --omit=dev --json`: **0 vulnerabilities**. No dependency updates/audit fix performed |
| Real DB / RLS / migration application | **Not run** in this audit. Do not infer production schema/index presence from checked-in migrations |
| Browser / visual / accessibility runtime checks | **Not run** in this audit; no baseline refresh. Browser test files were indexed, not executed. Historical red E2E status in handoff docs is not freshly verified or waived |
| Coverage thresholds, mutation, timezone matrix, load tests, CodeQL | **Not run** here. Existing CI/configuration was read; prior reports are not substituted for fresh runs |
| Live providers / legal rates / production | **Not accessed or verified**. No emails, payment requests, bank calls, real restores or production writes |

A preliminary `npm test` on Node 22 exceeded the single command wait and continued; it was intentionally stopped before completion when the correct Node 24 runner was prepared. It is **not counted as a completed test run**. The completed Node 24 run above uses the same file globs with an explicit concurrency setting before the paths. Temporary audit scripts, logs, runtime installation and generated build artifacts are outside tracked source; the deliverable at that stage was this Markdown file. The subsequent atlas PR also adds offline tools, canonical artifacts and read-only CI checks; those are validated separately in the atlas guide.

## Hotspots and inventory totals

| Area | Tracked files | Text line spans |
|---|---:|---:|
| `src/components/` | 448 | 82,659 |
| `src/lib/` | 438 | 51,276 |
| `src/server/` | 202 | 28,814 |
| `src/services/` | 25 | 3,206 |
| `src/hooks/` | 39 | 5,466 |
| `src/stores/` | 9 | 1,902 |
| `src/model/` | 4 | 1,615 |
| `src/tests/` | 620 | 63,892 |
| `e2e/` | 90 | 3,693 |
| `supabase/` | 37 | 2,448 |
| `scripts/` | 15 | 1,406 |
| `docs/` | 53 | 17,185 |
| `archive/` | 54 | 1,322 |

These categories do not exhaust the root/other support files. Components include **448 tracked files**, lib **438**, server **202**, tests **620**; raw file count does not tell us which features are complete.

Inventory source bytes: **26,083,828**; binary files: **45**; reviewer-annotated entries: **109**. Remaining entries are explicitly content-derived notes, not individually certified reviews.

### High fan-in shared files

| File | Runtime/tool/config direct importers (excluding test/archive) | All direct importers |
|---|---:|---:|
| `src/lib/utils.ts` | 411 | 434 |
| `src/types.ts` | 388 | 567 |
| `src/stores/useAuthStore.ts` | 272 | 391 |
| `src/stores/useLedgerStore.ts` | 247 | 405 |
| `src/firebase.ts` | 166 | 168 |
| `src/server/db/firestore.ts` | 149 | 276 |
| `src/lib/txFilters.ts` | 147 | 164 |
| `src/hooks/useLedgerCollections.ts` | 136 | 136 |
| `src/hooks/useCurrentRole.ts` | 94 | 96 |
| `src/hooks/useDialog.ts` | 77 | 78 |
| `src/lib/csvExport.ts` | 77 | 85 |
| `src/lib/accountUtils.ts` | 76 | 81 |
| `src/lib/db/firestore.ts` | 73 | 75 |
| `src/stores/useUIStore.ts` | 71 | 93 |
| `src/lib/periodLock.ts` | 67 | 70 |
| `src/lib/algorithms/types.ts` | 62 | 66 |
| `src/lib/reportCustomPeriod.ts` | 60 | 60 |
| `src/server/services/auditLogService.ts` | 56 | 56 |

Import counts include syntactic type edges and entrypoint/tool references, not actual execution frequencies. Review these before broad renames or model changes.

### Largest live implementation files

| File | Line span |
|---|---:|
| `src/components/sales/InvoiceModal.tsx` | 800 |
| `src/components/sales/Sales.tsx` | 800 |
| `src/server/routes/workspaceRoutes.ts` | 799 |
| `src/components/ledger/StatementImporter.tsx` | 768 |
| `src/components/ledger/ProfitAndLossView.tsx` | 766 |
| `src/components/ledger/JournalEntryModal.tsx` | 764 |
| `src/components/intelligence/IntelligenceCenter.tsx` | 748 |
| `src/lib/db/firestore.ts` | 731 |
| `src/components/hr/PayrollView.tsx` | 715 |
| `src/components/platform/settings/RulesSettingsView.tsx` | 714 |
| `src/server/db/pgFirestore.ts` | 712 |
| `src/components/inventory/Inventory.tsx` | 702 |
| `src/components/ui/SavedViewsManagerModal.tsx` | 690 |
| `src/components/ledger/Ledger.tsx` | 684 |
| `src/services/strategicEngine.ts` | 664 |
| `src/components/purchases/BillModal.tsx` | 663 |

## Canonical per-file atlas

Per-file reviewer notes, Git blob identities, AST declarations, imports, callsites, data candidates, workflow references and verification suggestions live only in [CODE_ATLAS.jsonl](CODE_ATLAS.jsonl). Use the [query/refresh guide](CODE_ATLAS.md); do not paste the entire database into a task prompt.

The historical inventory/hotspot counts above do not assert current file coverage, full manual inspection, deployment readiness or feature completion.
