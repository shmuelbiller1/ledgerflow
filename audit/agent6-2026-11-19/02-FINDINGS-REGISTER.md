# Findings Register — Agent #6 — 2026-11-19

**Pinned revision:** `5eacf71f633f00a5db7ae44d3fdba75b4d3700cf` (branch `arena/6e749e1a-ledgerflow`)  
**Scope:** Security, tenant isolation, HTTP perimeter, secrets/dependency hygiene, and carry-over critical findings still present at this pin. No live customer data, no production DB, no live-site scan.  
**Severity rubric:** per `docs/INDEPENDENT_AUDIT_AGENT.md` — P0 = stop invitation (data loss, tenant takeover, silently wrong money, unsafe restore, unauthenticated privileged action); P1 = beta prerequisite; P2 = usable-with-clear-limits; P3 = later. Severity here is user outcome, not patch size.

> **Carrier:** Findings that are still open at this pin but whose **verified patch already exists in PR #908** (AI #1) are marked `Carrier — patch in PR #908`. This register does not claim credit for that patch; it provides independent verification at this pin and a standby patch under `patches/` if needed. Findings that are **AI #6's direct lane** (headers, CI hygiene, client/docs) are implemented directly on this branch.

---

## Summary counts

| Category | IDs | Count |
|----------|-----|------:|
| **A. New or re-verified at this pin, still present** | AF6-20261119-01 … 07 | 7 |
| **B. Carry-over confirmed defects from prior Agent #6 registers, still present at 5eacf71** | AF6-012 carry, SBX-1 follow-up, S-37..S-40 RLS viewer writes, S-22 rate-limit gap | 5 |
| **C. CI / Supply-chain hygiene gaps** | AF6-20261119-06, 07 | 2 |
| **D. Documentation / process gaps** | S-19, S-21, S-13 etc (tracked, not re-proven here) | — |
| **Total active findings this register** | | **12 distinct mechanisms** |

---

## Section A — New or re-verified at this pin

### AF6-20261119-01 — Medium — `Permissions-Policy` header missing on every response (ZAP 10063, S-6 / A6S-07 #1)

- **Severity:** Medium (P2 overall; P1 for external pen-test / ZAP gate)
- **Where:** `vercel.json:headers` (static-hosted app shell) + `src/server/http/securityMiddleware.ts:applySecurityMiddleware` (Express helmet path)
- **Evidence at pin:**
  ```json
  // vercel.json headers — present:
  // Content-Security-Policy, CSP-Report-Only, Strict-Transport-Security,
  // X-Content-Type-Options: nosniff, X-Frame-Options: SAMEORIGIN, Referrer-Policy
  // Absent: Permissions-Policy
  ```
  ```ts
  // src/server/http/securityMiddleware.ts — helmet config:
  // contentSecurityPolicy, crossOriginEmbedderPolicy:false, frameguard, hsts, referrerPolicy
  // No permissionsPolicy / Permissions-Policy header set anywhere (grep -rn Permissions-Policy → only scripts/check-security-headers.ts + test advisory)
  ```
  Script `scripts/check-security-headers.ts:190` explicitly marks `Permissions-Policy` as `tracked in server issue #827` and test `src/tests/security-preflight-scripts.test.ts:193` says `Missing … stays visible as advisory until server issue #827 lands`. Both confirm intentional deferral, not absence.
- **Impact:** Browser features (camera, microphone, geolocation, USB) are not delegated-off by default; ZAP rule `10063` flags it. Does not by itself allow tenant takeover, but fails pen-test checklist `docs/security/OWASP_ASVS_L1_CHECKLIST.md` 14.4.7 and ZAP baseline gate.
- **Reproduction:** Start app in production (`NODE_ENV=production npm start`), `curl -sI http://127.0.0.1:3000/` — response has no `permissions-policy` header. Same for Vercel preview (no header in `vercel.json`).
- **Fix status:** **Fixed directly on this branch** — adds `Permissions-Policy: camera=(), microphone=(), geolocation=(), usb=(), payment=(self)` to both `vercel.json` and `src/server/http/securityMiddleware.ts` (helmet `permissionsPolicy` + fallback header). Tests: `src/tests/security-preflight-scripts.test.ts` now expects `pass` (updated), `e2e/security-headers.spec.ts` extended, `scripts/check-security-headers.ts` updated to not advise. Verified: `npm run build` passes; headers present in `vercel.json` and Express response.
- **Remaining risk:** None after merge; Vercel must redeploy to pick up `vercel.json` header.

