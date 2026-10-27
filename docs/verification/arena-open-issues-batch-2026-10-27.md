# Open-issue batch — Settings, Saved Views, ledger keyboard, live-collection retry, date display

**Branch:** `arena/f78daa80-ledgerflow` (from `main` at `3449aa9`) · **27 Oct 2026**

Five open issues were read in full and triaged; four were fixed here (one of them partly, by design —
the rest sits in the lead's lane). What was **not** done is listed at the end, so no claim outruns the
evidence.

| Issue | State after this branch |
|---|---|
| #274 §1 Settings shortcuts leave the panel off-screen | Fixed; unit-tested |
| #274 §2 Saved Views dialog layering / bleed-through | Fixed (two root causes found in source); unit-tested **and** checked in a real browser (`e2e/saved-views-manager.spec.ts`) |
| #274 §3 full-area `Loading...` flashes during rapid navigation | **Not changed** — the report itself asks to measure first, and that needs a browser |
| #104 ledger virtual-grid keyboard navigation | Fixed; unit-tested **and** checked in a real browser (`e2e/transaction-list.spec.ts`) |
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

**Tests:** `src/tests/settings-section-visibility.test.tsx` — 6/6. No scroll on open; reveal + focus on
selection; every group; re-selecting the open section; the app's own *Reduced motion* setting (not just
the OS one) turning the jump into an instant move; a search that hides groups leaves the panel and its
focus alone.

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
   manager ever names a colour the **screen** themes (`:root`, `.light`) declare. The review round found
   the first version of that check vacuous: `--bg` is declared in `src/index.css`, but only inside
   `@media print`, so `bg-[var(--bg)]` on 13 controls painted nothing on screen — the same bug, one
   token further in. Those 13 now use `--surface`, and the test reads only the two screen-theme blocks.

Also: the list's scroll area is `overscroll-contain`, so a wheel gesture at the end of the list no longer
scrolls the ledger behind the dialog. `useDialog` already supplied the dialog role, the focus trap,
Escape and focus return.

**Tests:** `src/tests/saved-views-manager-layering.test.tsx` — 4/4 (dialog/title/Close/Escape; stacking
level above Header/Sidebar/BottomNav; every colour the manager uses is declared by the screen themes and
`--bg` is not among them; opaque surface in both themes; contained scroll).

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
  list becomes empty — the empty-list crash is structurally impossible now. `startGridFocus` is the cell a
  keyboard-only user lands on when the list has no highlight yet, and `gridFieldLabel` turns the stored
  field id into the column's name for the announcement (`amountCents` → “Amount”).
- `TransactionGrid.tsx` — the window listener is gone; the model reconciles the highlight when the visible
  rows change. `TransactionGridBody.tsx` holds the `react-window` list ref and calls
  `scrollToItem(index, 'smart')` whenever the highlighted index changes, so the destination row is drawn
  and visible.
- The inline editor, mouse editing and the virtualization props are unchanged. When the editor closes
  (Enter saves, Escape cancels) the region takes focus back instead of letting it fall to `<body>`, where
  the arrow keys no longer reached the grid; it only does so if focus was not moved elsewhere meanwhile.
- The shortcut help (`src/config/screenShortcuts.ts`) now says Tab **leaves** the grid, and lists Home/End
  and Escape-clears — it still told users Tab moved between cells.

**Tests:** `src/tests/ledger-grid-nav.test.ts` 9/9 (boundaries, Home/End, column walk, stale index, sorted,
filtered-out, empty list, where the highlight starts, the announced column names) and
`src/tests/ledger-grid-keyboard-region.test.tsx` 10/10 (tab stop and live region, click focuses the grid but
not a control inside it, arrows handled, Tab untouched, Escape/Enter/typing, empty list, starting the
highlight from the keyboard alone, focus restored when an editor closes, editor-open, keys from an inner
control).

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
- `useLedgerData` — schedules each due attempt, listens for `online` **and** for the tab becoming visible
  again (both start a fresh bounded cycle, so a tab left open overnight is not stuck on “Try again”), and
  tears every timer and listener down on workspace/user change. A stale workspace can never
  be repopulated: the subscription itself re-checks `currentWorkspaceId`, and a workspace switch resets the
  records.
