# DIM-2 phase 1: where stock came from and where it went (AI #9)

**Task:** DIM-2 (GitHub #132), phase 1 of 4. **Branch:** `ai9/DIM-2` from main 2cca8686. **Read-only:** nothing is
written, there is no migration and no second ledger.

## What changed

- **`src/lib/stockTrail.ts` (pure).** It follows each stock move to its document and the party on that document:

  | Move | Document | Party |
  |---|---|---|
  | Purchase | its bill, plus the purchase order the bill was made from and that order's goods receipts | vendor |
  | Sale | its invoice, or for a delivery the sales order named on the delivery's entry | customer |
  | Customer return | its credit note | customer |
  | Sent back to the vendor | its vendor credit | vendor |
  | Opening stock, imports | none | "Origin not recorded"; never given a vendor |
  | Adjustments, counts, moves between locations | none | "Inside the business" |

- **Missing links are named:**
  - no document is linked;
  - the document is not in the books;
  - the document names no vendor or customer;
  - a delivery names no sales order.
- **Capped or still-loading document lists.** A document that cannot be found is "not among the documents loaded"
  rather than "not in the books".
- **Stock history window** (`StockHistoryDialog.tsx`): a new "From / to" column, plus a summary of how the units came
  in. The column goes after "Value" so the existing row checks keep their order.

## Worked units (`src/tests/dim2-stock-trail.test.ts`)

Widget had 4 on hand when the history began.

| Change | Units | Document | Party |
|---|---:|---|---|
| Bought | +10 | bill B-1 (from PO-7, received GR-1) | Acme |
| Sold | −3 | INV-1 | Dune |
| Delivered | −2 | order SO-1 | Elm |
| Returned | +1 | CN-1 | Dune |
| Bought | +5 | bill B-9, which is not in the books | missing link |
| Opening stock | +6 | — | not recorded |
| Adjusted | −1 | — | inside the business |
| Sent back | −2 | VC-1 | Acme |

On hand: 4 + 10 − 3 − 2 + 1 + 5 + 6 − 1 − 2 = 18.

- **Units in:** 11 recorded (10 + 1). 10 have no recorded origin (4 before the history + 6 opening). 5 have a missing
  document.
- **Units out:** 7 recorded (3 + 2 + 2). 1 inside the business.

## Results

- `dim2-stock-trail.test.ts` 4/4 and `dim2-stock-trail-dialog.test.tsx` 1/1 pass.
- The existing `stock-moves.test.tsx` and `stock-locations.test.tsx` pass unchanged.

## Next phases (#132)

2. Save the source document line ids and the supplier when goods are received.
3. Record destination labels and purpose on each move.
4. The reconciliation report.

## #260 review (7 findings)

Each fix has a test in `dim2-stock-trail.test.ts` (10/10).

1. **Delivery returns.** Goods returned against a delivery (kind `return`, document type `delivery`) now follow the
   delivery's entry to its sales order and customer, the same way a delivery does.
2. **Not loaded.** A document that is absent from a capped or still-loading list is now "not loaded" (its own origin and
   total). It is no longer counted as a missing document.
3. **Per list.** Each list decides for itself whether it is capped or loading. A capped entry list no longer hides a
   bill that is really missing.
4. **Stock received with Adjust stock.** These moves (kind `purchase`, document type `adjustment`) now show as "Stock
   adjustment (no bill)". They are counted as adjusted, not as missing.
5. **Purchase order from the bill.** A bill that names its order (`metadata.poId`) shows that order even when the order
   does not name the bill.
6. **Summary wording.** It now says "came in on a document with its vendor or customer", which is also true for undone
   sales and undone vendor returns.
7. **Speed.** The lists are indexed once and the dialog memoizes the trail. A test runs 5,000 moves against 10,000
   invoices in well under a second.

## Phase 2: the source is kept when stock is received (branch `ai9/DIM-2b`)

`cogsStockService.ts` now writes new fields on the stock move, in the same transaction as the move itself. No
migration is needed, and nothing is inferred: a field the entry does not name is left out.

| Move | Fields written |
|---|---|
| Bill's units | `documentLine` (its line index; bills already record it in `stockIn`) and `vendorId` (from the bill's entry) |
| Units sent back to a vendor | `documentLine` (the bill line they go back from), `sourceBillId` and `vendorId` |
| A reversal | Its original's fields |

