# W12-GOLD — a group with worked figures (AI #9, 21 Oct 2026)

`src/tests/w12-gold.test.ts`, real database, through the bulk and intercompany posting routes, the groups route and
`GET /reports/group-summary` (parent Parent Co in USD owning 100% of Daughter GmbH in EUR; rates EUR→USD closing 1.2,
average 1.1, historical 1.0). Cents:

| | Parent (USD) | Daughter (EUR) | Daughter translated | Eliminated | Group |
|---|---:|---:|---:|---:|---:|
| Income | 71,000 (60,000 + fee 11,000) | 40,000 | 44,000 | −11,000 | **104,000** |
| Costs | 20,000 | 20,000 (rent 10,000 + fee 10,000) | 22,000 | −11,000 | **31,000** |
| Net income | 51,000 | 20,000 | 22,000 | 0 | **73,000** |
| Assets | 151,000 (cash 140,000 + due from 11,000) | 80,000 | 96,000 | −11,000 | **236,000** |
| Liabilities | 0 | 10,000 (due to) | 12,000 | −12,000 | **0** |

- Translation difference: 96,000 − 12,000 − 50,000 − 22,000 = **12,000**.
- The fee's balances differ by the rate (11,000 vs 12,000 at the closing rate): the −1,000 difference is said and kept
  in equity; its income and cost agree (11,000 each at the average), so no profit difference.
- Group equity 236,000 = capital 150,000 + net income 73,000 + translation 12,000 + the 1,000 difference; one
  intercompany pair matched.
