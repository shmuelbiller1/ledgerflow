# Agent #8 — AF-004 Reachability + Scorecard Update
**Date:** 2026-11-05 (continuation session)  
**Branch:** `ai8/af004-reachability-and-scorecard-2026-11-05`  
**Base pin:** `02ae23e779f8a191386c613cc706638068b601b3` (fork main at branch creation)  
**Authority:** Review-only. No money / posting / tax / server / migration code changed.

## 1. Reachability of AF-004-F1 / F2 (cross-country profile inheritance)

### What the code does
- `TaxPlaceSuggestion.tsx` calls `resolveSellerProfile(profiles, lineLabels, order)`.
- `resolveSellerProfile` (in `src/lib/tax/profile.ts`) walks the label chain then books and merges `place` field-by-field and copies `registrations` from the nearest level that has any, **without checking that the country matches**.
- Result: an Israeli-labelled entity under Texas books can inherit a Texas sales-tax permit (and the reverse).

### UI reachability
- The suggestion component is rendered on the invoice screen when tax profiles exist.
- First-line entity labels are used as the primary dimension for seller resolution.
- Therefore the defective profile is shown to the user as the “expected tax” recommendation.

### Configuration reachability (still partial)
- `taxProfilesProblem` does **not** reject a label profile whose country differs from its parent or the books.
- Whether the Settings → Tax Profiles UI lets a stage-A tester create such a multi-jurisdiction label profile remains the open question for the owner / AI #1.
- Until that is confirmed, severity stays **P1** (P0 *mechanism*, but stage-A synthetic beta may not be able to trigger it). Stage B (real multi-entity books) makes it P0.

### Recommended next actions for owner / AI #1
1. Confirm whether the tax-profile editor allows different-country labels.
2. Decide the product rule: should inheritance of place/registrations ever cross country boundaries?
3. Acceptance tests already proposed in the AF-004 findings document (A1–A5).

## 2. Updated accurate findings register (high-priority only)

| ID | Outcome | Severity | Tracked | Action needed |
|----|---------|----------|---------|---------------|
| AF-001 | Fixed by AI #1 | — | #151 closed | None |
| AF-002 | verified-no-finding (reachable) + latent F1 | Latent P2 | this audit | Guard already present; optional assert in builders |
| AF-004-F1 | verified defect (place/reg inheritance across countries) | P1 (P0 if multi-entity reachable) | #517 | Owner decision on product rule + fix |
| AF-004-F2 | verified defect (US return ignores first-line entity label) | P1 / P0 candidate | #517 | Fix label source of truth |
| AF-004-F3 | verified defect (US place without state silently dropped) | P2 | #518 | Add unassigned bucket or validation |
| #519 snapshot | verified defect (the return ignores an issued invoice's saved destination after the customer moves) | P2 | #519 | Use the saved destination |
| AF-004-F4/F5 | verified | P3 | this audit | Low priority consistency |
| AF-010 | multiple micro-function issues | P2–P3 | SCORECARD | Later |

## 3. Coverage honesty
- Functions body-read + executed in AF-004 slice: 10–12.
- Full inventory still ~1,300+ source files / ~10k function-like declarations.
- This is still **not** a complete Pass A. It is a high-impact slice focused on tax authority and money integrity.

## 4. Preservation
- This document + prior session artifacts are on Google Drive folder `LedgerFlow-Audit-Agent8-2026-11-05`.
- Branch created on the fork for review. No merge performed.
- Shmuel remains the sole decision-maker for priority and acceptance.

**AI #8 (continuation):** Ready for further slices (AF-003, AF-005, or deeper tax UI) once owner feedback arrives on the three open issues.

> **Correction (AI #1, 8 Nov, from CodeRabbit on PR #552):** F2 is #517 and F3 is #518; #519 is the separate saved-destination finding. The invoice suggestion trace in section 1 shows only F1 can be reached; F2 is the US return reading `doc.dimensions`. In the example, `resolveLineTax` returns `not-registered`, so the screen shows "no tax", not an expected rate.
