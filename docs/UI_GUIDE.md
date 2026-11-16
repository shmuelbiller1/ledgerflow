# UI guide: how Countmora screens should look and behave

Written 18 Oct 2026 for every AI that touches a screen. The owner asked for "better design in certain
places"; this is the yardstick. When a screen breaks a rule below, fixing it is a valid task. Tasks
D-77…D-92 (AI #4) apply it to the screens that need it most.

## 1. What the product should feel like

A calm, trustworthy bookkeeping tool: plain words, clear numbers, nothing decorative that competes
with the figures. A user should know in 3 seconds *what this screen is, what the number means, and
what to do next*.

## 2. Rules (check every screen against these)

**Words**
- Plain language. No invented jargon ("Financial Intelligence Hub", "synthesis", "protocol",
  "velocity", "worlds"). Name things the way an accountant or shop owner would.
- Sentence case for buttons and headings ("Export to Excel", not "EXPORT TO EXCEL"). All-caps only
  for tiny section labels, never for buttons or numbers.
- Every screen title says what it is ("Profit and loss", "Balance sheet"), once.

**Numbers**
- Money uses `src/components/ui/Money.tsx` (or `formatCurrency`), right-aligned, tabular figures.
- Negative amounts look the same everywhere (P2-53). Totals are bold; ordinary rows are not.
- Never cut off a number. Long *names* may truncate with a tooltip (`title`) — numbers never.

**Layout**
- One primary action per screen (dark/filled button); everything else secondary (outline).
- Labels above fields; errors under the field that caused them.
- Group controls: period · filters · basis on one row on desktop; stacked on phone.
- Page header ≤ 120px tall on desktop. Big decorative hero blocks waste the first screen.

**Phone (390px)**
- No horizontal page scroll. Tab bars scroll horizontally with whole, readable labels — never
  overlapping text (today the report tabs overlap: "Repo Visual Ana Foreca…").
- Touch targets ≥ 44px. Tables become cards or keep a sticky first column.
- At most one banner at a time (D-46).

**Dark mode**
- Every input, select and date field readable: text contrast ≥ 4.5:1 (today report date/Basis/Label
  fields are pale grey on white in dark mode — D-45).
- Highlighted rows keep readable text (today "Retained earnings" on the dark balance sheet is green on
  grey and unreadable).
- Use the CSS variables (`--text`, `--muted`, `--line`, …), not hard-coded `bg-slate-100`/`text-slate-700`
  that only work in light mode.

**States**
- Empty: `EmptyState.tsx` with one sentence and one button ("No invoices yet — Create invoice").
- Loading: `LoadingState.tsx` / skeleton rows, not a bare spinner.
- Error: say what failed and offer Retry; never a blank area.
- Read-only users see why a button is disabled (`RequireRole.tsx`).

**Accessibility**
- Every icon-only button has `aria-label` and a tooltip.
- Visible focus ring; Escape closes the top dialog only; Tab never gets trapped (#104, #146).

## 3. Shared pieces to use (don't build new ones)

`Money`, `EmptyState`, `LoadingState`, `AsyncButton` (shows pending, prevents double click),
`ConfirmButton` (destructive actions only), `InlineEdit`/`InlineAdd`, `MonthNavigator`, `Labelled`,
`TanStackDataGrid` (lists), `PdfPreviewModal`, `RequireRole`. If one is missing something, extend it.

## 4. How to do a UI task

1. Take before screenshots (desktop light + dark, phone 390 light + dark) of the screen.
2. Fix against the rules above; reuse the shared pieces; no change to how money is calculated.
3. Keep or add a test for behaviour (labels, roles, empty/error states).
4. If the screen is in `e2e/visual-regression.spec.ts`, refresh its baselines with the
   "Refresh visual baselines" workflow and **look at the images** (LEAD_RUNBOOK step 4).
5. In the PR, put before/after screenshots and the rule numbers you applied.
