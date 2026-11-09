# AI #6 security-lane audit — 2026-11-05 (final report of the two-session audit)

**Author:** AI #6 (security lane, S-1…S-40). Review-only: **no money, posting, tax, migration or
`src/server/**` behaviour changed by this audit.** Owner: Shmuel. Merge/acceptance decisions are his
and AI #1's.

**Pins:**
- Session 1 (Arena, same lane): upstream `main` `dca9b65ba2778f544c304bdd2d83ecd08acee47b` — live route
  walk against a disposable Postgres 17 (all 51 migrations, RLS suite green), runtime route inventory
  of 330 declarations, `npm audit` 0 high/0 critical. Evidence: Google Drive checkpoint
  `2026-11-05_Agent6_Ledgerflow_SecurityAudit_CKP01.md` (folder "Ledgerflow Agent Backups").
- Session 2 (this session, upstream `main` `7550f2ba26bb63a96fdf8914441aa7fe516540f8`): every finding
  below re-verified against the current source through the GitHub API (exact files read, quotes and
  mount lines reproduced). No test suite was executed in session 2 — the executed-suite evidence is
  session 1's, and the two pins are named separately so nothing is overstated.

## 1. Verified controls (spot-checked at `7550f2b`, all present)

| Control | Where | Status |
|---|---|---|
| Shared cross-instance rate limiter (S-01/S-22 base): Postgres table, hashed keys, serializable check-and-increment, fails closed | `src/server/middleware/sharedRateLimiter.ts`, `rateLimiters.ts`, migration `20261021000000` | Present |
| Generic caps: 1,000/15 min `/api/*` (mounted `app.use("/api/", limiter)`), 100/min `/api/v1/*` (`apiLimiter`), brain 20/min, public invoice 30/min, PDF 10/min | `server.ts`, `rateLimiters.ts` | Present, confirmed in `server.ts` at `7550f2b` |
| CSP tightened policy report-only first + `POST /api/csp-report` (S-23) | `contentSecurityPolicy.ts`, `cspReportRoutes.ts`, `vercel.json` | Present (`registerCspReportRoutes(app)` mounted before limiter/CSRF in `server.ts`) |
| Webhook signature verification (S-31): Stripe `constructEvent`, Plaid JWT + timestamp, email token `timingSafeEqual` | `stripeWebhookRoutes.ts`, `plaidWebhookRoutes.ts`, `emailRoutes.ts` | PASS (session 1, unchanged paths) |
| Admin writes audited (S-26): `PUT /admin/workspaces/:id`, `PUT /admin/users/:id[/role]`, `PUT /admin/global-config` all call `writeAuditLog` | `adminRoutes.ts` | PASS — re-read at `7550f2b`, audit calls confirmed in all three handlers |
| API keys: `lf_<keyId>.<secret>`, SHA-256 + `timingSafeEqual`, scope map, quota fails closed | `src/server/auth/apiAuthenticate.ts` | Strong (session 1) |
| CSRF: origin/referer allowlist + custom-header/Bearer requirement; narrow webhook exemptions | `src/server/middleware/csrf.ts` | Confirmed at `7550f2b` (see F-05) |
| Cron auth: `CRON_SECRET` constant-time, path pre-validated | `auth/systemJobAuth.ts`, `routes/cronRoutes.ts` | Strong (session 1) |
| RLS: 75 document tables with row level security, security-definer helpers, `lf_rules` guard trigger | `supabase/migrations/20260924190000_init.sql` | Strong (session 1, RLS suite green on Postgres 17) |
| Upload content validation on `/api/upload-bank-csv`: `validateUploadedFile(filePath)` before parse, temp file unlinked on every failure path | `src/server/routes/logsUploadRoutes.ts` | Confirmed at `7550f2b` — partial delivery of S-30 |

## 2. Findings — each re-verified at upstream `main` `7550f2b`

