# LedgerFlow — final, accurate list (29 Oct 2026) — FINAL

**This document is FINAL as of the pin below.** (Owner 29 Oct: "work fast to get the final with
list of stuff — hard, accurate"; the system is ~2,343 TypeScript files under `src/`, so every
status below cites the run or read that earned it.) Later sessions: add a dated correction note
at the bottom; do not silently rewrite statuses.

| | |
|---|---|
| **Code pin (main base)** | `8a30819d9457431a4f4dc2635eaddac7d0132dd7` — "A-257 reload-notice, A-258 no lint suppressions, A-262 empty states…" PR **#440** |
| **This session's head** | `42f4aaae0c490995add61a2f4605cae8e80500f3` (branch `arena/9bc00485-ledgerflow`, PR **#446**) |
| **Supersedes** | `audit/FINAL_ACCURATE_LIST_2026-10-28.md` (FINAL at pin `a7c2038`) — kept as history, not edited |
| **Author** | AI #3 (Arena), staying in its lane: no money/posting/tax/`src/server/**` edits |
| **Evidence for this session** | `docs/verification/ai3-a259-a261-a234-2026-10-29.md`; CI runs named below |

**One-line status: LedgerFlow is launch-ready for code purposes in every lane except (1) the
automatic bank feed's confirmation-display rows (W11, AI #5 + AI #9), (2) the inventory
closing-stock row (AI #1 + AI #9), and (3) owner-only live settings (§2). Stage A = satisfied;
Stage B stays gated on those. Deployment protection stays ON until all of §2 is done.**

---

## 1 · Done — this session (PR #446, against pin `8a30819`)

Everything below is pushed on the branch and browser-proven in GitHub CI on this PR
(run `40961560328` green at `53203c7`; run `40962945868` green at `cc2bdd2`; the final head's run
is recorded at the bottom once green). Full detail: the verification note above.

| Item | What happened | Proof |
|---|---|---|
| **A-259** keyboard on busy screens | Six dialogs announced `role="dialog"` with **no keyboard behaviour at all** (Make deposit, Spread, Apply/refund credit, bank-line Pay/Split, Email invoice, Add fixed asset) — now on the shared `useDialog`. Hover-hidden row actions now also appear for keyboard focus (`group-focus-within`), with a source guard + named allowlist. | `e2e/keyboard-busy-screens.spec.ts` (5 screens: ring on row button → Enter → focus trapped in dialog → Escape → focus returns to the same button) + `src/tests/dialog-keyboard-a259.test.tsx` 7/7 |
| **#146** Escape dies after focus drift | A modal only heard Escape while focus was inside it; when a focused control unmounts/disables, focus drops to the body and Escape went dead behind the modal. `useDialog` now answers drifted Escape only as the topmost open dialog (deepest in the DOM, then latest) and never doubles field-level Escape. *Mechanism closed and pinned; the load-only original was not reproduced here — honest limit.* | `use-dialog` + `dialog-keyboard-a259` 14/14; CI green twice since |
| **A-261** phone report screens | Trial Balance / shared MonthNavigator / A/R+A/P aging controls to 44 px (P&L and Balance Sheet already measured 44). | `e2e/phone-report-screens.spec.ts` at 390 px: 6 screens, no sideways page scroll, tables scroll inside fitting boxes, period controls ≥44 px |
| **A-234** set-up wizard, browser leg | Full walk on the journey harness asserts the exact writes (workspace `lf_update` five-field save, `apply-template`, `opening-balances` in cents) and reads them back after remount. *Boundary honest: DB write stops at the harness stub; live persistence rests on the DB suites + 27 Oct migration, as before.* | `e2e/setup-wizard.spec.ts` green in CI |
| **#342** last device-zone displays | The final three `format(parseLocalDate(x))` screens (Forensic badges, Reconciliation row dates) now read the stored civil date (`civilMonthDay`/`civilMonthYear`/`civilDayOfMonth`, additive; no existing helper changed) — a Jan-1 entry can no longer display as Dec 31 across zones. Issue stays open for the helper-contract decision, which is AI #1's. | `date-display` civil pins; date batch 39/39 |
| **#104** grid keyboard, browser leg | Real Transactions grid region: focus, announced arrows/Home/End, highlighted row drawn on screen, Tab/Shift+Tab leave, Escape clears. 200-row scroll stay on unit `scrollToItem` assertions (demo books = 2 entries — stated in the spec). | `e2e/ledger-grid-keyboard.spec.ts` |
| Review bots | Codex: no findings. CodeRabbit: one Major (setup-wizard remount race) — fixed with an unmount wait. | PR #446 conversation |

**Suite/chores run this session:** tsc clean; ESLint 0 errors/0 warnings on changed files (repo
total unchanged: 42 warnings, all AI #1's `src/server/**`); all quality metrics at baselines
(`any` 37, UTC `new Date(` 6 — server lane; suppressions 0; ledger-door 0); AF-012 shipped-pack
probe re-run: 18 packs · 584 rules · 67 overrides · **0 chains** (#161 stays latent).
GitHub CI is the full-suite + browser evidence — every job (4 unit shards, 6 TZ shards, coverage,
DB migrations+ suites, 5 browser shards, visual, build, audits) green on `40961560328` **and**
`40962945868` *on this PR's commits*.

## 2 · Launch blockers that are NOT code (owner, in order)

1. **Restore Vercel** (Deployment Protection + billing) and confirm Production env:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `DATABASE_CA_CERT`, `SESSION_SECRET` ≥32, `CRON_SECRET` ≥32, `SYSTEM_SALT` ≥32
   (replace all four agent-generated secrets — `docs/FOR_YOU.md` §A2; rotation-safe **before**
   any real data / bank connection). (B2 — `docs/FIRST_TESTERS_GATE.md` G-17.)
2. **Live proof, ~10 minutes:** sign up on the live site (email arrives?), create a workspace,
   set up once, refresh, log out, sign back in → the same books open at once. (B6 / G-01.)
3. **No testers** until (1)+(2) are done; even then only the demo/sandbox wording that exists
   today ("Test environment; do not rely on results for actual filings or payment obligations"),
   no real bank credentials, no real filings. Stage B (real books) additionally waits on §3.
4. **Email + payments keys when ready:** Supabase SMTP (FOR_YOU §A5/7), `RESEND_API_KEY`,
   `EMAIL_FROM`, `STRIPE_*` (FOR_YOU §A8), Plaid sandbox (FOR_YOU §A8).
   Done already: Supabase redirect URLs + connector permissions (13 Oct, FOR_YOU §A0/1).

## 3 · Still open, by owner (verified from code on 29 Oct, not copied from yesterday)

### Stage-B functional blockers (from `docs/RELEASE_GATE.md`, re-read today)

| Row | Status today | What remains | Owner |
|---|---|---|---|
| **W11** bank-feed confirmation display | Partly — **main blocker** | Pending vs posted display; vendor-changed-row confirm-before-import; larger-than-batch manual CSV → held batch; real-provider two-run + mid-sync-failure proof (cursor fix is already merged) | AI #5 + AI #9 |
| **W12** | Tracked **Yes** | — | — |
| **W13** | Tracked **Yes** with caveats | Non-production-auth observation stays on the row for AI #9 review | AI #4 + AI #9 |
| Inventory closing-stock posting (ERPNext EG gap) | Open | Sales-below-stock-as-negative + period-close closing-stock entry | AI #1 + AI #9 (design agreed) |
| Everything else W1–W6, W9, W10, W14 | **Stage A satisfied** | — | — |

### Open GitHub issues — all 14, each re-verified in code today

| # | Issue (short) | Verified state on 29 Oct | Lane |
|---|---|---|---|
| **444** | Conflicting cutover rules: pinned `cutover-hold` marker vs gate/SEC text | Needs one authoritative cutover rule-set + its review | AI #1 / AI #9 |
| **342** | TZ-safety of date helpers | Remaining **screen** display sites fixed here (§1); the helper-contract half needs AI #1's decision | AI #1 |
| **274** | Settings panels clipped/hidden on mobile | Targeted tests exist (`settings-section-visibility`, `saved-views-manager-layering`); full real-browser pass still owed | AI #3 / visual |
| **161** | Nested `overrides` chains in rule packs (design) | AF-012 re-run today: **0 chains in shipped packs** — latent only; harden-on-first-chain stands | tax |
| **160** | AF-012 typed override targets (follow-up) | As filed | tax |
| **150** | AF-011 clarifications (2023 SS wage base; US-CA SDI amount) | As filed — small, human-readable | tax |
| **146** | Escape-to-close intermittently eaten | Focus-drift half fixed + pinned (§1); keep open until several full green suites prove the flake gone | AI #3 → close candidate |
| **143** | December weekly-balance off-by-one (CashFlowPredictor) | As filed | AI #1 (logic) |
| **141** | Customer statement not entity-scoped | `loadStatement(db, workspaceId, contactId, period, type)` still takes no entity argument — confirmed today | AI #1 / money |
| **132 / 131 / 130** | Restore integrity bound + verify against import · second evidence pass (offline queue/APIs) · statement + /api forms of the capped-loader class | As filed (B-class) | AI #1 / money |
| **104** | Grid full keyboard + scrollIntoView vs virtualizer | Unit `scrollToItem` coverage + new browser leg (§1); the >45-row real-scroll case remains — states so in the spec | AI #3 → mostly done |
| **96** | Server `mountWorkflows`: route audit outstanding | Server-only (`mountWorkflows` in `src/server/**` — no client dead-code half exists) | AI #1 / server |

## 4 · Honest leftovers (not blockers)

- **42 exhaustive-deps warnings**, all in SQL-managing hooks under `src/server/**` (AI #1) — need
  statement-by-statement review showing each change keeps the same reads/writes.
- **6 non-civil `new Date(`** in the server lane, none on a fiscal boundary (27 Oct walk).
- **37 `any`** at baseline; zero suppressions.
- **Tier-B ratchets**: literal-colour 871 / button 1379 / hand-rolled-open-state 1 / arbitrary-type
  39 — each with named follow-ups in `docs/COORDINATION.md`; can never rise.
- **AI #3 queue after this PR merges** (next in `docs/COORDINATION.md`): A-260 (Hebrew/RTL +
  dark mode re-check on ~6 busy screens, incl. long Hebrew account names), then kind
  loading/empty states (password fields, whole-app initial load), then a native-dialog-elements
  (Esc/focus) check.

## 5 · Scale & areas-of-proof snapshot (fresh counts, 29 Oct)

- 2,343 `.ts/.tsx` under `src/` · 896 unit test files run by `npm test` (4 shards) · 95 Playwright
  specs (+3 new today) · 46 migrations (fresh-apply CI gate) · full CI ≈ 25 jobs.
- 25 domains green at the base pin (all four unit shards, six TZ shards, three DB jobs incl.
  real-PG RLS/caps/migrations, coverage, five browser shards, visual, build, audits, secret scan,
  CodeQL, SBOM) — and re-proven twice on this PR's commits (§1).
- Open: **0 PRs** besides **#446**. **14 issues** (§3). **Vercel** status on this PR is red by
  owner's deliberate pause (preview disabled to save usage) — not a code result.

**Status: FINAL at the pin above.** Corrections and the final CI run id go below this line as a
dated addendum, never as a silent edit.

---
