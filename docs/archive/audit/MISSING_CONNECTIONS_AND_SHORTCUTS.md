# Missing Connections and Shortcuts

**Target revision:** `9aed5466c4691c5c55c6d4dbec0565d88dbc8462` (`main`)  
**Purpose:** Identify where existing LedgerFlow code stops short of a complete, user-visible, authoritative workflow. This is a research map, not permission to change reserved files or build replacement systems.

## Executive summary

The main pattern is **unfinished handoff**, not absence of feature code: many libraries, routes and reports already exist, but preview → authoritative action, current scope → export, stale client cache → server result, or settings → document form does not always connect. Preserve the code and keep partial work discoverable; connect existing pieces where their contracts are sound. Do not hide or disable a feature simply because its final handoff is missing.

The priority gaps are:

1. Financial answers and posting boundaries: BUG-01 through BUG-07 in `VERIFIED_BUG_REPORT.md`.
2. Report scope/provenance and statement PDF/email parity (BUG-02, BUG-04, AUD-10).
3. Retry-safe invoice posting and converted-FX balance enforcement (BUG-03, BUG-07; persistence/route tests still required).
4. A small set of enabled but unhandled/miswired UI buttons (BUG-06).
5. Scheduled mail reliability and scheduler parity (AUD-04/AUD-05).
6. RMA approval authority and restore snapshot/ownership boundaries (AUD-03/AUD-02).
7. Tax/locale helper libraries that still are not connected to supported document forms, return-review screens or a clearly bounded filing workflow.
8. Stale agent queue/capability documentation that can prompt duplicate work (AUD-16).

## Connection inventory

### 1. UI controls: wire existing behavior without making partial work disappear

The AST inventory contains **3,440 interactive JSX declarations** (not a runtime count). **2,313** handlers were statically resolved and **1,127** remain unresolved, dynamic, prop-driven or otherwise not traced. A browser suite was not run. The enabled button declarations listed below were source-checked as having no direct/form/ancestor action path; a separate “Close Period” control bubbles to selection rather than closing.

| Existing UI | What is present | Missing connection / safe completion |
|---|---|---|
| `src/components/commercial/PricingPage.tsx:100` | Registered pricing/plans view and tier labels | Tier buttons have no handler. Reuse the existing billing checkout path in `BillingSettings` or route the user there. Keep every tier visible; do not imply selection works until it does. |
| `src/components/finance/FiscalPeriodManager.tsx:200,284` | Period cards, a separate “Hard Close Period” action, and a year-end section | Hover-only “Close Period” triggers the card parent’s `setSelectedPeriod`; it does not close. “Run Year-End Wizard” has no handler. Preserve the working close action; wire/label the other controls honestly. |
| `src/components/finance/TaxManager.tsx:254` | “Fiscal Export” button | No action path. Connect to the already-used tax export helper/route only after checking its scope, or leave it visibly marked incomplete. |
| `src/components/finance/Consolidation.tsx:42` | “Export Report” button | No handler path. Reuse `src/lib/csvExport.ts` with the screen's consolidation scope; do not introduce a second export implementation. |
| `src/components/forensics/ForensicAudit.tsx:263` | “Generate Full Audit Log” button | No handler path. Trace whether the intended data comes from the existing audit-log service/route and respect admin scope; do not point at an unrelated endpoint merely to make the button clickable. |
| `src/components/ledger/ProjectProfitabilityView.tsx:134,184` | “Maximize” icon and “Export Node” action | Neither has an action path in the declaration. Reuse the shared CSV helper for export; for maximize, either implement the expected state or label it incomplete. |
| `src/components/platform/StressTestPanel.tsx:64` | “Latest Events” filter toggle | Toggle has no setter/action; connect the existing filter state rather than adding a parallel filter. |
| `src/components/platform/settings/DeveloperSettings.tsx:88` | “Provision New Endpoint” CTA | No handler path; an existing API Hub/API-key provisioning experience exists elsewhere. Point to the correct existing screen/route, or clarify the control's state. |
| `src/components/projects/ProjectsView.tsx:288` | “Generate Brief” CTA | No action path. No verified brief-generation route was established; do not fabricate one. Keep visible as incomplete until the user-facing output contract exists. |

The UI report IDs are `UI00001`–`UI03440` in `EVERY_UI_ACTION_MAP.csv`. The two public route-probe 404s are not missing routes: they are expected responses to synthetic invalid invoice/estimate tokens.

