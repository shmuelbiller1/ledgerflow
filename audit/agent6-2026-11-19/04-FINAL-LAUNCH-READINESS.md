# Final Launch Readiness — Agent #6 — 2026-11-19

**Pinned SHA:** `5eacf71f633f00a5db7ae44d3fdba75b4d3700cf` + branch `arena/6e749e1a-ledgerflow` fixes  
**Date:** 2026-11-19 UTC  
**Assessor:** Agent #6 (Security lane + Independent Audit slice)  
**Standard:** Evidence-supported per `docs/RELEASE_GATE.md` (14 workflows C/V/B), `docs/FIRST_TESTERS_GATE.md`, `AGENTS.md` §9. This is a slice assessment, not a whole-product certification.

---

## Verdict: **CONDITIONALLY READY — pending owner actions + PR #908 + pen-test**

LedgerFlow at this pin **must not** be declared “READY FOR LAUNCH” for real customer money without the conditions below. It **is** suitable for **invited testers on synthetic data** once the two PRs below merge and a pen-test is recorded.

---

## What is solid at this pin

1. **Period & FX integrity (money lane) — Fixed at this pin.**
   - `period.*` commands (year close, snapshot rebuild, FX revaluation + undo) now require `write:workspaces` ( commit `5eacf71` fixes #820). A `write:transactions`-only key can no longer lock a year or restate FX.
   - Past-date FX revaluation (#806/#901) now uses that day's documents and refuses later settlements/credits/write-offs (409). Prevents “today’s open amount is not that day’s” rebuild.
   - These were the most recent money-critical defects; they are now closed.

2. **Admin audit & PDF original (security + statutory) — Fixed at this pin.**
   - Admin role grants now log `auditLogs` row in same transaction; swallowed audit failures now roll back ( #826 in `5eacf71`).
   - Israeli original `מקור` stamp: `GET …/pdf?preview=1` no longer consumes mark; `X-Preview-Only:1` added ( #845 in `5eacf71`).

3. **Money scaling (yen/dinar) — Fixed at this pin for server calculations.**
   - `ilAllocation`, `usSalesTaxReturn`, `usNexusWatch`, `prepaidSchedule`, `txFilters` now convert via `convertMinorUnits` not `* rate` ( #844 in `5eacf71`).

4. **This branch’s S-6 + S-24 — Fixed on `arena/6e749e1a-ledgerflow`.**
   - `Permissions-Policy` header now emitted on both Vercel edge (`vercel.json`) and Express (`securityMiddleware.ts` + `helmet.permissionsPolicy`). Clears ZAP `10063`.
   - Secret scan now runs both fast regex + `gitleaks/gitleaks-action@v2` with `.gitleaks.toml` + full history.

5. **Tenant isolation & RLS — Strong baseline.**
   - `security-baseline.json` + `supabase/tests/rls.test.sql` + `src/tests/security-s8-s38-s39-isolation.test.ts` (32-route BOLA + Postgres RLS) are present. S-8/S-38/S-39 are marked ✅ by prior AI #6 with live-DB evidence.

---

## What still blocks a launch for real money

### Must-fix before inviting real books (P0/P1)

| # | Issue | Status | Owner | Required |
|---|-------|--------|-------|----------|
| **L-1** | **Export/PDF money decimals:** `TopExpensesIncome`, `IncomeBySource`, `ExpenseByCategory`, `AverageMonthly` CSVs show `123.45` instead of `12345` in JPY and `12.345` in KWD (100×/10× error) — #910; same for statement/inventory #906 | **OPEN** — server money lane, not this PR | AI #1 / AI #7 | Fix `csvMoney` → currency-aware writer using book currency (not transaction currency); worked JPY/KWD fixtures; verify 5 USD controls stay same |
| **L-2** | **Empty query key `?=` on `GET /api/v1/transactions`** — fuzzer gate ST201 | **OPEN at pin, patch in PR #908** | AI #1 (PR #908) or this patch | Merge PR #908 or apply `patches/02-empty-query-key.patch`; re-run Schemathesis clean |
| **L-3** | **500 details leak** on email/incoming-event routes (info disclosure) | **OPEN at pin, patch in PR #908** | AI #1 | Merge PR #908 or apply `patches/03-safe-500-details.patch` |
| **L-4** | **Server PCI fencing** (card numbers in AI payloads) defense-in-depth | **OPEN at pin, patch in PR #908** | AI #1 | Merge PR #908 or apply `patches/04-server-pci-fencing.patch` |
| **L-5** | **24 routes return 500 not 403** — observability, wrong error code | **OPEN** (baseline) | AI #1 | Batch fix + update `security-baseline.json` (remove from `serverErrors`) |
| **L-6** | **Viewer can insert `documents` via PostgREST** — least-privilege | **OPEN** | AI #1 (migration) | Add RLS/`lf_rules` guard + RLS test; see `patches/05-viewer-documents-rls.patch` proposal |
| **L-7** | **Backup/PITR verification job** (S-19) — no scheduled check that PITR window exists | **OPEN** | Owner + AI #6 | Add docs/runbook + provider-API check (Supabase PITR) + alert |

### Must-do owner actions (from `docs/FOR_YOU.md` + `SECURITY_CONTROLS.md`)

- [ ] Apply L-123 migration in Supabase (owner launch actions, still open per `CURRENT_WORK.md`).
- [ ] Set `DATABASE_CA_CERT` in Vercel (DB TLS verification).
- [ ] Rotate 4 secrets: `SESSION_SECRET`, `SYSTEM_SALT`, `INVITE_SECRET`, `CRON_SECRET` (before real Plaid banks — `SYSTEM_SALT` encrypts bank tokens).
- [ ] Vercel Deployment Protection off for Production (or add custom domain) before customers.
- [ ] Email sender SMTP (Postmark/Resend) + `RESEND_API_KEY`/`EMAIL_FROM` + `EMAIL_WEBHOOK_SECRET` (with header `X-Email-Webhook-Secret`).
- [ ] Stripe live keys (after Deployment Protection off) — `STRIPE_SECRET_KEY` + `VITE_STRIPE_PUBLIC_KEY`; webhook secret already in Vercel.
- [ ] Israel Tax Authority registration for allocation numbers (IL-6) before filing.
- [ ] Accountant check of one real month of IL VAT + US payroll before removing “not for filing” banner.
- [ ] Supabase PITR on for live project + one restore drill to a copy (`scripts/restore-drill.mjs` evidence in `docs/eval/`).

---

## Release Gate mapping (only AI #6’s slice)

This agent does **not** re-certify all 14 workflows (W1..W14). For security perimeter only:

| Gate | Meaning | Status at this pin |
|------|---------|---------------------|
| **S-1 Shared rate limiter** | Counts shared across instances | ✅ (migration `shared_rate_limit_entries`) |
| **S-6 Security headers** | CSP + HSTS + XCTO + XFO + Referrer + **Permissions-Policy** | ✅ **after this branch merges** (was `~` at pin) |
| **S-24 Secrets scan** | Every push + history + `.gitleaks.toml` | ✅ **after this branch merges** (was `~`) |
| **S-34 Security headers e2e** | Headers present on `/` and `/api/health` | ✅ (extended in this branch) |
| **S-35 Privacy (cookie banner)** | #835 + AI #6 follow-up `arena/430b54c1` | ✅ (on that branch, not this pin) |

Other gates (W11, W13, ERPNext) remain Amber per `docs/RELEASE_GATE.md` and are not moved by this PR.

---

## Conditions → timeline

1. **This week:** Merge `arena/6e749e1a-ledgerflow` (S-6/S-24) + PR #908 (A6S-07 #827). Redeploy Vercel (for `vercel.json` header). Re-run CI + Schemathesis + ZAP baseline; attach clean reports.
2. **Before real books:** Fix L-1 (JPY/KWD CSV, #910) + L-5/L-6 (least-privilege) + L-7 (PITR check) + owner actions above. Re-verify with worked JPY/KWD figures + RLS tests.
3. **Before claiming “secure”:** Human pen-test against deployed preview (not live), with ZAP + auth coverage + OWASP ASVS L1 checklist `docs/security/OWASP_ASVS_L1_CHECKLIST.md`.

---

## What this report is NOT

- Not a whole-product launch certificate. It does not certify US/IL payroll accuracy, inventory costing, or bank-sync correctness — those belong to AI #1/AI #3/AI #4/AI #9.
- Not a live-environment attestation. It does not prove current Supabase migrations are applied in prod, TLS is terminating correctly, or backups are actually scheduled — those require dated operating evidence (`docs/SECURITY_CONTROLS.md` § “Highest-priority evidence work”).
- No production data was read or changed; no live site was scanned (per `docs/prompts/SEC-SCAN-1` owner rule).

---

## Evidence pointers

- **This audit:** `audit/agent6-2026-11-19/` (00..04 + patches + PR-BODY)
- **Prior Agent #6:** `audit/agent6-2026-11-12/04-FINDINGS-REGISTER-2026-11-12.md` (AF6-001..019), `audit/agent6-2026-11-16/`, `audit/agent6-2026-11-17-security-followup/`
- **CI:** `.github/workflows/security-sbom.yml` (this branch diff), `.github/workflows/zap-baseline.yml`, `.github/workflows/api-fuzz.yml`
- **Security baseline:** `security-baseline.json` + `security_spec.md` §3 + `docs/SECURITY_CONTROLS.md`
- **PRs:** #908 (AI #1, #827/#796/#857), this branch’s PR (S-6/S-24) — see GitHub after push

