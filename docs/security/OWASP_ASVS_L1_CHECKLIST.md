# OWASP ASVS 4.0.3 Level 1 & API Security Checklist (S-36)

**Audit date:** 2026-11-18 (last full pass) · **addendum:** 2026-11-20 (Agent #6, PR #961 — see the
section at the end of this file; no earlier row was changed by it)  
**Audited commit baseline:** `f2a39a422` (`main`) + AI #6 verification/scanner branch; 2026-11-20
addendum pinned at `d1f2c8d` (`main`) + `arena/b1a560b0-ledgerflow`  
**Scope:** LedgerFlow web client (`src/`), Express/Vercel API (`server.ts`, `src/server/`), PostgreSQL Row-Level Security & triggers (`supabase/migrations/`), and CI security workflows (`.github/workflows/`).

Status key:
- **PASS** — control implemented and verified by code inspection and automated test against this repository.
- **PARTIAL** — primary control exists and passes core tests, with a specific tracked gap or staged rollout open.
- **FAIL** — verified gap reproduced against the local server/database; tracked in a linked GitHub issue for AI #1's server/database lane.
- **OPS** — depends on live deployment settings (Vercel, Supabase, DNS/TLS, provider dashboards) that cannot be certified from repository code alone.

---

## Summary by ASVS v4.0.3 Chapter

| Chapter | Area | Status | Open issues / notes |
|---|---|---|---|
| V1 | Architecture, Design & Threat Modelling | **PARTIAL** | Tenant + RLS architecture solid; sandbox denylist hardening in `#825` |
| V2 | Authentication | **FAIL** | Supabase JWT + TOTP + recovery codes in place; API-key 2FA deletion bypass in `#821` |
| V3 | Session Management | **PARTIAL** | JWT expiry/issuer/audience checked; session list/sign-out UI tracked as `S-28` |
| V4 | Access Control | **FAIL** | Cross-tenant BOLA & RLS pass; command scope/role/guard gaps in `#820`, `#821`, `#822`, `#823`, `#830` |
| V5 | Validation, Sanitization & Encoding | **PARTIAL** | Zod schemas, NUL-byte/413 JSON guards, React escaping, `plainRecords` guard gap in `#822`, AI fencing in `#827` |
| V6 | Stored Cryptography | **PASS** | AES-256-GCM (`SecurityService`), HMAC-SHA256 forensic/audit chains, SHA-256 random API key hashes, timing-safe compares |
| V7 | Error Handling & Logging | **PARTIAL** | `redactForLogs`, `SecurityService.scrubPII`, hash-chained `auditLogs`; admin audit gap in `#826`, 500 detail leaks in `#821`/`#827` |
| V8 | Data Protection & Privacy | **PARTIAL** | PCI `maskCardNumbers` on tickets, notes, queries, AI & receipt text (`S-18`); cookie choice enforced (`S-35`); personal export (`S-14`); server scrubbing `#827`, erasure `S-15` |
| V9 | Communications | **PASS / OPS** | HSTS preload (`max-age=31536000`), `upgrade-insecure-requests`, remote DB CA check (`check-prod-env.ts`); live `DATABASE_CA_CERT` verified by owner (`OPS`) |
| V10 | Malicious Code & Supply Chain | **PASS** | `npm ci --ignore-scripts`, CycloneDX SBOM (`security-sbom.yml`), SHA-pinned scanner actions, secret scan + `.gitleaks.toml` (`S-24`), prod audit gate (`S-25`) |
| V11 | Business Logic | **FAIL** | Balanced-ledger DB trigger + period locks + idempotency; `record.save` guard bypass `#822`, ASC 606/842 command retry double-post `#824` |
| V12 | Files & Resources | **PASS** | MIME/magic-byte & SVG script rejection (`src/server/utils/fileValidation.ts`, `S-30`), JSON size limits (`413`) |
| V13 | API & Web Service Security | **PARTIAL** | Shared Postgres rate limits (`S-1`), CSRF header check, Stripe/Plaid/Email webhook verification (`S-31`), OpenAPI fuzzing (`SEC-SCAN-1`); empty query key `#827` |
| V14 | Configuration & HTTP Headers | **PARTIAL** | Helmet + `vercel.json` CSP sync, COOP/CORP, `nosniff`, frame protection, `check-security-headers.ts` (`S-25`/`S-34`), ZAP baseline (`#762` fixed); S-23 CSP in report-only stage, `Permissions-Policy` in `#827` |