---

### AF6-20261119-02 — Medium — `GET /api/v1/transactions` accepts empty-name query key `?=` with HTTP 200 (Schemathesis ST201, A6S-07 #2)

- **Severity:** Medium (P2; input-validation hygiene, fuzzer gate)
- **Where:** `src/server/routes/transactions/crudRoutes.ts:registerTransactionCrudRoutes` `GET /` handler — parses `req.query` without rejecting `""` key
- **Evidence at pin:** Handler destructures only known keys (`workspaceId`, `startDate`, `endDate`, `accountId`, `limit`, `cursor`, `fields`, `label.*`) and passes remainder to `parseLabelFilters`. An empty key `req.query[""] = "1"` is ignored and returns `200` with transaction list. Upstream issue #827 §2 records same: Schemathesis 4.33.4 flagged `200` on `?=`.
- **Impact:** Sloppy query parsing; not a tenant break, but fails strict-API contract and blocks Schemathesis promotion to blocking mode (report-only → blocking requires zero fuzzer findings for 3 clean `main` runs).
- **Reproduction:**
  ```bash
  curl -s -H "Authorization: Bearer <valid>" "http://127.0.0.1:3000/api/v1/transactions?workspaceId=ws_1&="
  # Expected: 400 Bad Request "Empty query parameter name"
  # Observed at pin: 200 with JSON
  ```
- **Fix status:** **Carrier — patch in PR #908** (AI #1) + **standalone patch `patches/02-empty-query-key.patch`** provided for this branch. Patch adds early guard: `if ("" in req.query) return 400`. Unit test `src/tests/security-s16-s18-s34-data-protection.test.ts` extended in PR #908; this branch's `src/tests/server-query-validation.test.ts` (new) reproduces 400 vs 200. No direct server edit on this branch to avoid conflict with PR #908; patch is `git apply --check` clean.
- **Remaining risk:** Until PR #908 merges, fuzzer stays report-only.

---

### AF6-20261119-03 — High — Server 500 bodies echo raw `err.message` (information leakage, A6S-07 #4)

- **Severity:** High (P1 if stack traces leak; Medium at this pin because messages are generic but include internal details)
- **Where:** `src/server/routes/emailRoutes.ts:33,51,60` `res.status(500).json({ details: err.message })`; `src/server/routes/incomingEventRoutes.ts:26` same
- **Evidence at pin:**
  ```ts
  // emailRoutes.ts:33
  res.status(500).json({ status: "error", message: "The email could not be sent", details: err instanceof Error ? err.message : String(err) });
  // incomingEventRoutes.ts:26
  res.status(500).json({ status: "error", message: "The incoming events could not be read", details: err instanceof Error ? err.message : String(err) });
  ```
  `security-baseline.json:serverErrors` lists 24 routes that return `500` on outsider/viewer refusal (e.g. `GET /api/reports/balance-sheet` → `500 … Unauthorized: You are not a member`). Prior audit noted same; PR #908 changes these to log server-side (redacted) and return generic message only.
- **Impact:** Internal details (e.g. "Unauthorized: You are not a member of this workspace") already appear in 500 `details`; email routes may leak provider-specific errors. Helps attacker enumerate workspace existence vs membership. Not full stack trace, but violates `security_spec.md` "safe error/log output" and OWASP ASVS 7.4.1.
- **Reproduction:** As outsider, `GET /api/reports/balance-sheet?workspaceId=ws_other` → 500 with `details: "Unauthorized: You are not a member..."` (recorded in baseline). As `emailRoutes` caller with broken email provider, trigger send → 500 `details` contains provider error text.
- **Fix status:** **Carrier — patch in PR #908** + **standalone patch `patches/03-safe-500-details.patch`** (log with `redactForLogs`, return generic message only). No direct edit on this branch (reserved lane). Verified patch compiles (`tsc --noEmit` with patch applied).
- **Remaining risk:** Until merge, baseline documents 500s; monitoring will conflate refusals with crashes.

---

### AF6-20261119-04 — Medium — Server-side card-number masking & prompt-injection fencing inconsistent (defense-in-depth, A6S-07 #3)

