# Code atlas — generated coverage evidence

Input commit: `74b8318bfba0983ecba05bfbe4c41494ff57a36e`
Input tree: `b59c8d3970fb58361f7cdd3bb0459ec34388996e`
Extractor SHA-256: `5f5ec90ffe9b385b52175b789469046781099952e78858ba0de2e10ece2d0ff3`
TypeScript: 5.9.3

| Measure | Count |
|---|---:|
| Tracked input paths / entries | 2141 / 2141 |
| Automatically extracted entries | 2141 |
| Code-related files | 1967 |
| Binary assets (metadata only) | 45 |
| Reviewer-annotated entries | 126 |
| Targeted source-inspected entries | 54 |
| Stale manual entries | 0 |
| Unknown module/glob relationships | 82 |
| Computed API callsites (unresolved URLs) | 259 |
| JS/TS parse diagnostics | 0 |
| Workflow traces (not feature completion) | 18 |

## Categories

- application: 995
- archive: 54
- asset: 3
- automation: 10
- binary-asset: 5
- binary-test-asset: 40
- configuration-or-support: 23
- documentation: 59
- fixture: 9
- generated-atlas-artifact: 2
- migration: 35
- script: 33
- server: 198
- server-or-client-entry: 3
- test: 672

## Workflow evidence scope

- V1-07: Record payments — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- V1-01: Create or open the books / onboarding — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- V1-02: Set up or import the accounts — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- V1-03: Add customers, vendors and items as needed — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- V1-04: Connect or import the bank — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- V1-05: Enter money in and money out — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- V1-06: Classify activity and add labels — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- V1-08: Reconcile — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- V1-09: Read the reports — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- V1-10: Close the period — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- V1-11: Back up and restore — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- V1-12: Show where each important number comes from — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- FLOW-SALES: Sales document → journal → optional stock — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- FLOW-PURCHASES: Purchase bill → journal/receipt/stock boundaries — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- FLOW-CREDITS: Issue credit, apply existing credit, or refund — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- FLOW-TAX: Dated jurisdiction choice → document arithmetic → return review — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- FLOW-STOCK: Stock departure, count/adjustment, history and returns — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance
- FLOW-PERMISSIONS: Identity → workspace scope → writer role → DB boundary — current; source trace + existing test references; NOT newly executed authenticated E2E/provider/DB acceptance

## Exclusions and limits

- Untracked/ignored working files and Git internals are not in the committed tree. No tracked paths excluded.
- Binary assets: metadata only, no visual/decompilation review.
- Gitlinks: inventory only, submodule contents not traversed.
- These files have entries for their blobs IN THE PINNED INPUT COMMIT, not the later generated output. A Git blob cannot contain its own output hash. Compare source changes separately from expected generated-artifact drift.
- Unknowns are retained in each entry. Use `unknowns`, `show`, `workflow` and `impact`; no dynamic dispatch/provider/deployment proof is implied.
- Mechanical metrics regenerate from the canonical JSONL; this page has no independent per-file summaries.
- Commands/test results and tool limitations: [atlas guide](CODE_ATLAS.md). Prior source audit findings: [strategy audit](DEEP_CODE_AUDIT.md), pinned to its own stated revision.
