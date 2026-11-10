# AI #9 — Illinois reduced grocery rate and New York's "more than $500,000"

AI #1's answers (2) and (3), 20 Oct evening. One PR, as allowed.

**Illinois groceries.** `productTaxabilityPack` turned a reduced-rate row into an `accumulate` rule, so it was added
to the state's own rate: Illinois groceries came out at 6.25% + 1% = 7.25%. A reduced row is the state part itself,
so it is now an `override` that replaces the state's rule in force, as an exemption excludes it. Local rates still add
on top when they are loaded. The same applies to the other reduced rows: groceries in AL, AR, MO, MS, SD, TN and UT,
and Illinois prescription medicine.

**New York.** The A-27 nexus table met every threshold at "or more". New York's rule is "more than $500,000 and more
than 100 sales", so its row now carries `strict: true`, and `nexusWatch` and the US quarter journey's
threshold-reached flag compare with `>` for it. Other states are unchanged; Texas still crosses at exactly $500,000.

**Worked figures** (`src/tests/il-ny-tax-fixes.test.ts`):
- **Illinois groceries:** 1%, so a $100.00 sale carries **$1.00** (was $7.25). Other Illinois goods stay at 6.25%;
  prescription medicine is 1%.
- **The reduced grocery rates are the state parts:**

  | AL | AR | MO | MS | SD | TN | UT |
  |---|---|---|---|---|---|---|
  | 3% | 1.25% | 1.225% | 5% | 4.2% | 4% | 3% |

  Texas and Virginia stay exempt.
- **New York:**
  - exactly $500,000.00 with 100 sales: **not crossed** (flagged at 100%);
  - $500,000.01 with 101 sales: crossed;
  - $600,000 with exactly 100 sales: not crossed (both tests are needed).
- **Texas:** exactly $500,000: crossed.

All three tests fail without the change.

**Noted, not changed:** the taxability table lists Virginia in both the exempt and the reduced grocery lists. The
exempt list wins, so Virginia groceries are exempt here. Which one the table should say is a source check for the
table's owner.

## #258 review: rates checked against the states' notices (20 Oct)

The override change made each reduced row the state rate itself, so the rows had to be right. I checked them against
each state's notice (via search; the .gov sites cannot be fetched from this environment).

| State | Row before | Row now | Basis |
|---|---|---|---|
| IL | reduced 1% | **exempt** (state) | State 1% grocery tax ended 1 Jan 2026 (Public Act 103-0781). A municipality or county may levy its own 1% by ordinance, and RTA/Metro-East rates remain (in the note). |
| AR | reduced 1.25% (should have been 0.125%) | **exempt** (state) | State 0.125% ended 1 Jan 2026 (Act 1008 of 2025). City and county grocery taxes remain (note). |
| AL | 3% | **2%** | Act 2025-305, from 1 Sep 2025. |
| UT | 3% | **1.75%** | 3% is the combined rate with the 1% local and 0.25% county options (note). |
| VA | listed exempt *and* reduced 2.5% | **exempt** (state), out of the reduced list | The state part ended 1 Jan 2023; the 1% local tax applies everywhere (note). |
| MO, MS, SD, TN | 1.225%, 5%, 4.2%, 4% | unchanged | |

**Also from the review:**
- A category row now targets every state-rate row its dates overlap (`overlappingStateSalesRuleIds`), not only the one in
  force on its first day.
- New York's "more than" is carried in the rule pack's `NexusEffect` (`strict`) and in the rule's name.
- **Existing test changed** (the review requires it): `us-nexus-and-taxability.test.ts` expected Illinois groceries
  reduced 1% and Alabama 3%. It now expects Illinois exempt and Alabama 2%.

The local grocery taxes (Illinois ordinances, Arkansas, Virginia 1%, Utah local/county) are not modelled. These states
are "not verified" on the invoice screen, and their rows' notes name the local tax.