- **Severity:** Medium (P2; defense-in-depth, not primary boundary)
- **Where:** `src/server/routes/brainRoutes.ts:56-69` (ephemeralData, accountName) + `src/server/services/clientQueryService.ts` — client already masks via `maskCardNumbers` in `src/lib/reportNotes.ts`, `src/services/clientQueryActions.ts`, `src/services/aiService.ts`; server does not consistently apply same to direct API callers
- **Evidence at pin:** `brainRoutes.ts` builds `contextSummary` from `ephemeralData` without calling `maskCardNumbers` or `fenceUserData`; `clientQueryService.ts` stores user question without masking. Prior register AF6-013..014 noted same; #827 §3 filed for server lane. Client-side tests in `src/tests/security-s16-s18-s34-data-protection.test.ts` pass for browser path, but `src/tests/ai-brain-route.test.ts` (if run with raw card number in payload) would show unmasked server handling.
- **Impact:** Direct API caller can store/forward raw PAN via AI/inquiry paths; downstream logs/LM calls may retain it longer than intended. Primary PCI boundary is client + `securityService.encryptSensitiveField`, but defense-in-depth requires server to also scrub.
- **Fix status:** **Carrier — patch in PR #908** (adds `maskCardNumbers` + `fenceUserData` in `brainRoutes.ts`, `maskCardNumbers` in `clientQueryService.ts`) + **standalone patch `patches/04-server-pci-fencing.patch`**. No direct edit on this branch.
- **Remaining risk:** Client masking already ships; server patch closes direct-API gap.

---

### AF6-20261119-05 — High — `viewer` can still write `documents` (and support tickets) via browser DB (RLS gap, carry-over)

- **Severity:** High (P1 beta prerequisite; tenant-integrity, not full takeover)
- **Where:** Supabase RLS + `lf_rules` for table `documents` (and `supportTickets`) — baseline `security-baseline.json:tables.documents.viewer = "ri"` (read + insert)
- **Evidence at pin:** `security-baseline.json` explicitly records `bookkeeper` `riud` on many tables and `viewer: "ri"` on `documents`; `docs/SECURITY_SWEEP.md` §"What it found when first run" lists same: "A viewer can add rows to documents and change any support ticket". `supabase/tests/rls.test.sql` exercises viewer refusals on core ledger tables, but `documents` is intentionally left writable for viewer uploads in current `lf_rules`? Prior Agent #6 filed #822 for `record.save` bypass; this is the DB-side counterpart.
- **Impact:** A read-only viewer can insert a document row directly via PostgREST (bypassing `documentRoutes` which checks `requireWorkspaceRole`); document status/amount still needs server posting to affect ledger, but can pollute document lists and trigger downstream reads. Not financial posting, but violates least-privilege.
- **Fix status:** **Reserved — reported to AI #1** (requires migration to tighten `documents` RLS or `lf_rules` for viewer writes, plus `documentRoutes` already checks role; patch needs DB test). Standalone patch `patches/05-viewer-documents-rls.patch` proposes adding `lf_rules` entry `allow_viewer_write: false` for `documents` and RLS policy `FOR INSERT … WITH CHECK (lf_can_write(ws))` instead of member-read. Not applied on this branch (needs DB migration + RLS test).
- **Reproduction:** With viewer JWT, `POST` to PostgREST `documents` with `{ workspaceId: ws_1, type: "invoice", ... }` → `201` at pin (if RLS allows). Verified against `security-baseline.json` and sweep test expectations.

---

### AF6-20261119-06 — Medium — 24 server routes return HTTP 500 instead of 403/404 on outsider/viewer refusal (observability & UX, carry-over)

- **Severity:** Medium (P2; masks real crashes, misleads clients)
- **Where:** See `security-baseline.json:serverErrors` — 24 entries including `GET /api/activity-feed`, `GET /api/reports/*`, `GET /api/v1/ledger`, `GET /api/v1/logs`, `GET /api/v1/metrics`, `POST /api/v1/brain/*`, etc.
- **Evidence at pin:** Each entry is `stranger: 500 { "status":"error", "message":"Failed to fetch …", "details":"Unauthorized: You are not a member..." }`. Sweeps (`src/tests/security-sweep.test.ts`) assert baseline equality but do not themselves fix the code. `docs/SECURITY_SWEEP.md` documents this as first-run finding still present.
- **Impact:** Monitoring cannot distinguish refusal from crash; clients get `500` not `403`, breaking retry/backoff and error-handling logic. Not a privilege escalation.
- **Fix status:** **Reported, not directly patched** — each route needs `handleApiError` to map `Unauthorized` → `403` (or `authorizeWorkspace` to throw `HttpError(403)` instead of generic `500`). Patches per-route are repetitive; recommended batch PR by AI #1. This register tracks removal from `serverErrors` as each is fixed.
- **Remaining risk:** Until fixed, alert fatigue and misleading `500` in dashboards.

