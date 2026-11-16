# CMD-1 execution checklist after PR #726

**Starting point:** PR #726 merged into `main` at `afbc052` on 16 Nov 2026. The default registry has 49 commands. The current `commands-baseline.json` records 194 server route-write sites and 106 direct browser-write sites. Those ratchet counts are the source of truth; lower them as work lands, never raise them.

This checklist covers the active CMD-1 → SBX-1 sequence, not the historical 864-item product backlog. Full requirements and security rules remain in [`CMD-1-commands.md`](CMD-1-commands.md) and [`SBX-1-assistant-sandbox.md`](SBX-1-assistant-sandbox.md).

## Work checklist

### 1. Finish the CMD-1 prerequisites for a useful sandbox

- [ ] **Periods — close workflow:** move the seven write sites in `src/server/routes/periodRoutes.ts` behind named commands, preserving every legacy URL, status, and response. Reuse `periodCloseService.ts`; extend the existing database-backed coverage in `src/tests/period-close.test.ts` to prove normal, refused, and replayed calls.
- [ ] **Periods — transaction/year-end operations:** handle the eight write sites in `src/server/routes/transactions/periodRoutes.ts` as a separate slice. Keep valuation, close-year, snapshot, and reversal behavior unchanged; use worked figures and existing service tests.
- [ ] **Chart of accounts:** add command-backed writes and move the three direct browser writes in `src/components/ledger/ChartOfAccountsView.tsx`. Do not confuse these with `src/server/routes/accountRoutes.ts`, which is mostly personal-account and workspace-group APIs.
- [ ] **Inventory:** commandify the nine baseline write sites in `src/server/routes/inventoryRoutes.ts`, then move the five direct writes in `src/components/inventory/Inventory.tsx`. Preserve stock and ledger behavior; use the existing inventory and COGS tests.
- [ ] Complete any remaining workspace, account, period, and inventory operations needed by the SBX-1 prerequisite gate.

### 2. Finish the CMD-1 command surface

- [ ] Continue by domain, using `commands-baseline.json` to choose high-yield files while keeping each PR reviewable. Current largest server-file counts are: `transactions/reconcileRoutes.ts` 11; `accountRoutes.ts` 10; `inventoryRoutes.ts` 9; `apiKeysRoutes.ts`, `paymentRoutes.ts`, `savedListRoutes.ts`, and `transactions/periodRoutes.ts` 8 each; `mathRoutes.ts`, `periodRoutes.ts`, and `workspaceRoutes.ts` 7 each.
- [ ] Keep `/admin` and `/system` routes out of the command surface. Mark high-risk actions explicitly and retain two-step confirmation.
- [ ] Audit the generated outputs against the prompt: full OpenAPI, the typed SDK client, browser-safe command metadata, schemas, and descriptions. Generate them from the registry; do not hand-maintain copies.
- [ ] Lower the route-write ratchet for each migrated slice and keep the command-generated, registry, and baseline tests green.

### 3. Move direct browser writes safely

- [ ] Inventory all 106 baseline browser-write sites by collection/table and owner. Prioritize shared write helpers only where they preserve each caller's validation and response behavior.
- [ ] Migrate one table/domain at a time: command endpoint, UI caller, RLS refusal tests, then a migration that removes the old browser write policy.
- [ ] **Do not apply a live migration in this work.** The owner applies it only after the PR is merged and the corresponding code is deployed.

### 4. Assistant and sandbox

- [ ] Build proposals, partial accept, edit/revalidate, reject, undo, and generated assistant tools/read tools. The 25-command threshold is already met; keep tool output generated from command descriptions.
- [ ] Start SBX-1 only after workspace, accounts, periods, and inventory command batches are merged. Follow its database-role, no-real-write, no-sequence, cache-isolation, and full equivalence-test gates.
- [ ] Do SBX-2 (code answers, remembered decisions, caching, model/tool speed) only after SBX-1 passes.

## Fast execution loop

1. Use the ratchet to select the next domain; use the prerequisite order above to break ties. Prefer a shared service and an existing DB-backed test harness over the largest raw count.
2. Before refactoring a route, capture its current success, refusal, authorization, and retry/idempotency response. Keep it as a compatibility wrapper; do not change accounting or tax math.
3. Implement one domain PR at a time. Batch related endpoints that share the same service, but keep separate financial workflows (for example, period close vs. FX revaluation) reviewable.
4. Run the touched test file after each slice. Run command generation once after the domain is complete; verify the generated-artifact and ratchet tests.
5. Before pushing, run the required type check, lint, relevant database tests, and RLS tests if SQL changed. Let PR CI handle the full matrix; fix failures before adding another domain.
6. Leave live migrations for after merge and deployment. Do not block command work on owner-only deployment or database actions.

**This checklist PR is documentation only:** no source code, policy, migration, or live database is changed here. The next implementation PR should start with the period-close slice above.
