# The screen-rebuild ratchets

Prompt 2 asks for five counters that may only go down, so the interface cannot drift back to the way it
was built. They live in `quality-baseline.json` and are computed by `scripts/quality-metrics.ts`; the
guard is `src/tests/quality-ratchet.test.ts`, and `src/tests/interface-ratchets.test.ts` proves each
counter goes up when the old pattern comes back (on a throwaway tree, never on the repository).

`npm run ratchet:update` lowers a number. Nothing here may be raised without an owner decision in
`docs/FOR_YOU.md`.

| Counter | Today | The rule |
|---|---|---|
| `unreachableActions` | **0** | Every registered screen, report and settings tab can be found by typing a word into the search box. Zero is the only acceptable value. Proven in `src/tests/palette-reachability-guard.test.ts`, which searches the real registry, in English and Hebrew. |
| `screensWithManyPrimaryButtons` | **19** | EASE_OF_USE U-2: one filled button per screen. |
| `handTypedApiCalls` | **170** | A screen calls the server through one place, not by typing `/api/…` into a `fetch`. |
| `rawTables` | **196** | A screen uses the shared list instead of drawing its own `<table>`. |
| `directDbWrites` | **93** | A screen, hook or store asks the server; it does not write the books straight from the browser. |

## The sites that remain, and why each is still there

These are the honest reasons, not a promise that they are good. Each PR in the rebuild lowers the
number it can; the rest are listed so the next person starts from the truth.

### `screensWithManyPrimaryButtons` — 19 files

- `ledger/BankFeedImport.tsx` (4), `onboarding/SetupWizard.tsx` (3), `ledger/ReconciliationWizard.tsx` (3):
  a step-by-step flow where each step has its own filled button. One is on screen at a time, so the
  person never sees two; the counter reads the file, not the screen.
- `intelligence/IntelligenceCenter.tsx` (3), `platform/settings/{Billing,Dimensions,Team}Settings.tsx` (3 each),
  `ledger/Ledger.tsx`, `finance/CreditNotesView.tsx`, `common/DimensionValueActions.tsx`: several filled
  buttons in different panels or dialogs of one screen. Each needs reading before one is demoted, and
  demoting the wrong one moves the person's eye off the thing they came to do.
- `auth/AcceptInviteView.tsx`, `common/ViewErrorBoundary.tsx`: two states of one screen (signed in / not).

### `handTypedApiCalls` — 170

Most are in the settings and forensics screens that call a route the browser has always called
directly (`/api/admin/…`, `/api/reports/…`). They move to `useCommand` in the step that builds it
(prompt 2, part 3), which needs the generated client and command schemas from CMD-1.

### `rawTables` — 196

The codemod moves the most-used screens first: Sales, Purchases and Inventory are on the shared list
(the first slice); Transactions, Bank review, Customers and Vendors are next. The rest are reports,
which need the shared list to grow a footer/total row first (they all draw their own `<tfoot>`).

### `directDbWrites` — 93

The first version of this counter read 15 because its pattern expected a leading dot, which the modular
Firestore API never writes; it now matches the bare call and counts each one once (Gitar caught it).
Each site is a write the app has no server route for yet. They are listed in the ledger-door work
(`docs/BUG_PATTERNS.md`, the `unchecked-write` pattern), which is where the route gets built; moving
them before the route exists would only move the problem.
