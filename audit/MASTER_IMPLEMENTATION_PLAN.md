# Master Implementation Plan — LedgerFlow

**Plan against:** `main` at `9aed5466c4691c5c55c6d4dbec0565d88dbc8462`  
**Status:** Research/sequence only. No application implementation, ownership assignment or production operation was performed by this audit. Follow `AGENTS.md`, `docs/COORDINATION.md`, reserved-file rules and existing release buckets when work is assigned. Do not change money math without the financial owner.

## Guiding principles

1. **Finish and prove existing flows before adding breadth.** Reuse posting services, report calculators, shared export helpers, existing route guards, job services and UI views where sound.
2. **Financial truth comes before UI polish.** Write the independent expected amount and state-transition contract before editing implementation.
3. **One authoritative scope and identity.** Every report/export carries the same workspace/date/basis/currency; every retried mutation has a stable actor/request/business-revision identity.
4. **DB and browser are gates, not optional evidence.** A unit mock cannot establish PostgreSQL transaction behavior, applied migrations, browser scope or provider delivery.
5. **Keep unfinished work visible.** Label previews, placeholders, experimental tools and disconnected controls; do not hide or disable them merely because they are incomplete. Restrict only actions whose real-record execution could compromise security, correctness or stored data.
6. **Small, reviewable changes.** One invariant or handoff per change, owning tests first, no broad DB/framework rewrite, no baseline increase to make a failing check appear green.

## Release-blocking work packages

### Stage 0 — Build the verification floor before changing money paths

**Purpose:** Replace the current “cannot verify here” boundary with reproducible synthetic DB/browser evidence.

- Provision a disposable PostgreSQL/Supabase test project, never production data. Record DB version, migration version/checksum, test auth configuration and reset procedure.
- Run `src/tests`/Postgres suites and `supabase/tests/rls.test.sql`; make absent DB configuration visible in the test output/CI rather than counting skip notices as passes.
- Install a pinned Chromium/Playwright runtime; identify the focused current browser failures before broad visual work.
- Create stable synthetic fixtures: USD/EUR, distinct per-line FX rates, opening balance, sale/credit/reversal, expense/refund, invoice with payment, bank import, customer statement, closed period, two roles and two workspaces.
- Preserve exact commands and PASS/FAIL/SKIP counts in the progress ledger. Keep no production credentials/secrets in files or test logs.

**Exit gate:** A clean disposable DB applies migrations and passes the targeted RLS/transaction setup tests; a browser run completes one read-only journey; failures are recorded, not waived.

### Stage 1 — Financial correctness and reporting scope (P0)

| Order | ID / work package | Existing code to start from | Required acceptance before merge |
|---|---|---|---|
| 1 | **BUG-07 — FX base-currency balancing contract** | `TransactionValidator`, `DoubleEntryValidator`, `lineAmount`, existing FX posting tests | Finance owner specifies raw transaction currency, base-currency conversion, rounding and FX-clearing treatment. Add server-boundary cases for line rates 1.083/1.087 and multi-line rounding. Invalid residual refuses before write or is explicitly balanced by an authorized rule; no report can show a nonzero ledger sum. Run in-memory and PostgreSQL route tests. |
| 2 | **BUG-03 — invoice posting idempotency / revision CAS** | `invoicePosting.ts`, `postingKit.ts`, bulk transaction handler, `invoiceService`/document mutation contract | Stable server-owned operation/revision identity; retry after lost response, same action in two tabs, edit-while-stale, changed payload and true replay all have one expected durable effect. Document + journal + stock commit atomically; no client cache is used as the concurrency authority. |
| 3 | **BUG-01 — signed reversal totals** | `calculateFilteredTotals`, `TransactionTotalsRow` | Sale/reversal and expense/refund fixtures meet independent gross inflow/outflow expectations; normal payment, transfer, credit note and FX totals remain unchanged. Test function and browser grid; journal postings remain untouched. |
| 4 | **BUG-02 — scoped authoritative reports** | `useFinancialReporting`, four report screens | Request/response includes workspace + period/as-of + basis + comparison + generation. After success(A) then failed B, A is not shown as B; no old request paints a new workspace. Explicit loading/error/local-fallback/completeness provenance. Test each statement and comparative branch. |
| 5 | **BUG-04 / AUD-01 — shared statement scope** | `StatementView`, `statementService`, document routes, email service, shared report computation | Define selected-range vs full-history intent. Same transaction list, opening balance and ending balance in screen, JSON, PDF and email. Date/time-zone inclusive boundaries and credit/payment edge cases. Confirm all delivery paths use the one contract. |
| 6 | **AUD-19 — signed Altman EBIT** | `src/lib/algorithms/altman-z-score.ts` | Sale+reversal returns EBIT contribution to zero; expense+reversal, credit/refund and FX cases behave with signed lines. Establish period vs current-balance semantics and qualify/un-calibrate “bankruptcy probability” claims. Do not treat score as accounting advice. |