### F-01 · MEDIUM — AUD-09 access tests cover named routers, not the whole app stack
`src/tests/aud09-write-access.test.ts` walks only `workspaceRouter`; `aud09-outside-routers.test.ts`
covers a hand-written list of 12 mounts; `aud09-app-routes.test.ts` covers only API-key routes.
App-level write routes outside those routers (e.g. `/api/v1/ledger`, `/api/v1/auth/*`,
`/api/v1/bank/map`, `/api/v1/forensics/anomaly-scan`, `/api/upload-bank-csv`, `/api/v1/admin/*`)
have **no AUD-09 test net**. Session 1 inspected each by hand and found none open; the gap is the
test coverage, not a live hole. Cheapest permanent fix: make the recorder enumerate the **app**
stack (it already patches the express Router prototype globally) and fail on any new app-level write
route with no named guard. (Carried from session 1's live walk at `dca9b65`; test files unchanged
between pins.)

### F-02 · MEDIUM — `authRateLimiter` is exported but mounted nowhere; `/api/ai` routes have no dedicated limiter
Confirmed at `7550f2b`:
- `src/server/middleware/rateLimiters.ts` defines `authRateLimiter` (5/15 min/IP) and
  `publicInvoiceLimiter`, `pdfGenerationLimiter`, `brainRateLimiter` — but `server.ts` imports and
  mounts only `publicInvoiceLimiter`, `pdfGenerationLimiter`, `brainRateLimiter` (+ generic
  `limiter`/`apiLimiter`). `authRateLimiter` has **no mount point** anywhere (GitHub code search:
  3 hits — definition, the 28 Oct S-22 evidence doc, `sharedRateLimiter.ts`).
- `app.use("/api/ai", aiRouter); app.use("/api/v1/ai", aiRouter);` are mounted with **no dedicated
  limiter** — only the generic 1,000/15 min `/api/*` and 100/min `/api/v1/*` caps — while
  `/api/v1/brain` has its dedicated 20/min `brainRateLimiter`. Both AI routers expose expensive
  Gemini tasks (12 routes each surface: strategic-analysis, parse-receipt, …).
- Browser sign-in/sign-up/reset call Supabase Auth directly; there is no server-side sign-in route,
  so server-side per-user sign-in limiting is currently impossible by design (provider limits apply).

