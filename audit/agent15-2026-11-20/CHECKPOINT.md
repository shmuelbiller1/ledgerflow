# Agent #15 — checkpoint 2026-11-20

## Scope and recovery
Branch `arena/bdd9a838-ledgerflow`, base `d1f2c8dda3d8378270117d9c30d8aae3ee0337a6`. Agent #15 owns bank/receipt screens and tests only. No posting, money, server or database edits. No independent subagent tool is available. Never merge this work.

## Instruction sources examined
Root AGENTS.md; src/AGENTS.md; src/components/AGENTS.md; src/tests/AGENTS.md; src/lib/AGENTS.md; CURRENT_WORK.md; COORDINATION rules/NOW, full Agent #15 queue, EU-C2 overlap, relevant recent messages; PLAN sections 15–17; ROADMAP; UI_GUIDE; DEVELOPER_WORKFLOWS; RELEASE_GATE; independent-audit mission introduction and methodology. Reviewed current open PR list, issue list, #891 body/comments, #717 inline bot reviews (historical neighbouring shared-grid work), actual CI workflow and latest main runs. No Agent #15 open PR identified. No separate Agent #15 inbox found in docs search. Drive master recovery index read first 12,000 characters only (116,029-byte file); remaining archive content not examined. No exhaustive 3,000-file audit claimed.

## Findings register
### A15-B3-01 — Low — missing functionality — confirmed
- Location at base: `src/components/ledger/ReconciliationView.tsx:32–41,184–240`.
- Evidence: pending feed only used `needYouFirst`; no age grouping or chronological review option. BankStatementLine has `date` but no received-at field (`src/model/ledger.ts:426–448`).
- Consequence: aged unmatched lines cannot be systematically reviewed by waiting-age band. No accounting amount or durable-record corruption demonstrated.
- Reproduce: open Reconcile; pending lines are shown without age headings or age-order control.
- Correction implemented: explicit age-order select, grouped statement-date ages (over 30, 7–30, under 7), chronological ordering, future and unknown date groups; preserve EU-C5 default. Explain loaded-cache and statement-date basis. Existing actions unchanged.
- Verification: 23/23 focused tests passed, no skips; type check passed with 4 GiB heap after initial default-heap OOM; ESLint passed (0 errors, 2 existing warnings). Full suite in progress under Node 24 (system Node is 22). No browser run or DB test yet.
- Remaining risk: UI grouping has component evidence only; Chromium and broad CI still required. Statement-date age is not actual elapsed time since importing. Default intentionally remains needs-you-first to preserve EU-C5.

## Queue and next actions
B-1/B-2/B-4 previously ticked; not re-audited. B-3 implemented pending wider verification. B-5 no detail provenance UI verified yet: schema exposes source/importIdentity/suggestion but no explicit file-name/row fields. B-6 receipt workflow investigation pending (`src/components/ledger/InboxView.tsx`). B-7 390px light/dark browser checks pending. B-8 and overlapping EU-C2 both unticked; no keyboard patch made. Inspect current ownership before continuing.

## Verification state
- `npm ci --ignore-scripts`: passed; lifecycle scripts deliberately not run. Runtime requirement is Node 24; provisioned through npm package for full suite.
- Focused tests: `NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx tsx --test src/tests/bank-line-age.test.ts src/tests/reconciliation-screen.test.tsx src/tests/eu-c5-reconciliation-starts-finished.test.ts` — 23 pass.
- `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` — passed.
- `npm run lint:eslint` — passed, 2 pre-existing server warnings.
- Latest base main Actions inspected: CI run `44639692151` succeeded at base SHA; this is NOT verification of this branch's changes.
- PR not yet created; no branch CI or bot feedback yet.

## Drive
Existing archive root: https://drive.google.com/drive/folders/1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK
Recovery folder: `1lirpdsmux1n7DEnyZKuHlJpMp2lUENBp`.
Patch folder: `1BVL9-vPmnP4gCCXI4c1vtqSgHnyCo6Oz`.
This checkpoint will be uploaded and read back; do not infer upload success from this local text.

Assessment: partial bank-screen work, NOT a launch-readiness certification. Remaining responsibilities listed above.

