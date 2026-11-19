# Four account-based reports: incomplete reads and CSV

Agent 7 · F-2/F-5 · 18 Nov 2026 audit · [PR #882](https://github.com/shmuelbiller1/ledgerflow/pull/882). Base `bce500c139be72264b8652fad9248610c7496eb9`. This is a report-input and export audit, not a change to amounts, posting, authorization or storage.

| Confirmed defect | Evidence on the base | Correction in this PR |
|---|---|---|
| **A7-F2-01 · High** [#879](https://github.com/shmuelbiller1/ledgerflow/issues/879) | All entries arrived, but the Rent account was outside the chart page. A $2,000 lease and $5 fuel produced a downloadable `top-expenses.csv` containing **only fuel, $5.00**. With only the lease, the screen said “No expenses in this period.” No `top-lines` request was made. | `useServerTopLines` uses the existing account-aware range read, including account revisions. An outstanding request shows loading. A refused read allows a labelled, non-exportable local preview and manual retry. An unsupported period points back to the period control. |
| **A7-F5-02 · High** [#884](https://github.com/shmuelbiller1/ledgerflow/issues/884) | Income by Source, Expense by Category and Top Line Items declared no activity before the first transaction snapshot. Monthly Averages offered twelve zero months. All four still offered CSV when a previously loaded chart subsequently failed; its `loaded` flag alone was insufficient. A standalone file would no longer carry the screen's caveat. | `ReportInputBoundary` asks for the relevant collections, requires the current workspace's snapshot, prioritizes failed reads over stale loaded flags and retries the failed input. `AccountReportResult` distinguishes pending, refused, unsupported period, and complete. Bills have a separate read boundary: they do not determine posted expense totals. |

## What was checked

- **Components** — [`account-range-report-states.test.tsx`](../../src/tests/account-range-report-states.test.tsx). Bad state → retry → fresh snapshot; actual current-workspace emptiness; pending/refused full read; current and obsolete replies after changing period, chart or workspace; uncapped, unrelated and unidentified caps; all-time / too-wide period; no standalone partial CSV. Existing [worked books](../../src/tests/helpers/reportLedger.ts) still give $5,500 net income and $2,400 net expenses, including refunds and reversals.
- **Browser** — [`account-report-completeness.spec.ts`](../../e2e/account-report-completeness.spec.ts) uses the actual report and CSV downloader. The first full read gets 503, retry succeeds, and the parsed file must contain `Office lease … Rent … 2000.00`, then `Fuel stop … Fuel … 5.00`. Desktop and phone screenshots and base/candidate files are in the recovery archive. This spec stubs the HTTP response; it does not prove a production deployment.
- **Database contract** — unchanged L-123 `step4a`, `step4de`, `step4f` and `step5a` tests run against a **disposable PostgreSQL 17** with the repository's migrations. They exercise the real routers, member/refusal and sandbox-read parity. The independent seven-entry book has $9/$7/$2 full ranked expenses and $15/$8 income, not just the newest four entries. Database identity is injected by the test harness. The RLS SQL suite passed separately.
- **Built sample company** — from a fresh **Continue as Guest** session, all four real CSVs downloaded. Independent signed-line sums over 1,238 posted USD sample entries matched all twelve months and 25 ranked December amounts (income $16,285.20; expenses $43,751.50). [Downloads and reproduction scripts](https://drive.google.com/open?id=1Th41eeICv3sk5z7wg1tPRLgOZzES2TTH). The [function scorecard](https://drive.google.com/open?id=1d72zoe24OT9Goe3zIPOAInJKtMSgWORc) separates 31 individually inspected bodies from 72 indexed-only ones; it does not certify the rest of the app.
- **Verification boundary** — Node 24 `lint:types`, touched-path ESLint, affected tests and Chromium run locally. For current CI, including the merged coverage gate, use the [PR's checks](https://github.com/shmuelbiller1/ledgerflow/pull/882/checks); a local green test is not CI approval. Detailed verification and patch receipts: [recovery checkpoints](https://drive.google.com/open?id=175Q9aRG6-_Q31WK4tmHbna6NA0_-xJ6f).

Reproduce without live data:

```sh
# Node 24; LF_TEST_DATABASE_URL must name a new, disposable local database.
npm ci
npm run db:test-setup && npm run test:rules
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic node --import tsx --test --test-force-exit \
  src/tests/{account-range-report-states,l123-step4a-top-lines,l123-step4de-breakdowns,l123-step4f-monthly-averages,report-views}.test.tsx \
  src/tests/ledger-collections-guard.test.ts
npx playwright test e2e/account-report-completeness.spec.ts
```

**Scope left open:** F-2 is not a certification of every analytical screen; F-5 is not an app-wide loading audit. [#818](https://github.com/shmuelbiller1/ledgerflow/issues/818) is the separate invoice-backed Sales by Item finding. Workspace-wide exports, print/PDF, FX/minor-unit math, hosted authentication, deployment and the real-records pilot gates are not certified by these results. No launch stage changes here.
