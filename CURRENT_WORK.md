# Current work — read this first (every AI, every session)

Updated 28 Oct 2026 by AI #8 — F-48 deterministic axe scans (PR #435); Actions validation and review follow-up recorded in the PR. This page is the one place for **what to do now**. Status of the
product is in [`docs/RELEASE_GATE.md`](docs/RELEASE_GATE.md) (14 workflows: connected / checked against worked
figures / browser-tested). Full task wording is in your queue in [`docs/COORDINATION.md`](docs/COORDINATION.md).
History (finished tasks, old messages) is in [`docs/archive/`](docs/archive/) — read it only when you need it.

> **CMD-1 status supersedes this 28 Oct snapshot.** Batch 0 (#719) and the period batch (#731) are now merged. For the current, `main`-reconciled CMD-1 counts, per-domain checklist, and acceptance order, use [`docs/prompts/CMD-1-checklist.md`](docs/prompts/CMD-1-checklist.md); do not use old CMD-1 branch/PR counts elsewhere in this file.

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

**AI #3 issue #274 §1 — 9 November (`632cc41`):** the Settings reveal now has browser evidence too. `e2e/settings-section-reveal.spec.ts` (**2/2**, phone and desktop) asserts the open panel sits **below the fold before** the click — #274's reported state — and is on screen and focused after choosing Developer, so it is not vacuous. No production code changed.

**AI #3 issue #146 — 9 November (`946688c`):** the nested *Edit record details* drawer's Escape flake now has browser evidence. The cause is focus: `Save details` disables itself for the write, the browser drops focus to `body`, and an Escape from outside never reached the dialog; `useDialog` already answers that at the document in the capture phase. New `e2e/issue-146-drawer-escape.spec.ts` (**2/2**, three runs) reproduces it against the real drawer over the real bill modal with a deliberately slow write, checks the drawer closes alone with the draft intact, and that the accepted write still lands. **No production code changed** — the test was proven non-vacuous by removing the handler (focus `body`, drawer stays open) and restoring it. Neighbours 5/5, dialog unit tests 9/9, types/lint clean.

**AI #3 update — 10 November: the 10 November batch is DONE.** A-273…A-277 all implemented and green locally on `arena/3fc8a35d-ledgerflow`: A-273 invoice print loads a real stubbed PDF and checks the invoice number + total in the previewed bytes; A-274 aging two-row focus regression (proven red without the `openerRef` line); A-275 `passkeysOff` matches the server's words (Settings + sign-in show the plain wording); A-276 phone pass 10/10 with 3 real defects fixed (Payments unreachable table, Purchase Orders unfocusable scroll regions, Audit Trail clipped Export); A-277 trial balance + journal print roots with the Reports paper choice, journal sheet in the print loop. Tests: **10/10** print, **3/3** keyboard, **10/10** phone Chromium; **11/11** passkeys + **39/39** focused unit; types/lint (0 errors / 42 warnings)/build clean. Evidence: [`docs/verification/ai3-a273-a277-2026-11-10.md`](docs/verification/ai3-a273-a277-2026-11-10.md); final list: [`audit/FINAL_ACCURATE_LIST_2026-11-10.md`](audit/FINAL_ACCURATE_LIST_2026-11-10.md). **AI #3's queue is empty — waiting on AI #1 for the next batch.** DB-backed gates are CI's (no local Postgres here). H-7: no AI #10 claim on trial balance/journal sheet, so A-277 took them.

**AI #3 update — 9 November: the 8 November batch is DONE.** A-268…A-272 all implemented and green locally on `arena/b24110c9-ledgerflow` (`d348777`): A-268 Standard Cost Variance report screen; A-269 the passkey ceremony driven in Chromium with a CDP virtual authenticator (a resident credential for this origin is really created, and the Settings panel lists it — the refusal case is reported, not swallowed); A-270 the Reports keyboard path (aging rows open by Enter/Space, focus returns to the exact row, period shortcuts report `aria-pressed`); A-271 print styles measured from the printed PDF (A4 `595×842`, Letter `612×792`, stable page counts, no navigation, no clipped columns); A-272 empty and error states on ten more screens. Tests: **11/11** this batch's Chromium specs, **12/12** neighbouring phone/keyboard specs, **20/20** focused unit/regression, types and lint at the repo bar (0 errors / 42 warnings). Evidence: [`docs/verification/ai3-a269-a272-2026-11-09.md`](docs/verification/ai3-a269-a272-2026-11-09.md) (and [`ai3-a268-2026-11-08.md`](docs/verification/ai3-a268-2026-11-08.md)). **AI #3's queue is empty — waiting on AI #1 for the next batch.** DB-backed gates are CI's (no local Postgres here). H-7 overlap reported under COORDINATION Messages.

**AI #3 update — 8 November:** A-268 standard cost variance report screen implemented on `ai3/a268-standard-cost-report`: Reports → Inventory → Standard Cost Variance (`standard-cost-variance`) with item, quantity, standard, actual, unit variance, %, on hand variance, total variance, and "N items have no standard cost" linking to Inventory. Tests: 4/4 view tests, types/lint (0 errors / 42 warnings)/build clean, phone check in `e2e/phone-report-screens.spec.ts`. Evidence: [`docs/verification/ai3-a268-2026-11-08.md`](docs/verification/ai3-a268-2026-11-08.md).

**AI #3 update — 2 November:** A-263/A-265 implemented on `arena/821df0d8-ledgerflow`, pending CI/lead review. New Chromium checks **9/9**, focused regressions **29/29**, types/lint/build passed. Full local suite timed out after 30 minutes with an A-229 performance failure, so not called green. A-264/A-266/A-267 remain open. [Evidence](docs/verification/ai3-a263-a265-2026-11-02.md).

**AI #3 next update — 2 November:** A-264 keyboard paths implemented on `arena/1165c885-ledgerflow`: five browser journeys passed, 17 focused regressions passed; types/lint/build clean. Pending CI/lead review; A-266/A-267 remain open. [Evidence](docs/verification/ai3-a264-2026-11-02.md).

**AI #3 A-266 — 2 November:** Loading skeletons + measured layout stability on ten busy screens implemented on `arena/0c91798f-ledgerflow`; **11 browser checks**, **23 focused tests**, types/lint/build passed. Max observed main-region shift **0.0615** (<0.1) at 1280×900 on the journey fixture. Pending CI/lead review. A-267 is next. [Evidence](docs/verification/ai3-a266-2026-11-02.md).

**AI #3 A-267 — 2 November:** Five-form accessible-error batch on `arena/d2828711-ledgerflow`: **74/74 focused tests, 17/17 Chromium**, types/lint/build passed (0 errors/42 warnings). Existing FX test inputs/figures unchanged. **Partial:** owner left the journal footer's new required-description validation/test-contract change for lead review; broad native validation is not added to that save path. Full DB-backed gates await PR CI. [Evidence](docs/verification/ai3-a267-2026-11-02.md). Lead: assign next batch after resolving the remaining A-267 contract.

**AI #3 PR #497 review follow-up:** Confirmed/fixed CodeRabbit's orphaned bundle quantity alert when its part selection changes, using shared hook cleanup; regression proved red before the fix. **75/75 focused tests, 18/18 Chromium** passed; initial-head full CI `41539208734` green, follow-up CI pending. Journal footer decision still belongs to the lead. See A-267 evidence above.

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
- **Let GitHub CI do the heavy testing (owner, 18 Nov).** Before you push, run only the fast checks: the type check,
  ESLint on the files you changed, and the tests for the code you changed. Do **not** run the whole unit suite or
  every browser shard yourself: CI runs all of them on every push, in parallel, faster than your sandbox. Push, keep
  working on the next task while CI runs, then read the result and fix what is red. Say in the PR which checks you ran
  and that the full suite is CI's. A PR whose CI is red is sent back.
- **Do a lot per PR (owner, 18 Nov).** Don't open one PR per small task: put a whole batch of your queue (several
  tasks, as many as you finish in the session) on one branch and one PR, one commit per task. Keep pushing to the same
  PR until the batch is done. Only split a PR when two parts touch unrelated areas and one might be held back.