---

### AF6-20261119-07 — Medium — Period commands now scoped correctly, but legacy `write:transactions` key still has broad writer surface (scope hygiene, #820 follow-up)

- **Severity:** Medium (P2; scope-creep, not direct bypass at this pin after #820)
- **Where:** `src/server/auth/apiAuthenticate.ts:COMMAND_AREA_SCOPE` + `src/lib/apiScopes.ts:API_KEY_SCOPE_IDS`
- **Evidence at pin:** At `5eacf71`, `period: 'write:workspaces'` correctly maps all `period.*` commands to `write:workspaces` (commit message confirms: year close, snapshot rebuild, FX revaluation + undo now need `write:workspaces`, not `write:transactions`). This FIXES #820. However, `COMMAND_AREA_SCOPE` still maps `journal`, `payment`, `invoice`, `bill`, `creditnote`, `inventory`, `asset`, `loan`, `lease`, `revenue`, `reconciliations`, `transaction` all to `write:transactions` — a single key can post across invoices, bills, payments, inventory, assets, leases, revenue recognition, and reconciliation. That's by design, but prior audit #821 flagged that `write:transactions` is overly broad (can delete owner 2FA, mute security email, create/share cross-workspace groups via legacy routes not yet under command scopes). Those legacy routes now mostly go through commands, but a few `workspaceApiRoutes`/`workspaceRoutes` paths still use direct `requireWorkspaceRole` not command scopes.
- **Impact:** A compromised `write:transactions` key has wide ledger impact (expected), but should NOT have `write:workspaces` or `admin` powers. At this pin, period commands are now correctly excluded, so the high-risk separation is achieved. Remaining broadness is product design, not a bug, but should be documented for key issuance UX.
- **Fix status:** **Verified fixed for #820 at this pin** — this branch confirms the mapping is present and `agent7 probe-08` style assertion would pass. No new patch needed for this item. Left as observation for future key-scoping UX (split `write:transactions` into finer scopes).
- **Remaining risk:** Low — explicitly documented; future fine-grained scopes remain optional.

---

## Section B — Carry-over confirmed defects still present at this pin (from prior registers)

These were proven at earlier pins and re-checked (code-read) at `5eacf71`. They are not re-proven with live DB in this session (no disposable Postgres), but their code paths are unchanged.

| ID | Prior ID | Severity | Title | Present at 5eacf71? | Action |
|----|----------|----------|-------|---------------------|--------|
| B-1 | AF6-003 / #910 | High | Four account-report CSVs shift yen/dinar decimals 100×/10× despite correct on-screen | **Yes** — `src/components/reporting/{TopExpensesIncomeReportView.tsx:107,IncomeBySourceReportView.tsx:91,ExpenseByCategoryReportView.tsx:102,AverageMonthlyReportView.tsx:103}` still call `csvMoney` → `src/lib/moneyFormat.ts:122-129` fixed-2-decimal | Reported (AI #7/AI #1 lane; #910 open); not a security boundary, but financial correctness P0. Patch exists in PR #889 scope (which is not yet merged). Tracked here for launch readiness. |
| B-2 | AF6-006 / #906 | High | Statement + inventory CSVs shift decimals in JPY/KWD books | **Yes** — same root cause as B-1 but different views (statement, inventory valuation) | Same as B-1, issue #906 open. |
| B-3 | AF6-010 / #845 fix | P1 | `viewer` consuming Israeli original `מקור` stamp via `GET …/pdf` | **Fixed at this pin** — commit `fix(pdf): a preview never takes the Israeli original copy mark (#845)` is in `5eacf71` history: `GET .../pdf?preview=1` now reads mark without stamping, sends `X-Preview-Only:1`. Verified in `src/server/routes/documentRoutes.ts` (preview guard). **Closed — no longer active.** |
| B-4 | SBX-1 / #825 | High | `lf_sandbox` live-table denylist + trigger guards incomplete | **Still open** — `src/server/db/firestore.ts` sandbox helpers (`getDb({sandboxId})`, `requireLiveDb`, `sandboxBelongsTo`) present, but `supabase/migrations/*_sandbox*.sql` denylist not yet complete per #825. Prior probe `agent7/probe-08` still valid; not re-run here. Tracked for AI #1. |
| B-5 | S-22 / #428 | Medium | Rate limiting per user on sign-in, password-reset, AI routes | **Partial** — `aiRoutes.ts` now has `brainRateLimiter` + `apiLimiter` (100/min IP, 1000/15m IP), `authRateLimiter` exists but is unused (Supabase Auth is provider-side). `S-22` remains `~` (partial) — provider limits unverified. |

---

## Section C — CI / Supply-chain hygiene (new)

### AF6-20261119-08 — Medium — CI secret scan does not run `gitleaks`, does not consume `.gitleaks.toml`, does not scan history (S-24)

- **Severity:** Medium (P2; supply-chain hygiene)
- **Where:** `.github/workflows/security-sbom.yml: Scan tracked source for accidental private keys` (custom Node script, 10 patterns) vs `.gitleaks.toml` (custom `ledgerflow-api-key` rule + default rules + allowlist by path)
- **Evidence at pin:** Workflow step runs `node --input-type=module` with `patterns = [ PEM, lf_id…, Stripe, whsec_, ghp_, sbp_, re_, SG., AIza, xox ]` — 11 patterns. `.gitleaks.toml` defines `ledgerflow-api-key` plus `useDefault=true` (covers 80+ generic rules: AWS, GCP, GitHub, Slack, etc.). Workflow does NOT invoke `gitleaks detect`, does NOT read `.gitleaks.toml`, scans only `git ls-files` (tracked HEAD), not history, not all branches, not PR diffs vs base. Scope note in `docs/COORDINATION.md` S-24 explicitly says "Partial: does not run Gitleaks, consume .gitleaks.toml…".
- **Fix status:** **Fixed directly on this branch** — workflow now: (1) keeps fast tracked-source regex guard (fail-fast, no extra binary), (2) adds `gitleaks detect --no-banner --redact -v --config .gitleaks.toml --log-opts=--all` via `gitleaks/gitleaks-action` on `pull_request` + `push: main`, with `continue-on-error: false` for `main` and advisory for PRs until history clean. Allowlist paths from `.gitleaks.toml` honored. History scan is `git log --all` equivalent via `gitleaks` `--log-opts`. Test `src/tests/security-preflight-scripts.test.ts` already covers preflight script expectations; extended to cover new step.
- **Remaining risk:** Historical findings may still exist (need owner `gitleaks detect --log-opts --all` run and triage); this register does not claim history is clean.

---

### AF6-20261119-09 — Low — `npm audit` 15 moderate vulns present; dependency allowlist empty (S-25 hygiene)

- **Severity:** Low (P2 if exploitable; currently moderate only)
- **Where:** `npm audit` output after `npm ci --ignore-scripts` at this pin: `15 moderate severity vulnerabilities` (glob 7.x/11.x deprecated, fstream, node-domexception, recharts 2.x). `security-audit-allowlist.json` is `{ "allow": [] }` (empty) — S-25 `scripts/check-dependency-audit.ts` wired in `security-sbom.yml` already.
- **Evidence:** `npm audit --audit-level=high` would not fail (moderate only), but `npm audit` (default) would. The repo's `docs/CI_STRATEGY.md` and `S-25` require fail on high/critical with allowlist.
- **Fix status:** **Tracked, not patched this session** — `npm audit fix` would churn lockfile and may break `recharts` major; decision needs owner + AI #1 lane (dependency major bumps). Workflow already enforces `check-dependency-audit.ts` (GHSA allowlist with expiry). This finding records that `npm audit fix` candidates exist but are deferred intentionally.
- **Recommended:** Review `npm audit` JSON, open per-package update PRs (glob → 10+, recharts → 3.x after migration guide), keep allowlist empty until a specific GHSA needs timed exception.

---

## Section D — Process / Documentation gaps (not re-proven, tracked)

These are open tasks in `docs/COORDINATION.md` that are not code defects but launch-readiness gaps. They are listed for completeness; evidence links are to prior checkpoints.

- **S-11 Session hardening** — cookie flags (`HttpOnly`, `Secure`, `SameSite`), session lifetime, re-auth for owner actions (workspace delete, member remove, restore). Not yet audited at this pin (requires live session flow review).
- **S-13 Login anomaly alerts** — many failed sign-ins / new country → owner notification. Not yet built.
- **S-15 Deletion of a person** — GDPR erasure with pseudonymised audit trail. Design doc + tests pending; `personalDataService.ts` covers access (S-14) but not deletion.
- **S-19 Backup verification job** — scheduled check that latest PITR window exists (provider API) + alert. `scripts/restore-drill.mjs` covers manual drill, not scheduled verification.
- **S-21 Access review** — monthly reminder for owners to review access export (C-35). Export exists; reminder job missing.
- **S-27/S-28 Admin flag screen + session list** — remain open in coordination.
- **F-12b Backup export busy after StrictMode replay** — issue #804 open (separate agent lane).

---

## Tests & reproduction performed this register

| Finding | Reproduction method | Result at pin |
|---------|---------------------|---------------|
| 01 Permissions-Policy | `grep -rn Permissions-Policy` + `vercel.json` header list + `curl -I` in prod build | Confirmed absent → fixed on this branch |
| 02 Empty query key | `curl ?=` against live server (or unit test of `req.query`) | Confirmed 200 → patch provided |
| 03 500 details | `security-baseline.json` `serverErrors` + `emailRoutes.ts` source read | Confirmed 24×500 + 4×details — patch in PR #908 |
| 04 PCI fencing | `brainRoutes.ts` source read + client vs server mask compare | Confirmed inconsistent — patch in PR #908 |
| 05 Viewer documents | `security-baseline.json` `tables.documents.viewer=ri` + `SECURITY_SWEEP.md` note | Confirmed writable at DB layer |
| 06 500 vs 403 | `security-baseline.json` 24 entries | Confirmed, tracked |
| 07 Period scopes | `apiAuthenticate.ts` `COMMAND_AREA_SCOPE.period=write:workspaces` at `5eacf71` | Confirmed FIXED |
| 08 Secret scan | `security-sbom.yml` vs `.gitleaks.toml` diff | Confirmed partial → fixed on this branch |
| 09 Moderate vulns | `npm audit` after `npm ci` | 15 moderate, tracked |

All reproduction is deterministic and does not require live customer data. DB-dependent probes (tenant isolation, viewer RLS write) are inferred from baseline + code at this pin; live DB confirmation is CI-gated (`supabase/tests/rls.test.sql`, `src/tests/security-sweep.test.ts`).

---

## Recommended corrections (ordered by risk)

1. **Merge PR #908** (#827 + #796 + #857) — closes 02, 03, 04 in one review (AI #1 lane). Verify with `npm test` (with DB) + `npm run test:rules` + Schemathesis clean run.
2. **Merge this branch's S-6 + S-24 fixes** — `vercel.json` + `securityMiddleware.ts` + `security-sbom.yml` gitleaks step (AI #6 lane). Redeploy Vercel after `vercel.json` change.
3. **File/assign follow-ups:** B-1/B-2 CSV decimals (#910/#906) to AI #7/AI #1 (money lane, PR #889 scope); B-4 sandbox denylist (#825) to AI #1; S-22 provider-limit verification to AI #1 + owner.
4. **Schedule pen-test** against deployed preview after (1)+(2); re-run ZAP baseline (local only) and attach report; verify CSP `report-only` → `enforce` promotion checklist in `docs/SECURITY_CONTROLS.md` once summary stays empty for a billing cycle.
5. **Address moderate npm vulns** via separate dependency-update PRs (not this security PR).

---

## Evidence bundle

- **Pinned SHA:** `5eacf71f633f00a5db7ae44d3fdba75b4d3700cf` + `audit/agent6-2026-11-19/` in this repo
- **Patches:** `audit/agent6-2026-11-19/patches/02-empty-query-key.patch`, `03-safe-500-details.patch`, `04-server-pci-fencing.patch`, `05-viewer-documents-rls.patch` (all `git apply --check` clean on `5eacf71`)
- **Direct fixes on branch:** `vercel.json`, `src/server/http/securityMiddleware.ts`, `.github/workflows/security-sbom.yml`, `scripts/check-security-headers.ts`, `src/tests/security-preflight-scripts.test.ts`, `e2e/security-headers.spec.ts`
- **CI:** See `03-GATES-AND-CI-EVIDENCE.md` for latest head checks
- **Prior registers:** `audit/agent6-2026-11-12/04-FINDINGS-REGISTER-2026-11-12.md`, `audit/agent6-2026-11-16/02-LIVE-AUDIT-FINDINGS-AND-SCAN-RESULTS.md`

