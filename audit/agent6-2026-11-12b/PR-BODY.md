# Agent #6 — #651 fixed, #652/#662 server half fixed, plus three verification probes

**Branch:** `arena/b33f6cd0-ledgerflow` (fork `Chaim-Richard/ledgerflow`), based exactly on upstream `main`
`e33b3f2bc8273ab2fcecf3affc34e0652d7d594c` (2026-11-12T22:22:42Z).
**Do not merge without the owner's review; nothing here was merged.**

## The fixes

### 1. `#651` — two report figures converted a foreign payment with the exchange rate alone (P1)

A payment in a currency with a different number of minor units than the books was 100× (JPY) or 10× (KWD) out.

| Path | Before | After |
|---|---|---|
| Sales-rep commission — `src/lib/salesReps.ts:167` | a 10 % commission on a ¥100,000 sale at 0.0067 in USD books = **67 cents** | **6,700 cents ($67.00)** |
| Cash-basis revenue — `src/server/reports/cashBasis.ts:123` | a fully paid ¥100,000 invoice recognised **670 of 67,000** (1 %) | **67,000** (100 %) |

The payment's currency is now part of `CommissionPayment`/`CashBasisPayment`, the conversion is
`convertMinorUnits(amount, rate, paymentCurrency, baseCurrency)`, and both routes/screens pass the workspace
currency. Rows with no saved currency keep the old rate-only reading (legacy data).

### 2. `#651`'s sibling, found while proving it — a *partly* paid foreign invoice recognised its whole posting (P1)

`cashBasis.ts` re-valued the accrual's lines with `lineAmount()` but kept their own `baseAmountCents`, which
`lineAmount` prefers — so the paid share was ignored for every foreign accrual. The shared lines now drop
`baseAmountCents` (they are base cents at rate 1 at that point). Test: the part-payment and KWD cases.

### 3. `#652` / `#662` — the generic entry routes let a bookkeeper edit or reverse an invoice's or payment's entry (P1)

`PUT /api/v1/transactions/:id` (both branches) and `POST /api/v1/transactions/:id/reverse` now refuse, with a
pointer to the document, anything that changes a document entry's status, figures, date, metadata, rate or locks —
and refuse to un-post a posted entry (`status → failed | draft`, which `isPostable` drops from every report).
**Flags, notes and other annotations still save**, because the ledger list's flag button PUTs `{ isFlagged }` on
every row including document entries; a whole-record rewrite and a reversal are refused outright. The platform-admin
override mirrors the existing certified/cleared locks. Audit rows for in-place edits now carry `before`/`after`
(status, date, total, description, line count, currency, rate) — issue #652(d).

New file: `src/server/services/ledgerEditGuards.ts`. The rule is the browser's own (`isDocumentEntry`).

## Tests

| Suite | Result |
|---|---|
| `src/tests/currency-minor-units-reports.test.ts` (new, 5 worked-figure cases: JPY, KWD, USD control, legacy row, part payment) | **5/5** |
| `src/tests/ledger-edit-guards.test.ts` (new, 8 cases incl. flag-only and mixed partial updates, wiring) | **8/8** |
| `src/tests/cash-basis.test.ts` + `sales-reps*.test.tsx` (neighbours) | **15/15** |
| `npx tsc --noEmit` | 0 errors |
| ESLint on every touched file | 0 errors, 0 warnings |
| `audit/function-audit/probes/af008-641-aging-vs-ledger.ts` | **20/20 OK** (V7/V8 were DEFECT before this branch) |

**Not run here:** the DB-gated suites, `npm run test:rules` and Playwright — this sandbox has no PostgreSQL and no
browsers. The endpoint-level proof of the new 409s belongs to the Postgres CI job.

## Re-verified at this pin (no change needed)

`#641`/`#648` (`toBaseCents` minor units) are fixed on `main`; AF6-004/005/006 and the 12 Nov patches 02–07 are
landed; the 10 Nov findings F-01 (`taxPlace.region`) and F-08 ("Recorded as filed" per state) are fixed. New
positive evidence: statement cross-checks (11 cases), money-function invariants (26 cases) and the audit hash
chain with tamper detection (7 cases) — all pass, in `audit/agent6-2026-11-12b/probes/`.

Full register: `audit/agent6-2026-11-12b/02-FINDINGS-REGISTER.md`. Launch verdict: unchanged — **not ready** for
real accounting until the remaining money-lane issues (#653, #654, #646) and the DB/browser gates are closed.