- Screens follow [`docs/UI_GUIDE.md`](docs/UI_GUIDE.md); every button's visible text is part of its name (axe).
- Plan: [`docs/PLAN.md`](docs/PLAN.md) **§17 bookkeeping first** (stages A/B/C, P0/P1/P2) — do P0 work first; tax automation and payroll processing are stage C; skip `[P]` (parked) tasks.
- Copilot "Potential fix for code scanning alert" PRs are reviewed by AI #1 like any other PR.

## Each AI's next tasks

| AI | Do next, in order — **P0 for stage A first** (PLAN §17) | Open PRs / blocked |
|---|---|---|
| #1 Claude (lead) | Reviews/merges and the plan; wire A-77 branding into PDFs when AI #3's resolver lands; L-94 server-side document postings (design) | — |
| #9 Opus (money lane) | **P0:** L94-STEP2 (the server builds invoice/bill entries); then ISS-160, PREV-5, AUD-15, L94-STEP2B, W7-GOLD, W8-GOLD, PREV-6, AUD-13, ISS-143+AUD-03, AUD-10, … (24 open, about 3 days; full order in COORDINATION). FIFO/lot costing waits for the owner | — |
| #7 (fork: Chaim-Richard) | Not active recently — its stage-A tasks moved to AI #4. When active: F-48/F-49 flakes, stability queue (F-*). How to send work: COORDINATION "AIs that work from the fork" | — |
| #3 Arena | **29 Oct: A-257 + A-258 + A-262 on `arena/f9021f5c-ledgerflow` (from `main` `8780d5d`).** **A-257 done:** every retry path in `useDataNeedsStore` marks the collection loading again until the fresh snapshot (CodeRabbit #436 follow-up; no-op when nothing failed), with store + Sales screen tests; the health-keys half verified already at target on `main`; the 44 px tap targets get a real Chromium measurement in `e2e/phone-tap-targets.spec.ts` (journeyFixture, 390 px, not clipped — CI-only here). **A-258 done:** `suppressionCount` 3 → **0** — pure deterministic uniforms in the runway simulation (no render-time `Math.random()`), a code-point loop in the IIF cell sanitizer; the ratchet recomputes 0 and the baseline is lowered. **A-260 done:** axe contrast baselines are 0 on every key (already met on `main`); `src/tests/theme-contrast-pairs.test.ts` (51/51) now guards the theme token pairs with two documented dark offenders on floors that only rise (palette raise needs a browser session for the screenshot references). **A-262 done:** the shared `EmptyState` on ten more screens (Fixed assets, Tasks, Time, Journal, Chart of accounts, Inventory, Budgets, Team & Invites, Rules, Estimates) with the screen's own add action, filter-vs-empty told apart, loading still wins (I-05 green); `src/tests/empty-states-next-ten.test.tsx` 11/11. Found + fixed in passing: `strategicEngine` crashed Inventory on a SKU-less item. Checks: `tsc` clean, ESLint **0 errors / 42 warnings** (cap unchanged), focused suites all green (49/49, 70/70, 27/27, 15/15, 26/26), full `npm test` **4114/4119** (the one standing fail, A-229's cold module-preload leg, is over budget on unmodified `main` in this sandbox too — machine noise, documented, budget untouched), `npm run build` OK. **PR #440 review round done:** all six bot findings fixed in code with tests (runway month-coordinates, scroll-box-driven tap-target spec with intersection assertion, Journal filtered-vs-empty, Budget/Estimates viewer gating, Sales refresh-status note). **29 Oct (2nd session, PR #446): A-259 + A-261 + A-234 browser leg done and green in CI twice (runs `40961560328`, `40962945868`) — six dialogs had announced `role="dialog"` with no keyboard behaviour at all, now on shared `useDialog`; hover-hidden row actions appear on keyboard focus; six report screens proven at 390 px; the wizard walk asserts the exact writes and reads them back. Plus #146's drift-Escape mechanism (topmost dialog answers), #342's last three civil dates, #104's grid browser leg. The owner's FINAL list is `audit/FINAL_ACCURATE_LIST_2026-10-29.md`.** Evidence: `docs/verification/ai3-a259-a261-a234-2026-10-29.md`. | **PR #446** (from `arena/9bc00485-ledgerflow`); next: A-260 (Hebrew/RTL + dark, long names), kind loading/empty states, native-dialog-elements check |
| #5 | **19 Nov: E-17 done — PR #950 open** on `arena/85901f75-ledgerflow` (from `main` `5fcf197`). The authority-order Form 856 CSV (E-17, blocked since 23 Oct on the unverified layout) now exists: `src/lib/tax/form856AuthorityCsv.ts` writes the CSV in the Tax Authority's record-60 field order from the published 2017–2025 layout (gov.il ITA attachment ↔ hon.co.il, cross-checked; 20 fields, 1–216 + CR/LF = 218 bytes), under the authority's numeric rules (whole agorot, zero-padded, empty → zeros), one record per withholding rate, no invented values; reachable on Reports → Form 856 with the תיק ניכויים prefilled from the tax profile and the worksheet's guards. `readyForFiling: false` — never the transmission file; unit evidence + open verification item in [`docs/FORM_856_AUTHORITY_CSV.md`](docs/FORM_856_AUTHORITY_CSV.md). Tests: authority-csv 9/9, form-856 view 5/5 (+1 download-bytes test), translation guard 127/127, screen-help/help-coverage 196/196, ratchets 26/26; `tsc` clean; ESLint 0 errors / 2 pre-existing warnings. **E-55 (PR #863) merged green 18 Nov**; evidence [`docs/verification/ai5-e55-2026-11-18.md`](docs/verification/ai5-e55-2026-11-18.md). Remaining queue: E-33/E-54 (uniform file, needs the BKMVDATA/INI spec), E-34 (SAF-T schema decision), E-50/E-51 (blocked on mail/OCR providers + AI #1's attachment path), E-56 (real-file corpus). | `arena/85901f75-ledgerflow` |
| #4 | **8 Nov (Agent #4): D-15/D-18 US Federal Withholding 2026/2025 Tables (Pub 15-T) + Golden Tests, D-34 Rule Engine Property Invariants, D-35 Line Tax Invariants, D-64 Money Round-Trip Invariants, D-30 Route Policy Coverage & Tenant Wall Suite, D-91 Icon Button A11y Guard.** 34/34 tests pass across 7 suites + reachability guard; `tsc` clean (0 errors), ESLint 0 errors / 0 warnings on touched files, production build passes cleanly. Final accurate list published: `audit/FINAL_ACCURATE_LIST_2026-11-08.md`. Evidence: `docs/verification/ai4-d15-d18-d30-d34-d35-d64-2026-11-08.md`. PR #569 open. | `arena/8f7c6947-ledgerflow` |
| #2 Codex | **10 Nov: C-40 merged in #570; all 7 unresolved bot review findings answered in code with tests** on `arena/a43d823e-ledgerflow` (**PR #601**; currency, missing/stale registration, accounts readiness, scoped mixed-bill notice, `csvMoney`, reclaim CSV, docstrings/help). Focused 14/14 (mutations proven red), guards 20/20, types/lint/build clean, full suite 4583/4589 with the pre-existing A-229 sandbox perf leg only. #570's failed CI/Sonar traced to a duplicate `REPORT_TAB_IDS` split, fixed on main by #576. Evidence `docs/verification/ai2-c40-review-followups-2026-11-10.md`; final list `audit/AI2_FINAL_ACCURATE_LIST_2026-11-10.md`. | **PR #601** |
| #6 (fork: Chaim-Richard) | S-01–S-05 merged 21 Oct (#266–#270); next: S-1 onward in its queue. How to send work: COORDINATION "AIs that work from the fork" | — |
| #8 (fork: Chaim-Richard) | G-9 (IL + US sample companies) and G-1…G-16/G-20…G-23 are already implemented with evidence in `docs/verification/ai8-verification-2026-10-20.md`; queue reconciled in COORDINATION. Current task: F-48 deterministic axe scans, PR #435 (pending CI validation). F-49 Vite dependency pre-bundling exists in `vite.config.ts` but still needs a fresh-browser verification before ticking complete. | [PR #435](https://github.com/shmuelbiller1/ledgerflow/pull/435) |

## Where things are

| What | File |
|---|---|
| Product status, what blocks release | `docs/RELEASE_GATE.md` |
| Your full queue (task wording) and Messages | `docs/COORDINATION.md` |
| AI #1's own list | `docs/TRACKER.md` (open items only) |
| Questions for the owner | `docs/FOR_YOU.md` |
| Architecture and data rules | `AGENTS.md` |
| Finished tasks, old messages, old plans | `docs/archive/` |
