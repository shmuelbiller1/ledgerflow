# Checkpoint 02 — Architecture, Ledger Door, RLS & Security Audit (Agent #7 — 2026-11-13)

- **Baseline Commit:** `e33b3f2bc8273ab2fcecf3affc34e0652d7d594c` (`upstream/main` == `origin/main`)
- **Live PostgreSQL Verification:** PostgreSQL 16.2 (`postgresql://postgres:postgres@127.0.0.1:5432/lf_test`) — `npm run test:rules` (`ALL RLS TESTS PASSED`) + live probes `probe-01`, `probe-02`, `probe-03`, `probe-05`, `probe-06` (`exit 0`, zero stderr).

---

## 1. Prior Agent #7 Findings (`#646`–`#662`) Re-Verification Matrix on `e33b3f2bc`

| Ref | Prior Finding | Live Status on `e33b3f2bc` | Exact Evidence |
|---|---|---|---|
| **C-1 / `#656`** | Direct browser writes to `transactions`, `payments`, `journalEntries`, `reconciliations`, `workspaceShards`, `auditLogs` UPDATE/DELETE | **CLOSED** | Revoked in `20261111000000_ledger_integrity_and_rls_hardening.sql`; live `role_table_grants` query confirms `authenticated` holds `SELECT` only. |
| **`#657` (`A7-01`)** | `bugPatterns.ts` missed variable-held `db.collection('transactions').doc(...)` references | **CLOSED** | Closed in upstream PR `#685`; `server-direct-ledger-write` = `11` (`paymentService.ts:493` included). |
| **`#654` (`A7-08`)** | `PUT /api/v1/transactions/:id` bypassed `requiredLabels` (`refusedLabels`) | **CLOSED** | Enforced in `src/server/routes/transactions/crudRoutes.ts:358-360`. |
| **Minor units (`postingCheck` / `prepaidService`)** | `postingCheck.ts` and `prepaidService.ts` ignored `JPY`/`KWD` minor units | **CLOSED** | Both now call `convertMinorUnits(...)`; however, `prepaidSchedule.ts:87` (`documentLine`) and 7 tax modules remained unpatched (see `A7N-04`). |
| **`#646`** | Unposted (`posted: false`) `open` credit notes/vendor credits deflate party balances; `date_required = false` on commercial docs | **STILL LIVE** | Reproduced in `probe-02` & `probe-06`; patched in `05-rls-assets-hardening-and-payroll-role-check.patch` + `06-reporting-statement-tb-cashflow-and-unposted-filter.patch`. |
| **`#652` / `#662`** | Posted/system/document ledger entries mutated or deleted in place | **STILL LIVE (incl. Fork PR `#28` bypasses)** | Fork PR `#28` leaves `reconcileRoutes.ts:165-188` and `bulkRoutes.ts:154-160` wide open (`probe-03`), misses `partialUpdate.exchangeRate`, `approved`/`reviewed` statuses, and `'credit-refund'`/`'credit-application-fx'`. Closed in `02-posted-immutability-complete-reconcile-batch-crud.patch`. |
| **`#653`** | Cross-currency bank transfer / multi-rate entry support | **STILL LIVE** | Single header `exchangeRate` + `TransactionEditModal` previously left `line.exchangeRate = 1` unsynced (`A7-02c` client side fixed on branch). |
| **`#640` / `#647`** | Duplicate `BEFORE UPDATE/DELETE` triggers on `public.transactions` | **STILL LIVE** | Both `trg_transactions_*` (`#640`) and `transactions_enforce_*` (`#647`) active in `information_schema.triggers`; deduplicated in `05-rls-assets-hardening-and-payroll-role-check.patch`. |

---

## 2. Newly Discovered Architecture, Ledger Door & Security Defects

### `A7N-01` (P1 / Critical) — `checkLedgerEntry` (`ledgerDoor.ts:40-44`) Rejects `TransactionValidator`'s Home-Currency `totalAmountCents`, Leaving Every Foreign `standalone-payment` Permanently Unvoidable
- **Files:** `src/server/services/ledgerDoor.ts:40-44`, `src/kernel/validation/TransactionValidator.ts:82`, `src/server/services/paymentVoidService.ts:159`
- **Root Cause:** `TransactionValidator.validateAndPrepare` computes `totalAmountCents` in **home currency** (`115,000` USD cents for `€1,000.00` at `1.15`), while `checkLedgerEntry` sums raw `Math.max(0, l.amountCents)` in **foreign currency** (`100,000` EUR cents) and throws `LedgerDoorError (400): The entry total (115000) does not match its lines (100000)`.
- **Impact (Live-Verified in `probe-01`):**
  1. Calling `voidPayment` on **any** header-FX or line-FX `standalone-payment` crashes `400` and leaves `payment.status = 'posted'` forever.
  2. Calling `refundCredit` on **any** foreign credit note or vendor credit crashes `400` (`probe-02`).
  3. Migrating `#654` (`POST/PUT /api/v1/transactions`) onto `ledgerWrite`/`ledgerCreate` would break all foreign-currency journal entries unless `checkLedgerEntry` accepts `homeDebits`.
- **Note on Eliminated Hypothesis:** `TransactionLineSchema` strips `baseAmountCents` inside `TransactionValidator.validateAndPrepare` before `settleHomeCurrency` runs, so `paymentVoidService.ts:127` does **not** double `baseAmountCents`; the actual defect is `checkLedgerEntry`'s currency mismatch.
- **Remediation:** `audit/agent7-2026-11-13/patches/01-ledger-door-fx-and-credit-refund-fixes.patch`.

