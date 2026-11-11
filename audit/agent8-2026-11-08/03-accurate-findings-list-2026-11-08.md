# Agent #8 — Accurate Findings List (2026-11-08)

**Session:** Continuation of independent audit (Pass A)  
**Authority:** Review-only. No money / posting / tax / server / migration code changed by this agent.  
**Pinned base (fork main at last push):** `02ae23e7…` / current HEAD may be newer  
**Prior work:** AF-001..AF-010 slices, issues #517/#518/#519, branch `ai8/af004-reachability-and-scorecard-2026-11-05`

## Executive status for launch readiness

Stage A (synthetic bookkeeping beta) is largely ready per prior RELEASE_GATE work. Remaining high-impact open items are concentrated in **tax authority / entity label handling (AF-004)** and a small set of money micro-function contracts (AF-010). Bank cursor durability (AF-001) was fixed by AI #1. Label cent balancing (AF-002) is verified clean on reachable paths.

## Accurate findings register (current)

| ID | Outcome | Severity | Tracked | Notes / Recommendation |
|----|---------|----------|---------|------------------------|
| **AF-001** | **Fixed** by AI #1 (29–31 Oct) | — | #151 closed | Cursor + bankLines now atomic. |
| **AF-002** | verified-no-finding (reachable) + latent F1 | Latent P2 | this audit | Non-positive tax/discount legs dropped only if called with negatives; posting guards block today. Optional assert in builders. |
| **AF-004-F1** | **Verified defect** | **P1** (P0 if multi-entity reachable) | #517 | `resolveSellerProfile` merges place fields + registrations across countries with no country check. `taxProfilesProblem` does not reject cross-country inheritance. UI (`TaxPlaceSuggestion`) uses the result. |
| **AF-004-F2** | **Verified defect** | **P1 / P0 candidate** | #518 | US sales-tax return reads `doc.dimensions` while screens keep entity label on first line → sales can be attributed to wrong registration. |
| **AF-004-F3** | **Verified defect** | P2 | #519 | US customer place with country but no state is silently omitted (no unassigned bucket / warning). |
| **AF-004-F4** | Verified | P3 | this audit | Dual buyer-state rules disagree for non-US buyers (return vs quarter journey). |
| **AF-004-F5** | Verified | P3 | this audit | Set-valued facts keep first occurrence; verified flag can be false when a later verified copy exists. |
| **AF-010-F1** | Needs re-check at current HEAD | P2 | this audit | Two `allocateCents` implementations with opposite contracts (coerce vs throw). |
| **AF-010-F2** | Appears mitigated in current `moneyFormat.ts` | Was P2 | this audit | Parenthesized negatives now handled (`text.startsWith('(')`). Re-verify with dedicated test. |
| **AF-010 remaining** | Multiple P2/P3 | P2–P3 | SCORECARD | Infinity formatting, non-Latin digits → 0, expression range, CSV formula space bypass. |
| **AF-003** | Open (server reserved) | — | #141 / A-72 | Statement scope (entity + period) must match screen / JSON / PDF / export. |
| **AF-005** | Open | — | #130 / #131 | Stock history / as-of valuation. |

## What was body-read and/or executed this cycle
- Full body of `src/lib/tax/profile.ts` (`resolveSellerProfile`, `taxProfilesProblem`, place validation).
- Full body of `TaxPlaceSuggestion.tsx` (confirms UI reachability of F1/F2).
- Full body of `src/lib/moneyFormat.ts` (`parseAmountToCents`, `formatDecimal`, locale handling).
- Prior AF-001 / AF-002 / AF-004 / AF-010 evidence re-read and status reconciled.

## Honest coverage
- Fully inspected functions (all prior slices + this session): ~80.
- Source inventory still ~1,300+ non-test TS/TSX files / ~10k function-like declarations.
- This is **not** a complete Pass A. It is a prioritised, evidence-backed list of the defects most likely to affect correct books or tax reports.

## Preservation
- This document will be pushed to branch `ai8/accurate-findings-2026-11-08` on the fork.
- Also uploaded to Google Drive folder `LedgerFlow-Audit-Agent8-2026-11-05` (or successor).
- Previous session artifacts remain on Drive and under `docs/archive/audit/agent8-2026-11-05-session-*`.

## Recommended owner actions (priority)
1. Decide product rule for cross-country tax profile inheritance (AF-004-F1) and whether stage-A can create such profiles.
2. Align entity-label source of truth for US sales-tax returns (AF-004-F2).
3. Add unassigned-state handling or validation for US places (AF-004-F3).
4. Close or re-verify AF-010 micro-function contracts with focused tests.

**AI #8** — continuing. Ready for AF-003 / AF-005 / deeper posting graph once owner feedback arrives on the three open tax issues.
