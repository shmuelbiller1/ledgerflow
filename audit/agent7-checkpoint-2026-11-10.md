# Agent #7 checkpoint — 10 November 2026

Session: independent-audit slice (docs/INDEPENDENT_AUDIT_AGENT.md, umbrella issue #150). Docs/probe-only branch; no financial, posting, tax-math, migration or server code touched.

## Pin and branch

- Upstream `shmuelbiller1/ledgerflow` `main` at `dc40739708a013ad080ffb306fe461554a2391fc` (2026-11-10T03:08Z; docs-only delta over `5968faf3`, which is where the executed evidence ran — `git diff --stat` between them touches only `docs/COORDINATION.md`).
- Work branch: `arena/016300c9-ledgerflow` (this session's assigned branch), reset from the fork's stale squashed `main` (`e58fa00a`) to upstream `main` before any work. No commit was made on the old base. The old base remains intact on `Chaim-Richard/ledgerflow:main`.
- Fork: `Chaim-Richard/ledgerflow` (origin); upstream added as `upstream` per CURRENT_WORK "Start of every session" step 0.

## Investigated

- `AGENTS.md`, `CURRENT_WORK.md`, `docs/INDEPENDENT_AUDIT_AGENT.md`, `docs/COORDINATION.md`, `docs/RELEASE_GATE.md`, `docs/FIRST_TESTERS_GATE.md` (skim), `docs/FOR_YOU.md` (owner actions), open GitHub issues/PRs (all 15 issues re-read; #524…#539, #527 confirmed merged 2026-11-09; #525 closed unmerged).
- Conflict-marker sweep across every tracked file at the pin: exactly one hit — `audit/FINAL_ACCURATE_LIST_2026-11-08.md` (introduced by `2245ff43`, 2026-11-09; still present at `dc4073970`).
- Source re-reads at the pin: `rules.ts`, `usSalesTaxReturn.ts`, `usInvoiceTax.ts` (saleDestinationSnapshot), `profile.ts`, `ilVatReturn.ts` (documentEntityLabels), `usNexusWatch.ts`, `calendarDate.ts`, `useLedgerData.ts`, `statementService.ts`, `israelMonthJourney.ts`, `returnAuthorizationRoutes.ts`, `rules-engine-properties.test.ts`.
- CI/workflow state: `ci.yml` (Postgres 17 service, 4 unit shards + coverage gate), ESLint ratchet success on `5968faf3`, CI + CodeQL in progress on `dc407397`.

## Discovered

- `main` contained an unresolved git merge conflict in `audit/FINAL_ACCURATE_LIST_2026-11-08.md` (Side A = Agent #7 list @fd50b2f2; Side B = Agent #4 list @dbaa113). Fixed in this PR (markers removed, both sides preserved verbatim, dated correction note added).
- #519 reproduced end-to-end at the pin through `saleDestinationSnapshot` + `usSalesTaxReturn` (new probe, committed): moving a customer retroactively removes their issued sales from the original state's return.
- #161 engine defect re-executed at the pin (order A,B,C → applied A,C; B,A,C → A; C,B,A → A). Shipped packs: 584 rules / 67 overrides / **0 nested chains / 0 dangling targets** — latent today; D-34 properties do not cover chains.
- AF-004 probe re-executed: P1,P2,P3,P4,P6,P7,P8 defects reproduce; P5 control holds. Common root: `resolveSellerProfile` inherits the books' registrations/place into any label-level entity that lists none of its own.
- #131: stock-side implementation is merged and gate-green (W13 Yes/Yes/Yes); residual = server full-history books figure (AI #9's own note); issue open.
- #130: revaluation code merged (#259); the ISS-130 migration was superseded by the 21 Oct migration, which the owner ran on 21 Oct ("Success. No rows returned"). Live DB not audited here.
- All 15 open issues re-verified open on GitHub (last close was #444, 2026-10-30). The 11-08 list's "stale, lead verify+close" set (#96,#141,#146,#342,#160,#143) remains accurate as code state; none was closed by the lead.

## Implemented

- `audit/FINAL_ACCURATE_LIST_2026-11-10.md` — the current accurate list at the pin (15 issues categorized; executed evidence; counts; limitations).
- Conflict-marker fix to `audit/FINAL_ACCURATE_LIST_2026-11-08.md` (both sides preserved).
- `audit/function-audit/probes/af004-519-customer-moves.ts` — new #519 reproduction probe.
- This checkpoint.

## Tested

- Probes re-executed at `dc4073970`: af012-rule-chain-order, af012-shipped-pack-chains, af004-tax-authority-probe, af004-519-customer-moves.
- Focused suites: `rules-engine-properties`, `iss160-il-vat-equipment`, `collection-retry`, `calendar-dates`, `civil-date-properties`, `aud01-statement-scope` → 38 pass / 0 fail. `iss143-rma-server`: not run (DB-gated; `LF_TEST_DATABASE_URL` unset; no Postgres binary in sandbox).
- Full `npm test` launched at the pin and still running at finalisation — result recorded in the PR/Drive, not asserted here.
- Not run: test:rules/RLS, browser/E2E, build, eslint, tsc (delegated to PR CI; this change touches no `src/`).

## Remains unfinished

- Money-lane fix for #519/#518/#517 (single shared-facts change) and #161 (chain semantics or graph rejection) — AI #1/#9 lane; do not start without assignment.
- Lead verification + closure of #96,#141,#146,#342,#160,#143,#274,#130,#131.
- Server-side full-history books figure for ISS-131 (issue point 4).
- Conflict-marker CI guard (suggested to lead; not added here — CI config change is beyond a docs PR).
- Full unit-suite outcome of this exact pin in CI (running locally; authoritative signal = PR CI).

## Where things are saved

- Branch `arena/016300c9-ledgerflow` on the fork (pushed); PR into `shmuelbiller1/ledgerflow:main` (link in the task report / handoff note; falls back to the fork compare link if the integration cannot open upstream PRs from a fork).
- Google Drive folder `2026-11-10 final accurate list session` (`1rWocRGHuq834BzET46Bq3PsmFxhvNFMd`) inside `LedgerFlow AI7 audit 2026-11-06` — checkpoints, the list, probe outputs, patch file.
- Recovery patch: `git diff dc407397..HEAD` saved in that folder.
