# CMD-1 remaining-work checklist

**Status reconciled 15 Nov 2026 against `main` at `a5b6eb3d853b73b05b0990d1e386862d1ff534bf` (PR #731).** Requirements and acceptance criteria remain in [`CMD-1-commands.md`](CMD-1-commands.md); this file is the live progress checklist, not a replacement prompt.

## Verified checkpoint

- [x] Batch 0 is merged as [#719](https://github.com/shmuelbiller1/ledgerflow/pull/719). `docs/FOR_YOU.md` records that its server-only migration was applied after deployment. The SQL covers `invoices`, `bills`, `creditNotes`, `vendorCredits`, `autoRules`, and warranty-history protection; **estimates are not covered by that migration**.
- [x] The period batch is merged as [#731](https://github.com/shmuelbiller1/ledgerflow/pull/731). Keep its historical Vercel rate-limit result separate from the current batch; it is not a source-code or acceptance failure.
- [x] At the verified base, the registry has **60 commands**; the ratchet is **182 server route-write sites / 106 direct browser-write sites**. The browser inventory spans 54 files. See [`commands-baseline.json`](../../commands-baseline.json) for the measured per-file list.
- [x] This PR adds `numbering.update`, converts the legacy numbering `PUT` to a runner wrapper, preserves the legacy response, and lowers the server ratchet to **181 sites across 62 files**. The browser ratchet remains **106 sites across 54 files**. The registry now has **61 commands**. No accounting calculations or browser policies are changed by this batch.
- [x] The 25-command prerequisite for starting CMD-1 proposal work is met. SBX-1's broader workspace/accounts/periods/inventory prerequisites are **not** all met yet.

## Fastest safe order

1. **Keep each PR to one domain.** Add the command and its normal/refused/retried parity tests first; keep the existing URL as a thin wrapper. This avoids broad conflicts and gives review a small behavioral surface.
2. **Next, prioritize the account and inventory areas** (`accountRoutes.ts`: 10 remaining scan sites; `inventoryRoutes.ts`: 9). They are high-value command coverage and SBX-1 dependencies. Keep the more complex reconciliation work (`transactions/reconcileRoutes.ts`: 11) in its own tested banking batch rather than folding it into either PR. Use the full per-file counts in `commands-baseline.json`, not stale counts from another branch.
3. **Continue workspace/configuration and remaining ledger/payment route batches** (`savedListRoutes.ts`: 8; `paymentRoutes.ts`: 8; `workspaceRoutes.ts`: 7), then take the remaining cohesive route domains. Migrate by service/domain, not by mechanically wrapping every HTTP `POST`.
4. **For each browser table, finish its server command and callers before changing RLS.** Switch real-workspace writes to the command, preserve guest/sample behavior only where it is intentionally local, then add that table's deny-write migration and expected-refusal tests in the same focused batch. Queue migration application in `docs/FOR_YOU.md` for after merge **and deployment**.
5. **Start proposals/read tools after the prerequisite command areas are stable.** The 25-command gate is already met, but completing account and inventory commands before the SBX-1 overlay avoids rebuilding it around missing write semantics. Keep assistant tokens, proposal lifecycle, sandbox, and tools as distinct testable slices.
6. **Regenerate, don't hand-edit generated command metadata.** Run `npm run commands:generate` after each new command batch and keep the generated-output test green. Finish with a route/write inventory audit and the acceptance gates below.

## 1. Server routes → registered commands

- [x] Keep the current runner, registry, and per-file AST ratchet; lower the baseline only when a write route is actually converted.
- [x] Preserve the existing command-backed areas on current `main`, including the period work from #731. `taskRoutes.ts` has no residual write site in the current ratchet.
- [x] Convert document-number settings (`PUT /api/v1/workspaces/:workspaceId/numbering/:type`) through `numbering.update`; retain its `{ status, series }` wire shape and test preview, role/validation refusals, audit, inverse, and retry behavior.
- [ ] Migrate the remaining **181** scanner-counted route sites, one cohesive area per PR. Current largest candidates: `transactions/reconcileRoutes.ts` (11), `accountRoutes.ts` (10), `inventoryRoutes.ts` (9), `paymentRoutes.ts` (8), `savedListRoutes.ts` (8), and `workspaceRoutes.ts` (7). The baseline JSON is authoritative for the complete inventory.
- [ ] Before every route move, cover the old request/response for a normal result, a refusal, and a retry; then retain those parity assertions on the command wrapper. Do not change posting, tax, or report math.
- [ ] Review and classify every remaining POST/PUT/PATCH/DELETE site. In particular, keep `mathRoutes.ts`'s seven `TruthEngine` calculation endpoints out of mutation commands unless a stored-data write is demonstrated; add a test-backed, reasoned scanner exception rather than hiding or wrapping read/calculation work. Review the remaining period-route hits similarly (the reset path writes; FX preview is read-only despite POST).
- [ ] Finish the runner's required refusal-order/dummy-command acceptance proof and audit every command's schema, roles, transaction handler, read-only preview, audit summary, applicable inverse, risk, example, and refusals.

## 2. Browser writes and RLS

- [ ] Inventory and move the remaining **106 direct browser-write call sites across 54 files**. The scanner's largest current source files include `useEntityOperations.ts` and `useAutoRules.ts` (6 each), `Inventory.tsx`, `EstimatesView.tsx`, and `SupportView.tsx` (5 each). Classify each call by table and real-workspace vs guest/sample behavior before changing it.
- [ ] Migrate table by table: registered command and server parity tests → browser caller switch → migration removes browser insert/update/delete access → `supabase/tests/rls.test.sql` proves the direct operation is refused while reads remain available.
- [x] Keep the already-merged #719 document/rule migration in scope only as completed groundwork: four issued-document tables, automation rules, and warranty-history protection. It does **not** finish estimates or the remaining browser-write inventory.
- [ ] List each new migration in `docs/FOR_YOU.md`; apply it to the live database only after its PR is merged and the deployed UI is verified. Never remove a browser policy ahead of the code that replaces the write.
- [ ] At final acceptance, make the direct-write count zero or keep each exception in an explicit, tested reason list; do not weaken the ratchet.

## 3. Proposals, undo, and assistant tools

- [x] The command-count threshold to begin this work is met (61 commands after this batch).
- [ ] Issue an assistant token scoped to one person, one workspace, and that person's role; expire it within one hour and reject it on every non-read/non-command route.
- [ ] Assistant command calls validate and preview only, then persist a proposal; they must never run a handler before the person's acceptance.
- [ ] Add proposal list/read, accept-as-person, edit-and-revalidate then accept, reject, and expiry behavior. Test partial acceptance and placeholder IDs for later steps in a multi-step proposal.
- [ ] Record each accepted command's inverse and run Undo as an ordinary checked command. Test create/edit/delete proposal flows, refusal, retry, partial acceptance, and undo.
- [ ] Implement the SBX-1 overlay from [`SBX-1-assistant-sandbox.md`](SBX-1-assistant-sandbox.md): read-only proposed-state lists/records/reports, recheck at acceptance, and no writes before acceptance. Complete the workspace, accounts, periods, and inventory prerequisites first.
- [ ] Add the read tools `search_records`, `get_record`, `list_records`, `run_report`, `ask_books`, `explain_number`, `list_proposals`, `preview_proposal`, and `calculate`; expose roughly 25 tools at once plus `find_command(words)` over the full list.
- [ ] Generate `assistant/tools.json` from each command's schema and `describe`; add provider conversion and freshness/completeness tests. Add `assistant/SYSTEM_PROMPT.md` with the prompt's data-is-not-instruction, cite-your-source, use-tools-for-figures, propose-before-acceptance, clarify-ambiguity, and workspace-currency rules. These assistant files/routes are not present in the current base.
- [ ] Require high-risk actions to be accepted one at a time with fresh two-step confirmation; never offer Accept All for them. Keep `/admin` and `/system` outside the command registry.

## 4. Generated outputs

- [x] `scripts/generate-commands.ts` produces the command manifest, browser-safe schemas/roles, generated SDK command inputs/names, and OpenAPI schema-name map. `src/server/openapi.ts` derives its command paths and schemas from those generated artifacts; `sdk/ledgerflowClient.ts` uses the generated input types. `commands-generated.test.ts` checks registry/schema/OpenAPI/client metadata consistency.
- [x] Regenerate the artifacts for `numbering.update` in this PR; the generated-output test covers the new schema and command.
- [ ] Keep the generator/freshness tests in every command PR, and ensure the final API/schema and typed-client coverage includes every registered command. Generate assistant tool outputs from the same source; do not hand-maintain duplicate descriptions.

## 5. Final acceptance

- [ ] Server route-write count is zero, or every remaining site is listed with a tested reason; direct browser-write count is zero, or every exception is listed with a tested reason.
- [ ] Every registered command has the required schema, roles, handler, read-only preview, audit, applicable inverse, risk, example, and refusal guidance; runner auth, workspace, validation, lock/capacity, transaction, retry, and audit order are proven.
- [ ] An assistant proposal covering create, edit, and delete can be previewed, partly accepted, and undone; the sandbox rechecks before acceptance and never writes early.
- [ ] Direct-write probes and RLS cases refuse browser writes to every moved table; reads and deployed screens still work. All migration actions are recorded for post-deploy application.
- [ ] Generated OpenAPI/SDK/browser metadata and assistant tools are current and fail tests when stale.
- [ ] Full CI and the CMD-1 prompt's final gates pass; `docs/RELEASE_GATE.md` workflows previously marked “Yes” remain “Yes”.
- [ ] No posting, tax, or report calculations changed as part of this structural migration.
