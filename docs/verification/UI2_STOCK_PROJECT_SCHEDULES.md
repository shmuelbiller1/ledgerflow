# UI-2: project, time, item and stock schedules

Base `4a6cc44`. Ten report screens, plus one shared chart data table. No change to the posting engine,
stock valuation, invoice cost or time approval rules. These are embedded schedules, not editable record lists.

## Check the figures

The browser fixture is the `monthly-books` workspace at 28 February 2026. Names deliberately mix scripts.
It mounts production components with deterministic source records or read responses, not screenshots of an
invented page. Independently of that fixture, `e2e/stock-project-links.spec.ts` opens nine Reports deep links
in the real app and reaches the **transaction-line** matrix using the Projects tab on a 390px phone.

| Screen | Worked example and boundary |
|---|---|
| Project profitability | Pier: two **matching lines**, $125.00 income − $31.25 expense = $93.75, 75.0%. Jetty: one expense, −$15.75. All projects: $78.00 net on $125.00 income = 62.4%. Over 40% is strict; a chart limited to ten doesn't limit the results table. No export of the loaded-only analysis. |
| Time by person and project | Avi / Pier: 45 + 35 = 80 minutes, two entries. Both “billable” and “waiting” include the same 45; neither is added again. Financial CSV: `80,1.33,45,45,2`. Owner/accountant can read the team, other roles their own time; 5,000 returned entries cannot establish a complete month. |
| Sales by item | Two Valve units: EUR 40 at 1.25 = $50.00; estimated cost $15.00, profit $35.00, margin 70.0%. Row and footer agree; a full-history reply and a partial local fallback have different source notes. |
| Gross margin by item group | Parts: February 70.0%, eleven unsold months `—`, year $50.00 sales / $35.00 margin / 70.0%. February's CSV cells are `5000,1500,3500,70.00`, not formatted money. The full 54-column file is independent of the displayed-column export. A short, reordered, partial or wrong-book matrix must not certify the download. |
| Inactive items | As of June 30, Valve's Feb 4 sale was 146 days ago. It was still within the threshold on March 1. Gauge has no recorded sale; an undated issued sale isn't “never”. At a 147-day threshold Valve disappears. Neither failed nor capped reads prove inactivity. |
| Backorders | Oldest order wants 3 Valve, next wants 4. With 5 available, the first is ready, the second has 2 covered and 2 short. Vendor order 8 − 2 received = 6 outstanding; still to buy 0. Nothing is reserved. Missing/capped inputs (including a 1,000-order purchase read) cannot authorize release. |
| Inventory item details | Opening 4 / $30; bought 2 / $15 ($7.50 each), then sold 2 / −$15. Closing 4 / $30; received 2, issued 2. The sale drills into its transaction, not a document guessed from the date. A period without movements still has its opening and closing. |
| Stock aging | 4 units / $30: 2 aged 0–30 days, 1 aged 31–90, 1 from before recorded history. Last sold Feb 4, 24 days before the report day. A missing age is not a known arrival date. |
| Inventory turnover | Open/close/average 4 units; received/net sold/all issued 2. Cost sold $15 / average stock value $30 = 0.50; units also 0.50, 59 days / 0.50 = 118.0 days. CSV keeps 15 machine fields including minor units; no denominator means `—`, not zero. |
| Stock transfers | Feb 6: 2 East → West, both halves. Feb 7: 1 out of West, missing move-in. Missing pairs remain visible, with the correct reason. Filtering the CSV to missing pairs keeps ISO date, quantity, source/destination, `no` and the reason. A 5,000-move read does not prove “nothing moved”. |

## Before and after