### 2. Sales and ledger posting: close identity, authority and cache gaps

| Current path | Already exists | Missing connection / acceptance |
|---|---|---|
| Invoice save → `postInvoiceLedger` → `postTxsServerApi` → `/api/v1/transactions/bulk` | One server transaction persists the entity and ledger rows; server validates transaction IDs and request identity | BUG-03: client-loaded transaction history chooses reversals; stale retries mint fresh transaction IDs and idempotency keys. Add server-owned invoice revision/action identity or CAS and prove one durable effect for retry/concurrency in PostgreSQL. |
| Successful post → local `useLedgerStore` | Client cache is updated immediately | BUG-05: local cache prepends the request instead of upserting canonical response rows. Use ID-based upsert or scoped invalidation plus a workspace/user generation check; prove subscription/replay/switch races. Do not alter durable journals to fix a cache artifact. |
| FX transaction → `TransactionValidator` → reports | FX-aware `lineAmount`, per-line rates, raw `DoubleEntryValidator`, and FX posting tests exist | BUG-07: the validator's raw zero-sum check is not the later converted base-currency sum. Finance owner must set the rounding/clearing contract; enforce it at the server boundary and test synthetic rates through route + DB. |
| Imported bank file → client dedup → bulk import | Parser/preview, ID-unique server writes, import UI | AUD-22: source duplicate check is against loaded transaction cache; server uniqueness is by generated row ID, not source fingerprint. Add a stable server-side source fingerprint only after defining legitimate same-day/same-amount duplicates and verifying pagination/cap behavior. |
| Customer/vendor save → `syncEntityBalance` | Recalculation from open documents exists | AUD-21: refresh is fire-and-forget and failures only `console.warn`; expose stale/refresh state or invalidate the cached balance, and verify it against the ledger. It is a denormalized display balance, not posting authority. |
| Payment create → `handleCreatePayment` | Atomic route/service and a stronger operation-ID/payload-hash replay path exist | Legacy callers can omit an operation ID and use `createPaymentAtomic`; inventory first-party callers and require a stable key on retryable UI actions. Test same key/same body, changed body, actor change and lost response. |

### 3. Reports, statements and exports: one scope from heading to answer

- **BUG-02:** report hook failures become `null`; report screens can retain old `serverData`/`isServerAuthoritative`. Bind each response to workspace, date/as-of, basis, comparative scope and request generation. A stale response may be retained only as explicitly labeled last-good data, never under a new heading.
- **BUG-04 / AUD-01:** `StatementView` has selected dates; `statementService.loadStatement` hard-codes 1970–2099 and feeds PDF/email. Define whether a statement action is full history or selected period, then pass the same `StatementScope` through screen, JSON, PDF, email and opening balance. Avoid building a new statement implementation.
- **AUD-10:** different screens fall back to local cached data and collection caps. Add a shared scope/provenance envelope such as `{ source, workspaceId, period, basis, completeness, asOf, error }`; report when a cap may truncate, preserve an explicit failure state and avoid cross-workspace late responses.
- **Report export buttons:** Tax Manager and Consolidation have dead actions; existing `csvExport` helpers are the preferred connection. Verify the filters/rates/tax status are identical to the visible report.
- **Record register vs report scope:** the account register drills into loaded entries with caps while full-history server reports use a different scope; identify the source and completeness at the drill-down boundary instead of silently implying parity.

### 4. Operations and background jobs

- **AUD-04:** scheduled report period marker is written before email send. A failed send is not automatically retried for that period; the marker is not an atomic concurrent claim. Reuse report building but add a durable per-period/per-recipient outbox/claim, retry state and observable delivery status.
- **AUD-05:** standalone `serveApp.ts` installs a maintenance timer, error-digest timer and boot recurring run. Vercel `cronRoutes.ts` runs a larger registry (14 job entries in the current route). Use one registry/explicit deployment contract; do not blindly run both schedulers and duplicate effects.
- **Dunning:** `DunningLettersReportView` is a preview/list. Sending, once-per-step log and saved workspace schedule remain in server email paths. Connect only with explicit recipient confirmation, server authorization, idempotency, log and retry state; do not present preview as delivery.
- **Recurring estimates:** current Reports path previews repeat schedules/drafts. The estimate form's repeat control and recurring job are separate; connect the existing path rather than creating another scheduler.
- **Mail/provider flows:** source routes and unit tests are not proof of live mail. Keep provider-dependent actions visible, show “not configured”/failure/queued vs sent truthfully, and verify provider sandbox behavior before promising delivery.

