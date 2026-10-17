# LedgerFlow — Code Intelligence Atlas

A commit-pinned engineering reference for **where to change something, what depends on it, which data/contracts matter, and how to verify it**. This is navigation and evidence, not certification that every indexed feature works.

## Start with a scoped question

Use Node **24.x** and the locked dependencies (`HUSKY=0 npm ci --ignore-scripts`). No application server, credentials or production connection is needed. Commands print JSON unless noted.

```sh
node scripts/code-atlas.mjs stats
node scripts/code-atlas.mjs query 'calculateAmountDue' --limit 5
node scripts/code-atlas.mjs show src/lib/documentMath.ts
node scripts/code-atlas.mjs deps src/lib/documentMath.ts --direction in --depth 2 --limit 25
node scripts/code-atlas.mjs impact src/server/services/paymentService.ts --depth 2 --limit 40
node scripts/code-atlas.mjs workflow V1-07
node scripts/code-atlas.mjs workflow FLOW-TAX
node scripts/code-atlas.mjs unknowns --limit 5
node scripts/code-atlas.mjs changes --revision worktree --check
node scripts/code-atlas.mjs validate
```

`query` matches all words across path, reviewer purpose/note/ownership contract, inferred purpose, declarations, route expressions and table/RPC names. It is lexical search, not an LLM or semantic execution engine. `show` returns one full file entry; `deps` walks direct syntactic dependencies; `impact` separates direct edges from **possible indirect** screens/routes/tests/data-operation candidates, plus workflow references and a verification checklist. Impact output is bounded; check `truncated`/operation counts and use `show` for the relevant candidates. `workflow` without an ID lists the available traces.

**Do not put the whole JSONL into a prompt.** Start with a workflow or a few search results, inspect the owner entry and its direct callers, then open the actual source and focused tests. A symbol declaration, comment, registration or test title is not proof of runtime reachability or correctness.

## Files and authority

- **[CODE_ATLAS.jsonl](CODE_ATLAS.jsonl)** is the only maintained per-file database: metadata record, one record for every tracked input path, then workflow records. Manual explanations and calculation-ownership contracts live here, not in a parallel spreadsheet/Markdown appendix.
- **[CODE_ATLAS_VALIDATION.md](CODE_ATLAS_VALIDATION.md)** is generated coverage/statistics from that database: exact input commit/tree, extractor hash, denominators, annotated/inspected/stale counts, unresolved relationships, categories and workflow evidence scope.
- **[DEEP_CODE_AUDIT.md](DEEP_CODE_AUDIT.md)** retains the historical architectural findings, prioritization, source probes and executed application checks at base `8d858165d8853dcad5479b270a52d191b669c631`. Its former 2,134-file appendix has been retired into the canonical store. Its historical numbers must not substitute for current atlas statistics.
- **[`scripts/code-atlas.mjs`](../scripts/code-atlas.mjs)** generates, queries, annotates, compares and validates. **[`scripts/code-atlas.test.mjs`](../scripts/code-atlas.test.mjs)** tests the tool against committed synthetic repositories, not production modules.
- **[Read-only atlas CI](../.github/workflows/code-atlas.yml)** runs tool tests, validates references, checks source/review drift and compares a fresh extraction with the committed canonical bytes. It never commits, updates production, uses provider credentials, or marks a feature done.

Existing authority stays with [AGENTS.md](../AGENTS.md), [developer workflows](DEVELOPER_WORKFLOWS.md), [ROADMAP](ROADMAP.md), [capabilities](CAPABILITIES.md), [tracker](TRACKER.md), [plan](PLAN.md), and current coordination/ownership instructions. This PR does not reassign tasks or rewrite these documents. Existing scanners remain separate: [`quality-metrics.ts`](../scripts/quality-metrics.ts), [`bug-patterns.ts`](../scripts/bug-patterns.ts), [`check-rule-sources.ts`](../scripts/check-rule-sources.ts), [`lint-rule-packs.ts`](../scripts/lint-rule-packs.ts), [`rule-pack-diff.ts`](../scripts/rule-pack-diff.ts), and [`eslint-warning-ratchet.mjs`](../scripts/eslint-warning-ratchet.mjs). Use their documented commands for their own contracts; an atlas index is not their result.