---

## Detailed Level 1 Control Checklist

### V1 — Architecture & Tenant Boundaries
| ID | Control | Status | Evidence |
|---|---|---|---|
| 1.1.1 | Documented security architecture, lane ownership, and pre-release gates | **PASS** | `security_spec.md`, `docs/RELEASE_GATE.md`, `docs/runbooks/incident.md` |
| 1.4.1 | Multi-tenant data isolation enforced at both API and PostgreSQL RLS layers | **PASS** | `supabase/tests/rls.test.sql` (`npm run test:rules`), `src/tests/security-sweep.test.ts`, `src/tests/security-s8-s38-s39-isolation.test.ts` |
| 1.4.4 | Assistant sandbox (`lf_sandbox`) isolated per tenant and denied sensitive live tables | **PARTIAL** | Cross-tenant & expiry RLS verified in `security-s8-s38-s39-isolation.test.ts`; sensitive live-table denylist & non-client trigger guards tracked in `#825` |

### V2 — Authentication
| ID | Control | Status | Evidence |
|---|---|---|---|
| 2.1 / 2.2 | Authentication delegated to Supabase Auth with verified email enforcement | **PASS** | `src/server/auth/supabaseAuth.ts` (`verifyIdToken`, `isEmailConfirmed`) |
| 2.2.1 | Anti-automation rate limiting on API and failed API-key attempts | **PASS** | `src/server/middleware/rateLimiters.ts` (shared Postgres store, `S-1`), `src/tests/sec-scan-1-and-api-hardening.test.ts`; per-user auth/reset limits open under `S-22` |
| 2.8.1 | TOTP two-step login and single-view hashed recovery codes | **PARTIAL** | `src/server/services/recoveryCodeService.ts`, `src/components/settings/RecoveryCodesPanel.tsx` (`S-29`) |
| 2.8.7 | Account MFA/recovery/notification actions cannot be abused by workspace API keys | **FAIL** | Live-reproduced: `write:transactions` key calls `account.makerecoverycodes`, `account.userecoverycode` (deletes verified TOTP factor), and `account.setnotificationemail` (`off`) — filed as `#821` |
| 2.10.4 | No hardcoded default or placeholder secrets allowed in production | **PASS** | `src/server/config/assertStartupConfig.ts`, `scripts/check-prod-env.ts` (`S-2`), `.gitleaks.toml`, `.github/workflows/security-sbom.yml` |

### V3 — Session Management
| ID | Control | Status | Evidence |
|---|---|---|---|
| 3.2.1 | Tokens cryptographically verified (issuer, audience, expiry, signature) | **PASS** | `src/server/auth/supabaseAuth.ts` (`jose` `jwtVerify`) |
| 3.3.1 | Sign-out invalidates sessions; admin revoke supported server-side | **PARTIAL** | `authAdmin` in `src/server/auth/supabaseAuth.ts`; user-facing active-device list tracked in `S-28` |
| 3.5.3 | Stateless API keys compared in constant time with expiry enforcement | **PASS** | `src/server/auth/apiAuthenticate.ts` (`crypto.timingSafeEqual`, `expiresAt`) |