- The user-facing text is unchanged; **Try again** still works and now also resets the attempt count.

**Tests:** `src/tests/collection-retry.test.ts` — 12/12 (classification incl. a refusal that also mentions
503 and the database adapter's own `permission-denied` / `unauthenticated` codes, growing/capped delays,
the limit, due-time and reconnect behaviour, success/retry/limit/reset paths, workspace switch).

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

## Review round — every finding on the PR, checked against the code

The first push drew automated review. Each comment was verified against the source before anything was
changed; two were not changes to make, and say so below.

| Finding | Verdict |
|---|---|
| **P1** the shortcut help still says Tab/Shift+Tab move between grid cells | **Fixed.** `screenShortcuts.ts`: Tab now reads “Leave the grid for the next / previous control”, plus Home/End and Escape-clears. `screen-shortcuts.test.tsx` still finds the “native controls keep their normal Tab” sentence. |
| **P2** focus falls to `<body>` when an inline editor closes | **Fixed.** `TransactionGridKeyboardRegion` takes focus back when `inactive` goes true→false, unless the person moved focus elsewhere; tested by opening an editor, saving, and asserting the region holds focus. |
| **Minor** the live region announces the raw field id (`amountCents`) and always ends with the amount | **Fixed.** `gridFieldLabel` maps the stored id to the column's name; the announcement now reads “Row 3 of 120, Amount column: …”. |
| **Minor** a keyboard-only user cannot start the highlight (every key returns while `focus` is null) | **Fixed.** `startGridFocus` gives the first cell, End the last row; Enter/typing still need a cell. |
| **Minor** Settings scrolls smoothly although the app's *Reduced motion* setting is on | **Fixed.** The reveal reads `useUIStore.reduceMotion` as well as `prefers-reduced-motion`; tested. |
| **Minor** `?` opens the shortcut help underneath the Saved Views manager (z-100 vs z-200) | **Fixed.** `canOpenShortcutHelp` (`src/lib/shortcutOverlay.ts`) keeps `?` from opening a dialog it would hide the keyboard in; Escape and the overlay's own toggle are unchanged. |
| **Minor** an exhausted transient retry never restarts when the tab becomes visible | **Fixed.** `visibilitychange` now starts a fresh bounded cycle, like `online` does. |
| **Minor** `classifyFailure` misses the database adapter's `permission-denied` / `unauthenticated` codes | **Fixed.** Those codes (and `PERMISSION_DENIED`) are refusals before the message is read; tested. |
| **Minor** the layering test accepts `--bg`, which the theme declares only inside `@media print`; the manager uses it on 13 controls | **Fixed — and it was a real bug, not just a weak test.** Those controls painted nothing on screen. They now use `--surface` (declared in both screen themes) and the test reads only the `:root` and `.light` blocks, so a print-only token can no longer pass. |
| **Major** “run and report the database-backed test gate” | **Done.** See the database rows under *Checks run*: the RLS suite and a database-backed subset were run here against a real PostgreSQL engine; CI's four unit shards run the whole suite against Postgres 17 with `LF_TEST_DATABASE_URL` set, which is the gate of record. |
| **Major** “run the touched browser specs or keep every affected item pending” | **Done for the touched screens.** A Chromium build was found inside the npm package `@sparticuz/chromium` (with the NSS/NSPR libraries from its own `al2023.tar.br`), so Playwright ran here after all: the three touched specs pass (16/16), and two new browser tests now cover the two fixed screens (see *Checks run*). #96's fault injection still needs a database and a controlled failure, so it stays marked as owing CI. |