### 5. Restore, RMA and server trust

- **AUD-02:** restore now rejects unbalanced ledger entries before writes, but foreign-ID ownership and deletion-snapshot reads are outside the final transaction. Complete transaction-scoped ownership/version checks and schema/relation validation; test concurrent posting/restore, close-date changes and zero writes on rejection.
- **AUD-03:** RMA requests/decisions/events are nested metadata changed via generic entity updates. Use a server-owned transition endpoint with authenticated actor, expected revision, requester/approver separation and append-only decision events. Keep receipt, inventory and credit posting in their existing services.
- **AUD-07:** generic `executeCommand` and bulk posting bind actor/request hash, but three direct `executeIdempotent` calls in `adminRoutes.ts` omit `payloadHash`. Pass the canonical hash and test mismatched replay; do not assume the tracker checkbox covers every direct helper caller.
- **AUD-09:** server DB access is privileged; browser RLS/SQL client guards are not the universal boundary. Maintain a route → authenticated identity → workspace → role → lock → schema → business invariant → transaction audit for every mutation family.

### 6. C-102 through C-126 connection queue: distinguish completed wiring from real remaining work

`docs/COORDINATION.md` leaves the 25 C-102…C-126 lines unchecked. Current code/capability evidence shows many are already wired in a later revision; do not duplicate those screens. Some tasks still refer to a genuine second-stage handoff or an internal-only helper. This table is a source check, not browser/target-database proof.

| Queue item(s) | Current connection evidence | Correct remaining action |
|---|---|---|
| C-102 barcode scan | `barcodeScan.ts` is used by cycle-count and landed-cost report views (CAPABILITIES row 175) | Update stale queue state after reconciling owner/test requirements; browser scan-device behavior is unverified here. |
| C-103 comment threads | `commentThreads.ts` is used by `RecordNotesPanel` and Record Notes report (row 147) | Mark connection accurately; retain comments vs plain notes as separate concepts. |
| C-104 custom fields | Settings/report path and migration exist (row 173) | Partial: check migration deployment; fields are not shown on the reserved customer/vendor/item forms or those exports. Do not edit reserved forms without coordination. |
| C-105 quotes / C-106 delivery notes | Customer Quotes report/portal and Delivery Notes report views (rows 177,176) | Existing connections; keep signing/provider and document semantics explicit. |
| C-107 dunning | Dunning letters list/preview exists (row 169) | Partial: connect confirmed send to existing email/log path with retry/recipient authority; preview is not “sent.” |
| C-108 landed cost / C-109 milestone billing | Preview/report views exist (rows 174,167) | Partial: no landed-cost posting is claimed; milestone invoice action stays in the order workflow. Connect only to the existing posting/ordering contract. |
| C-110 price-list import | Settings screen with preview/undo uses existing route (row 170) | Existing connection; test guest refusal and save/undo against the target DB. |
| C-111 record notes | RecordNotesPanel/report are present (row 171) | Existing connection; CAPABILITIES row 151 still contradicts it. Reconcile documentation without changing the feature. |
| C-112 recurring estimates | Customer Quotes report previews schedule/drafts (row 146) | Partial: estimate form repeat control and scheduled creation are separate; no new scheduler. |
| C-113 reorder suggestions | Report can draft purchase orders through `addEntity` (row 168) | Connected with limits: items never purchased cannot be drafted; verify draft-only semantics. |
| C-114 serial/lot numbers | Serial/lot lookup report is connected (rows 149/172) | Partial: recording serials on invoice/receipt lines is still a separate document-form handoff. |
| C-115 entity filings / C-116 IL VAT return / C-117 Israeli document types / C-118 Israeli identifiers / C-119 PCN874 draft / C-120 tax suggestions | Helpers and unit tests exist; no direct screen caller was found in current `src` search; many are only exported from `workspaceExports.ts` | Keep labeled as internal/calculation/fixture paths. Connect to an accountant-reviewed tax-profile/document/return-review UI only when source, period, jurisdiction and refusal cases are specified. PCN874 fixture draft is not an authority filing. |
| C-121 US 1099 preview | Indirectly consumed by vendor-1099 readiness and golden fixtures; report exists (row 189) | Do not claim the preview helper itself is an e-file/form; no W-9 collection or filing path is established. Update stale queue wording. |
| C-122 US filing calendar / C-123 US sales-tax return | Calendar/return helpers and tests exist; no direct screen caller was found | Keep the calendar as planning and return as calculation until jurisdiction/entity periods, evidence, export and review are connected. No filing/payment. |
| C-124 US tax ID format / C-125 VAT number format / C-126 US address state/ZIP | Parsers/format helpers and tests exist; no form caller was found in current `src` search | Connect to the correct customer/vendor/entity editor and preserve country-specific validation; do not imply authoritative tax-ID/VIES verification. Respect reserved form files. |

