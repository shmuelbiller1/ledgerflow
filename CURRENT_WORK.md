# Current work — read this first (every AI, every session)

Updated 25 Oct 2026 by AI #5 (Arena) — E-53 IIF export + E-44/45/46/47 provider imports; verification evidence: [`docs/verification/ai5-e53-e44-e47-2026-10-25.md`](docs/verification/ai5-e53-e44-e47-2026-10-25.md). This page is the one place for **what to do now**. Status of the
product is in [`docs/RELEASE_GATE.md`](docs/RELEASE_GATE.md) (14 workflows: connected / checked against worked
figures / browser-tested). Full task wording is in your queue in [`docs/COORDINATION.md`](docs/COORDINATION.md).
History (finished tasks, old messages) is in [`docs/archive/`](docs/archive/) — read it only when you need it.

## Not done yet — the short list (updated every merge)

Everything below is open. Finished items leave this list. Full wording is in COORDINATION (other AIs) and TRACKER (AI #1).

**Stage A (synthetic bookkeeping beta) is READY.** All 9 workflows (W1, W2, W3, W4, W5, W6, W9, W10, W14) are Connected, Verified with worked figures, and Browser-tested. See [`audit/LAUNCH_READINESS_FINAL_AUDIT_2026-10-23.md`](audit/LAUNCH_READINESS_FINAL_AUDIT_2026-10-23.md) and [`docs/RELEASE_GATE.md`](docs/RELEASE_GATE.md).

| Workflow / Gate | Status | Who |
|---|---|---|
| Done for A | **W1, W2, W3, W4, W5, W6, W9, W10, W14** (all 9 Yes/Yes/Yes; D-98 and D-99 browser journeys merged in #324; L-123 server balances merged in #334, #345, #351; G-24 journey merged in #282) | — |
| Owner launch actions | Paste L-123 migration in Supabase, set `DATABASE_CA_CERT` in Vercel, rotate 4 secrets (items in `docs/FOR_YOU.md`) | Owner |
| Stage B: W11 QuickBooks/CSV | Import acceptance matched to source (AU-4) | AI #5 / AI #9 |
| Stage B: W13 stock | Full stock browser journey (W13-GOLD figures verified #281) | AI #4 / AI #9 |
| Stage B: ERPNext depth | Repost engine (EG-1 #348 design), Payment ledger (EG-2), Period closing voucher (EG-3), Stock snapshots (EG-7) | AI #1 / AI #9 |

**Pull request for this branch**

| PR | State |
|---|---|
| new (from `arena/8d145257-ledgerflow`) | E-53 IIF export + E-44/E-45/E-46/E-47 provider list imports |
| new (from `arena/f78daa80-ledgerflow`) | Open-issue batch, 27 Oct: #274 §1 Settings section reveal + §2 Saved Views dialog surface/stacking, #104 ledger keyboard region (no window listener, no Tab capture, scroll-to-row, no empty-list crash), #96 bounded automatic live-collection retry, #342 stored-date display. Review round: every finding on the PR answered (focus return from the cell editor, Tab help text, spoken column names, keyboard start, app reduced-motion, `?` under a dialog, retries after the tab returns, adapter refusal codes, and the print-only `--bg` the manager painted with). Evidence: [`docs/verification/arena-open-issues-batch-2026-10-27.md`](docs/verification/arena-open-issues-batch-2026-10-27.md). No RELEASE_GATE row changes. |
| **#414** (from `arena/63bdffa0-ledgerflow`) | AI #2 C-38/C-54/C-65/C-67/C-68/C-85/C-87/C-89/C-90/C-91/C-96/C-97/C-98/C-101 launch-readiness batch; review fixes and reviewed CI visual baselines included |
| new (from `arena/f7145642-ledgerflow`) | AI #3 A-230…A-235 batch (A-232 + A-233 + A-235 done, A-230/A-231 verified outside the server lane, A-234 component journey + browser open) + `audit/FINAL_ACCURATE_LIST_2026-10-28.md`. Evidence: `docs/verification/ai3-a230-a235-2026-10-28.md` |
| new (from `arena/f9021f5c-ledgerflow`) | AI #3 A-257 + A-258 + A-262: retry paths mark collections loading until the fresh snapshot; lint suppressions 3 → 0 (baseline lowered, recompute-verified); shared empty states with "Add your first …" actions on ten more screens; Chromium 44 px tap-target spec for CI. Evidence: `docs/verification/ai3-a257-a258-a262-2026-10-29.md` |

**Waiting on you (owner)** — details in `docs/FOR_YOU.md`
- Replace the four generated secrets (item 2), try sign-up on the live site (3), deployment protection (4).
- Email sender + provider (5, 7), database certificate (6), Stripe last 2 steps (8), privacy papers (17).
- GitHub: require CI before merging to `main` (L-67).

**After stage A (stage B)**: W11 QuickBooks/CSV import matched to the source (AU-4), W13 stock journey, Israeli allocation numbers, production gates. W12's group-report browser gate is complete in PR #370. **Stage C**: tax filing automation, payroll processing. The ~400 "LATER" ideas stay in TRACKER and are not on this list.

## Start of every session

0. **Where you push.** Run `git remote -v`. If `origin` is **`Chaim-Richard/ledgerflow`** (a fork — AI #6, #7, #8 work
   there), your work reaches the owner only as a **pull request from the fork into `shmuelbiller1/ledgerflow`, base
   `main`**, with "Allow edits by maintainers" ticked. Start every task from the owner's latest main, not the fork's:
   `git remote add upstream https://github.com/shmuelbiller1/ledgerflow.git` (once), then
   `git fetch upstream && git checkout -b ai<N>/<task-id> upstream/main`; push with `git push origin ai<N>/<task-id>`.
   Full steps: COORDINATION "AIs that work from the fork". If `origin` is `shmuelbiller1/ledgerflow`, push your
   branch there and open the PR as usual. Only AI #1 pushes to `main`.
1. Look at **your own open PRs** first (on `shmuelbiller1/ledgerflow`, including ones from the fork). Fix the ones AI #1 sent back (push to the same branch). A task in an open
   PR is not free to start again; if your next task needs that code, branch from that PR and say "builds on #NNN".
2. Then take the next task below, from the latest `main`.

## Rules that never change

- **AI #9 (Opus)** may change money/tax/stock code **in its lane only** (files listed in COORDINATION "AI #9"), always through a PR that AI #1 reviews; every money change comes with a test of worked figures.
- **AI #1 (Claude)** is the lead: pushes straight to `main`, merges everyone's PRs, owns money, posting, tax maths,
  statements/PDFs and `src/server/`. **Every other AI** works on its own branch and opens a PR; never merge your own.
- Problems in AI #1's area → write them under Messages in COORDINATION; don't patch them.
- Before opening a PR run: the type check, **the whole unit suite** (`npm test` with the local test database), ESLint
  (0 errors, warnings ≤ 205), the browser spec(s) you touched, and `npm run test:rules` if you touched SQL.
  Say the pass counts in the PR. A PR that fails its own test is sent back.
- Screens follow [`docs/UI_GUIDE.md`](docs/UI_GUIDE.md); every button's visible text is part of its name (axe).
- Plan: [`docs/PLAN.md`](docs/PLAN.md) **§17 bookkeeping first** (stages A/B/C, P0/P1/P2) — do P0 work first; tax automation and payroll processing are stage C; skip `[P]` (parked) tasks.
- Copilot "Potential fix for code scanning alert" PRs are reviewed by AI #1 like any other PR.

## Each AI's next tasks

| AI | Do next, in order — **P0 for stage A first** (PLAN §17) | Open PRs / blocked |
|---|---|---|
| #1 Claude (lead) | Reviews/merges and the plan; wire A-77 branding into PDFs when AI #3's resolver lands; L-94 server-side document postings (design) | — |
| #9 Opus (money lane) | **P0:** L94-STEP2 (the server builds invoice/bill entries); then ISS-160, PREV-5, AUD-15, L94-STEP2B, W7-GOLD, W8-GOLD, PREV-6, AUD-13, ISS-143+AUD-03, AUD-10, … (24 open, about 3 days; full order in COORDINATION). FIFO/lot costing waits for the owner | — |
| #7 (fork: Chaim-Richard) | Not active recently — its stage-A tasks moved to AI #4. When active: F-48/F-49 flakes, stability queue (F-*). How to send work: COORDINATION "AIs that work from the fork" | — |
| #3 Arena | **29 Oct: A-257 + A-258 + A-262 on `arena/f9021f5c-ledgerflow` (from `main` `8780d5d`).** **A-257 done:** every retry path in `useDataNeedsStore` marks the collection loading again until the fresh snapshot (CodeRabbit #436 follow-up; no-op when nothing failed), with store + Sales screen tests; the health-keys half verified already at target on `main`; the 44 px tap targets get a real Chromium measurement in `e2e/phone-tap-targets.spec.ts` (journeyFixture, 390 px, not clipped — CI-only here). **A-258 done:** `suppressionCount` 3 → **0** — pure deterministic uniforms in the runway simulation (no render-time `Math.random()`), a code-point loop in the IIF cell sanitizer; the ratchet recomputes 0 and the baseline is lowered. **A-260 done:** axe contrast baselines are 0 on every key (already met on `main`); `src/tests/theme-contrast-pairs.test.ts` (51/51) now guards the theme token pairs with two documented dark offenders on floors that only rise (palette raise needs a browser session for the screenshot references). **A-262 done:** the shared `EmptyState` on ten more screens (Fixed assets, Tasks, Time, Journal, Chart of accounts, Inventory, Budgets, Team & Invites, Rules, Estimates) with the screen's own add action, filter-vs-empty told apart, loading still wins (I-05 green); `src/tests/empty-states-next-ten.test.tsx` 11/11. Found + fixed in passing: `strategicEngine` crashed Inventory on a SKU-less item. Checks: `tsc` clean, ESLint **0 errors / 42 warnings** (cap unchanged), focused suites all green (49/49, 70/70, 27/27, 15/15, 26/26), full `npm test` **4114/4119** (the one standing fail, A-229's cold module-preload leg, is over budget on unmodified `main` in this sandbox too — machine noise, documented, budget untouched), `npm run build` OK. **PR #440 review round done:** all six bot findings fixed in code with tests (runway month-coordinates, scroll-box-driven tap-target spec with intersection assertion, Journal filtered-vs-empty, Budget/Estimates viewer gating, Sales refresh-status note). **Next: A-259 (keyboard paths), A-261 (report phone layouts) — Chromium specs for CI; A-234's browser leg.** Evidence: `docs/verification/ai3-a257-a258-a262-2026-10-29.md`. | **PR from `arena/f9021f5c-ledgerflow`** (this branch); A-234/259/260/261 need a machine with a browser |
| #5 | **On this branch (ready for review): the E-53/E-44/E-45/E-46/E-47 imports-exports batch** — the IIF **writer** (`src/lib/iifExport.ts`, lists only — no `!TRNS`/`!SPL`, no balances/quantities; the E-29 reader is its round-trip test) with an owner-only card on Settings → Backup & Export built from the checksum-verified server backup; and four documented-provider list readers wired into the Import-data source select: Xero chart/contacts (E-44 done), Wave customers (E-45), Zoho Books (E-46), Sage 50 CHART/CUSTOMER/VENDOR/ITEM (E-47, the documented numeric type-code table, with retainage/contra codes refused by row, never reclassified). 7 fixtures shaped on the cited templates; tests 6+4+5+3+4+5 lib/ui + 4 screen. Merged earlier: E-58, E-26/E-43, E-28, E-29, E-32/E-36–E-40 (#355), E-35. **Next:** E-55's PCN874 validation screen (the only unblocked row left); E-17/E-33/E-34/E-54 spec-blocked, E-50/E-51 provider-blocked, E-56 needs real photos, E-57's four totals wait on AI #1's snapshot. Queue re-read: [`docs/verification/ai5-queue-audit-2026-10-23.md`](docs/verification/ai5-queue-audit-2026-10-23.md). Evidence: [`docs/verification/ai5-e53-e44-e47-2026-10-25.md`](docs/verification/ai5-e53-e44-e47-2026-10-25.md). | `arena/8d145257-ledgerflow` |
| #4 | #370 is merged (D-47 and F-47/W12). W13 purchase → stock → sale → valuation now has a real-router/Postgres browser journey at both widths/themes, awaiting review. D-42/D-44/D-76 reconciled as already delivered. Next: D-99 fully authenticated four-account/W14 proof, which remains open. | `ai4/w13-full-stock-journey`; [evidence](docs/verification/ai4-w13-full-stock-journey-2026-10-24.md) |
| #2 Codex | **27 Oct: C-84 pack sections, C-83 certificate reminder drafts, C-94 report skeleton, C-95 totals drill-down on `arena/89c30823-ledgerflow`.** The monthly pack picker now carries **Budget vs actual** and **Stock on hand by age** from the existing report services (own month/as-of day, printed with each section, refusing a mismatching answer); Reports → Customer tax certificates drafts the EN/HE reminder letter for an expired, expiring or undated certificate (copy or the reader's own mail app — nothing sent, filed or changed); `ReportSkeleton` replaces the spinner in the report shell and shows while the pack reads its sections; and every P&L, balance-sheet and trial-balance **total** now opens the posted entries it is made of with the server explaining the same figure. Queue re-check at `2b6705e` ticked C-74, C-76, C-77, C-79, C-80, C-81, C-82 and C-100 as already delivered with their own tests; C-78/C-86/C-88 wait on AI #1's server routes, C-92 needs a column i18n layer, C-99 needs allowed `workspaces` fields, C-93 is not fully walked. No money/posting/tax-math/server/schema change; no RELEASE_GATE row claimed. Checks: `tsc` clean, full ESLint 0 errors / 42 warnings (cap unchanged), changed-file 0/0, new and touched tests 23 pass. Evidence: `docs/verification/ai2-c84-c83-c94-c95-2026-10-27.md`. | **PR from `arena/89c30823-ledgerflow`** (review) |
| #6 (fork: Chaim-Richard) | S-01–S-05 merged 21 Oct (#266–#270); next: S-1 onward in its queue. How to send work: COORDINATION "AIs that work from the fork" | — |
| #8 (fork: Chaim-Richard) | Works now and then: G-9 sample companies (IL + US), then its G-queue. How to send work: COORDINATION "AIs that work from the fork" | — |

## Where things are

| What | File |
|---|---|
| Product status, what blocks release | `docs/RELEASE_GATE.md` |
| Your full queue (task wording) and Messages | `docs/COORDINATION.md` |
| AI #1's own list | `docs/TRACKER.md` (open items only) |
| Questions for the owner | `docs/FOR_YOU.md` |
| Architecture and data rules | `AGENTS.md` |
| Finished tasks, old messages, old plans | `docs/archive/` |
