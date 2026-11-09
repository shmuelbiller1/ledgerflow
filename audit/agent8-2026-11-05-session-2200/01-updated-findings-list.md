# Agent #8 — Updated Accurate Findings List (2026-11-05 session continuation)

**Pinned application SHA for this update:** to be confirmed against current upstream/main  
**Previous pin used for AF-004:** `7896cbdcbba520f71614a3445b963b1c88d497bb`  
**Source of truth for prior work:** `audit/agent8-2026-11-05-session-2033/` + `audit/function-audit/`  

## Status of high-priority AF cases (as of last verified work)

| ID | Title | Outcome | Severity | Tracked | Notes |
|----|-------|---------|----------|---------|-------|
| AF-001 | Durable bank cursor vs durable bank lines | **Fixed by AI #1** (29–31 Oct 2026, #151/#439/#457) | Was P1 (P0 mechanism) | #151 closed by fix | Cursor + bankLines now written in same transaction. Contract tests updated. |
| AF-002 | Per-label cent reconciliation (`spreadLabels` / balancer) | **verified-no-finding** for reachable paths + property tests (2,000+ cases) | Latent P2 (AF-002-F1) | this audit | Non-positive tax/discount legs dropped if called with negatives; blocked by posting guards today. |
| AF-004 | Tax fact / seller-profile authority | **5 verified defects** (F1–F5) via pure-function probes | F1/F2 P1 (P0 candidate if multi-entity), F3 P2, F4/F5 P3 | Issues #517, #518, #519 | Cross-country place/registration inheritance; US return ignores first-line entity label; silent drop of US place without state; dual buyer-state rules; set-valued fact verification order. |
| AF-010 | Money micro-functions | Multiple P2/P3 findings (allocateCents contract divergence, parenthesized negatives, etc.) | P2–P3 | this audit | See SCORECARD register. |
| AF-011 / AF-012 | Civil dates / rule override chains | Reviewed in earlier slices / PR lineage | — | #342, #161 | Not re-opened. |

## Accurate current open findings that still matter for launch (priority order)

1. **AF-004-F1 / F2 (tax authority / entity label)** — Multi-entity or multi-jurisdiction profiles can cause sales to be attributed to the wrong tax return (Texas vs Israeli VAT). Pure functions and probes confirm the mechanism. Reachability for stage-A testers still needs owner confirmation. Issues #517/#518/#519 filed.
2. **AF-004-F3** — US customer tax place without a state is silently omitted from the sales-tax return (no unassigned bucket or warning).
3. **AF-002-F1 (latent)** — Template builders can produce unbalanced entries if ever called with non-positive tax/discount; currently guarded.
4. Remaining AF-010 micro-function inconsistencies (parser, allocator contracts, Infinity formatting).

## What has been executed
- Pure-function probes for AF-004 (8 cases, 6 intended failures documented).
- Existing tax suites: 51/51 pass at the AF-004 pin.
- Full unit suite (previous session): ~5,098 pass / 1 timing failure on isolated Postgres 17.
- RLS + migrations: green.
- Browser diagnostic for one AF-004 contract: control pass / intended fail.
- No live customer data, no production secrets, no money code changes by this agent.

## What remains unfinished (next work)
- Confirm current upstream/main HEAD and re-pin.
- Reachability analysis for AF-004 (can stage-A create cross-country label profiles? Check TaxProfilesSettings save path).
- Read `TaxPlaceSuggestion.tsx` and customer tax-place form.
- AF-003 statement scope (once server side lands).
- AF-005 stock/as-of.
- Broader Pass B capability-to-implementation matrix update.
- Authenticated / real-DB browser journeys for tax returns.
- Update SCORECARD.md and publish final accurate list once more slices complete.

## Preservation
- This file uploaded to Google Drive folder `LedgerFlow-Audit-Agent8-2026-11-05` (id `1sbrj3ozjhKXAeNPa3xd5etKUUb-ZLU_V`).
- Previous session evidence archive and checkpoints already on Drive and in the fork.
- Will commit this session's artifacts to a new branch on the fork when the investigation advances further.

**Next action:** re-pin HEAD, examine TaxPlaceSuggestion + profile save paths for AF-004 reachability, then update the scorecard.
