# PR, Bot Review & Open Issue Resolution Log — Agent #6 (`2026-11-12`)

## 1. Resolution of PR `#618` CodeRabbit Review Comments (8 Notes)

PR `#618` (`ai6/security-audit-2026-11-05`) received 8 actionable review comments from `coderabbitai[bot]`:
- **4 comments on `audit/ai6/security-audit-2026-11-05.md`** (present on `main`):
  1. *Line 65-72 (`server.ts` route line citations)* — Re-verified against current modular `server.ts` (`<= 188` lines after `F-01` split) and documented exact current modules in Session 3 Addendum.
  2. *Line 139 (`S-19` `LF_ALLOW_GUEST_AUTH=1`)* — Clarified that guest auth is strictly opt-in (`NODE_ENV !== 'production'` and `LF_ALLOW_GUEST_AUTH=1`) and audited via `checkProductionConfig`.
  3. *Line 174 (`S-24`/`S-27` `.gitleaks.toml`)* — Corrected stale claim that `.gitleaks.toml` failed to parse; confirmed valid TOML and expanded `.github/workflows/security-sbom.yml` to enforce all 9 secret pattern classes in CI (`AF6-017b`).
  4. *Line 223 (`S-30` upload scope)* — Clarified that `POST /api/upload-bank-csv` performs magic-byte/content inspection via `validateUploadedFile` and unlinks temporary files on all exit paths, while JSON document routes enforce strict `1mb`/`15mb`/`50mb` route-scoped body limits (`securityMiddleware.ts`).
- **4 comments on `src/tests/security/*` (PR `#618`-only branch files)**:
  - Avoided copying PR `#618`'s sub-directory path (`src/tests/security/*.test.ts` was outside `package.json`'s `test:shard` glob `src/tests/*.test.{ts,tsx}`!) and avoided source-regex-only assertions where behavioral calls are possible.
  - Placed new CI-executed tests directly at `src/tests/agent6-security-and-fx-audit.test.tsx` so `npm run test:shard` executes all assertions in CI using real behavioral calls (`JournalEntryModal` DOM + `settleHomeCurrency` + `lineAmount` + `checkLedgerEntry`, `withReversal`, `checkProductionConfig`, `validateUploadedFile`, `maskCardNumbers`).

---

## 2. Resolution & Cross-Mapping of Open GitHub Issues

| Issue | Title | Agent #6 Disposition |
|---:|---|---|
| **#657** | `L-95` `ledgerDoor` CI guard gap | **FIXED DIRECTLY ON BRANCH (`AF6-016`)**: Upgraded `scripts/bug-patterns.ts` to resolve variable-held `collection('transactions')` and `.doc(...)` bindings (`const txRef = ...`), exposing 13 previously invisible direct writes across 9 server files (`reconcileRoutes.ts`, `crudRoutes.ts`, `paymentService.ts`, `recurringService.ts`, etc.) and locking per-file ceilings in `ledger-door-baseline.json` + `src/tests/bug-patterns.test.ts`. |
| **#641** | Multi-currency journal / home-currency discrepancy | **ROOT CAUSE IDENTIFIED & FIXED (`AF6-003` + `AF6-019`)**: Fixed `JournalEntryModal.tsx` `exchangeRate²` double-conversion, `DocumentLineEditor.tsx` `JPY`/`KWD` minor-unit parsing, and `autoReversal.ts` `baseAmountCents` negation; plus `Patch 03` (`fxRevaluation.ts` `JPY`/`KWD`) and `Patch 07` (SQL `exchangeRate` trigger). |
| **#646, #648, #650–#654, #661, #662** | Accounting / Server / Report open items | Cross-checked against open PRs (`#663, #665, #667, #670, #671, #672`) and AI #1's reserved server/math lane; verified zero file collisions between our branch (`arena/c3c0cb2e-ledgerflow`) and all active agent PRs. |

---

## 3. Open PR Collision Audit (`Zero Overlapping Files`)

Files modified on `arena/c3c0cb2e-ledgerflow`:
1. `.github/workflows/security-sbom.yml`
2. `audit/ai6/security-audit-2026-11-05.md`
3. `audit/agent6-2026-11-12/**` (new Agent #6 directory)
4. `ledger-door-baseline.json`
5. `package.json` (`--max-warnings 2` only)
6. `scripts/bug-patterns.ts`
7. `src/components/common/DocumentLineEditor.tsx`
8. `src/components/ledger/JournalEntryModal.tsx`
9. `src/lib/autoReversal.ts`
10. `src/tests/agent6-security-and-fx-audit.test.tsx` (new)
11. `src/tests/bug-patterns.test.ts`

Checked against open PRs `#618, #636, #647, #660, #663, #664, #665, #667, #668, #669, #670, #671, #672`: **0 conflicting production files** (note `#618` is an older unmerged Nov-5 security-audit doc PR whose 4 `security-audit-2026-11-05.md` review comments are superseded/resolved cleanly here).

---

## 4. Vercel Preview Deployment Note

Per project owner instructions, automatic Vercel preview deployments on PRs/merges were intentionally disabled to control costs; a red/skipped `Vercel` status check alone is expected infrastructure behavior and not a code failure. All GitHub Actions CI gates (`tsc`, ESLint ratchet, architecture layers, rule packs, tax tables, bundle checks, unit/integration shards, SBOM/secret scan) are the authoritative code-quality checks.


## Post-review correction

Owner-requested corrections for the two P0 create-route findings and the multi-line FX settlement were made directly on PR #673, together with regression tests. Patch 01 was archived as a text reference and must not be applied twice. Remaining standalone patches are 02–07. Review the current CI run and the database-backed test results before approval.