### V4 — Access Control (OWASP API1 BOLA / API5 BFLA)
| ID | Control | Status | Evidence |
|---|---|---|---|
| 4.1.1 | Server enforces authentication and workspace authorization on protected endpoints | **PASS** | `src/tests/route-policy-coverage.test.ts`, `src/tests/aud09-write-access.test.ts`, `src/tests/security-s8-s38-s39-isolation.test.ts` (32-route cross-tenant suite) |
| 4.1.3 | Principle of least privilege for platform admin flag (`app_metadata` only) | **PASS** | `src/tests/security-s8-s38-s39-isolation.test.ts` confirms forged `user_metadata.admin=true` gets `403` across all `/api/v1/admin/*` routes |
| 4.1.5 | Least-privilege role checks across payments, pay runs, bank lines, reconciliations, and imports | **FAIL** | Payments/pay runs (`S-38`) and 8/9 bank/import commands pass; `reconciliations.bankline` allows `viewer` to mark bank lines matched/ignored — filed as `#830` |
| 4.2.1 | Direct object references (`id`, `accountId`, `customerId`, `invoiceId`) scoped to caller's workspace | **PASS** | Verified in `src/tests/security-s8-s38-s39-isolation.test.ts` (`S-8`, `S-38`, `S-39`) |
| 4.2.2 | API key scopes restrict commands to permitted domains and single workspace | **FAIL** | Unmapped commands fall through to `write:transactions` (`#823`), `period.*` scopes (`#820`), and `groups.create`/`groups.share` cross workspace boundary (`#821`) |
| 4.3.2 | Directory listing disabled; static SPA serves only built assets | **PASS** | `src/server/http/serveApp.ts`, `vercel.json` |

### V5 — Validation, Sanitization & Encoding
| ID | Control | Status | Evidence |
|---|---|---|---|
| 5.1.1 | Malformed JSON, oversized payloads (>1 MB), and NUL bytes rejected with JSON 400/413 | **PASS** | `src/server/http/securityMiddleware.ts`, `src/tests/sec-scan-1-and-api-hardening.test.ts` |
| 5.1.3 | Command and record payloads enforce domain field invariants server-side | **FAIL** | `record.save` / `record.delete` bypass client-only Postgres triggers for `inventory`, `assets`, signed `estimates`, and `taxRates` — filed as `#822` |
| 5.3.4 | Parameterized SQL queries across the PostgreSQL adapter (no string-interpolated user values) | **PASS** | `src/server/db/pgFirestore.ts`, `src/server/db/pg/writes.ts`; identifier formatting uses `%I` |
| 5.3.10 | Untrusted text sent to AI endpoints confined to allowlisted data fields | **PARTIAL** | `src/server/services/aiGateway.ts` (`allowedPayload`), `src/tests/security-s16-s18-s34-data-protection.test.ts`; server `brainRoutes.ts` fencing tracked in `#827` |

### V6 — Stored Cryptography
| ID | Control | Status | Evidence |
|---|---|---|---|
| 6.2.1 | Sensitive third-party tokens encrypted with AES-256-GCM and random 96-bit IV | **PASS** | `src/services/securityService.ts` (`encryptSensitiveField` / `decryptSensitiveField`) |
| 6.3.1 | Security-sensitive IDs, keys, and tokens generated via `crypto.randomBytes` / Web Crypto | **PASS** | `src/lib/secureId.ts`, `src/server/commands/apiKeys.ts`, `src/server/services/recoveryCodeService.ts` |

### V7 — Error Handling & Audit Logging
| ID | Control | Status | Evidence |
|---|---|---|---|
| 7.1.1 | Credentials, API keys (`lf_id_`, `lf_live_`, `sk_`), emails, and 13–19 digit PANs scrubbed from logs/telemetry | **PASS** | `src/lib/logRedaction.ts`, `src/services/securityService.ts`, `src/tests/log-redaction.test.ts`, `src/tests/security-s16-s18-s34-data-protection.test.ts` |
| 7.2.1 | Workspace and platform-admin privilege changes write tamper-evident audit rows | **PARTIAL** | Hash-chained `auditLogs` (`S-12`) in place; unlogged new-user admin promotion & swallowed audit errors filed as `#826` (plus API-key `auditlog.append` in `#823`, restore audit in `#778`) |
| 7.4.1 | HTTP 500 errors return generic messages without SQLSTATE codes or stack traces | **PARTIAL** | JSON body errors pass; non-UUID `22P02` in `recoveryCodeService.ts` (`#821`), raw `err.message` in `emailRoutes`/`incomingEventRoutes`/`adminRoutes` (`#826`, `#827`), and non-member `500` on report routes |

