# Agent #8 checkpoint — 20 November 2026

Partial independent audit, not a release certification. Branch `arena/bab26cbd-ledgerflow`; pinned base `d1f2c8dda3d8378270117d9c30d8aae3ee0337a6`. Initially clean. No application, financial, migration or production data changes. No specialized subagent or model-selection controls available.

## Sources actually examined
Root `AGENTS.md`, `CLAUDE.md`, `CURRENT_WORK.md` opening and Agent #8 status, `docs/COORDINATION.md` opening rules, Agent #8 queue and recent search results, `src/AGENTS.md`, `src/lib/AGENTS.md`, `src/tests/AGENTS.md`, `docs/INDEPENDENT_AUDIT_AGENT.md`, first-tester gate excerpt, `audit/agent8-2026-11-19/CHECKPOINT.md`, prior 16 Nov report excerpt, existing #928 probe, issue #928 and #953, open issues/PR list, PR #936 comments, inline reviews and checks, PR #925 description and latest main workflow runs. Drive archive search and truncated master index read. Not all referenced guides, messages, reviews or prior reports were read. Current branch restriction and owner's no-merge instruction supersede old fork/merge instructions. Tax/server/migrations remain lead-owned.

## Findings register
**A8-20261120-01 — Medium, confirmed existing defect #928, not fixed.** At base above, `src/lib/tax/ilVatReturn.ts:72-73` omits `baseCurrency` from both `buildTaxReturn` calls; `src/lib/taxCodes.ts:240-242` scales only when both currencies are supplied. Independent synthetic fixture `vat-independent-probe.ts`: JPY sale ¥10,000 net and ¥1,800 tax, fixed-asset bill ¥5,000 net and ¥900 tax, each at ₪0.02 per ¥. Hand calculation: sales 20,000 agorot, output VAT 3,600, fixed-asset input VAT 1,800, net payable 1,800. Observed 200, 36, 18, 18; both documents counted. Incorrect return figures may lead to underreported VAT and input credit. Run `npx tsx audit/agent8-2026-11-20/vat-independent-probe.ts`; this diagnostic asserts the *current defect*, so a correct fix should make it fail until updated. It tests the pure builder, not UI, real DB, filing or legal treatment. Coordinate with lead: forward actual books currency to both builders, trace every caller and accountant export, then verify JPY/KWD/2-decimal, asset/credit and end-to-end figures independently. Issue #928 already owns the work; no duplicate issue.

Evidence blob IDs at base: `src/lib/tax/ilVatReturn.ts` 68f04ddbd4fb1e174b7be67c96363905e27e1d8b; `src/lib/taxCodes.ts` 37a929cb20c85816e958ea23124da733a9dcb35f; `src/lib/taxReturnDocs.ts` 0425666c22df0b8215defd4591fc48996f9b8300. Recheck after code changes. No repo-wide function coverage count established.

## Verification / reviews
`npm ci --no-audit --no-fund` succeeded, with unsupported local Node 22.22.3 versus required 24.x. Probe exited 0 with above results. No unit suite, typecheck, browser, database or production validation run. Main CI run 44636777433 for base completed success; separate CodeQL, SBOM and report-only Schemathesis runs succeeded; workflow_run lint ratchet success, with separate skipped runs. Does not validate this branch or imply all launch gates passed.

PR #936 already merged. GitHub API returned no inline review comments or formal reviews; Gitar reported no findings, Sonar gate passed. Codex summary says review failed due to usage limits, with a flag for unresolved findings but no exposed inline findings; cannot claim Codex reviewed successfully. CI on that docs-only PR includes scope skips. No further change to merged branch or review thread attempted.

## Resume priorities
1. Lead: resolve #928 and independently re-run adjusted worked-figure tests, including input/output and credits; avoid presenting probe success as correctness.
2. G-17 vendor intake #887, G-18 expense semantics #894 and G-19 server enforcement #921 remain open/dependent on owner and lead; do not create financial postings from capture. Check issue status before work.
3. Continue #150 function-by-function review with explicit scope, counts, blob pins, isolated DB/browser tests. Investigate #942/#941 and other open critical security items without modifying another agent's lane.
4. Inspect current PR/CI and reviews after every push; do not merge. Verify Google Drive checkpoint and index pointer; preserve concurrent agents' index content rather than overwriting it.
5. Node 24 and a disposable isolated PostgreSQL are needed for faithful broader testing; no such DB was verified here. Issue #953 intermittent DB serialization remains uninvestigated beyond its issue text.