## Evidence model: what an entry actually says

Each `file` record has the input `sourceRevision`, full **Git `blobSha`**, Git object mode/type, size/line/classification facts, mechanical extraction, inferred purpose, dependency edges and reverse edges, data candidates, verification suggestions, unknown module relationships, and optional manual review. Gitlinks use their commit object ID and are explicitly inventory-only; none is silently traversed.

### Implementation extraction

The installed TypeScript compiler parses committed JS/TS-family content. Declarations record function signatures and spans, classes/interfaces and members, types, enums, exported variables, callsite names/owners and selected implementation comments. Error/guard excerpts locate throws, catches and syntactic refusals. They do **not** prove exhaustive error handling or universally enforced safeguards. Non-JS/TS code has appropriate bounded source/SQL evidence, not invented TypeScript declarations. Comments/purpose fallback are clearly **inferred**, not a claim that implementation fulfills its comment.

Dependencies use `typescript.resolveModuleName` with the snapshot's `tsconfig.json` and locally installed locked dependencies. Import/re-export bindings, type-only imports, literal dynamic imports and `require` are distinguished. Supported simple `import.meta.glob` patterns expand only to tracked paths. Assets, Node builtins, external packages, runtime-provided modules and unknowns have separate resolution statuses. There is no fallback that guesses missing files by basename.

Registrations, local Express declarations/mounts, HTTP callsites, collection/table access candidates, RPC callsites and SQL declarations are **separate evidence channels**. Computed import paths and unsupported glob syntax stay unknown; computed URLs retain their source expression but are not linked to a guessed route. Combine a local route with its parent mount and middleware in source. Registry properties are syntactic candidates, not proof a screen is usable. SQL uses **textual extraction**, including explicitly labeled dynamic-template candidates; it is not a SQL interpreter, deployment inventory, migration-order proof or RLS verification. `.from`/collection aliases, dynamic SQL and transaction-reference data flow are deliberately incomplete. Candidate table-name links to migrations/RPC function declarations do not establish actual runtime access or migration application.

### Manual interpretation and staleness

`manual.inspection` distinguishes `targeted-source-inspection` from prior targeted audit annotations. The initial 109 audit notes were retained with real Git blob evidence rather than their former truncated SHA-256 fingerprints; additional targeted notes/contracts were added. The conservative inspected count is a **subset** of annotated entries. Even a source-inspected entry is targeted boundary tracing, not independent line-by-line certification of every branch. Most code files are automatic-only, and the generated report says so. A requirement for independent semantic correctness review of every code file is **not yet fulfilled** by structural extraction.

A manual record stores `reviewedRevision`, `basedOn` path/blob pairs, certainty, status and changed sources. Its own blob and declared dependencies/related implementations are checked. Workflow reviews have their own blob evidence. A changed/deleted evidence blob makes the old interpretation visibly `stale`; automatic refresh preserves it and **does not silently reapprove it**. A deleted annotated path is retained as a retired annotation, not counted as current coverage. Recreating a similar file does not automatically transfer approval. Dependency tracking is explicit, not a promise to notice every semantically relevant external change.

### Workflows and calculation ownership

The canonical database contains **18 source-traced workflows**. `V1-01` through `V1-12` correspond to the [ROADMAP main path](ROADMAP.md), including onboarding/accounts/parties, bank import, money in/out, classification/labels, payments, reconciliation, reports, close, backup/restore and number provenance. `FLOW-SALES`, `FLOW-PURCHASES`, `FLOW-CREDITS`, `FLOW-TAX`, `FLOW-STOCK` and `FLOW-PERMISSIONS` extend the cross-cutting trust boundaries. Each has real paths for entry, inputs, calculation, command/action, persistence and existing verification evidence; any named symbol must exist in the extraction. The review evidence includes every referenced stage path. Source trace and test references do not equal a newly passed authenticated journey or provider acceptance. Unknowns and data affected are recorded with the trace.

