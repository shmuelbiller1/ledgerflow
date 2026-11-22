# Group consolidation review — acquisition-date slice (in progress)

## GC-01 — P1: group totals include the subsidiary before control was obtained

**Evidence:** `group-acquisition-database.test.ts` uses synthetic books, real group-creation and group-summary routes, test-injected identity and isolated PostgreSQL. Parent starts with $200 cash/capital. Subsidiary starts with $100 cash/capital and earns $20 on March 1. Parent acquires 100% for $120 on June 1 (equal to subsidiary book and fair net asset value, for this worked example); subsidiary earns $30 on August 1. No intercompany transactions, debt, depreciation, tax or acquisition adjustments are assumed.

- The May 31 report, **before control**, reports **$320 group assets** and **$20 group income**. Under the specified ordinary acquisition scenario, the parent has $200 assets and $0 income; the not-yet-owned subsidiary is outside the consolidated group.
- The full-year report shows **$50 income/net profit** rather than **$30 post-acquisition profit**. Its $230 assets and $230 equity happen to be right in this very simple example: balancing does not prove the period income is right.

IFRS 10 ¶20 and B88 specify consolidation and subsidiary income/expense inclusion from the date control is obtained until it is lost, subject to relevant scope and framework exceptions: [IFRS Foundation, IFRS 10](https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2025/issued/ifrs10.html). Our case assumes this is an ordinary acquisition of a business, not an investment entity, common-control, or pro forma presentation. The app labels this a group summary and also describes a group with a parent as a consolidation. It does not disclose these totals as all-year pro forma unaffiliated figures in the tested route.

**Mechanism:** `memberFigures` computes each member's P&L for the full requested period and its balance sheet at the end date (`src/server/reports/groupReport.ts:225–244`). Although `acquired` drives a separate `profitSinceBought` for associates and goodwill analysis, `sum` adds controlled subsidiaries' entire member figures regardless of acquisition date (`:345–346, :397–419`). An acquired date after the end date also does not keep a subsidiary out of a historical balance sheet. Nor does the tested scenario cover disposals, changes in control or initial same-day convention.

**Acceptance:** Define acquisition/control timelines and scope, use them consistently for period profit, balance sheet, account lines, NCI and eliminations; handle loss of control and policy exceptions, and reconcile detail and total. Avoid presenting an unadjusted aggregate as GAAP/IFRS consolidation. Have a consolidation specialist validate acquisition accounting and related disclosures.

```sh
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/group-acquisition-database.test.ts
```

1 diagnostic passed, deliberately asserting present incorrect outputs; it clears only its unique synthetic rows.

## GC-02 — acquisition premium is called goodwill without identifying fair-value adjustments (code-level limitation)

The group report calculates and labels the excess of the parent investment account over the subsidiary's acquisition-date **book** equity share as goodwill, with no identifiable-asset fair-value adjustment input in that computation (`groupReport.ts:368–394`, `GroupSummaryReportView.tsx:368–370`). For an ordinary IFRS 3 business combination, goodwill is generally a residual after measuring identifiable net assets at acquisition-date fair values, with specified exceptions and NCI treatment; see [IFRS Foundation IFRS 3](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-3-business-combinations/). For example, 100% cash price $120, acquired book net assets $100 and identifiable fair net assets $115 (assume no other adjustments): residual goodwill is $5, while this calculation labels $20 goodwill and does not separately show the $15 fair-value step-up. This is not a complete purchase-price-allocation example; actual tax, intangible, NCI and other facts can change the result. Existing synthetic database tests document the implementation's book-value premium, not statutory correctness. No real acquisition, impairment, asset acquisition, or downstream depreciation was tested.

Do not represent the simple book-value premium as final statutory goodwill. Require acquisition accounting inputs and expert review or clearly label the calculation as a non-statutory estimate that excludes fair-value adjustments.

## GC-03 — P1: intragroup inventory profit stays in the consolidated assets and net income

**Worked case and evidence:** Directly seed balanced synthetic local-DB journals for an established 100%-owned subsidiary, with parent $250 capital and subsidiary $100 inventory/capital; parent buys the shares for $100 at book value. During the year, the subsidiary sells the whole inventory to the parent for $150 cash, with $100 COGS. The sale and purchase are marked and paired as intercompany, while the separate $100 COGS journal is unmarked. The parent holds the entire inventory at year-end; there are no external sales, other income, tax, liabilities or expenses. The real group/report routes show a matched intercompany pair with no unmatched entries, **$300 assets/equity and $50 net income**, even though the correct consolidated amounts under these assumptions are **$250 assets/equity and $0 net income**: cash $150 plus inventory at the group's original $100 cost. The reported P&L is internally inconsistent: $0 income, $100 COGS, negative $100 gross profit, no expense, but positive $50 net income. Eliminating the $150 sale and the $100 cost and removing the $50 profit from inventory yields the independently worked result.

The test seeds records rather than proving that the ordinary intercompany/inventory entry UI creates these precise metadata or journals. Hosted production, tax, partial sell-through, different ownership and inventory returns were not tested. `groupReport.ts:237–242, 363–365, 402–417` subtracts tagged sales/costs from displayed sections but leaves the companies' aggregate net income unchanged; it has no inventory-profit elimination based on the buyer's remaining stock. Even when a journal is unmarked, the mismatch is not identified by pair matching. IFRS 10 B86(c) expressly includes unrealized intragroup profits in assets such as inventory in elimination requirements: [IFRS Foundation, IFRS 10](https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2025/issued/ifrs10.html). Accounting treatment depends on the applicable framework and facts.

**Acceptance:** Track and reconcile both sides and the amount of inventory still within the group; eliminate unrealized profit, recognize it when the group sells externally, reconcile income minus costs to net income, and test partial sell-through, loss, foreign currency, taxes and untagged/mismatched entries. Refuse or unmistakably qualify a group total when sufficient information is absent.

```sh
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/group-inventory-database.test.ts
```

1 diagnostic passed, asserting the wrong current output. Initial fixture used an unsupported `cogs` account type and failed; corrected to the program's `cost_of_goods` type and reran. Further acquisition/associates, translation, loss of control and account-line tests remain outstanding.