**Vendor credit entries.** These now record each line's `billLine` in `stockOut`, and the bill as `returnsFromBillId`.
The credit's own key is used, never `metadata.billId`, so a credit is never read as the bill's own entry.

**Stock history window.**
- Shows "Bill B-1, line 2" for a purchase, and "Vendor credit VC-1 · from Bill B-1, line 2" for a return.
- When a bill can no longer be found, the vendor saved on the move still names the source, and the link is still
  reported as missing.

**Worked units** (`src/tests/dim2b-stock-source.test.ts`, on the database):
- Bill B-1 has a service line and 4 chairs on its line 2. The chairs' move keeps line 2 and vendor v1.
- Vendor credit VC-1 sends 2 back from line 2. That move keeps bill B-1, line 2 and v1.
- Voiding VC-1 brings the 2 chairs back with the same source.

Both tests fail without the change.

## Phase 3: where stock went is kept with the move (branch `ai9/DIM-2c`)

| Move | What it now keeps | Where it is written |
|---|---|---|
| Sale | The customer (`customerId`), the invoice line (`documentLineId`), and that line's labels other than location (`labels`, e.g. project or property). The location stays in `locationId`. | `cogsStockService.ts`, from the cost-of-goods entry: `invoiceCogs.ts` now names the customer, and the line's labels were already on the cost line. |
| Delivery | The customer and the order line (`documentLine`) the delivery entry names. | |
| Customer return | The customer and the invoice line it came back against. | The return entry (`salesReturns.ts`, given the credit note's customer by `creditPosting.ts`). |
| Reversal | The same as its original. | |
| Stock adjustment | Why, as written (`purpose`, up to 200 characters). | `stockAdjustmentService.ts` |

No migration is needed, and nothing is inferred.

**Stock history window.** It shows the sold line's labels under the customer, and the reason for an adjustment ("Inside
the business: Damaged in transit"). When an invoice can no longer be found, the customer kept with the move still
names where the stock went. The link is still reported as missing.

**Worked units** (`src/tests/dim2c-stock-destination.test.ts`, on the database). Each test fails without the change.

| Event | Units | The move keeps |
|---|---:|---|
| INV-7 to Acme, line l1 (Project P1, Location L1) | −5 | Acme, l1, `{ project: P1 }`; location L1 |
| CN-1 return | +2 | Acme, l1 |
| Adjustment "Damaged in transit" | −1 | the reason as its purpose |

On hand: 10 − 5 + 2 − 1 = 6.

## Phase 4: Stock sources and uses (branch `ai9/DIM-2d`, on top of phase 3)

Reports → **Stock Sources and Uses** (`StockSourcesUsesReportView.tsx`, `src/lib/stockSourcesUses.ts`). For a period,
it shows each item's:
- opening stock;
- where its units came from: each vendor, Adjust stock (no bill), origin not recorded, adjustments up, returns by
  customer;
- where they went: each customer with the sold line's labels, vendors they were sent back to, and adjustments down by
  the reason written;
- cost changes (value with no units) and moves between locations (netted, never counted twice);
- closing stock, with the check opening + came from − went to = closing.

**Unknowns are flagged, never assigned.** That covers a purchase with no vendor, a sale with no customer, an
adjustment with no reason, and origin not recorded. A history that does not add up says by how many units. The CSV
export holds every line and the check.

**Data.** The report reads the existing `/reports/inventory-details` history. `itemDetails` now passes on the phase 2–3
fields of each move. Nothing is written, there is no second ledger, and the valuation stays moving average: a use's
value is what its move was booked at.

**Touches outside the stock files, one line each:** `registry.tsx` (the view and its menu entry), `screenHelp.ts` (3
sentences) and the `view-registry-coverage` spec (the view is mounted).

**Worked figures** (`src/tests/dim2d-stock-sources-uses.test.tsx`, the issue's own example), in cents:

| Step | Units | Value |
|---|---:|---:|
| Received from Supplier A (goods 200,000 + freight 20,000) | +100 | 220,000 |
| Moved between locations | 50 out, 50 in | none |
| Property A construction | −30 | 66,000 |
| Property B maintenance | −20 | 44,000 |
| Sold to Acme, Project P1 | −40 | 88,000 |
| **Closing** | **10** | **22,000** |

The check: 0 + 100 − 90 + 0 = 10. A second item shows two vendors at two prices kept apart, an undone sale netting
its customer's line, and 10 unknown units (6 with no origin, 4 sold to no recorded customer) flagged.