**Stage exit:** all above tests pass on Node 24; BUG-03/BUG-07 and report export paths pass against disposable PostgreSQL; browser verifies date/basis/workspace switching. No real-book release until each has traceable evidence.

### Stage 2 — Recovery, replay identity and authority boundaries (P0/P1)

| Work package | Current state | Acceptance |
|---|---|---|
| **AUD-02 — restore transaction boundary** | Unbalanced ledger records are now rejected before writes. Ownership reads and delete snapshot remain outside final transaction. | Move authoritative ownership/version/deletion checks into a transaction/serializable maintenance contract; validate allowed record shapes and references; refuse malformed backup with zero writes; deterministic interleavings for foreign-ID claim, new posting, period close and restore; export/restore/report/stock invariants all match. Keep the working restore visible. |
| **AUD-07 — residual idempotency callers** | Generic `executeCommand` and bulk posting now use actor/request identity; 3 direct `adminRoutes.ts` calls omit payload hashes. | Audit every `executeIdempotent` caller; pass canonical payload hash or explicitly reject un-fingerprinted replay. Test same key/same body, same key/different body, actor change, cross-operation reuse, crash and concurrent request; stable 409/refusal semantics. |
| **AUD-03 — RMA state authority** | UI transition logic and metadata history exist; generic save does not establish server two-person authority/CAS. | Server transition command accepts actor + expected revision; enforces requester/approver split and allowed transitions; appends immutable event in same transaction; rejects forged actor, stale state, wrong customer/order; never substitutes for receipt/stock/credit posting. |
| **BUG-05 — client cache canonicalization** | Cache currently prepends request transactions after success; duplicate ID probe reproduced. | Apply canonical response with ID upsert scoped to current workspace/user generation; test realtime-before-response, replay, response after switch, server-normalized fields and report totals. No durable journal mutation. |
| **AUD-21 — party balance refresh** | Customer/vendor cached balance refresh is fire-and-forget and logs errors. | Make refresh/invalidation observable and retriable; compare against server party reports after save, payment, credit, deletion and workspace switch. Ledger stays authoritative. |
| **AUD-22 — import source fingerprint** | Client dedup checks loaded transaction cache; server unique ID does not guarantee source de-duplication. | Design stable fingerprint contract for imports and define legitimate duplicate handling; test duplicates beyond load cap/pagination, two concurrent imports, same-day same-amount distinct lines and server refusal/report. Do not discard valid same-amount activity. |

### Stage 3 — Security and deployment configuration (P1)

1. **AUD-20 — remote DB TLS:** require verified remote TLS/CA/system trust in production; fail startup clearly on unsafe config; wrong CA/hostname and missing production CA must fail; local disposable Postgres remains usable.
2. **AUD-11 — safe fetch:** bind address validation to actual connection or use reviewed provider allowlist/egress proxy; test DNS answer changes, IPv4-mapped IPv6 spellings, private/reserved targets, redirects, timeout and blocked credentials without contacting internal hosts.
3. **AUD-12 — CSP:** define one deployment configuration source for Supabase/API/provider origins; test effective static + server response headers, with least privilege; avoid widening `connect-src` to all hosts.
4. **AUD-13 — identity epoch:** cancel/drop async admin-derived results after sign-out/user/workspace change; clear sensitive UI/cache; prove server checks refuse any stale UI action.
5. **AUD-09 — write-family review:** maintain a route → identity → workspace → role → period → schema → account/entity ownership → atomic mutation → audit/idempotency matrix. Do not assume RLS catches a privileged service bug.

**Stage exit:** security/authorization tests pass in browser and DB; production-shaped TLS/CSP configuration is observed in a staging deploy. No claim of production security from source alone.

### Stage 4 — Reliable jobs, communications and provider status (P1)

- **AUD-04:** replace pre-mark-before-send with a durable per-period/per-recipient outbox and atomic claim/lease, retry/backoff and idempotent provider semantics where supported; represent queued/sent/failed separately.
- **AUD-05:** centralize the daily job registry or publish a precise per-deployment contract; standalone and Vercel must execute the intended set exactly once across replicas. Do not blindly add duplicate interval timers.
- Keep recurring, dunning, scheduled statements/reports and notification jobs separately observable. Per-job failure should not falsify the overall success state.
- Use provider sandbox credentials only. Test a crash before send, provider timeout after acceptance, partial recipient failure, overlapping runs, secret unavailable and manual re-send.