### V8 — Data Protection & Privacy
| ID | Control | Status | Evidence |
|---|---|---|---|
| 8.3.4 | Payment-card numbers masked before persistence/transmission across notes, tickets, queries, chat, AI, and extracted receipt/statement text | **PARTIAL** | `src/lib/cardNumberMask.ts`, `src/lib/reportNotes.ts`, `src/lib/recordNotes.ts`, `src/lib/feedbackTicket.ts`, `src/services/clientQueryActions.ts`, `src/services/aiService.ts`, `src/components/intelligence/Copilot.tsx`, `src/components/support/SupportView.tsx`; server-side defense-in-depth tracked in `#827` |
| 8.3.6 | Personal data access export and cookie/telemetry consent enforcement | **PARTIAL** | `src/server/services/personalDataService.ts` (`S-14`), `src/lib/cookieConsent.ts` + `src/lib/errorTracker.ts` (`S-35`, `src/tests/cookie-consent.test.tsx`); account pseudonymisation tracked in `S-15` |

### V9 — Communications Security
| ID | Control | Status | Evidence |
|---|---|---|---|
| 9.1.1 | TLS enforced with HSTS (`max-age=31536000; includeSubDomains; preload`) and CSP `upgrade-insecure-requests` | **PASS** | `src/server/http/securityMiddleware.ts`, `vercel.json`, `e2e/security-headers.spec.ts` |
| 9.2.1 | Remote PostgreSQL TLS certificate validation checked by preflight | **OPS** | `scripts/check-prod-env.ts`; requires owner `DATABASE_CA_CERT` in Vercel (`docs/FOR_YOU.md` AUD-20) |

### V10 — Supply Chain & Dependency Hygiene
| ID | Control | Status | Evidence |
|---|---|---|---|
| 10.2.1 | Zero High/Critical production npm vulnerabilities; automated gate with expiring allowlist | **PASS** | `scripts/check-dependency-audit.ts`, `security-audit-allowlist.json` (0 production vulns verified 2026-11-18), `.github/workflows/security-sbom.yml`, `.github/dependabot.yml` |
| 10.3.2 | CI locks lifecycle scripts (`--ignore-scripts`), emits CycloneDX SBOM, and scans tracked files for secrets | **PASS** | `.github/workflows/security-sbom.yml`, `.gitleaks.toml`, `.github/workflows/codeql.yml` |

### V11 — Business Logic & Accounting Integrity
| ID | Control | Status | Evidence |
|---|---|---|---|
| 11.1.1 | Double-entry balance (`sum = 0`, integer cents) enforced in PostgreSQL trigger | **PASS** | `lf_enforce_balanced_ledger()`, `lf_transactions_ledger_integrity()` |
| 11.1.2 | Closed fiscal periods reject backdated entries, payments, payroll runs, and opening imports | **PASS** | Verified in `src/tests/security-s8-s38-s39-isolation.test.ts` (`S-38`, `S-39`); asset/plain-record bypass filed as `#822` |
| 11.1.4 | Retried posting operations are idempotent | **FAIL** | Command `Idempotency-Key` and legacy `/api/v1/revenue/recognize` replay cleanly; headerless `/api/v1/commands/revenue.recognize` and `lease.capitalize` double-post — filed as `#824` (bank-rule retry also tracked in `#796`) |

### V12 — Files & Resources
| ID | Control | Status | Evidence |
|---|---|---|---|
| 12.1.1 | Uploaded file size, MIME type, magic bytes, and active SVG script content validated | **PASS** | `src/server/utils/fileValidation.ts` (`S-30`) |

