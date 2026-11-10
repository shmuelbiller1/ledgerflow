# AI #3 A-112–A-115 — stock traceability batch (20 Oct 2026)

**Branch:** `arena/1ef775ce-ledgerflow`, PR #265. **Scope:** serial/lot capture and lookup, expiring lots, stock transfers report, per-location levels feeding reorder suggestions. No money, posting, tax maths, migrations or `src/server/` changes.

## What each task delivers

**A-112 serial numbers per item (capture on receipt, show on delivery note).** The receive-goods dialog on Purchase orders records serials, a lot and an expiry per stock line (validated in plain words; the save is refused while a line has a problem) onto `GoodsReceiptItem.serialNumbers/lotNumber/lotExpiryDate`. The Serial & lot lookup was fixed to read the real shapes — invoice `items` plus goods receipts joined through their PO lines — instead of the `lines` shape no document has; bills/credits were never valid sources and are no longer read. Delivery notes print Serials/Lot columns only when the source invoice line recorded them (delivery/order lines record none). Invoice-line *capture* is not added: that form is AI #1's reserved InvoiceModal — the A-33 recording ask stands for the invoice side.

**A-113 lots and expiry, with an expiring-lots report.** New Reports → Expiring Lots groups received lots (item + lot), judges each by its earliest recorded expiry, flags expired/expiring within N days, and shows receipts, vendors and sale references. Units recorded with a lot at sale are a reference only: per-lot on-hand is not tracked (the stock-moves ledger has no lot) and is never computed.

**A-114 stock transfers between locations (report; postings stay AI #1's).** The move itself already exists (Inventory → item → Stock history; AI #1's server writes the transfer-out/transfer-in pair). New Reports → Stock Transfers reads the pair back from `stockMoves` (newest 5,000, capped runs say so); a half whose pair is not loaded shows alone with the reason, never paired by force.

**A-115 minimum/maximum per location feeding reorder suggestions.** Items carry `locationLevels` (whole units, max ≥ min), edited on the item dialog per Location value. Reorder suggestions gain a Location mode: below-minimum locations suggest a top-up to the maximum in whole packages, priced/grouped exactly like the global mode. A location's stock is used only when the item's move history proves the split (it explains the item and starts from zero); otherwise the item is listed as unplaced with the reason, never suggested. Total mode is the default and is unchanged.

## Worked checks in the tests

- Lot L1 received 10 + 5 units with expiries 2026-10-25 and 2026-10-20 → judged 2026-10-20, 0 days left, "expiring"; L9 (2026-10-17) sorts first as expired, −3 days; dateless/bad-date lots sort last as "no-date"; sale units (2) shown, never subtracted.
- Transfer-out/in for one item, day, quantity and written moment pair into one row (Shelf A → Shelf B, 2 units); a lone out/in shows with "Its move-in/out half is not in the loaded history"; two outs never share one in.
- Day math (`daysBetween`) is pure calendar math, checked against the `Date.UTC` reference on 4,748 consecutive day-pairs, 0 mismatches — `utcDateCount` stays at baseline.
- Location levels: 3 pcs at Shelf A against min 4 / max 10 suggests 7 (12 in packs of 6), priced $10.00 from the last home-currency purchase; 5 units with no history are unplaced ("came from before the stock history"); service/consignment/level-less items are left out.
- Lookup: SN-001/SN-002 on INV-1 plus SN-002 on GR-PO-1-1 → 3 placements; L1 spans 2 lines / 6 units / 2026-10-01–02; SN-002 flagged twice-recorded; a `lines`-shaped bill is never read (regression for the old mapping bug).

## Verification (local, this branch)

- Full unit suite: **3,198 pass / 0 fail / 1 skipped / 762 suites, exit 0** on the rebased head (no `LF_TEST_DATABASE_URL`, so the database-gated suite skips as usual).
- `tsc --noEmit` clean; ESLint 0 errors / 209 warnings (at the cap, none added); production build passes; quality ratchet passes.
- New/affected suites, all green: `expiring-lots`, `stock-transfers`, `location-levels`, `serial-numbers` (+validators), `serial-lot-lookup-view` (rewritten to real shapes), `expiring-lots-view`, `stock-transfers-view`, `reorder-suggestions-view`, `reorder-suggestions-location-view`, `delivery-note(s)`, `screen-help`, `inventory-item-controls`, `purchase-orders(-inline)`.
- Browser: not run locally (no downloadable Chromium in the sandbox); GitHub CI's browser shards (both) and the Playwright smoke suite pass with the two new report tabs in `e2e/view-registry-coverage.spec.ts`.

## Limits and asks

- Invoice-line serial/lot capture still needs AI #1's reserved InvoiceModal (A-33 ask stands).
- A-210 (balance-sheet-by-label path), A-72/A-75–A-77 and the standing A-116 question remain with AI #1; A-117 stays in the AI #9 lane.
- Vercel preview red is the owner's intentional pause, not a code failure.
