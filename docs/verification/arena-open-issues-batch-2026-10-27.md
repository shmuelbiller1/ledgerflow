# Open-issue batch — Settings, Saved Views, ledger keyboard, live-collection retry, date display

**Branch:** `arena/f78daa80-ledgerflow` (from `main` at `3449aa9`) · **27 Oct 2026**

Five open issues were read in full and triaged; four were fixed here (one of them partly, by design —
the rest sits in the lead's lane). What was **not** done is listed at the end, so no claim outruns the
evidence.

| Issue | State after this branch |
|---|---|
| #274 §1 Settings shortcuts leave the panel off-screen | Fixed; unit-tested |
| #274 §2 Saved Views dialog layering / bleed-through | Fixed (two root causes found in source); unit-tested |
| #274 §3 full-area `Loading...` flashes during rapid navigation | **Not changed** — the report itself asks to measure first, and that needs a browser |
| #104 ledger virtual-grid keyboard navigation | Fixed in source; unit-tested (browser assertions still owed) |
| #96 failed live collection may not recover | Fixed: bounded automatic retry; unit-tested (browser fault injection still owed) |
| #342 stored Jan 1 shifts into the prior year | Display half fixed; the shared parser / report-year bucket left to the lead |
| #161, #160, #151, #150, #146, #143, #141, #132, #131, #130 | Not touched here (see "Left alone") |

## #274 §1 — a Settings section is brought into view

`src/components/platform/Settings.tsx` — the shortcut buttons called `setActiveSettingsTab` and nothing
else, so the panel changed below the fold and the buttons looked dead. Now:

- `chooseSection(tabId)` sets the tab **and** bumps a reveal counter, so re-choosing the section that is
  already open also reveals it (a plain state change would not re-run an effect);
- the reveal effect scrolls `#settings-panel` with `block: 'start'` (honouring
  `prefers-reduced-motion`), then moves focus to it;
- the panel is a named landmark — `role="region"`, `aria-label="<section> settings"`, `tabIndex={-1}`,
  `scroll-mt-24` so a sticky header cannot cover the heading;
- opening Settings, restoring a saved section or switching workspace changes `activeSubTab` *without*
  a request, and then nothing scrolls (no jump on entry).

**Tests:** `src/tests/settings-section-visibility.test.tsx` — 5/5. No scroll on open; reveal + focus on
selection; every group; re-selecting the open section; a search that hides groups leaves the panel and
its focus alone.

## #274 §2 — Saved Views manager: two source-confirmed causes

1. **The overlay was below the chrome.** It was `z-50`; the sidebar is `z-[100]` (`Sidebar.tsx`) and the
   phone bottom bar is `z-50` (`BottomNav.tsx`). At 1280 px the 896 px dialog is centred with its left
   edge at ~192 px, i.e. under the sidebar — which is exactly the reported "title and Close button hard
   to see near the persistent navigation". The overlay is now `z-[200]`, above every chrome layer
   (measured in the test against the highest chrome level, not a hard-coded number).
2. **The dialog surface had no colour at all.** The manager painted with
   `bg-[var(--surface-card)]`, `var(--surface-elevated)`, `var(--line-strong)`, `var(--text-muted)` and
   `var(--text-secondary)` — **none of which is declared anywhere in `src/index.css`** — so its panel
   and header painted nothing and the dark ledger showed through the list. It now uses only declared
   tokens (`--panel`, `--elevated`, `--brass-line`, `--muted`, `--text`), and a source test fails if the
   manager ever names a colour the theme does not declare.

Also: the list's scroll area is `overscroll-contain`, so a wheel gesture at the end of the list no longer
scrolls the ledger behind the dialog. `useDialog` already supplied the dialog role, the focus trap,
Escape and focus return.

**Tests:** `src/tests/saved-views-manager-layering.test.tsx` — 4/4 (dialog/title/Close/Escape; stacking
level above Header/Sidebar/BottomNav; every colour the manager uses is declared; opaque surface in both
themes; contained scroll).

**Follow-up, deliberately not in this PR — it needs a reviewed visual baseline.** Two other components
that share this toolbar also paint with undeclared aliases: `SavedViewsBar` (`--surface-card`,
`--surface-elevated`) and `DeepSearchBar` (same two). Declaring those aliases in the theme is the correct
fix, and this branch tried it: CI's visual shard then failed on **Dashboard dark at 1280 and 390**,
because the Dashboard renders `SavedViewsBar` where the bar became opaque (≈1% of pixels). The
`Refresh visual baselines` workflow is a human-reviewed `workflow_dispatch` (candidate images on a review
branch), and this environment cannot dispatch workflows or run Chromium, so the alias fix and its two
baseline images are left as a separate reviewed change. `--surface-sunken`, `--border`, `--line-strong`,
`--text-muted`, `--text-secondary`, `--accent`, `--danger`, `--negative` are still undeclared elsewhere in
the app for the same reason.

## #104 — ledger grid keyboard navigation

The old implementation attached a `keydown` listener to **`window`** whenever a row was clicked,
`preventDefault()`ed **Tab**, moved a logical `focusedCell` without scrolling the virtualized list, and
dereferenced `transactionsWithBalance[nextIndex].id` even when the filtered list was empty (`-1`).

Now:

- `src/components/ledger/TransactionGridKeyboardRegion.tsx` — one focusable, labelled `region` around the
  rows. Listeners are attached natively (the `useDialog` pattern), so the element is a landmark with a tab
  stop rather than a div impersonating a button. Clicking a row focuses it; **Tab/Shift+Tab are never
  prevented**, so the keyboard can leave the grid; Escape clears the highlight; Enter or typing opens the
  cell editor; a polite live region announces "Row *n* of *m*", date, description, column and amount.
- `src/lib/ledgerGridNav.ts` — the movement rules as pure functions: ArrowUp/Down one row (clamped),
  Home/End, Left/Right across the drawn columns and then to the neighbouring row. `reconcileGridFocus`
  keeps the highlight on its **record** across a sort and drops it when a filter removes the record or the
  list becomes empty — the empty-list crash is structurally impossible now.
- `TransactionGrid.tsx` — the window listener is gone; the model reconciles the highlight when the visible
  rows change. `TransactionGridBody.tsx` holds the `react-window` list ref and calls
  `scrollToItem(index, 'smart')` whenever the highlighted index changes, so the destination row is drawn
  and visible.
- The inline editor, mouse editing and the virtualization props are unchanged.

**Tests:** `src/tests/ledger-grid-nav.test.ts` 7/7 (boundaries, Home/End, column walk, stale index, sorted,
filtered-out, empty list) and `src/tests/ledger-grid-keyboard-region.test.tsx` 8/8 (tab stop and live
region, click focuses the grid but not a control inside it, arrows handled, Tab untouched, Escape/Enter/
typing, empty list, editor-open, keys from an inner control).

## #96 — a failed live collection comes back on its own

`subscribeLedgerCollection` marks a failed key and unsubscribes; the parent effect excluded failed keys, so
only the status bar's **Try again** could revive the collection — a tab that was hidden or a network blip
left financial screens stale.

- `src/lib/collectionRetry.ts` — no React, no timers: `classifyFailure` (a permission refusal — `42501`,
  401/403, "row-level security", "JWT expired" — is **never** retried; connection trouble is), `planRetry`
  (attempts counted, next attempt due in 4/8/16/32 s, capped at 2 min, `AUTO_RETRY_LIMIT = 4`) and
  `canRetryNow`.
- `useDataNeedsStore` — keeps `trouble[key] = { kind, attempts, nextRetryAt }` next to the existing
  `failed` message the status bar shows; `markLoaded` / `retry` / `resetLoaded` clear it;
  `retryTransientFailures(now, immediate)` clears only failures that may be retried;
  `retryAfterReconnect()` starts a **fresh bounded cycle** for connection failures when the browser says
  it is online again (a refusal still waits for a person).
- `useLedgerData` — schedules each due attempt, retries at once when the tab becomes visible, listens for
  `online`, and tears every timer and listener down on workspace/user change. A stale workspace can never
  be repopulated: the subscription itself re-checks `currentWorkspaceId`, and a workspace switch resets the
  records.
- The user-facing text is unchanged; **Try again** still works and now also resets the attempt count.

**Tests:** `src/tests/collection-retry.test.ts` — 12/12 (classification incl. a refusal that also mentions
503, growing/capped delays, the limit, due-time and reconnect behaviour, success/retry/limit/reset paths,
workspace switch).

## #342 — a stored date is shown as written (display half)

`formatDate` converted a stored `YYYY-MM-DD` through `parseLocalDate`, which builds a *workspace-midnight
instant*, and then read device-local year/month/day. With a UTC device and an active `Pacific/Auckland`
workspace, `formatDate('2026-01-01', 'YYYY-MM-DD')` returned `2025-12-31` — the issue's exact repro.

- `src/lib/calendarDate.ts` — new `civilDateParts(value)`: the year/month/day **as written**, `null` for a
  timestamp, free text or an impossible day (`2026-02-30`), so the answer is identical on every device.
- `src/lib/utils.ts` — `formatDate` formats a stored calendar date from those parts and never from a zone.
  A `Date` or a timestamp keeps its previous behaviour (a moment is read in the device's zone), so no other
  caller changes.

**Tests:** `src/tests/date-display.test.ts` — 5/5, including the issue's UTC-device/Auckland-workspace
repro, DST days in both directions, a leap day, both year boundaries, the far-west case, a guest workspace
with no zone, and impossible days.

**Left to the lead (AI #1, per COORDINATION 22 Oct):** `parseLocalDate`'s workspace-midnight instant and
`TaxManager.tsx`'s `parseLocalDate(tx.date).getFullYear()` year bucket (a Jan 1 entry can be classified
into the previous reporting year). That is the shared financial-date contract the D-65 note asked the lead
to decide; it is not changed here.

## Checks run

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint . --max-warnings 42` | 0 errors, **42 warnings** (exactly the existing cap; no suppression added) |
| `npm test` (whole unit suite, no database) — run as four `--test-shard` processes | **4,016 tests: 4,013 pass, 0 real failures, 2 skipped.** One timing budget (`report-speed-12m`, "10 screen modules under 1,500 ms") failed at 1,989 ms because four shards shared the machine; it passes alone in 17.9 s (3/3). |
| `npm run build` (vite + esbuild server bundle) | passed (`built in 26.70s`) |
| `quality-ratchet`, `bug-patterns`, `reachability-guard` | 13/13 |

Not run in this environment, and therefore not claimed:

- **Browser (Playwright) specs**, including the ones these issues ask for (200-row arrow scrolling and Tab
  exit for #104; hidden tab + forced transient subscription error for #96; "panel is inside the viewport"
  for #274 §1). The sandbox has no Chromium and `npx playwright install` cannot reach the browser CDN here.
  The unit tests above cover the extracted logic and the component behaviour that jsdom can assert.
- `npm run test:rules` (needs a local Postgres), coverage/mutation gates, and the contrast baselines — the
  new CSS variables were chosen to match the tokens the surrounding cards already use, but the screenshot
  and contrast specs remain the authority.

## Left alone on purpose

- **#161** (chained rule overrides depend on array order) and **#160** (Israeli VAT equipment split) and
  **#151** (Plaid cursor durability) — tax/posting/server lanes; require the lead.
- **#143**, **#141**, **#131**, **#130** — money/posting behaviour, lead's lane.
- **#150**, **#146** — audit mission and a flaky nested-drawer Escape test that needs a browser under load.
- **#132** — a feature request, not a defect.
