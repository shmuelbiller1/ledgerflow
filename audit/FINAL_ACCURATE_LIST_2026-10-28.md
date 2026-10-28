# The accurate list — what is actually left before launch (2026-10-28)

**Status: FINAL for this pass.** This is the delta over `audit/FINAL_ACCURATE_LIST_2026-10-27.md`,
written the next day by **AI #3 (Arena)** at the request of the owner ("work fast to get the final
with list of stuff — hard, accurate"). Every claim below was either (a) produced by a command in
this checkout at the pin named, (b) carried forward from the 27 Oct list with its evidence, or
(c) explicitly marked **not verified here**.

**Browser evidence in this list:** the nine stage-A workflow rows keep the browser results recorded
in `docs/RELEASE_GATE.md` from earlier runs; they are **not** re-run by this audit. This sandbox has
no Chromium, so the browser checks this pass added (A-233's phone screens) are marked with their
GitHub CI run rather than a local run, and the ones that never ran there are marked **not run**.

- **Pinned revision:** `a7c203852b4dce2dc7b149aa04516b3387d7a243` (`main`, 28 Oct, "fix(quick entry):
  post both lines so the server stops refusing every entry", PR #431).
- **Branch this list was produced on:** `arena/f7145642-ledgerflow` (the A-230…A-235 batch, plus the
  documents). No money, posting, tax-maths, `src/server/**`, schema, migration or dependency change.
- **Previous list:** `audit/FINAL_ACCURATE_LIST_2026-10-27.md`, pin `b4a92158` (AI #8).
- **Owner note on red checks:** the Vercel preview is intentionally paused for merges (usage), so a
  red Vercel status is **not** a code result. GitHub CI on a PR is the code test here.

---

## 1. What actually blocks the synthetic beta (stage A) today

Stage A needs W1, W2, W3, W4, W5, W6, W9, W10, W14 **connected / verified with worked figures /
browser-tested** (`docs/RELEASE_GATE.md`), the test-environment banner, and G-01/G-02. All nine rows
are Yes/Yes/Yes on `main`. What is left is **not code in an AI's queue** except as noted:

| # | Item | State at this pin | Who |
|---|---|---|---|
| **B1** | **Owner actions in Vercel/Supabase**: rotate `SESSION_SECRET`, `INVITE_SECRET`, `CRON_SECRET`, `SYSTEM_SALT`; set `DATABASE_CA_CERT`; deployment protection off for testers; real email sender; try sign-up on the live site | **Unchanged — owner only.** `docs/FOR_YOU.md` items 2–8 | Owner |
| **B2** | **Three migrations confirmed applied** (`20261020120000_inventory_cost_server_only.sql`, `20261021010000_inventory_cost_editable_at_zero.sql`, `20261022000000_rma_server_only.sql`) | **Unchanged — needs a Supabase check**; the other 42 are recorded applied | Owner |
| **B3** | **First-run save bug (wizard)** | Fixed in code on 27 Oct by migration `20261027000000_server_fields_allowed`; the component journey that guards it now exists and passes (A-234 below); the **browser walk with the real row is still missing** | AI #3 (A-234) |
| **B4** | **TaxManager tax-year filter** (a Jan-1 entry in an Israeli book filed in the previous year on a US laptop) | **Fixed** — `TaxManager.tsx:205` now filters with `civilYear(tx.date)` (PR #426). Verified by grep at this pin | done |
| **B5** | **Report cache served before membership** (AF-015) | **Fixed** — `reportRoutes.ts` authorises the workspace before reading the cache (PR #427). Verified by reading the code at this pin | done |
| **B6** | **Test-environment banner (G-05)** | Code present (`src/components/support/TestEnvironmentBanner.tsx`); **seen on the tester deployment: not verified** (no browser here) | Owner/verification |

**Net:** no new code blocker for stage A was found in this pass. The open risks are the owner's
deployment items (B1, B2) and two verification gaps (B3 browser journey, B6 banner seen live).

## 2. Verified open defects at this pin

The 14 open GitHub issues, checked against the code where a grep can decide it:

| Issue | Sev | What it is | State at `a7c2038` (28 Oct) | Lane |
|---|---|---|---|---|
| **#151 AF-001** | P1 | Plaid `syncCursor` advances before durable bank-line ingestion | **Open, verified now:** `plaidRoutes.ts:261` still writes `syncCursor`; the route still has **0** references to `bankLines` | AI #1 |
| **#342 AF-011** | P2 | A stored Jan-1 date shifting a year when workspace and device zones differ | **Narrowed:** display fixed (27 Oct), tax-year filter fixed (#426, §1 B4). The remaining piece is `parseLocalDate` building a workspace-midnight instant (`src/lib/utils.ts`) — no other screen's *filter* uses it for a year | AI #1 (helper) |
| **#161 AF-012** | P2 latent | Chained rule overrides depend on array order | **Still latent, unchanged:** the shipped packs have 67 overrides and **0 chains**, so no live figure is wrong; probe `audit/function-audit/probes/af012-shipped-pack-chains.mjs` | AI #9 |
| **#274** | P2 | Settings shortcut panel off-screen, Saved Views layering, loading flashes | **Partly fixed** (#416: Settings section reveal + Saved Views dialog surface/stacking). Loading flashes: fixed by A-235's loading states on the ten busiest screens; the other screens still use the global status bar | AI #3/#4 |
| **#146** | P2 | Nested "Edit record details" drawer does not close on Escape under load | **Not verified here** (browser-only) | AI #4 |
| **#143** | P1 | RMA approvals/cumulative quantities atomic on the server | Server-only + trigger shipped (ISS-143); the remaining CAS scope is recorded honestly in `docs/CAPABILITIES.md` row 184 | AI #1 |
| **#141** | P1 | Account Statement PDF ignores the selected screen period | Screen side shipped (A-72/AUD-01); the **entity** scope is still refused on PDF/JSON because `loadStatement` has no entity argument | AI #1 |
| **#131** | P1 | Inventory valuation mixes current stock with historical ledger balances for as-of dates | Fixed and covered (`iss131-inventory-as-of.test.tsx`); issue text is older than the fix — ready to close after AI #1 confirms | AI #1 |
| **#130** | P1 | Inventory cost edits change valuation without a matching posting | Fixed, server-only cost + revaluation (`iss130-stock-revaluation.test.ts`); ready to close with the same confirmation | AI #1 |
| **#104 AF-013** | P2 | Ledger grid keyboard loses the visible row / traps Tab | **Fixed in code** (#416: one focusable region, no `window` listener, `scrollToItem`, no empty-list crash); browser re-check outstanding | AI #3/#4 |
| **#96 AF-014** | P2 | A failed live collection never recovers after the tab returns | **Fixed in code** (#416: bounded retry + `online`/`visibilitychange`); browser re-check outstanding | AI #3 |
| **#160** | P2 | Israeli VAT equipment split has no persisted document adapter | **Stage C by design** (open, not a stage-A/B blocker) | AI #9 |
| **#150** | — | Umbrella independent-audit issue | Open by nature (this list is its current output) | audit |
| **#132** | — | Feature idea (product acquisition trace) | Backlog, not a defect | backlog |

**Not re-verified in this pass** (needs a browser or a database): #146, #143's CAS, #104/#96's
browser behaviour, and the statement PDF wiring (#141).

## 3. Release gate (`docs/RELEASE_GATE.md`) — unchanged rows

- **Stage A (synthetic bookkeeping beta): READY.** W1, W2, W3, W4, W5, W6, W9, W10, W14 are
  connected, verified with worked figures and browser-tested.
- **Stage B (narrow real-records pilot) blockers:** **W11** import totals matched to the source
  (AU-4) — still "No" on Verified; **W13** stock journey — AI #4's full purchase → stock → sale →
  valuation browser journey is in review on `ai4/w13-full-stock-journey`; **W12** group report is
  done (#370). Plus the ERPNext depth items for AI #1/#9 (EG-1…EG-7).
- **Stage C:** tax filing automation and payroll processing — not required for A or B; the screens
  say "calculation — check before filing".

## 4. This pass's own batch (A-230 … A-235, AI #3) — accurate status

Evidence: [`docs/verification/ai3-a230-a235-2026-10-28.md`](../docs/verification/ai3-a230-a235-2026-10-28.md).

| Task | Status | Why |
|---|---|---|
| **A-230** `any` 37 → 15 | **At target outside AI #1's lane; not tunable** | All 37 `any` are in `src/server/**` (per-file list in the evidence doc). The non-server target was already 0 after A-222. The baseline stays 37 because 37 is the true count |
| **A-231** UTC dates 6 → 0 | **0 outside the server lane; fixed one real UI "today"** | The 6 are `serverKit.ts:37–39` + `transactions/helpers.ts:25–27`. The printed page header's UTC day is now the workspace day (`getLocalDateISO()`); `postingCore.ts:75`'s UTC "today" is posting code → AI #1 |
| **A-232** warnings → 0 in `src/components` | **Done (already 0)** | `npx eslint .` = 0 errors / 42 warnings, every one in `src/server/**`. Cap stays 42 (lowering it would fail on the server warnings) |
| **A-233** phone layout, next ten screens | **Half done** | Items table scroll box, 44 px Budget row buttons, 44 px Projects control; four main-tab screens added to `e2e/phone-main-screens.spec.ts`; ran in PR #436 CI (not locally: no Chromium) and the six sub-tab screens still need their own browser check |
| **A-234** set-up wizard browser test | **Component journey done, browser open** | `src/tests/setup-wizard-journey.test.tsx` (1/1; evidence from this batch's commit `10ead910`, not from the pinned revision above, which predates the test) walks all four steps, asserts the `lf_update` write carries every allowlisted workspace field (the B3 guard), the template id, the balances in cents and the first-of-month date, then re-opens the wizard and finds the saved values. The browser walk with the real Supabase row is still missing (no Chromium) |
| **A-235** empty/loading/error states on the ten busiest screens | **Done** | One shared `ScreenDataNotice` + `useScreenDataHealth` + one label list; wired into 8 screens (Dashboard and Banking already had their own retry); **11/11 tests pass**, one per screen plus a dropped-connection case |

## 5. Where the documents still disagree with the code

| Document says | Code at this pin says | Action |
|---|---|---|
| Stage-A row for **W2** in `RELEASE_GATE.md` lists the statement's entity scope as refused on PDF | True, and #141 is still open for the server argument | keep; AI #1 |
| `audit/README.md` header says "Updated 23 Oct, pinned `1f6fe901`" | Three audits have landed since | point it at this file (low-risk doc edit for whoever next touches it) |
| `docs/RELEASE_GATE.md` W11 "Verified: No" | `ImportAcceptanceView` exists and `au4-import-acceptance.test.tsx` passes | W11 needs the **source→ledger total proof** (AI #1's server verification), not the screen |
| `docs/FOR_YOU.md` three migrations "may or may not be applied" | No migration file proves them | owner check (B2) |

## 6. What is not verified in this list (said once, plainly)

- **No browser** in this environment (`~/.cache/ms-playwright` empty; the Chromium download host is
  unreachable; a bundled Chromium needs `libnss3`/`libnspr4`, which this image does not have).
  Therefore: no Playwright spec was executed locally (CI ran them on PR #436), no screenshot was inspected, and A-233/A-234's
  journeys are **unexecuted**.
- **No database** here (`LF_TEST_DATABASE_URL` unset, no `psql`), so every database suite skips
  locally; PR CI runs them on Postgres 17.
- **No live deployment** was touched: owner items B1/B2/B6 are exactly that.
- Nothing in this list asserts that the software has no bugs; it asserts what has and has not been
  checked, at a pin, with the command that checked it.

## 7. The next ten things, in the order they unblock launch

1. Owner: B1 (secrets, `DATABASE_CA_CERT`, deployment protection, email sender) and B2 (three
   migrations) — nothing else can be tested for real until these are true.
2. AI #3: **A-234** — run the wizard journey in a browser with the real row (the component journey
   already exists and passes).
3. AI #3: the other half of **A-233** — the six sub-tab screens at 390 px, in a browser.
4. AI #1: **#151 (AF-001)** — the Plaid cursor must not advance before the bank lines are durable.
5. AI #1: **#141** — an `entity` argument for `loadStatement` so the statement's PDF/JSON match the
   screen's scope.
6. AI #4: merge the **W13** stock journey (in review) → stage B's W13 row.
7. AI #5 / AI #1: **W11 AU-4** — import acceptance matched to the source totals (the last Yes/No in
   stage B besides W13).
8. AI #1/AI #9: the **ERPNext depth** items (repost engine EG-1, payment ledger EG-2, period-closing
   voucher EG-3, stock snapshots EG-7).
9. AI #3/AI #1: close the issues that the code already fixed once the browser confirms them —
   #104, #96, #274, #130, #131 (and #423/#421/#422 are already merged).
10. Whoever owns the docs: refresh `audit/README.md`'s pin and this file at the next audit.