### V13 — API, CSRF & Webhook Security
| ID | Control | Status | Evidence |
|---|---|---|---|
| 13.1.3 | API credentials never carried in URLs; webhook signatures verified before state change | **PASS** | Stripe HMAC + timestamp, Plaid ES256 JWT + body SHA-256, Email timing-safe secret tested in `src/tests/security-s16-s18-s34-data-protection.test.ts` (`S-31`) |
| 13.2.3 | CSRF protection on state-changing routes (`X-LedgerFlow-Request` + strict CORS origin allowlist) | **PASS** | `src/server/middleware/csrf.ts`, `src/server/http/securityMiddleware.ts`, `src/tests/security-sweep.test.ts` |
| 13.2.5 | Continuous automated OpenAPI schema fuzzing against local CI instance | **PASS** | `.github/workflows/api-fuzz.yml` (Schemathesis `4.33.4`, Phase 1 report-only per `docs/FOR_YOU.md`; server findings filed as `#821`, `#827`) |

### V14 — Configuration & Security Headers
| ID | Control | Status | Evidence |
|---|---|---|---|
| 14.4.1–7 | `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, no `X-Powered-By` | **PARTIAL** | Verified by `scripts/check-security-headers.ts`, `src/tests/security-preflight-scripts.test.ts`, `e2e/security-headers.spec.ts`, and `.github/workflows/zap-baseline.yml` (ZAP `2.16.1` + narrow `scripts/evaluate-zap-report.mjs`, fixing `#762`). Remaining: complete S-23 `script-src` hash enforcement and add `Permissions-Policy` (`#827`). |

---

## Appendix A — Money-Posting Endpoint Idempotency Audit (S-5)

| Endpoint / command family | Idempotency mechanism | Retry safe without header? | Status & evidence |
|---|---|---|---|
| `POST /api/v1/commands/*` (with `Idempotency-Key` header) | Server `idempotencyKeys` table + canonical request hash (`409` on payload mismatch) | Via header | **PASS** — `src/tests/security-s8-s38-s39-isolation.test.ts` (`S-5`) |
| `payment.receive` / legacy `POST /api/v1/transactions/payments` | `PAYMENT_CREATE` `operationId` / `Idempotency-Key` + request fingerprint hash | With `operationId` / header | **PASS** — `src/server/commands/payments.ts` |
| `invoice.save` / `bill.save` / `creditnote.*` / `vendorcredit.*` | Document ID upsert + `postingRevision` / status transition guard | Yes (same doc ID) | **PASS** — `src/server/commands/documents.ts` |
| `invoice.void` / `bill.void` / `payment.void` | Status check refuses voiding an already-voided record (`400`/`409`) | Yes | **PASS** — `src/server/commands/documents.ts`, `payments.ts` |
| `payroll.run` | Same-day/schedule duplicate check unless `again: true` is explicitly passed | Yes (default) | **PASS** — `src/server/commands/payroll.ts` |
| `asset.depreciate` | Period schedule key check prevents double-posting same period | Yes | **PASS** — `src/server/services/assetAccountingService.ts` |
| Legacy `POST /api/v1/revenue/recognize` & `POST /api/v1/leases/capitalize` | `checkAndRegisterIdempotency` with deterministic contract/period fallback key | Yes | **PASS** — `src/server/routes/revenueRoutes.ts:26`, `leaseRoutes.ts:27` |
| `POST /api/v1/commands/revenue.recognize` & `lease.capitalize` | Only guarded when caller sends `Idempotency-Key` (no deterministic fallback key) | **No — posts twice** | **FAIL** — live-reproduced, filed for AI #1 as **`#824`** |
| Bank-rule auto-post on retried feed sync | Tracked rule-application dedup | Partial | **PARTIAL** — tracked for AI #1 in **`#796`** |
| Stripe webhook `POST /api/webhook/stripe` | Signature verification + Stripe `event.id` deduplication | Yes | **PASS** — `src/server/routes/webhookRoutes.ts` |

---

## Release Gate Recommendation (Security Lane)