## Follow-up checkpoint
Production build passed. Added Chromium age-view regression in `e2e/reconciliation-navigation.spec.ts` (not yet executed). Default Playwright browser download failed with ECONNRESET from cdn.playwright.dev, outside the sandbox's allowed hosts. Recovered an alternative Chromium 153 binary via the allowed npm registry (`@sparticuz/chromium`), unpacked only under ignored `.cache/`; no dependency/lockfile changes. Local browser execution will use an ignored config; CI uses its normal pinned Playwright browser. Full tests are still running; wait before browser measurement to avoid concurrent load.

B-5 dependency: `BankStatementLine` has source, fingerprint, suggestion rule IDs and matched transaction ID, but not original import filename/row. Do not invent these or decode a fingerprint as a filename. Need importer/server owner clarification before claiming full provenance.
B-6 dependency: phone capture saves a document linked to a draft bill (`snapReceipt.ts:12–70`, `SnapReceiptDialog.tsx:138–156`), not an independent receipt collection. Bank lines match transactions, not receipt documents. Existing payment/allocation paths and capped-cache completeness must be traced before asserting a receipt has no matching bank line.
B-8 status: code inspection found `reviewKeys` already used for the guess rows in `InboxView.tsx:365–366`, implementing J/K/arrows and A/Enter; `c`/label/rule shortcuts and the required 50-row browser journey remain unverified. Neither B-8 nor EU-C2 can honestly be ticked from that helper alone.

First Drive checkpoint verified by full text read-back (4,109 bytes, not truncated): https://drive.google.com/file/d/15XbN1kOVNNZKUiscnVbCtsUiAUPRgqH0/view . Later checkpoint content supersedes that initial copy.

## Verification checkpoint — PR #963
Implementation `b3b6d264eab168383506518cdb50385c713eaa35` pushed to the current branch; draft PR https://github.com/shmuelbiller1/ledgerflow/pull/963 . Full Node24 suite completed in 1,030.56 seconds: **6,255 tests, 6,243 pass, 1 fail, 11 skipped**. Sole failure: existing A-229 cold ten-screen imports, 2,643.22 ms vs 1,500 ms. Idle current-head rerun: 2,266.56 ms. Untouched base archive in `.cache/agent15-base`, run from its own cwd with its own tsconfig and shared dependencies: 3,984.90 ms, same failure, other 2 tests pass. First archive attempt from parent cwd had invalid JSX transform and is not baseline evidence. Reported with commands/results on https://github.com/shmuelbiller1/ledgerflow/issues/834#issuecomment-7030451262 . No threshold changes.

Actual browser regression: **2/2 pass** after resolving alternative-browser environment setup. Chromium153 via npm; CI browser remains pinned158. Default CDN browser install failed. Initial fallback attempts failed due missing font paths / Vulkan library discovery; a single-process launch also could not reuse contexts. Final ignored config uses no single-process flag; libraries symlinked alongside executable, FONTCONFIG_PATH configured to real fonts, LD_LIBRARY_PATH includes `lib` + `lib/lib`, VK_ICD_FILENAMES points to `lib/vk_swiftshader_icd.json`, args include in-process-gpu/ignore-gpu-blocklist/no-zygote/no-sandbox/disable-dev-shm-usage/use-gl=angle/use-angle=swiftshader/enable-unsafe-swiftshader. Both existing mixed-language navigation and new age-group/search/selection tests pass in one run. App startup reports expected missing-DB background jobs; these mocked browser probes do not establish live persistence or provider integration.

Review at initial head: Gitar passed with no issues (functional validation not enabled). Sonar failed new-code duplication 10.8% (>3%); duplicated browser mounting setup was genuine, now extracted to `mountReconciliation`, retaining existing assertions. Post-fix Sonar result pending. GitHub showed no Actions runs automatically for this draft; do not call CI green. Will explicitly request CI on the latest intended branch commit.

Drive patch `1d_9dcONlVUYNYNMUXmhyjUkiC-qwTU1Z` verified against local MD5 `da1e9a06c5f88dc26af37f4bd42e1f98`, 26,108 bytes; initial snapshot only. Recovery addendum: https://drive.google.com/file/d/1Nqokfv0xrXaAuI3Ff2oLDeR0TukXgizo/view . Master recovery index has a non-destructive dated comment linking it; **master body not rewritten** because only truncated content was read. This is not a claim the full master-body maintenance requirement is completed.