[Hosted capture and no-update recheck](https://github.com/shmuelbiller1/ledgerflow/actions/runs/44583505427) (`de837e7` references): 40 cases in each pass. The separate local Chromium capture also passed all 40 on its own no-update run. Fonts and native month inputs differ between the local browser and CI; the hosted images below are the merge references. The 27 real-shell / existing chart / action / report browser tests passed separately.

Each link is one full populated screen. **390 light** and **1280 dark** use Hebrew/RTL; the other two use
English/LTR. Before WebPs are from the original components; after PNGs are Playwright references. The
Time before fixture had a viewer with a mocked team response; the after fixture uses an accountant for
the same team figures. The API, not the screenshot fixture, enforces the reader's permissions.

| Screen | 390 light | 390 dark | 1280 light | 1280 dark |
|---|---|---|---|---|
| Projects | [before](images/ui2-stock-project/before-projects-390-light.webp) · [after](../../e2e/__screenshots__/schedule-projects-390-light-chromium-linux.png) | [before](images/ui2-stock-project/before-projects-390-dark.webp) · [after](../../e2e/__screenshots__/schedule-projects-390-dark-chromium-linux.png) | [before](images/ui2-stock-project/before-projects-1280-light.webp) · [after](../../e2e/__screenshots__/schedule-projects-1280-light-chromium-linux.png) | [before](images/ui2-stock-project/before-projects-1280-dark.webp) · [after](../../e2e/__screenshots__/schedule-projects-1280-dark-chromium-linux.png) |
| Time | [before](images/ui2-stock-project/before-time-390-light.webp) · [after](../../e2e/__screenshots__/schedule-time-390-light-chromium-linux.png) | [before](images/ui2-stock-project/before-time-390-dark.webp) · [after](../../e2e/__screenshots__/schedule-time-390-dark-chromium-linux.png) | [before](images/ui2-stock-project/before-time-1280-light.webp) · [after](../../e2e/__screenshots__/schedule-time-1280-light-chromium-linux.png) | [before](images/ui2-stock-project/before-time-1280-dark.webp) · [after](../../e2e/__screenshots__/schedule-time-1280-dark-chromium-linux.png) |
| Sales by item | [before](images/ui2-stock-project/before-sales-390-light.webp) · [after](../../e2e/__screenshots__/schedule-sales-390-light-chromium-linux.png) | [before](images/ui2-stock-project/before-sales-390-dark.webp) · [after](../../e2e/__screenshots__/schedule-sales-390-dark-chromium-linux.png) | [before](images/ui2-stock-project/before-sales-1280-light.webp) · [after](../../e2e/__screenshots__/schedule-sales-1280-light-chromium-linux.png) | [before](images/ui2-stock-project/before-sales-1280-dark.webp) · [after](../../e2e/__screenshots__/schedule-sales-1280-dark-chromium-linux.png) |
| Group margin | [before](images/ui2-stock-project/before-groups-390-light.webp) · [after](../../e2e/__screenshots__/schedule-groups-390-light-chromium-linux.png) | [before](images/ui2-stock-project/before-groups-390-dark.webp) · [after](../../e2e/__screenshots__/schedule-groups-390-dark-chromium-linux.png) | [before](images/ui2-stock-project/before-groups-1280-light.webp) · [after](../../e2e/__screenshots__/schedule-groups-1280-light-chromium-linux.png) | [before](images/ui2-stock-project/before-groups-1280-dark.webp) · [after](../../e2e/__screenshots__/schedule-groups-1280-dark-chromium-linux.png) |
| Inactive items | [before](images/ui2-stock-project/before-inactive-390-light.webp) · [after](../../e2e/__screenshots__/schedule-inactive-390-light-chromium-linux.png) | [before](images/ui2-stock-project/before-inactive-390-dark.webp) · [after](../../e2e/__screenshots__/schedule-inactive-390-dark-chromium-linux.png) | [before](images/ui2-stock-project/before-inactive-1280-light.webp) · [after](../../e2e/__screenshots__/schedule-inactive-1280-light-chromium-linux.png) | [before](images/ui2-stock-project/before-inactive-1280-dark.webp) · [after](../../e2e/__screenshots__/schedule-inactive-1280-dark-chromium-linux.png) |
| Backorders | [before](images/ui2-stock-project/before-backorders-390-light.webp) · [after](../../e2e/__screenshots__/schedule-backorders-390-light-chromium-linux.png) | [before](images/ui2-stock-project/before-backorders-390-dark.webp) · [after](../../e2e/__screenshots__/schedule-backorders-390-dark-chromium-linux.png) | [before](images/ui2-stock-project/before-backorders-1280-light.webp) · [after](../../e2e/__screenshots__/schedule-backorders-1280-light-chromium-linux.png) | [before](images/ui2-stock-project/before-backorders-1280-dark.webp) · [after](../../e2e/__screenshots__/schedule-backorders-1280-dark-chromium-linux.png) |
| Inventory details | [before](images/ui2-stock-project/before-details-390-light.webp) · [after](../../e2e/__screenshots__/schedule-details-390-light-chromium-linux.png) | [before](images/ui2-stock-project/before-details-390-dark.webp) · [after](../../e2e/__screenshots__/schedule-details-390-dark-chromium-linux.png) | [before](images/ui2-stock-project/before-details-1280-light.webp) · [after](../../e2e/__screenshots__/schedule-details-1280-light-chromium-linux.png) | [before](images/ui2-stock-project/before-details-1280-dark.webp) · [after](../../e2e/__screenshots__/schedule-details-1280-dark-chromium-linux.png) |
| Stock aging | [before](images/ui2-stock-project/before-aging-390-light.webp) · [after](../../e2e/__screenshots__/schedule-aging-390-light-chromium-linux.png) | [before](images/ui2-stock-project/before-aging-390-dark.webp) · [after](../../e2e/__screenshots__/schedule-aging-390-dark-chromium-linux.png) | [before](images/ui2-stock-project/before-aging-1280-light.webp) · [after](../../e2e/__screenshots__/schedule-aging-1280-light-chromium-linux.png) | [before](images/ui2-stock-project/before-aging-1280-dark.webp) · [after](../../e2e/__screenshots__/schedule-aging-1280-dark-chromium-linux.png) |
| Turnover | [before](images/ui2-stock-project/before-turnover-390-light.webp) · [after](../../e2e/__screenshots__/schedule-turnover-390-light-chromium-linux.png) | [before](images/ui2-stock-project/before-turnover-390-dark.webp) · [after](../../e2e/__screenshots__/schedule-turnover-390-dark-chromium-linux.png) | [before](images/ui2-stock-project/before-turnover-1280-light.webp) · [after](../../e2e/__screenshots__/schedule-turnover-1280-light-chromium-linux.png) | [before](images/ui2-stock-project/before-turnover-1280-dark.webp) · [after](../../e2e/__screenshots__/schedule-turnover-1280-dark-chromium-linux.png) |
| Transfers | [before](images/ui2-stock-project/before-transfers-390-light.webp) · [after](../../e2e/__screenshots__/schedule-transfers-390-light-chromium-linux.png) | [before](images/ui2-stock-project/before-transfers-390-dark.webp) · [after](../../e2e/__screenshots__/schedule-transfers-390-dark-chromium-linux.png) | [before](images/ui2-stock-project/before-transfers-1280-light.webp) · [after](../../e2e/__screenshots__/schedule-transfers-1280-light-chromium-linux.png) | [before](images/ui2-stock-project/before-transfers-1280-dark.webp) · [after](../../e2e/__screenshots__/schedule-transfers-1280-dark-chromium-linux.png) |

## Reproduce

- `npx playwright test e2e/visual-regression.spec.ts --grep 'visual stock and project'` — 40 populated
  states, scoped axe, keyboard controls and assertions on actual values / downloaded files. Snapshot
  tolerances are unchanged. `npx playwright test e2e/stock-project-links.spec.ts` — real shell navigation.
- `src/tests/stock-project-schedules.test.tsx` covers a late response after changing and returning to a
  period, refusal/retry, malformed rows, a role change, cap, chart/table counts and full-year CSV shape.
  `stock-transfers-view` checks both kinds of missing half, filters, refusal and the cap.
- With `LF_TEST_DATABASE_URL` pointing to a migrated test database, `inventory-details`, `stock-aging`,
  `time-tracking`, `l123-step4b-sales-by-item` and `l123-step4k-item-group-margin` exercise real service
  reads and their access checks. `npm run test:rules` separately checks Postgres RLS.
- `npx tsx scripts/codemod-row-table.ts --files` is a dry survey, not a conversion count for this PR.
  `quality-ratchet`, `raw-table-decisions`, `reports-translation-guard` and `report-date-display-guard`
  guard the path counts, accessible local copy and reader dates against regressions.
