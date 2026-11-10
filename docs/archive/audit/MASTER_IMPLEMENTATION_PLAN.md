# Master Implementation Plan — LedgerFlow

**Plan Target:** `main` at `1f6fe901d0553ff8c26ff08a3ccd4ebcfe72b759` (2026-10-23, post-PR #351)  
**Initial Baseline Target:** `9aed5466c4691c5c55c6d4dbec0565d88dbc8462` (2026-10-18)  
**Status:** **Stage 0 and Stage 1 are 100% COMPLETE.** Stage A Synthetic Bookkeeping Beta is approved. Stage B roadmap is detailed below.

---

## Executive progress scorecard

| Phase / Work Package | Target Scope | Current Status | Verification Evidence |
|---|---|---|---|
| **Stage 0: Verification Floor** | Typecheck, lint, build, property/boundary suites | **COMPLETE** | `tsc --noEmit` 0 errors; ESLint 0 errors / 105 warnings; `npm run build` pass; Atlas validate pass. |
| **Stage 1: Financial Core (P0)** | BUG-01, BUG-02, BUG-03, BUG-04, BUG-07, AUD-19 | **COMPLETE** | All 6 items verified fixed with passing tests in `VERIFIED_BUG_REPORT.md`. |
| **Stage 2: Recovery & Authority (P0/P1)** | AUD-02, AUD-03, AUD-07, BUG-05, AUD-10, AUD-11, AUD-20 | **COMPLETE** | L-94 Step 2/2B, RMA server-only, restore counts, provenance, safeFetch DNS pinning, and TLS CA validation all merged. |
| **Stage A: 9 Bookkeeping Workflows** | W1, W2, W3, W4, W5, W6, W9, W10, W14 | **COMPLETE** | All 9 workflows are Connected · Verified with worked figures · Browser-tested. |
| **Stage B: Narrow Real-Records Pilot** | W11, W12, W13 + ERPNext Depth (EG-1…EG-10) | **READY TO EXECUTE** | EG-5 (credit limit) & EG-12 (tax persistence) merged; EG-1 design merged; W12/W13 goldens merged. |
| **Stage C: Tax & Payroll Automation** | W7, W8 statutory filing + direct payroll | **DEFERRED (STAGE C)** | PCN874 & 1099 goldens verified for calculation; filing automation deferred. |

---

## Detailed status by stage

### Stage 0 — Verification floor (Completed)
- [x] Node 22/24 automated unit testing with tsx test runner.
- [x] Strict TypeScript configuration passing with 0 diagnostics.
- [x] ESLint linting ratchet passing (105 warnings / 0 errors against 106 max-warnings cap).
- [x] Bug pattern scanner passing at or below baseline.
- [x] Code Atlas dependency and workflow validation passing (ok: true, 0 parse errors).
- [x] Production build (Vite + esbuild) passing cleanly with chunk splitting and PWA service worker.

### Stage 1 — Financial correctness & reporting scope (Completed)
- [x] **BUG-01: Signed reversal totals** — `txFilters.ts:416` nets reversal lines by account orientation; `list-totals-reversal.test.ts` (3/3 pass).
- [x] **BUG-02: Scoped authoritative reports** — Generational request tracking in financial views clears state on error; AUD-10 provenance badges display data freshness.
- [x] **BUG-03: Invoice posting idempotency** — Server-side document posting via `POST /api/v1/documents/:type/:id/post` with mandatory `Idempotency-Key` (L-94 Step 2 & 2B).
- [x] **BUG-04 / AUD-01: Unified statement scope** — `StatementScope` shared across screen, server JSON, and PDF generator (PR #288).
- [x] **BUG-07: FX base-currency balancing** — Dual double-entry validation (document currency + base currency); odd-cent allocated to largest line; `home-currency-balance.test.ts` (7/7 pass).
- [x] **AUD-19: Signed Altman EBIT** — EBIT calculation preserves line signs so reversals do not inflate score (PR #300).

### Stage 2 — Recovery, replay identity & authority boundaries (Completed)
- [x] **AUD-02: Restore transaction boundary** — Retried restore transactions report each record once (PR #318, RESTORE-COUNTS); unbalanced entries refused prior to writes; D-98 browser test passes.
- [x] **AUD-03: Server RMA state authority** — Return authorizations transition via server with requester/approver separation and CAS (PR #302, ISS-143).
- [x] **AUD-07: Idempotency payload hashing** — Canonical payload hashing enforced on mutating routes.
- [x] **BUG-05: Local cache upsert** — Deduplicated ID upsert in `postingKit.ts` and `useLedgerStore.ts`; `post-cache-upsert.test.ts` passes.
- [x] **AUD-10: Report provenance** — Universal `{source, asOf, scope, error}` disclosure badge on all statement views (`report-provenance.test.ts` 30/30 pass).
- [x] **AUD-11: safeFetch DNS pinning** — One-time DNS resolution with public IP pinning against SSRF (PR #314).
- [x] **AUD-20: Database TLS verification** — Server certificate verified against `DATABASE_CA_CERT` when configured (PR #319).
- [x] **L-123: Server-side balances & snapshots** — Closed-year snapshots (`periodBalances`), server report opening (`balancesAsOf`), and chart of accounts / register balances above 20,000 cap (PR #334, #345, #351).

---

## Stage B implementation roadmap (ERPNext depth sprint)

With Stage A fully verified and approved, development proceeds to Stage B:

1. **EG-1 Engine Implementation (Build on merged design #348):**
   - Implement the repost/repair service that recalculates stock moving averages, COGS, and payment allocations following backdated corrections.
2. **EG-2: Payment Ledger:**
   - Create durable allocation entries (payment ↔ document, amount, currency, realized FX gain/loss, write-offs) separate from GL entries.
   - Build Payment Ledger report for audit reconciliation.
3. **EG-3: Period Closing Document:**
   - Create a posted Period Closing Voucher document that formally closes P&L balances to Retained Earnings per fiscal year.
4. **EG-7: Stock Closing Snapshot:**
   - Record period-end stock valuation snapshots (quantity + value per item/warehouse) to guarantee reproducible historical inventory valuation.
5. **EG-6: Landed Cost Posting:**
   - Transition landed cost from preview-only to posted inventory cost allocation on goods receipt.
6. **EG-4: Budget Posting Control:**
   - Enforce budget threshold checks (warn or refuse) at invoice and bill posting time.
7. **EG-9: Server-side Bank Rules:**
   - Execute bank categorization rules on the server during statement import.
8. **EG-10: Ledger Comparison Report:**
   - Build GL vs Payment Ledger comparison and invalid-entry repair report.
9. **EG-14: Opening Invoices Import:**
   - Migration tool to import open AR/AP invoices with original numbers and dates, reconciling with AU-4 opening balances.

---

## Owner's action items to open Stage A

1. **Paste migration in Supabase SQL editor:**
   `supabase/migrations/20261023000000_period_balances.sql`.
2. **Set environment variable in Vercel:**
   `DATABASE_CA_CERT` = downloaded Supabase SSL certificate.
3. **Rotate 4 secrets in Vercel:**
   `SESSION_SECRET`, `INVITE_SECRET`, `CRON_SECRET`, `SYSTEM_SALT`.
4. **Launch Stage A Synthetic Beta!**