**Recommendation (server lane — AI #1/owner decide):** add a dedicated `aiRateLimiter` in the exact
shape of `brainRateLimiter` and mount it on both `/api/ai` and `/api/v1/ai`; either mount
`authRateLimiter` on a future `/api/v1/auth/*` surface or delete it and document that sign-in is
provider-limited. No change made by this audit (review scope).

### F-03 · LOW — `POST /api/v1/admin/integrity/orphan-scan` is authenticated but not admin-gated
Confirmed verbatim at `7550f2b` in `src/server/routes/adminRoutes.ts`:
`app.post("/api/v1/admin/integrity/orphan-scan", authenticate, …)` — every other `/api/v1/admin/*`
route in the same file uses `authenticate, requireAdmin`. Not a privilege hole today: the handler
resolves `workspaceId` from body/query/`developerWorkspaceId` and `getReportContext()` calls
`authorizeWorkspace`, so only a member of the named workspace can run it. But the URL advertises an
admin surface and a future edit could wrongly assume the guard.
**Recommendation:** add `requireAdmin` or move it out of `/api/v1/admin/`.

### F-04 · LOW — `POST /api/upload-bank-csv` is not workspace-role-gated at the route
Confirmed verbatim at `7550f2b` in `src/server/routes/logsUploadRoutes.ts`:
`app.post("/api/upload-bank-csv", authenticate, upload.single("file"), …)` — no
`requireWorkspaceRole`/writer guard at the route. Mitigations confirmed in code: the upload passes
`validateUploadedFile()` before parsing; the parsed rows are **returned, not persisted**; the temp
file is unlinked on every path; `assertWorkspaceAccess` is called only when a `workspaceId` was
supplied, and only to read the workspace timezone. Residual exposure: any authenticated user of any
workspace gets an unmetered (beyond generic `/api/*`) CSV parse/compute surface.
**Recommendation:** add a writer-role check or a dedicated limiter.

### F-05 · INFO — CSRF exemption list is explicit and narrow (recorded, no action)
Confirmed at `7550f2b` in `src/server/middleware/csrf.ts`: `ignoredPrefixes = ['/api/webhook/',
'/api/v1/workspaces/webhooks/', '/api/v1/public/', '/api/ai/', '/api/v1/ai/']` plus
`ignoredPaths: [/^\/api\/v1\/email-events\/?$/]` in `server.ts`. Each exempted surface carries its
own authenticator (webhook signatures S-31; public invoice limiter; email provider token). One
extra observation to keep on the radar: a request bearing a `stripe-signature` header bypasses the
custom-header/Bearer requirement (needed for Stripe webhook raw-body flow; the webhook route itself
verifies the signature). Recorded so no reviewer has to re-derive it.

### F-06 · INFO — 29 document tables have no `lf_rules` row (RLS still applies; uncapped keys)
From session 1's migration walk at `dca9b65`: only 38 of 67 tables get an explicit `lf_rules` row;
without one, the guard trigger applies no key allowlist, so a member with the right role can write
arbitrary keys into `data` for `bankLines`, `vendors`, `estimates`, `budgets`, `employees`,
`payRuns`, `inventory`, `fixedAssets`, `taxRates`, `recurring`, `autoRules`, and others (server-only
collections are gated by client RLS policies instead). **Recommendation:** `lf_rules` rows with
`allowed_keys` for client-writable collections; deny policy for server-only ones. Migration is
AI #1's lane.

## 3. S-lane status after this audit (for the queue)

| Task | Status |
|---|---|
| S-01 shared rate limiter | Done (merged, live in `sharedRateLimiter.ts` + migration) |
| S-02 prod settings check, S-03 restore drill script, S-04 SBOM, S-05 idempotency audit | Merged 21 Oct (#266–#270) |
| S-23 CSP tightened report-only | Done (S-22 review confirmed live) |
| S-22 per-user limits on sign-in/reset/AI | **Open — F-02 is the concrete delta** (no dedicated AI-route limiter; `authRateLimiter` unmounted) |
| S-24 gitleaks in CI | Open (`.gitleaks.toml` from #396 does not parse and had no workflow; worth its own small PR) |
| S-25 npm-audit CI gate | Confirmed present in `.github/workflows/ci.yml` (session 1); S-25 can be ticked when CI-visible |
| S-26 admin action audit rows | Verified PASS in code at `7550f2b` |
| S-27…S-36 | Open (S-30 partially delivered via `validateUploadedFile` on the CSV upload path) |
| S-37…S-40 (AUD-09 access tests) | Preflight done 21 Oct; real-Postgres adversarial matrices still to run (session 1 re-ran the RLS suite green; the four route-level matrices are not yet executed as tests) — plus F-01's coverage gap |

## 4. Honest statement of what was and was not run

- **Session 1 (pin `dca9b65`)** executed: `npm ci`, all 51 migrations on fresh Postgres 17,
  `npm run test:rules` (all RLS tests passed), `npm audit` (0 high/0 critical), live Express route
  walk (330 declarations). Its full-suite/browser runs had not finished at checkpoint time and are
  **not** claimed.
- **Session 2 (pin `7550f2b`, this file)** executed: source-level verification of every finding and
  control above through the GitHub API (exact file reads and searches, quotes reproduced). **No
  npm/test/browser runs were executed in session 2** and none are claimed here.
- Push limitation of session 1 (no git credentials in its sandbox) is resolved by session 2: this
  report is committed to the fork branch named in the PR and the upstream PR is linked in the Drive
  checkpoint `2026-11-05_Agent6_Ledgerflow_SecurityAudit_CKP02.md`.

## 5. Recommendations to Shmuel / AI #1 (priority order)

1. **F-02**: dedicated limiter on `/api/ai` + `/api/v1/ai` (same shape as brain's) — cheap, closes
   the only unmetered expensive-compute surface. Server lane: AI #1.
2. **F-01**: extend the AUD-09 recorder to the app stack so new app-level write routes fail CI
   without a named guard — the permanent fix for the coverage gap, test-only change.
3. **F-03 / F-04**: one-line guards (`requireAdmin`; writer-role check on the CSV upload) — small
   server PRs, AI #1's lane.
4. **F-06**: `lf_rules` rows for client-writable collections — migration proposal, AI #1's lane.