Before onboarding real customer books with third-party API integrations or multi-user teams, resolve
at minimum the Critical/High server issues **`#821`** (API-key 2FA/group isolation), **`#822`**
(`record.save`/`record.delete` accounting guards), **`#823`** / **`#820`** (command API-key scopes),
**`#824`** (ASC 606/842 command idempotency), **`#830`** (viewer bank-line write), and **`#825`**
(before exposing assistant sandbox routes), and complete owner `OPS` checks (`DATABASE_CA_CERT`,
live webhook secrets, and `npx tsx scripts/check-security-headers.ts` against the live HTTPS URL).

---

## Addendum — 2026-11-20 (Agent #6, PR #961): exported formulas, indexable token links, one error path

Pinned at `d1f2c8d` (`main`) + `arena/b1a560b0-ledgerflow`. Findings register:
`audit/agent6-2026-11-20/01-FINDINGS-REGISTER.md`. No row above was edited; these are the deltas.

| ID | Control | Status | Evidence |
|---|---|---|---|
| 5.3.3 | Spreadsheet (CSV) formula injection is neutralised in every exported file | **PASS after PR #961** — was **PARTIAL** | `src/lib/csv.ts` `looksLikeFormula()` (decides on the first character a spreadsheet reads, not the first byte: leading space, NBSP, ZWSP and BOM included; carried as AF-010-F5), used by `toCsv`/`sanitizeCsvCell` **and** `unguardCsvCell`; `src/tests/security-csv-formula-injection.test.ts`; 85/85 export/archive suites. **Still open in the API lane:** `GET /api/v1/workspaces/:id/export?format=csv` builds its CSV by hand — filed with a verified patch as **`#962`** |
| 5.1.4 | Money in an exported file is written in the currency it is stored in | **FAIL in the API lane** (`#962`) | `handleWorkspaceExport` writes `totalAmountCents / 100` + `toFixed(2)`: ¥1,000,000 → `10000.00` (100× high), KWD 12.345 → `123.45` (10× low). Reproduction: `audit/agent6-2026-11-20/repro/workspace-csv-export.mjs` |
| 8.2.1 / 8.3.4 | A URL that carries a bearer token (invoice `/i/`, portal `/c/`, estimate `/e/`, invitation `/invite/`) is not indexable or snippet-cached | **PASS on the Vercel deployment after PR #961** — Express-hosted SPA still open | `vercel.json` `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex` on the four prefixes (first response, no script), `src/lib/privacyRobots.ts` + `src/main.tsx` (page meta on client-side navigation), `public/robots.txt` blocks only `/api/` — token prefixes must stay fetchable or the `noindex` is never read; `src/tests/security-token-page-indexing.test.ts` (6 cases incl. an `App.tsx` route guard and both directions of the robots.txt rule). Open: the same header in `serveApp.ts` (API lane) |
| 7.1.1 / 8.1.2 | Client error telemetry respects the visitor's choice, is redacted, de-duplicated, and does not cross an account boundary | **PASS after PR #961** — was **PARTIAL** | `index.html`'s inline reporter (raw stack → `POST /api/health`, a route with no `POST` handler, no consent, no redaction) removed; `src/server/http/contentSecurityPolicy.ts` `APP_INLINE_SCRIPT_HASHES = []`; `vercel.json` CSP regenerated; `src/tests/security-client-error-reporting.test.ts` |
| 14.4.3 | Every inline script a page ships is named by hash in the tightened CSP, and a page with none ships none | **PASS** | `csp-report-only.test.ts` recomputes hashes from `index.html`; `scripts/check-security-headers.ts` now requires the Report-Only `script-src` to drop `'unsafe-inline'` (a hash only when the page has an inline script) |

**Dependency surface at this pin (unchanged status):** `scripts/check-dependency-audit.ts` → PASS,
0 production advisories at any severity; the 15 `npm audit` moderates are dev-tool transitive
(`qs` under Stryker's `typed-rest-client`, `minimatch`/`glob` under eslint/workbox) and stay out of
the shipped bundle.

**Release-gate recommendation change:** add **`#962`** (server CSV export: formula injection and
wrong-currency amounts) to the Critical/High list that must be closed before real customer books.