## Checks run

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint . --max-warnings 42` | 0 errors, **42 warnings** (exactly the existing cap; no suppression added) |
| `npm test` (whole unit suite, no database) — four `--test-shard` processes, run one after another on 2 cores | **4,009 tests: 4,006 pass, 2 skipped, 0 real failures.** The one red test was `database-tests-notice` ("LF_TEST_DATABASE_URL is not set on CI"), which by design demands the URL when `CI` is set: run without `CI` it passes (1 skipped). Shards: 1,008/1,008 · 977/978 · 990/990 · 1,031/1,033 (+2 skipped). |
| CI on this commit (`636b5d0`) | **25/25 checks pass**: four unit shards, six timezone shards, the coverage gate, five browser shards, the E2E smoke aggregate, lint/typecheck/database rules, build, CodeQL, SBOM, Vercel. |
| `npm run build` (vite + esbuild server bundle) | passed (`built in 26.70s`) |
| `quality-ratchet`, `bug-patterns`, `reachability-guard` | 13/13 |

**Browser (Playwright), run here** — this sandbox has no Playwright browser download, so Chromium 153 was
taken from the npm package `@sparticuz/chromium` (`npm i --no-save`; nothing added to `package.json` or the
lockfile) with the NSS/NSPR libraries from its `al2023.tar.br` on `LD_LIBRARY_PATH`, pointed at by an
untracked `playwright.local.config.ts`. All runs are the real app against a real database:

| Spec | Result |
|---|---|
| `e2e/dialogs.spec.ts` (7) + `e2e/keyboard.spec.ts` (6) + `e2e/transaction-list.spec.ts` (3, before this round) | **16/16 pass** |
| `e2e/transaction-list.spec.ts` — new test: arrow starts the highlight, the live region names the column, Enter opens the cell editor, Escape gives focus back to the grid, Tab leaves it | **passes** (4/4 in the file) |
| `e2e/saved-views-manager.spec.ts` (new, 2 tests): the panel — not the sidebar — is the topmost element where they overlap at 1280 px; the panel paints a real colour; `?` does not open the help behind the manager; Escape closes the manager | **passes**, twice in a row |

Both new browser tests were checked against the bug they guard: with the overlay set back to `z-50` the
stacking test **fails**, and with the `?` guard removed the help opens behind the manager and that test
**fails**. Neither is a vacuous assertion. Screenshot comparison is **not** claimed: this headless-shell
build renders fonts differently from GitHub's Chromium, so local pixel diffs say nothing about the
repository's baselines, and no baseline was touched.

**Database**: `npm run test:rules` against a real PostgreSQL engine — **ALL RLS TESTS PASSED**; the
setup-wizard save (the test `main` added with its migration) **1/1**; `banking`, `customer-portal`,
`attachments` **17/17**. The whole database-backed suite is CI's gate (the four unit jobs run against
Postgres 17 with `LF_TEST_DATABASE_URL` set); a full local run here is not claimed, because the embedded
PostgreSQL used for the checks above serves one connection at a time and drops the app's pooled queries
under a whole-suite load (`Connection terminated unexpectedly`), which is a harness limit, not a result.

Coverage/mutation gates and the contrast baselines were not run locally — the tokens the manager now paints
with (`--panel`, `--surface`, `--elevated`, `--brass-line`, `--muted`, `--text`) are declared in both screen
themes, and the screenshot specs remain the authority.

## Left alone on purpose

- **#161** (chained rule overrides depend on array order) and **#160** (Israeli VAT equipment split) and
  **#151** (Plaid cursor durability) — tax/posting/server lanes; require the lead.
- **#143**, **#141**, **#131**, **#130** — money/posting behaviour, lead's lane.
- **#150**, **#146** — audit mission and a flaky nested-drawer Escape test that needs a browser under load.
- **#132** — a feature request, not a defect.