### 7. Tax, locale and compliance boundaries

- `FEATURE_COMPLETENESS_MATRIX.csv` captures the current 193 numeric rows parsed from `docs/CAPABILITIES.md` plus 17 audit-only rows. Many capabilities are explicitly “Available with limits,” “Partial,” “Internal, test or demo only,” or “Placeholder”; keep these labels visible.
- Tax tables, registration watch, withholding rules and return previews are not equivalent to jurisdictional advice, complete tax calculation, e-filing or payment. The current golden fixtures cover only specified IL/US cases; the app does not thereby support every state/country, locality, exemption, reverse-charge fact or statutory period.
- Several C-115…C-126 libraries have tests without a direct screen caller; tests establish helper behavior only. Connect each rule to a verified seller/entity profile, actual document lines, sourced date range and review/export boundary before calling it supported.
- Use fictional entities/transactions and explicit jurisdiction fixtures for tests. Do not “solve” unsupported jurisdictions by guessing a rate or hiding their existing modules.

### 8. Documentation and navigation mismatches

- `docs/COORDINATION.md` still presents C-102…C-126 as unstarted even though many have screens. Reconcile each item with current view registry, evidence, owner and true remaining acceptance; preserve the message history.
- `docs/CAPABILITIES.md` has 193 numeric rows but only 190 unique numeric IDs: rows 162, 163 and 164 each occur twice. This makes `docs/CAPABILITIES.md#162` etc. ambiguous; the CSV's FC IDs remain unique. Assign unique durable capability IDs before using those row anchors as implementation keys.
- Capability rows 151 and 171 contradict each other for record notes; rows 152 and 173 contradict each other for custom fields. Treat the later source evidence as a correction candidate, not permission to silently erase the old row.
- Some report views place many specialized tools under a large Reports tab. Before adding navigation, test findability and “what action is safe here?”; do not add another dashboard layer just to expose a helper.

## Route and data-map interpretation

- The static backend map has **282 path/method patterns**; the live local `createApp()` Express stack had **279 route objects**. Three additional static patterns are array-path variants, not three proven runtime routes missing from the app.
- The actual-method HTTP probe covered **169 concrete client URL patterns**. The two remaining 404s are public invoice/estimate lookups with synthetic invalid tokens. Status counts are 2×200, 3×400, 47×401, 115×403, 2×404. The app was probed locally without valid user/provider credentials: these responses do not prove authenticated workflow success or every route's role guard.
- An additional static scan found 15 dynamic URL callsites that could not be assigned a concrete probe path. The current route map is a discovery aid; path matching, helper indirection, browser rendering and runtime conditions remain limitations.
- `DATABASE_OPERATION_MAP.csv` lists **1,403 AST callsite candidates**. These are not 1,403 individually reviewed/verified queries. Account scope, transaction boundary, row-level security and effects must be inspected at the actual route/service.

## Recommended connection order

1. **Stop misleading money answers:** BUG-01, BUG-02, BUG-04, BUG-07; get finance-owner sign-off on signed FX/rounding contracts.
2. **Make retries safe:** BUG-03 and the AUD-07 missing-hash callers, then BUG-05 cache reconciliation.
3. **Make operations recoverable:** AUD-04 outbox/atomic claim; AUD-05 one scheduler contract; restore AUD-02/RMA AUD-03 authority boundaries.
4. **Connect visible controls:** BUG-06 using existing checkout/export/close paths; no fake endpoint; keep unfinished controls visible with explicit status.
5. **Reconcile the stale backlog:** C-102…C-126, capabilities rows and screen callers; keep genuinely incomplete handoffs open.
6. **Verify with tools available to the tester:** real PostgreSQL, browser and sandbox-provider runs; record the exact resulting evidence before any real-record pilot.

No application code was changed for this report.
