# AI #9 — CON-3 Israel special VAT areas (Eilat) on invoices

Based on main 2ea24b9. Lane: `src/lib/tax/resolveLineTax.ts`, plus the invoice screen's tax suggestion
(`TaxPlaceSuggestion`, `TaxExemptionNotice`, one prop line in `InvoiceModal`). No posting code changed: the invoice keeps
posting from its tax code, and the code is now the right one.

**What was wrong.** `resolveLineTax`'s built-in Israeli table zeroed the rate only when `district === 'Eilat'` exactly,
so a customer in `אילת`, `eilat` or with Eilat as the city was charged 18%. Every 0% suggestion then took the workspace's
*exempt* code. That books a sale into Eilat as exempt, but by law it is zero-rated: the seller would lose its input credit
and the VAT report would put the sale in the wrong box.

**Now.**
- The built-in table is `ilVatRateTable()`, which uses `ilVatAreaKeyFor` (#229), so every spelling of a place is recognised.
- `resolveLineTax` returns `treatment` for an Israeli special area, following the Eilat Free Trade Zone Law, 1985, s.5:
  - a sale into Eilat by a dealer from outside the area: **zero-rated** (5(a));
  - a sale by a seller whose tax place is Eilat to a buyer in Eilat: **exempt**, no VAT and no input credit (5(b), 5(e)), reason `exempt-area`;
  - the West Bank, Gaza and duty-free areas: zero-rated (export areas).
- `taxChoiceFor` takes the code with exactly that treatment. If the workspace has no such code it substitutes nothing and returns `missing`.
- The invoice suggestion says which case applies and offers "Use zero-rated" / "Use exempt". It does so even when the
  invoice is already at 0% on the wrong kind of code. When the code is missing, it says to add one in Settings → Tax
  Manager, because a 0% custom rate is not counted on the VAT report.

**Worked figures** (`src/tests/con3-il-eilat-invoices.test.tsx`, by hand, agorot). Three ₪10,000 invoices on 10 Mar 2026:
| Invoice | Seller | Buyer | Net | VAT | VAT report box |
|---|---|---|---|---|---|
| INV-1 | Tel Aviv Ltd | Eilat (`אילת`) | ₪10,000 | ₪0 | zero-rated sales ₪10,000 |
| INV-2 | Tel Aviv Ltd | Haifa | ₪10,000 | ₪1,800 (18%) | taxable sales ₪10,000, output VAT ₪1,800 |
| INV-3 | Eilat Ltd | Eilat | ₪10,000 | ₪0 | exempt sales ₪10,000 |

The Tel Aviv return is 1,000,000 / 180,000 / 1,000,000 zero-rated / 0 exempt, so ₪1,800 to pay. The Eilat return is
0 / 0 / 0 / 1,000,000 exempt. All 6 tests fail on the old code.

**Not decided here (unchanged):**
- An Eilat dealer selling to the rest of Israel is charged the ordinary rate, the same as before.
- The law's schedule of goods excluded from the relief, and checking where goods are used, stay with the user and the
  Tax Authority guidance (see the `IL_VAT_SPECIAL_AREAS` note).
- Seller residence is read from the seller profile's tax place (district or city).
- Sales abroad (`export`) still take the old 0% choice (exempt code first). By law (VAT Law s.30) an export is
  zero-rated too. This is raised for AI #1 under Messages and not changed in this PR.

Release gate: W7, connected for the Eilat line. W7 stays Partly because CON-4 is still open.

**Review fixes (#234, Codex P1 ×2).**
- **The relief is the user's choice, not the expected tax.** It depends on facts the books do not hold: goods or
  services, whether the buyer is an Eilat-resident dealer buying for its business there, where the goods are used, and
  the law's excluded goods.
  - `resolveLineTax` keeps the same reason and treatment for the area. It now also returns the `conditions` and the
    `ordinaryRate`.
  - The invoice states the conditions and "Otherwise VAT is 18%". It offers "It qualifies: use zero-rated / exempt"
    and "Use 18%", so a service or a sale to a private buyer is one click from the ordinary rate.
- **No promise about input VAT.** The exempt message no longer says "no input credit". It says the input VAT on
  purchases for an exempt sale is not deductible and that the VAT report does not split those purchases out, so they
  need review. Apportioning that input VAT is VAT-return maths and is left to AI #1 (raised under Messages).