### Stage 5 — Finish visible controls and actual feature handoffs (P2 after financial gates)

#### UI controls

For BUG-06, source-check the control and connect only to an existing appropriate path:

- Pricing CTA → established BillingSettings checkout.
- Fiscal Period “Close Period” → actual close action or an honest period-selection label; year-end wizard stays visible as incomplete until its owner supplies an action.
- Tax/Consolidation/Forensic/Project exports → shared CSV/audit service with screen scope and permission tests.
- Project maximize → actual local view state or visible incomplete state.
- Developer Endpoint CTA → existing API Hub/provision route after authorization checks.
- Stress Test “Latest Events” → existing filter state.
- Projects “Generate Brief” → do not invent a route; leave discoverable as incomplete until output/product contract exists.

**Acceptance:** keyboard and pointer trigger the same intended action; failures do not toast success; filters/export include current scope; unresolved features remain visible with clear status.

#### C-102…C-126 and capabilities

- Reconcile unchecked C-102…C-126 against current view registry and `CAPABILITIES.md`; many are already connected (barcode, comments, quotes, delivery notes, price-list import, reorder, etc.). Do not create duplicate screens.
- Preserve partial boundaries: custom fields are in settings but not reserved record forms; dunning is preview vs send; recurring estimates are preview vs form/job; serial numbers are lookup vs line capture; landed cost is preview vs posting; milestone is report vs invoice path.
- Keep tax-only helpers visibly internal/calculation-only until the tax owner supplies verified jurisdiction, source/date, entity-period, document integration, report/export and refusal requirements.
- Fix unique numeric IDs in `CAPABILITIES.md` (193 rows, 190 unique IDs) and reconcile rows 151/152 with 171/173. Keep old history; establish stable IDs and evidence rather than silently overwriting.

### Stage 6 — Measure performance and clarify quality evidence (P2)

- Profile guest/authenticated route startup, slow-device/network behavior, large workspaces, report query timing, PWA cache update and offline recovery. Current bundle measurements are build artifacts only.
- Keep current lazy feature loading; change chunking only when a measured profile justifies it and route/E2E tests preserve behavior.
- Rename/document the `quality-baseline.json` suppression-marker metric that is currently called `eslintWarnings`; report actual ESLint diagnostics separately. Do not raise the 212-warning cap or use static heuristic counts as confirmed bugs.
- Keep exact test environment and database/browser/provider availability beside every pass count.

## Minimum regression matrix

| Invariant | Pure/unit | PostgreSQL/RLS | Browser/E2E | Provider/deployment |
|---|---|---|---|---|
| Reversal and FX balances | Signed sale/expense/refund; line conversion and rounding | Actual route rejects/balances per approved contract | Grid/report displays expected direction | N/A |
| Invoice retry | Stable operation contract and changed-payload refusal | Lost-response/two-tab race: one durable business effect | Save twice, slow/failed response, workspace switch | N/A |
| Report and statement scope | Selected date/opening/comparative calculations | Server rows scoped by workspace/date | Error, switch, PDF/email/CSV parity | Email test recipient only |
| Restore | Schema/ledger fixtures | Interleaving and zero-write refusal; reopen invariant | Backup/restore screen recovery | N/A |
| Access control | Role/schema helpers | RLS + privileged route tests for wrong workspace/nonmember/viewer | Stale auth identity and route refusal | Staging TLS/CSP |
| Scheduled send | Period and idempotency rules | Outbox claim/retry/concurrency | Status/recipient UX | Mail sandbox failure/retry |
| Import dedupe | Fingerprint and valid duplicates | Concurrent source-import uniqueness | Same file reimport past cap | Bank provider sandbox only |

## Already resolved; do not re-add as open tasks without new evidence

- **AUD-06:** `src/server/utils/*.test.ts` is included in the ordinary test script.
- **AUD-08 (bulk path):** workspace/lock state is re-read and checked inside the bulk commit transaction. This is specific to inspected bulk posting; it does not certify all other mutation routes.
- **AUD-02 restore validation:** unbalanced entries are rejected before queued writes. The remaining ownership/snapshot transaction boundary is still open.
- **AUD-07:** generic command and bulk idempotency improvements exist; direct admin callsites and invoice document-level retry identity remain open.

## Definition of done before real-record pilot

A pilot proposal should include current revision/build; all P0 regression results; PostgreSQL migration/RLS version; browser/screenshots/logs; restore drill; correct TLS/CSP configuration; provider sandbox receipts; supported jurisdiction matrix; known unfinished feature list; recovery/support owner; and an explicit user approval of the remaining risks. A green build, 2,799 unit passes, static route map or “all capabilities” count alone is not a release decision.
