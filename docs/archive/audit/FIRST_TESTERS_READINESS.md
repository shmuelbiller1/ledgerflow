# First Testers Readiness

**Target revision:** `1f6fe901d0553ff8c26ff08a3ccd4ebcfe72b759` (2026-10-23, post-PR #351)  
**Previous baseline:** `9aed5466c4691c5c55c6d4dbec0565d88dbc8462` (2026-10-18)  
**Recommendation:** **STAGE A (Synthetic Bookkeeping Beta) is APPROVED and ready to invite testers.** For testers using disposable books and synthetic data, all release-blocking gates and accounting core bugs have been resolved. Real-records pilot (Stage B) remains conditional upon the owner completing the remaining deployment tasks (L-123 migration on Supabase, database CA certificate in Vercel, and secret rotation).

---

## Decision in one minute

- **All 7 high-priority financial and integrity bugs (BUG-01 through BUG-07) are verified fixed** by passing automated tests and inspecting the code at current HEAD.
- **All 18 audit findings (AUD-01 through AUD-22) are resolved or operationalized**: statement scope is unified, restore counts are corrected, RMAs are server-controlled, scheduled jobs are claimed without drop, DNS is pinned against SSRF, CSP is dynamic, and remote TLS is verified with `DATABASE_CA_CERT`.
- **All 9 Stage A workflows (W1, W2, W3, W4, W5, W6, W9, W10, W14) are complete**: connected on screens, verified with worked figures by hand, and browser-tested on CI.
- **L-123 and ERPNext-depth improvements are on main**: server-side document posting with credit-limit enforcement (EG-5), tax breakdown persistence (EG-12), closed-year period balances snapshots (L-123 step 1), server balances for reports (L-123 step 2), and chart of accounts / register balances above the 20k cap (L-123 step 3).
- **TypeScript, ESLint (0 errors / 105 warnings), and production build pass cleanly.**

---

## Readiness by test cohort

| Cohort | Recommendation | Status & Conditions |
|---|---|---|
| **Engineering development with synthetic fixtures** | **Proceed** | Full test suites, type checking, and builds pass cleanly. Synthetic fixtures for USD/EUR, multi-rate FX, and gold tax years active. |
| **Cohort A: Invited synthetic bookkeeping beta** | **APPROVED / READY** | Isolated Supabase project; synthetic data only; "Test environment" banner active; onboarding, bills, invoices, payments, bank imports, reconciliations, reports, close, backup/restore, and roles are fully operational. |
| **Cohort B: Narrow real-records pilot (few businesses)** | **Conditional / Pending Owner Actions** | Requires owner to: (1) apply L-123 migration `20261023000000_period_balances.sql` on Supabase; (2) paste `DATABASE_CA_CERT` in Vercel; (3) rotate 4 secrets in Vercel; (4) verify live sign-up on production URL. |
| **Cohort C: Automated tax filing & payroll processing** | **Deferred to Stage C** | Statutory e-filing (PCN874, US 1099 e-file) and direct payroll processing are Stage C; tax accounting and payroll import (PAY-1) are active for Stages A and B. |

---

## Verification status of Stage A release gates

| Gate | Status at HEAD | Evidence & Verification |
|---|---|---|
| **G-01: Setup saved, return after refresh** | **PASSED** | Authenticated session persistence in Zustand + Supabase auth; workspace switcher retains context across page reloads. |
| **G-02: First hour without dead ends** | **PASSED** | D-97 plain language pass on reconciliation/import/chart path; G-24 journey merged in PR #282; W1-GOLD worked figures merged in PR #291. |
| **G-03: Every change persists or is visibly refused** | **PASSED** | PREV-5 (PR #313) and PREV-5b (PR #331) failure tests; save errors retain draft and display actionable errors; no false success on refusal. |
| **G-04: Access boundaries between workspaces** | **PASSED** | Postgres RLS policies and server-side `requireWorkspaceRole` guards; cross-workspace write assertions tested in S-37–S-40; D-99 roles journey passed in PR #324. |
| **G-05: Sandbox banner and test record isolation** | **PASSED** | "Test environment" banner active in sandbox mode; disposable workspace IDs; synthetic fixtures separated from production. |
| **G-06: Error reporting and recovery** | **PASSED** | Data Status bar, contextual error toasts, undoable deletes, and support ticket submission paths verified. |
| **G-07: Primary screens (desktop, 390px, keyboard, RTL)** | **PASSED** | Responsive layouts (D-83/84), D-51 dialog keyboard focus order & visible focus (PR #343), and A-201 bilingual Hebrew help (PR #316/#325) verified. |
| **G-08: Usage license compliance** | **PASSED** | Restrictive source-available license documented in `LICENSE.md`; privacy policy templates prepared in `docs/privacy/`. |

---

## Resolution of previously identified blockers

| Blocked item | Previous concern | Resolution & verification on current main |
|---|---|---|
| **Financial answers (BUG-01)** | Reversals doubled in inflow/outflow totals | **Fixed:** `src/lib/txFilters.ts:416` nets reversal debits/credits according to account side. Tested in `list-totals-reversal.test.ts` (3/3 pass). |
| **Report scope (BUG-02 / AUD-10)** | Refetch failure kept old server figures | **Fixed:** Generational request counter clears data on error; report provenance badge explicitly shows source. Tested in `report-provenance.test.ts` (30/30 pass). |
| **Posting retry (BUG-03)** | Fresh UUIDs generated on retry | **Fixed:** Server-side posting route `POST /api/v1/documents/:type/:id/post` with mandatory `Idempotency-Key` (L-94 Step 2/2B). |
| **Statement scope (BUG-04 / AUD-01)** | PDF/email ignored screen date scope | **Fixed:** Unified `StatementScope` across screen, JSON, and PDF (PR #288). Tested in `aud01-statement-scope.test.tsx` (4/4 pass). |
| **Cache duplication (BUG-05)** | Retries appended duplicate rows to store | **Fixed:** Transaction ID upsert in `postingKit.ts` and `useLedgerStore.ts`. Tested in `post-cache-upsert.test.ts`. |
| **Unwired controls (BUG-06)** | 10 dead buttons and miswired Close Period | **Fixed:** All buttons wired or visibly disabled with explanations in C-127. |
| **FX balancing (BUG-07)** | Converted base currency did not zero-balance | **Fixed:** Dual double-entry validation (document + base home currency); odd-cent allocated to largest line. Tested in `home-currency-balance.test.ts` (7/7 pass). |
| **Altman Z-Score (AUD-19)** | Reversals increased calculated EBIT | **Fixed:** Line signs preserved in EBIT calculation (PR #300). Tested in `altman-z-score.test.ts`. |
| **Restore counts (AUD-02)** | Double record count on retried restore | **Fixed:** Merged in PR #318; D-98 backup/restore browser journey passed in PR #324. |
| **RMA transitions (AUD-03)** | Client-only metadata writes for RMAs | **Fixed:** Server-enforced state transitions with two-person rule (PR #302, ISS-143). |
| **Scheduled mail (AUD-04 / AUD-05)** | Silent email loss and disparate cron sets | **Fixed:** Atomic delivery claims per recipient (PR #311) and unified job registry (PR #339). |
| **SSRF vulnerability (AUD-11)** | DNS check not connection-pinned | **Fixed:** safeFetch resolves once, validates public IP, and pins connection (PR #314). Tested in `safefetch-dns-pinning.test.ts` (7/7 pass). |
| **Database TLS (AUD-20)** | TLS fallback without CA verification | **Fixed:** `DATABASE_CA_CERT` verified when configured (PR #319). Tested in `db-tls-config.test.ts` (5/5 pass). |

---

## Safe launch sequence for owner

1. **Paste L-123 migration in Supabase SQL editor:**
   - File: `supabase/migrations/20261023000000_period_balances.sql`.
2. **Configure Vercel environment variables:**
   - `DATABASE_CA_CERT`: paste downloaded Supabase SSL certificate.
   - `SESSION_SECRET`, `INVITE_SECRET`, `CRON_SECRET`, `SYSTEM_SALT`: set unique random strings.
3. **Turn off Vercel Deployment Protection** for production.
4. **Invite Cohort A synthetic beta testers!**
