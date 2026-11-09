# Independent Engineering Audit Report — LedgerFlow

**Audit Target Commit SHA:** `02ae23e779f8a191386c613cc706638068b601b3` (Post-PR #522)
**Working Branch:** Isolated agent branch
**Auditor:** Independent Ledgerflow Engineering Agent
**Review Target:** Shmuel Biller (`shmuelbiller1`)
**Scope:** Architecture, Accounting Calculation Correctness, Financial Transaction Integrity, Security Vulnerabilities, Database Consistency, and Automated Test Adequacy.

---

## Executive Summary & System Architecture

LedgerFlow is an enterprise resource planning and continuous double-entry ledger platform built on React 19, TypeScript, Vite, Tailwind CSS, Zustand, and Supabase PostgreSQL.

The system enforces a strict 3-layer architecture:
1. **Layer 1 (Durable Data & Browser Context):** Canonical financial records live in workspace-scoped Supabase PostgreSQL tables accessed via a Firestore-style compatibility API (`src/server/db/pgFirestore.ts` and `src/lib/db/`). Runtime client state resides in `useLedgerStore`, which is an ephemeral cache rather than authoritative ledger truth.
2. **Layer 2 (Pure Math Algorithms):** Pure computation modules (`src/lib/algorithms/`, `src/kernel/`) that never make network requests or mutate state directly.
3. **Layer 3 (UI Lenses & Dynamic Registries):** Modular React components registered via `src/config/registry.tsx`.

### Core Architectural Invariants Checked
- **Top-Level Scoped Collections:** Verified. All entities (`transactions`, `chartAccounts`, `invoices`, `bills`, `bankLines`, `projects`, etc.) exist as top-level collections partitioned strictly by `workspaceId`. No nested subcollections are used.
- **Double-Entry Equilibrium:** Every posting requires strict zero-sum balancing ($\sum \text{debits} + \sum \text{credits} = 0$).
- **Signed Directionality vs Absolute Totals:** `totalAmountCents` is strictly positive/absolute; debits vs credits are determined solely by line items.
- **Dynamic Role Resolution:** Hardcoded account IDs are avoided in favor of `resolveAccountRole(account)` or rejection.
- **Closed Period Governance:** Closed fiscal periods enforce reverse-and-correct workflows, rejecting destructive updates or deletions.

---

## 1. Accounting Calculation Correctness

### Confirmed Finding AF-012: Tax/Rule Override Chain Ordering Nondeterminism
- **Location:** `src/lib/rules/rules.ts:60-75` (`evaluateRules`)
- **Severity:** P2 (Calculation engine contract; latent in current shipped packs)
- **Description:** When evaluating rules with chaining overrides (Rule A overrides Rule B, Rule B overrides Rule C), the resulting set of applied rules depends on the array order of candidate rules passed to `evaluateRules`.
- **Reproduction:**
  Running `npx tsx audit/function-audit/probes/af012-rule-chain-order.mjs`:
  - Order `[A, B, C]`: outputs applied `[A, C]`, displaced `B by A`. (Rule C is NOT displaced because Rule B was evaluated after A displaced B, so B's override on C was skipped).
  - Order `[B, A, C]`: outputs applied `[A]`, displaced `B by A`, `C by B`.
  - Order `[C, B, A]`: outputs applied `[A]`, displaced `C by B`, `B by A`.
- **Production Pack Audit:** An AST inspection of all 18 shipped rule packs (584 rules, 67 overrides via `audit/function-audit/probes/af012-shipped-pack-chains.mjs`) confirmed that current shipped packs have 0 chained override targets and 0 dangling targets. Thus, no current live tax calculation is corrupted, but the engine is order-sensitive for any multi-tier override graphs.
- **Recommended Fix:** Topological sorting or iterative graph reduction of override chains before displacement resolution in `evaluateRules()`, or explicitly disallow/validate against chained overrides in rule pack linting (`scripts/lint-rule-packs.ts`).

---

### Confirmed Finding AF-010-F1: Divergent Monetary Allocation Contracts (`allocateCents`)
- **Location:**
  - `src/kernel/templates/TransactionTemplates.ts:20` (`allocateCents`)
  - `src/lib/Allocation.ts:8` (`allocateCents`)
- **Severity:** P2 (Architectural consistency & contract safety)
- **Description:** Two functions sharing the same name `allocateCents` implement conflicting behaviors on degenerate inputs:
  - `TransactionTemplates.allocateCents`: Clamps negative weights to 0; if total weight is 0 or weights array is empty, it coerces the entire amount onto the first element `[totalCents, 0, ...]`.
  - `Allocation.allocateCents`: Annotated as the "canonical monetary allocation module". It throws an `Error` on total weight $\le 0$, negative weights, or non-safe-integer totals; returns `[]` on empty weights.
- **Reproduction:** Verified in test `src/tests/audit-af010-money-primitives.test.ts` (Subtest 2).
- **Recommended Fix:** Unify allocation logic into a single canonical module in `src/lib/Allocation.ts` supporting an explicit configuration parameter for degenerate fallback handling (`{ onZeroWeight: 'throw' | 'first-slot' }`).

---

### Confirmed Finding AF-010-F2: Parenthesized Accounting Notation in `utils.parseAmountToCents`
- **Location:** `src/lib/utils.ts` re-exporting `src/lib/moneyFormat.ts:parseAmountToCents`
- **Severity:** P2 (User input parsing)
- **Description:** `utils.parseAmountToCents('(100.00)')` stripped parentheses and returned `+10000` (positive) instead of `-10000`. By contrast, `TruthEngine.parseAmountToCents` and `bankCsvAmountCents` handled parentheses correctly.
- **Status at HEAD:** Verified fixed in `src/lib/moneyFormat.ts`, verified by `src/tests/audit-af010-money-primitives.test.ts` Subtest 3 passing.
- **Recommendation:** Maintain regression tests and standardize all financial input parsers across dialogs on `TruthEngine`/`moneyFormat`.

---

### Confirmed Finding AF-002-F1: Non-positive Tax/Discount Lines Dropped in Posting Templates
- **Location:** `src/kernel/templates/TransactionTemplates.ts:167, 219` (`buildInvoiceLines`, `buildBillLines`)
- **Severity:** P2 (Defensive contract integrity)
- **Description:** In `buildInvoiceLines` and `buildBillLines`, tax and discount legs are emitted only if `taxCents > 0` or `discountCents > 0`. If invoked directly with a negative invoice total and negative tax (e.g. attempting to construct a credit adjustment via the base invoice template), the tax line is omitted, generating an unbalanced transaction where lines sum to the negative tax amount rather than 0.
- **Mitigation:** Production callers currently guard against non-positive totals prior to calling these builders (`invoicePosting.ts` and `billPosting.ts` check `if (amount <= 0) return;`), and credit notes use `buildReversalLines`.
- **Recommended Fix:** Add an explicit assertion `sum(lines) === 0` at the exit of `buildInvoiceLines` and `buildBillLines` that throws if unbalanced.

---

## 2. Financial Transaction Integrity

### Confirmed Status AF-001 / Issue #151: Plaid Bank Feed Cursor & Durable Ingestion
- **Location:** `src/server/routes/plaidRoutes.ts:153-220`, `src/server/services/plaidIngest.ts`
- **Severity:** P1 (Resolved at HEAD; Stage B prerequisite)
- **Investigation:** Prior audit identified that `/api/v1/plaid/sync` advanced the connection `syncCursor` while relying on the frontend to persist lines, causing unrecoverable feed lines if a client crashed.
- **Verification at HEAD:**
  - `src/server/services/plaidIngest.ts` (`storePlaidSync`) now atomically writes downloaded transactions to `bankLines` in the same database transaction that updates `syncCursor`.
  - Deduping via `importIdentity` (`plaid:<transaction_id>`) prevents duplicate posting.
  - Contract pinned and verified passing in `src/tests/audit-af001-plaid-contract.test.ts` (4/4 pass).

---

### Confirmed Status BUG-07: Dual Double-Entry Balancing in Foreign Currency
- **Location:** `src/kernel/validation/TransactionValidator.ts:126`, `src/lib/txFilters.ts:99`
- **Severity:** P1 (Resolved at HEAD)
- **Investigation:** Multi-line foreign currency transactions converted line-by-line could result in off-by-one cent imbalance in base home currency.
- **Verification at HEAD:** Dual validation is active; residual rounding cents are allocated to the largest line. `src/tests/home-currency-balance.test.ts` verified passing (7/7).

---

### Confirmed Status BUG-03 / L-94: Server-Side Document Posting Idempotency
- **Location:** `src/server/routes/documentPostRoutes.ts`, `src/server/services/documentPostService.ts`
- **Severity:** P1 (Resolved at HEAD)
- **Investigation:** Document posting enforces atomic server-side execution with required `Idempotency-Key` headers and deduplication, preventing double-accruals on network retries.

---

## 3. Security Vulnerabilities

### Confirmed Finding SEC-01: Dependency Security Vulnerabilities (`npm audit`)
- **Severity:** P2 (Moderate severity in dev/build dependencies)
- **Findings Summary:**
  `npm audit --audit-level=high` reports 17 vulnerabilities (2 low, 15 moderate):
  1. `deepmerge` $\ge$ 4.2.0 (GHSA-gcqx-w48m-w2h4): Prototype pollution via `workbox-build` / `vite-plugin-pwa`.
  2. `glob` 9.0.0–14.0.1 (GHSA-3g3m-2fjr-6pw4): AbortSignal cancellation bypass in `workbox-build`.
  3. `minimatch` 7.0.0–11.0.0 (GHSA-g3hv-75wg-m249): Potential DoS via globparts amplification in ESLint and `@typescript-eslint`.
  4. `qs` 2.2.5–6.16.0 (GHSA-q8mj-m7cp-5q26, GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g, GHSA-6pq8-jhm2-2vcw): Remotely triggerable DoS in `typed-rest-client` dependency.
- **Assessment:**
  - `deepmerge`, `glob`, and `minimatch` affect build tooling and ESLint plugins, not production runtime request processing.
  - `qs` resides under `typed-rest-client`. The primary application routes use Express 5 with standard body parsers.
  - Noticeable: `follow-redirects` was previously upgraded to `1.16.2`, successfully remediating GHSA-mrwp-f3q8-3g9p.
- **Recommended Fix:** Coordinate a package override or update for `typed-rest-client` and `vite-plugin-pwa` during a scheduled maintenance window after validating against Vite 6 bundling.

---

### Confirmed Finding AF-010-F5: Leading-Whitespace CSV Injection Bypass
- **Location:** `src/lib/csv.ts:sanitizeCsvCell`
- **Severity:** P3 (Edge-case CSV export sanitization)
- **Description:** `sanitizeCsvCell` prepends a single quote to neutralize cells starting with `=, +, -, @, \t, \r`. However, a cell with a leading space before a formula operator (e.g. `" =1+1"`) bypasses the initial character check while remaining executable in certain spreadsheet applications.
- **Recommended Fix:** Update `sanitizeCsvCell` to trim leading whitespace before testing for formula prefixes:
  ```ts
  const trimmed = value.trimStart();
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return `'${value}`;
  }
  ```

---

## 4. Database Consistency

### Schema Migrations & Isolation Review
- **Location:** `supabase/migrations/` (35 migration files)
- **Review:**
  - Row Level Security (RLS) policies consistently enforce `workspace_id` isolation across all tables.
  - Closed fiscal periods are enforced via PostgreSQL trigger functions (`lf_guard`) which reject mutating or inserting entries into closed dates unless authenticated as a platform administrator or performing a valid reversal.
  - Migrations `20261023000000_period_balances.sql`, `20261023010000_repost_queue.sql`, and `20261025010000_payment_allocations.sql` maintain transactional consistency for period balances and payment ledgers.

---

## 5. Missing or Inadequate Automated Tests

### Identified Test Coverage Gaps
1. **Concurrent Database Postings Under Real PostgreSQL:**
   - Most unit tests mock `pgFirestore` or execute in-memory. While `supabase/tests/rls.test.sql` tests database rules, end-to-end race tests simulating simultaneous double-posting on the same idempotency key or period close require a live test database (`LF_TEST_DATABASE_URL`).
2. **Adversarial Multi-Tier Override Rules Tests:**
   - Shipped rule packs currently have 0 multi-tier override chains, but no automated test enforces this property in CI.
   - Recommended test: Add `audit/function-audit/probes/af012-shipped-pack-chains.mjs` as a permanent CI check in `npm run lint:rule-packs`.
3. **CSV Whitespace Formula Injection:**
   - Existing CSV tests check standard formula prefixes but do not assert against whitespace-prefixed formulas (`" =SUM(...)"`).

---

## Verification Test Results Executed in this Session

| Test Suite / Probe | Command | Result | Pass/Fail Count |
|---|---|---|---|
| Rule override chain order probe | `npx tsx audit/function-audit/probes/af012-rule-chain-order.mjs` | Completed | Confirmed nondeterminism on chained overrides |
| Shipped pack chain audit probe | `npx tsx audit/function-audit/probes/af012-shipped-pack-chains.mjs` | Completed | 18 packs, 584 rules, 0 chained overrides |
| Audit AF test suite | `tsx --test src/tests/audit-af*.test.ts` | Completed | **30 / 30 Passed (0 failed)** |
| TypeScript check | `npm run lint:types` | Completed | Clean (0 errors) |
| ESLint check | `npm run lint:eslint` | Completed | Clean (0 errors, 42 warnings $\le$ 42 cap) |
| Bug pattern ratchet | `npx tsx scripts/bug-patterns.ts` | Completed | At or below baseline thresholds |
| Dependency audit | `npm audit --audit-level=high` | Completed | 17 vulnerabilities (dev/moderate) |

---

## Branch & Pull Request Feasibility for Shmuel Biller

### Coordination & Isolation Rules
- **Direct Pushes to Main:** Strictly forbidden for all agents except AI #1 (the lead).
- **Working Remote:** `origin` is `https://github.com/Chaim-Richard/ledgerflow` (fork).
- **Upstream Target:** `https://github.com/shmuelbiller1/ledgerflow` (`main`).
- **PR Feasibility:**
  - This audit report is completely isolated in `audit/INDEPENDENT_AUDIT_REPORT_2026.md`.
  - No financial posting, schema migration, or production code has been modified or combined with other agent workstreams.
  - A separate branch (e.g. `audit/independent-audit-2026`) can be pushed to `origin`, and a Pull Request can be opened targeting `shmuelbiller1/ledgerflow:main` for Shmuel Biller's review with maintainer edits allowed.
