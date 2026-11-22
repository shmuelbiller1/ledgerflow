# US use-tax review — historical effective dates (partial)

The use-tax screen is explicitly a **read-only, state-level estimate**, not a filing or accrual tool. Local taxes, exemptions, sales tax already paid, sourcing and other facts can change actual liability. These findings are date-specific counterexamples, not a validation of the other states or product categories.

## UT-01 — P1 for historical review: 2026 Illinois grocery exemption is applied in 2025

**Worked case:** A $1,000 purchase of qualifying grocery food for taxable business use in Illinois on November 1, 2025, with no vendor tax charged, no exemption or credit, and no local tax assumed. The state rate was **1%**, so the expected state component is **$10**. `reviewUseTax` shows the $1,000 as exempt, $0 unclear and **$0 estimated use tax**. [Illinois Department of Revenue FY 2026-03, October 2025](https://tax.illinois.gov/content/dam/soi/en/web/tax/research/publications/bulletins/documents/2026/fy-2026-03.pdf) states that the statewide 1% sales and use tax on qualifying groceries was eliminated effective January 1, 2026; use a qualifying item and actual tax facts, not every item called groceries. The separate local-grocery and transit taxes may continue.

**Mechanism/evidence:** `usProductTaxability.ts` dates the examined 2026 rows from January 1, 2026, but `reviewUseTax` calls `productTreatment(state, category)` without the bill date (`usUseTax.ts:156–165`); the helper simply returns the first current row. Thus a 2026 legal treatment is silently applied to an earlier bill, even though the invoice suggestion's separate path checks row dates. The pure test below reproduces the exact incorrect result; `UseTaxReportView.tsx:44–46` calls this helper for its visible date range. No authenticated browser, actual bill or filed return was tested.

## UT-02 — P1/P2 depending on historical use: South Dakota rate applied before effective date

**Worked case:** A $1,000 ordinary taxable purchase for South Dakota use on June 1, 2023, no vendor tax or credits, ignoring municipal tax. State tax was **4.5%, $45**; the program reports **4.2%, $42**, understating the state-only amount by **$3** and recording $0 as unclear. [South Dakota Department of Revenue, spring 2023 newsletter](https://dor.sd.gov/media/u53pil2m/newsletter-spring-2023.pdf) states the 4.5% to 4.2% reduction took effect July 1, 2023 (and notes the previous 2016 increase from 4%).

**Mechanism/evidence:** `usStateSalesTax.ts` assigns the 4.2% SD row `validFrom: '2000-01-01'`; `stateSalesTaxRate` and `reviewUseTax` accept the June 2023 date. The documented source is authoritative for this example, not a review of every past or future rate. New Mexico's state GRT row also appears to apply 4.875% back to 2020; [New Mexico Taxation and Revenue's July 2022 release](https://www.tax.newmexico.gov/wp-content/uploads/2022/07/Tax-laws-take-effect.pdf) states 5.125% before July 2022 and 5% from then until a further July 2023 reduction. GRT and compensating tax differ legally from retail sales tax: the NM observation warrants separate jurisdiction-specific investigation and is not asserted here as an independently reproduced use-tax amount.

**Acceptance:** Use legally sourced effective-dated product treatments and rates for the exact transaction date; when a date has not been verified, report unknown and exclude from a numeric estimate rather than backdating current facts. Test day before/on/after each statutory change, historical bills, jurisdiction and item exceptions, and future sunsets. A tax professional must approve the periods and sources.

```sh
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/use-tax-dated.test.ts
```

Two synthetic pure diagnostics passed while asserting the erroneous results. The existing tests exercise 2026 examples and do not certify historical rates. Do not infer that the engine posts, files or transmits a return.