### `A7N-02` (P1 / Critical) — `refundCredit` (`creditService.ts:363-410`) Refunds Unposted Credits (Fabricating A/R & A/P), Breaks Foreign/Non-2-Decimal Refunds, and Writes Zero Audit Logs
- **File:** `src/server/services/creditService.ts:363-410`
- **Impact (Live-Verified in `probe-02`):**
  1. Refunding an `open` credit with `posted: false` succeeds (`200`), crediting Cash `-50,000c` and debiting A/R `+50,000c` against a credit that never credited A/R — fabricating `+$500.00` of phantom A/R on the Balance Sheet.
  2. Foreign-currency refunds fail `400 LedgerDoorError` (`55000 != 50000`) and omit `convertMinorUnits` (`JPY`/`KWD`).
  3. Zero `auditLogs` rows are written (`auditLogCount: 0`).
- **Remediation:** `audit/agent7-2026-11-13/patches/01-ledger-door-fx-and-credit-refund-fixes.patch`.

### `A7N-03` (P1 / High) — `POST /api/v1/transactions/reconcile` and `POST /api/v1/transactions/batch` Bypass Posted & System Entry Immutability
- **Files:** `src/server/routes/transactions/reconcileRoutes.ts:165-188`, `src/server/routes/transactions/bulkRoutes.ts:140-165`
- **Impact (Live-Verified in `probe-03`):**
  - `POST /reconcile` (`200`) flips a posted `invoice-posting` entry (`status: 'completed'`) to `'void'` (wiping Revenue & A/R while the Invoice stays `'sent'`) and rewrites a posted `depreciation` entry's `amountCents` from `20,000` to `1`.
  - `POST /batch` (`200`) demotes posted `'completed'` entries back to `'draft'`, removing them from all financial statements without any reversal or audit trail.
- **Remediation:** `audit/agent7-2026-11-13/patches/02-posted-immutability-complete-reconcile-batch-crud.patch`.

### `A7N-06` (P1 / High) — Bookkeeper RLS Tampering on `public.assets` Resets `accumulatedDepreciationCents = 0` and Forces Server `runDepreciation` to Double-Post GL Depreciation
- **Files:** `supabase/migrations/20261111000000_ledger_integrity_and_rls_hardening.sql:357-364`, `src/server/services/depreciationService.ts:56-62`
- **Impact (Live-Verified in `probe-05`):** Authenticated `bookkeeper` holds direct `UPDATE` on `public.assets` with `accumulatedDepreciationCents` in `allowed_keys` and absent from `immutable_keys`. Resetting `accumulatedDepreciationCents` to `0` via PostgREST causes `runDepreciation` to post a second `$500.00` (`50,000c`) GL depreciation entry for the exact same month (`glDepreciationExpenseCents: 100000` = `2x`).
- **Remediation:** `audit/agent7-2026-11-13/patches/05-rls-assets-hardening-and-payroll-role-check.patch`.

### `A7N-08` & `A7N-09` (P2 / Medium) — `PUT /api/v1/transactions/:id` Stale `updatedAt` Self-Conflict (`409`) & `payrollImportService` Missing In-Transaction Role Re-Check
- **Files:** `src/server/routes/transactions/crudRoutes.ts:386-401`, `src/server/services/payrollImportService.ts:96`
- **Impact:** `PUT /transactions/:id` writes `FieldValue.serverTimestamp()` (`2026-11-13T...`) to PostgreSQL but echoes back the client's stale `transaction.updatedAt` (`2026-10-01T...`) in `res.json({ data: transaction })` (`probe-06`: 2nd edit using returned `data.updatedAt` immediately fails `409 Conflict`!). Meanwhile `payrollImportService.ts:96` omits an in-transaction `owner`/`accountant` role check (unlike `payRunService.ts:44`), creating a TOCTOU window on role demotion.
- **Remediation:** Patches `02` & `05`, plus client `entryActions.ts` fix committed on branch.

---

## 3. Pass 6 Security Audit Findings (`csrfProtection`, `fileValidation`, Webhooks, Upload Routes)

1. **`csrfProtection` (`server.ts:83`, `src/server/middleware/csrf.ts`):**
   - Verified safe: `/api/ai/*` authenticates exclusively via `Authorization: Bearer <JWT>` (`authenticateUser` header extraction, never ambient cookies), and `/api/webhooks/*` / `/api/stripe/webhook` / `/api/plaid/webhook` verify cryptographic HMAC signatures (`Stripe-Signature`, Plaid JWT/SHA-256, `X-LedgerFlow-Signature`) over raw request bodies. Browser cookie/session state cannot forge requests to any exempted path.
2. **`fileValidation.ts:76-89` (CSV UTF-8 heuristic):**
   - `validateMagicBytes` checks UTF-8 validity and null-byte absence on `.csv` uploads. It is wired only to `/api/upload-bank-csv`, which parses rows in memory and `fs.unlink`s the temp file immediately in `finally` — never served back as `Content-Type: text/html` and CSV formula cells are sanitized by `sanitizeCsvCell` on export. Low residual risk: non-UTF-8 bank CSVs (Windows-1255 / ISO-8859-8 Hebrew bank exports) are rejected at magic-byte validation if not transcoded first.