Important calculation files have canonical `manual.ownership` records: owned symbols, related shared/divergent implementations, reuse preconditions and independent expected-result checks. Use `show` or `impact` to retrieve them. In particular, stored legacy/v2 tax interpretation is not interchangeable with jurisdiction selection, assignment optimization is not the same as its UI/automatic score builders, credit issuance is not credit application, and delivery departure is not invoice issuance. The reproduced Altman absolute-value reversal error remains a **finding**, not an alternative recommended P&L formula. No formulas were changed or duplicated by these tools. File importers and recorded imported-binding calls help find callers; this is **not** symbol-level whole-program call/taint analysis.

## Financial and security change checklist

Retrieve the relevant workflow and owner contract first. Then preserve these boundaries in implementation and independent fixtures:

1. **Amounts/precision:** integer minor-unit persisted money; signed journal lines versus absolute transaction totals; explicit FX/base-currency conversion and rounding; quantity precision/Decimal rules are not necessarily integer quantities on every endpoint. Do not substitute display formatting for arithmetic.
2. **Ledger:** balanced double entry, owned/valid accounts, postable-only reporting, dated period locks, explicit reversals linked once. Confirm failed requests do not partially persist a document, journal or stock effect.
3. **Replay/concurrency:** same actor, workspace, payload and operation identity; inspect whether the owning transaction really contains the lock/replay checks. Legacy/no-ID routes and generic idempotency do not inherit payment-specific guarantees. Test response-loss replay and close-vs-write ordering separately.
4. **Authority/isolation:** browser role checks and hidden modules are UX, not server authorization. Browser RPC/PostgREST RLS and privileged server SQL are different trust boundaries. Test missing/wrong identity, wrong workspace, role downgrade, API-key scope and protected field mutations at the server/DB boundary.
5. **Completeness/report scope:** capped/lazy browser arrays are not complete history. Carry basis, dates, currency, account and label scope through screen, explanation, CSV/PDF/email. Refuse or label incomplete fallback data; sum the drilldown independently.
6. **Tax:** date-effective jurisdiction/registration/exemption and unknown table coverage; inclusive/compound/component rounding and legacy `taxVersion` compatibility. A zero rate or generated review export is not legal/filing acceptance.
7. **Stock:** ledger/quantity/history atomicity, negative-stock policy, fractional precision, weighted average cost where applicable, one departure mode, one linked reversal/return. Shipment/RMA metadata is not inventory authority.
8. **Recovery/provider:** authoritative full export versus labeled browser-cache fallback, ownership protection, point-in-time and balancing validation on restore. Provider/email/bank mocks are not delivery or acceptance; no hidden live tests.

Use the entry's direct test importers and impact candidates as **discovery**, then inspect actual assertions and run the appropriate tests. Indirect test imports are not function coverage. Include real DB/RLS and browser/provider evidence where the workflow requires it; document unavailable boundaries instead of calling them passed.

## Refresh procedure (explicit committed input)

A file cannot contain its own Git output blob hash. The atlas therefore hashes **every path in a specific input commit A**, including the previous versions of its generated artifacts, and output is committed afterward in **B**. The two generated artifact paths are inventory/blob metadata-only and never recursively content-indexed. `changes` reports their drift separately. It ignores only these two paths as generated outputs, not guides, tools, migrations, CI or application source.

The initial PR uses a tooling/docs/annotation-seed commit A followed by a full generated index/validation commit B. The bootstrap seed in A is explicitly marked incomplete; **the final canonical output in B** is the inventory used for review. For subsequent work:

```sh
# 1. Make/review the source and documentation changes, then commit them on the work branch.
#    Never pass an uncommitted working tree as evidence of inspected implementation.
SOURCE_REVISION=$(git rev-parse HEAD)

# 2. Refresh mechanical facts from that exact input; unchanged blobs can reuse extraction.
node scripts/code-atlas.mjs generate --revision "$SOURCE_REVISION"
node scripts/code-atlas.mjs changes --revision "$SOURCE_REVISION"
node scripts/code-atlas.mjs stats

# 3. Inspect every stale annotation/workflow against its changed evidence before reapproving.
node scripts/code-atlas.mjs annotate src/lib/documentMath.ts \
  --revision "$SOURCE_REVISION" \
  --purpose 'Describe the actually inspected contract' \
  --note 'Describe behavior, safeguards, gaps and verification—not a filename gloss' \
  --depends-on src/lib/taxCodes.ts

# 4. Validate, derive the report, run scoped verification, and commit the two output artifacts.
node --test scripts/code-atlas.test.mjs
node scripts/code-atlas.mjs validate
node scripts/code-atlas.mjs stats --markdown > docs/CODE_ATLAS_VALIDATION.md
node scripts/code-atlas.mjs changes --check
```

`annotate` replaces that entry's manual object; preserve/edit existing structured ownership fields deliberately if renewing an ownership contract. There is no automatic semantic approval. Workflow review updates are edits to the **canonical workflow JSONL record**, keeping all six stages, actual symbols and fresh path/blob evidence; `validate` checks references and `changes --check` rejects stale reviews. It does not independently certify prose. `reviewedRevision` may remain older than input A if all declared evidence blobs still match; the original review date/commit is never silently rewritten.

For a clean audit of the extractor, `generate --revision REV --fresh --output /tmp/ledgerflow-atlas.jsonl` bypasses mechanical cache while preserving canonical review notes, and its bytes should match an ordinary generation from the same revision/reviews/tool/dependencies. The tool is deterministic for those inputs; environment/compiler/dependency changes are not assumed equivalent. No timestamps or working-tree source bytes enter extracted facts. A regenerated report is derived, not separately maintained.

`changes` uses Git similarity-based rename detection for added/deleted/modified/renamed/type-changed tracked paths. It includes staged and unstaged tracked changes when comparing the worktree; untracked files intentionally are **not** committed inventory—check `git status` and commit source changes before refresh. Paths Git cannot confidently identify as a rename remain add/delete rather than an invented identity.

## Review validation and remaining limits

The atlas tool suite has **18 passing Node 24 tests**, covering exact Git inventory/blobs/binary handling, TypeScript aliases/re-exports/type/dynamic imports, globs/unknowns, routes/DB/RPC/SQL candidate separation, direct/indirect impact, deterministic cached and fresh extraction, re-resolution after new targets, committed content versus worktree edits, review staleness (own/dependent blobs), rename/add/delete, retired notes, corruption rejection, real guard/interface extraction, generated-artifact handling, workflow evidence/duplicate IDs, ownership evidence and artifact-only drift. The final generated coverage page contains the actual repository counts, unknowns and stale totals; it is not filled from this narrative.

Full repository extraction, a second identical cached generation, structural/reference validation, scoped query examples, source-drift checks and lint are part of this PR's local verification. The read-only CI workflow is added for subsequent runs; **its presence is not a claim GitHub Actions already passed**. Application results from the original unchanged base are historical and preserved only in [the strategy audit's verification section](DEEP_CODE_AUDIT.md#verification-performed-for-this-audit): 2,707 Node-24 unit tests passed, with 124 DB-dependent suite skip notices, plus 14 omitted utility/ratchet tests and a successful build. Those are not newly executed tests against the atlas tooling commit.

**Not done / not claimed:** full independent manual semantic review of every code file; authenticated browser journeys; real Postgres/RLS/restore/concurrency acceptance; migration/deployment state; current legal rules; live bank/payment/email/provider acceptance; external infrastructure review; exhaustive cross-module symbol/alias/SQL data flow. Unknown modules/computed URLs are counted rather than hidden. The CLI reads the local JSONL into memory before returning scoped results; it is a lightweight offline tool, not a streaming database/search service. The generated file is intentionally larger than Markdown navigation because it retains auditable implementation evidence; avoid duplicating it in tracked scratch outputs.

Review financial posting/database trust first, then the 12 V1 workflows, integrations and the remainder. Atlas coverage is **not** capability completion, a launch gate waiver, a new task owner, or an accounting/security fix.
