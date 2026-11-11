# AI #14 — ease-of-use status

Only the AI #14 queue is covered here. This is not a launch certificate and does not change RELEASE_GATE.

## Merged

| Task | Delivered | PR |
| --- | --- | --- |
| EU-D1 | Five fixed phone actions: Home, To review, New, Reports, More; 390px regression coverage | #626 |
| EU-B1 | New invoice/bill/customer opens the actual editor; new-record shortcuts reuse record links | #626 |
| EU-B2 | Short invoice/bill forms, existing fields under More options, populated/error fields revealed, per-person display preference | #626 |
| EU-E1 | Labels/value/Company vocabulary and explanation of Tags versus Labels; no stored ID/API rename | #632 |
| EU-B4 | Optional party/item drafting defaults and explicit recent-vendor suggestions, preserving typed/cleared values | #632 |
| EU-A2 | Business-type-first presets using existing chart IDs and label roles; optional opening balances on Overview | #632 |

AI #1 merged these PRs and supplied the final #632 tax-default/caller-choice review fixes. Those fixes are retained, not claimed as new AI #14 work in #638. Historical verification is in `docs/verification/ai14-eu-{d1-b1,b2,e1-b4,a2}-2026-11-10.md`.

## Implemented, not merge-ready

**EU-F1 — PR #638**, fixed Arena branch `arena/4eb1082b-ledgerflow`:

- Seven daily menu entries in the requested order.
- Advanced/business recommendation metadata on every registry entry, including plugins; Pro recommendations use the existing workspace business type.
- Searchable Show all tools and bookmarks work independently of business recommendations and Pro mode.
- Existing disabled-module, owner/admin and developer gates remain. This PR does not enable modules, change permissions, posting, schema or APIs. Disabled-module destinations remain unavailable; Settings → Modules guidance is displayed. The separate §F-1 proposal for disabled-module entries in the global page search is not implemented here.
- Active advanced pages opened from discovery retain navigation context.
- Existing neighboring browser fixtures follow the real new discovery path.

### Verified

- Pre-fix browser reproduction at 390/1280.
- **71/71 local browser checks pass** (38 navigation/dialog/axe/keyboard/transaction/receipt checks; 33 phone/report-keyboard/PDF/print checks).
- **43/43 focused unit/registry/bookmark/index/guard checks pass.**
- Final typecheck/build pass. Full lint: **0 errors / 42 existing warnings**; touched files: no warnings.
- Initial CI `43057375651`: production build, lint/types/database rules, all four unit shards, all six timezone shards and the merged coverage gate pass.
- Codex reviewed implementation commit `f3af389` with no findings. CodeRabbit was rate-limited, not successfully reviewed. SonarCloud and Vercel pass.

### Not yet verified / blocked

- All five initial browser CI shards failed at **Playwright installation**, before browser assertions ran; smoke aggregation failed as a consequence.
- Manual visual capture `43057369787` failed at the same installation step. No new visual reference has been accepted, and no screenshot tolerance was raised.
- Diagnostic capture `43059849751` confirms DNS failures resolving `archive.ubuntu.com`, `security.ubuntu.com` and `azure.archive.ubuntu.com` during dependency installation. Temporary workflow edits are restored byte-for-byte to the base; no net workflow or baseline change remains. Full browser CI and final reference review remain pending.

Detailed evidence: `docs/verification/ai14-eu-f1-2026-11-11.md`.

## Next, not implemented

EU-A1 guest demo is next in queue. EU-G1 Hebrew extraction, EU-C4 phone receipt flow, the remaining Labels tasks and all later queue items are not claimed complete. AI #1 retains merge ownership.
