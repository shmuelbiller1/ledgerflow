# AI #9 — Israeli exports are zero-rated, not exempt

AI #1's answer (1), 20 Oct: "a sale abroad is zero-rated (VAT Law s.30); its own PR with a worked-figures test". This
builds on #234 (CON-3), whose `treatment` and `taxChoiceFor(…, treatment)` it uses.

**Before.** For an Israeli seller and a buyer abroad, `resolveLineTax` answered `export` at 0%, and the invoice's "Use no
tax" called `taxChoiceFor(0)`, which takes the workspace's **exempt** code first. The export was then reported as an
exempt sale, not a zero-rated one.

**Now.**
- For an Israeli seller, `export` carries `treatment: 'zero_rated'`, so "Use no tax" takes the zero-rated code.
- The notice says an export is zero-rated under s.30. It also states the limits: goods leaving Israel, or a service to
  a foreign resident that s.30 covers, with the documents kept; a service used in Israel is taxed.
- Without a zero-rated code the notice says to add one, and offers no 0% that the report would miss.
- A US seller's export is unchanged.

**Worked figures** (`src/tests/il-exports-zero-rated.test.tsx`, agorot). A ₪20,000 export (2,000,000) and a purchase of
₪1,000 + 18% (100,000 + 18,000) in April 2026:
- VAT report: taxable 0, output 0, zero-rated 2,000,000, exempt 0, input 18,000.
- To pay −18,000, so ₪180 comes back.
- All 3 new tests fail without the change.

Release gate: W7 (Israeli VAT report boxes). The row is unchanged: W7 stays Partly.

**Review fixes (#237).**
- **Default state.** A new invoice's "No tax" has no tax code. "Use no tax" is still offered there, so the export
  gets the zero-rated code and not an out-of-scope 0%.
- **A choice, not a verdict.** A sale abroad is no longer decided from the buyer's country alone. The notice states
  when s.30 applies (goods leaving Israel, or a service to a foreign resident used abroad, with the documents) and
  "Otherwise VAT is 18%", and offers "Use no tax" (zero-rated) beside "Use 18%".
- **Touch targets.** Both actions are 44px.
- **Statute citation.** The Eilat subsection citation and the non-taxing-code fixes come from #234 (merged in).
