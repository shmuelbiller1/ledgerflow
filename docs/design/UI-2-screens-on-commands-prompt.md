# UI-2 — prompt: screens that show everything the server can do, and stay simple

Written 13 Nov 2026. This file is a prompt for one AI agent. Hand it over with: *"Do the task in
`docs/design/UI-2-screens-on-commands-prompt.md`."* Parts 3 to 5 need batch 0 of
`CMD-1-command-registry-prompt.md`, which delivers the generated client and the command schemas for
the browser; they then cover more commands as each CMD-1 batch lands. Part 7 needs CMD-1's
proposals. Parts 1 and 2 can start today.

---

## Your task

Rebuild the way screens are made so that **every action and report the server offers can be reached,
and a new person still sees only a few things**. Do not add features. Connect and simplify what exists.

## Why the screens hide the server today

- Each screen was built separately. About 200 screen files draw their own table; the shared grid
  (`src/components/ui/TanStackDataGrid.tsx`) is used by one. So sorting, search, export, bulk actions
  and phone layout exist on some lists and not others.
- Screens call the server by typing addresses in about 78 places and write to the database directly
  in about 170. A server feature with no screen that knows its address is invisible.
- About 167 report and tool views are registered, many reachable only through a sub-tab of a sub-tab.
- Finished code is connected to nothing: seven algorithms in `src/lib/algorithms/`, among others.

## Read first

`CLAUDE.md`, `AGENTS.md` (the owner's screen rules), `docs/UI_GUIDE.md`, all four parts of
`docs/EASE_OF_USE.md` (Part 4's twelve rules are the standard for every screen you touch),
`src/config/registry.tsx`, `src/lib/modules.ts`, `src/lib/recordLinks.ts`.

## What to build

### 1. One list

Grow the shared grid into the only list component: sort, search, column chooser, export, row
keyboard movement, tick boxes with a total of the selected rows, saved views, cards at 390px wide,
and an empty state that shows one sentence and one button and hides the tools. Move screens to it
with a codemod, most used first: Sales, Purchases, Transactions, Bank review, Customers, Vendors,
Items. Make `npm run scaffold:report` generate it.

### 2. One record page

A shared layout for any single record: its fields editable in place, its path at the top (for an
invoice: Draft → Sent → Paid, with the button for the next step), related records, files, history.

### 3. One way to act

A `useCommand(name)` hook over the generated client in `sdk/ledgerflowClient.ts`. It runs the
command, shows the result with **Undo** where the command has an inverse, and offers the next step
("Invoice saved. Send it · Record a payment · New invoice"). Replace hand-typed `fetch('/api/…')`
calls and direct database writes with it, screen by screen.

### 4. Forms from the schema

For simple commands, render the form from the command's input schema: labels from the dictionary,
required fields first, the rest under "More options", errors under the field. Hand-built forms stay
for invoices, bills and journal entries, and use the same field components.

### 5. One box that can do anything

The command palette lists **every command the person's role may run** and every registered report,
searched by plain words in English and Hebrew. Choosing a command opens its form or page. A module
that is switched off appears as "Payroll — turn on", not as nothing. This is how the product stays
simple and complete at once: few things on screen, everything one search away.

### 6. Short by default

The menu stays at Overview, To review, Sales, Purchases, Bank, Reports, Settings. Each area opens on
its most used list with one filled button. Everything else is under "More" or in the box from part 5.
Business type chooses the modules that start switched on.

### 7. Assistant proposals (after CMD-1 part 3)

A "Waiting for you" list of proposals: each row shows the command's preview, with Accept, Edit
(opens the normal form filled in) and Reject, and "Accept all" for a group. Nothing in this list has
changed the books yet, and the screen says so.

## Ratchets, so it can only improve

Add to the guard tests, with baselines that may only go down:
- screen files that draw a raw `<table>`;
- hand-typed `fetch('/api/` calls in `src/components`;
- direct database writes in `src/components`, `src/hooks`, `src/stores`;
- commands and registered reports that cannot be reached from the palette (must be zero);
- screens with more than one filled button.

## Rules

- Follow `CLAUDE.md`: a branch and a pull request for each step, CI green. Never skip or loosen a
  test to get green.
- No change to how money is calculated or posted. Screens call commands; they do not build postings.
- Every screen you touch: light and dark, 1280 and 390 wide, keyboard only, English and Hebrew
  strings from the dictionary, the existing axe checks passing. Refresh visual baselines with the
  "Refresh visual baselines" workflow and look at the images.
- Words follow the table in `docs/EASE_OF_USE.md` Part 4 (U-5).
- Put owner decisions in `docs/FOR_YOU.md` with the default you used, and keep going.

## Order of work

1. The list component and the first three screens on it.
2. The record page, on invoices.
3. `useCommand` and the Sales screens.
4. The palette that lists every command and report, with the reachability test.
5. Remaining screens by use, lowering each ratchet in every pull request.
6. The proposals list.

## Done when

- Every ratchet is at zero or lists each remaining site with a reason.
- A person who has never seen the product can, at 390px wide and with the keyboard on a desktop,
  create a customer, send an invoice, record its payment and open the profit and loss, with a
  browser test proving each.
- Every command and report can be found by typing a plain word into the palette.
