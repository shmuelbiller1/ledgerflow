/** Screen descriptions are part of the registry contract; no generic fallback hides missing help. */
export const SCREEN_HELP: Record<string, Record<string, string>> = {
  main: {
    practice:
      "Every set of books you can open, with what is waiting there: bank lines to review, banks to log in to again, questions, drafts, last month not closed and the next recurring item, most work first. A number opens that workspace on that screen.",
    inventory:
      "Review items, quantities and stock workflows. Edit supported metadata or inspect counts and adjustments. Use the stock adjustment workflow to change quantities or values.",
    projects:
      "Manage projects and inspect their pipeline or profitability. Edit metadata and inspect associated records. Profitability uses the included posted activity.",
    budgets:
      "Maintain budgets and compare them with actual activity. Edit supported metadata and review dates. A budget is a plan rather than a posted transaction.",
    dashboard:
      "Review the workspace overview for a chosen period. Arrange widgets, inspect balances and follow their report links. Forecast estimates and incomplete loaded history are labelled separately.",
    inbox:
      "Review imported activity needing attention. Inspect suggested categories or matches before accepting them. A suggestion does not establish that records are identical.",
    copilot:
      "Explore workspace data with the AI copilot. Review source records and proposed actions before using an answer. Generated advice is not a posted entry.",
    transactions:
      "Browse ledger transactions and their lines. Filter records, arrange columns and open the existing financial editor. Draft and void entries do not appear in posted reports.",
    "credit-notes":
      "Manage customer credits and vendor credits. Inspect allocations, remaining credit and refunds through the existing document workflow. Change amounts through the credit or refund workflow.",
    assets:
      "Maintain fixed-asset records and inspect depreciation history. Edit supported metadata or use the existing depreciation workflow. A preview does not post depreciation.",
    register:
      "Inspect activity for a selected account. Review individual entries and their account effects. Financial corrections use the original entry editor.",
    ledger:
      "Inspect journals, accounts and posted activity. Filter entries or open account detail and related reports. Account openings and period movement have different time scopes.",
    intercompany:
      "Explore activity between entities. Inspect source entries and the available elimination presentation. Viewing a consolidation does not itself post a journal.",
    recurring:
      "Manage recurring entry schedules. Inspect the next occurrence, pause a schedule or review generated documents. Generated drafts still require their normal workflow.",
    "query-builder":
      "Build a query over loaded workspace records. Add filters and inspect matching rows. Browser queries are limited to the history loaded for the workspace.",
    banking:
      "Manage existing bank connections and imported activity. Reconnect expired logins and inspect connection health. Provider setup determines which live services are available.",
    "audit-trail":
      "Review the recorded history of workspace actions. Find a record and inspect who changed it and when. An audit log is not an independent financial reconciliation.",
    "client-queries":
      "Questions the bookkeeper or accountant asked about entries, and the answers. Ask from an entry's edit window with \"Ask about this entry\"; answer, follow up or close the question here. Each side gets a notification; a question changes nothing in the books.",
    time:
      "Log what you worked on, for which customer or project and whether it is billable, then submit it. Owners and accountants approve it or send it back and keep the hourly rates (a project's, else a customer's, else a person's). Approved billable time becomes a draft invoice for its customer; nothing is posted until that invoice is.",
    tasks:
      "What each person in the workspace has to do, the late ones flagged. Owners, accountants and bookkeepers give a task to anyone here, optionally about an invoice, bill, entry, account or item, which opens from the list. The person given it is told, and ticking it done tells whoever gave it.",
    reconciliation:
      "Match bank activity with ledger entries. Review differences before accepting matches or completing reconciliation. Inspect the underlying documents when a match is uncertain.",
    "month-end-close":
      "Review the checks used to close a month. Inspect unresolved items and use the existing close workflow. Server permissions and period locks remain enforced.",
    "fiscal-periods":
      "Manage the fiscal calendar and period status. Inspect closed periods and the existing lock controls. Financial edits must respect the effective period lock.",
    sales:
      "Manage customers and sales invoices. Create or inspect an invoice, record settlement and edit related metadata in its side drawer. Approval, delivery and posting retain their existing document rules.",
    estimates:
      "Prepare estimates and quotes. Edit a draft or use the existing conversion workflow when accepted. An estimate is not posted sales revenue.",
    payments:
      "Review received and made payments. Inspect allocations and use the existing payment workflow for changes. Unapplied receipts are distinct from sales revenue.",
    purchases:
      "Manage suppliers and purchase bills. Inspect a bill, record payment and edit related metadata without leaving the form. Review taxes and totals before saving a bill.",
    "purchase-orders":
      "Prepare and track purchase orders. Inspect ordered items and use the existing receiving and bill workflows. A purchase order is not a posted bill.",
    loans:
      "Maintain loans the workspace owes: the lender, the principal, the rate, the term and the repayment schedule to the cent. Recording the money arriving or a payment posts one balanced entry through the ordinary posting path, so the period lock applies; a closed period refuses it. The screen never invents an account: it asks for the liability, interest and bank accounts it already has.",
    "petty-cash":
      "Run the petty cash box: one of the workspace's own cash-type accounts, with its balance read straight from the ledger. Spend from the box against an expense category, top it up from a bank account, or count the cash and post the difference to a chosen over/short account. Every movement is one balanced entry through the ordinary posting path, so the period lock applies; the screen never invents an account.",
    payroll:
      "Keep the employee list, their deductions and time off, and post pay runs. The server posts one balanced entry on the pay date: wages and the employer's taxes as expenses, net pay out of the bank, and withholding and deductions as payroll liabilities; Undo voids it while the date is open. An owner can require approval, so an accountant's run waits until an owner approves it or sends it back. The tax figures are estimates, so check them before paying.",
    reports:
      "Choose a financial report and its dates. Compare periods, print or copy an exact report link. Each report explains its timing and loaded-history limits.",
    charts:
      "Explore financial series and their declared units. Switch to a table, hide a series or narrow the date range. Presentation controls do not change accounting calculations.",
    forecaster:
      "Explore cash-flow forecasts and scenarios. Review assumptions and compare possible outcomes. Forecast values are estimates rather than posted balances.",
    intelligence:
      "Explore analytical tools over workspace context. Choose a tool and inspect its inputs and explanation. Scores and simulations are advisory rather than confirmed facts.",
    settings:
      "Configure workspace preferences and supported services. Choose a section or find it with the command palette. Some changes are available only to workspace owners.",
    "data-health":
      "Inspect consistency and data-quality findings. Follow record links and review corrections in their normal editors. Findings cover the records currently loaded, which may be incomplete.",
    support:
      "Review support requests and conversations. Create a ticket using the existing support workflow. Availability depends on the configured service and access.",
    help: "Find workflow guidance and registered screen descriptions. Search All screens using English or Hebrew names and inspect release notes. Send feedback from any screen to save a support ticket with screen and app version. Help describes the implemented workflow and its limits.",
    vault:
      "Manage supporting documents for financial work. Browse files and inspect their record associations. Upload availability depends on the configured document service.",
    pricing:
      "Compare available plans and published features. Review details before using the existing billing workflow. A plan description is not confirmation of a payment.",
    "api-hub":
      "Explore the API interface and integration examples. Review endpoint documentation and developer controls. An example response does not establish a live provider connection.",
    "system-command-center":
      "Inspect the developer-only administration demonstration. Explore its example panels when developer mode is enabled. Demonstration telemetry is distinct from production monitoring.",
  },
  reports: {
    "customer-tax-certificates": "Review current customer certificate declarations, with expiries within 30 calendar days first and expired or unreadable entries marked. Refresh the complete workspace customer list before CSV export. This is a dated review of current metadata, not verified entitlement or certificate history. Open customer details in a side drawer to keep this list visible.",
    "vendor-tax-records": "Review masked recorded tax/VAT IDs, withholding-certificate expiry and missing-data reminders. Refresh the complete workspace vendor list before CSV export; edited records invalidate that export until refreshed. This does not verify ID kind, W-9 receipt, registration or legal withholding obligations. Open related vendor details without leaving the report.",
    "form-856":
      "Review tax withheld at source from vendor payments, per vendor and tax year, with the certificate numbers the payments relied on. Choose the year and download the CSV for the form. Payments without a certificate number are listed as missing, never filled in; nothing is filed here.",
    "customer-cohorts": "Group customers by their earliest observed issued-invoice month and inspect each later month's total invoicing, distinct active customers or percentage. The first invoice can predate the selected display window. Incomplete invoice history makes these cohorts provisional.",
    "asset-register": "Review fixed assets held at a chosen date, with acquisition cost, recorded depreciation and book value. See category totals or export a numeric CSV. Historical cost adjustments after the selected date are flagged because saved asset metadata is current.",
    "one-sided-transfers": "Review internal bank transfers with a missing or unequal ledger cash side, or a confirmed statement match on only one side. Warnings are evidence to review, not proof that funds are missing. Results are provisional when bank statement or ledger history is incomplete.",
    "budget-actual": "Compare a saved account budget with posted account movement for the selected period or months. Open an actual to inspect its contributing entries. Recurring caps are spread by month; partial months keep their cap, and loaded-cache figures are provisional until full history is requested.",
    pnl: "Review posted income, cost of goods sold and expenses for the period. Compare periods and choose presentation columns. Incomplete loaded history makes the figures provisional.",
    "group-summary":
      "Choose one of your groups of books (Settings → Groups of books) and a period: each company's income, costs, profit, assets, liabilities and equity side by side, with the group's total when all keep their books in one currency (or translated into one). Each figure opens that company's own report. Balances and sales between the companies are taken out of the total; with a parent, the other owners' part is shown. Account by account lists each account across the companies, matched by code or name.",
    backorders:
      "Items sold on sales orders and not delivered yet, the oldest order first, against the stock on hand: what each line can take from stock and what it is short. Above, each short item in all with what is already on order from vendors and what is still to buy. Nothing is reserved or posted.",
    commissions:
      "Choose a period: for each sales rep, every payment their customers made against an invoice, the part before tax, and the rep's commission on it, with their total. Commission follows what was paid, not what was invoiced. Reps, their percentages and customers are kept in Settings → Sales reps; nothing is posted.",
    "goods-not-billed":
      "Goods delivered to customers that are not invoiced yet, and goods received on purchase orders that have no bill yet, at each order's price. The first is income still to invoice; the second, costs still to come.",
    "bank-clearance":
      "For a bank account and a period, each entry on it and the day the bank cleared it, from the matched statement lines. At the end, the deposits not yet on the statement and the payments not yet taken, and the balance the bank should show.",
    "depreciation-ledger":
      "For a period, each fixed asset's cost, the depreciation it had before the period, what the monthly runs posted in it, what it has at the end, and its book value, with the totals. Assets sold or scrapped are marked.",
    "item-register":
      "Every invoice line that sold a stock item, or every bill line that bought one, in a period, for one item or all. Each row opens its document, and each item's units and amount add up at the end.",
    "profitability-by":
      "For a period, revenue, cost, gross margin and margin % by customer, by item or by project. Revenue is the issued invoice lines; cost is the posted cost of goods sold (an estimate is marked where none is posted). By project, bill and expense lines with that label are added to the cost. Margin % is blank where there is no revenue.",
    "slow-moving-stock":
      "As of a day, each stock item with units on hand: its value at cost, the day it last sold and how long ago, in age buckets (0–30, 31–90, 91–180, over 180 days, never sold). Narrow it to items with no sale in N days, then export the list. Drafts, estimates and voided invoices do not count as sales.",
    "stock-aging":
      "As of a day, each item's stock on hand split by how long ago those units came in, the latest units taken to be the ones still there. With its value and the last sale, so slow-moving stock shows first. Read from the stock history the server keeps.",
    "inventory-details":
      "For a period, each item's opening quantity and value, every movement (sold, bought, returned, adjusted, counted, moved) with its entry, and the closing quantity and value. Read from the stock history the server keeps with each change.",
    "by-label":
      "Choose a label (Property, Project, Location…) and a period: the income, costs and result of each of its values, and of the lines without one, account by account. Together the columns add up to the profit and loss of the period. Each figure opens the entries behind it.",
    "ask-books":
      "Ask about an account, a label and a period in words. The question is read into filters you can see and change; the figure is calculated from all posted entries in the workspace's currency, and the entries behind it are listed. It reads names and dates, not any sentence.",
    "balance-sheet":
      "Review assets, liabilities and equity at the end date. Compare snapshots and inspect account detail. The start date does not erase earlier activity.",
    "cash-flow":
      "Review the existing posted cash-flow statement. Compare periods and inspect included account activity. Scenario forecasts are separate from this statement.",
    "party-linked-trial-balance":
      "Review journals explicitly linked to one customer or supplier. Choose a party and inspect debits, credits and account balances. Unallocated workspace openings and unlinked journals are excluded.",
    "sales-trends":
      "Review twelve months of issued-invoice item activity. Group by customer or item and compare another ending date. Credit notes and document-level tax or discount allocation are outside this item calculation.",
    "purchase-trends":
      "Review twelve months of purchases by vendor or item and compare ending dates. Vendor totals use issued bills in base currency; item mode uses the item-wise bill register with units, separate document currencies and CSV. Load full history before relying on item figures; returns and tax/discount reallocation are outside item mode.",
    "sales-payment-summary":
      "Review customer receipts grouped by method under the existing customer report rules. A separate posted-payment section shows money received and paid per method and document currency, with a review CSV. Unlike currencies are never added, and draft or void payments are excluded. Partial or undated records block that CSV; payments are not automatically invoice revenue or proof of a reconciled bank balance.",
    "exchange-rates-used":
      "Review exchange rates stored on workspace documents and entries. Choose dates and inspect the rates actually used. Historical rates on records are distinct from current market quotes.",
    "open-advances":
      "Review customer deposits and vendor prepayments not yet applied to an invoice or bill, oldest first. See how long each has waited and which contacts hold the most. Apply them from the customer's or vendor's page.",
    "deferred-revenue-waterfall":
      "Review scheduled revenue earned by month and still deferred at the period end. Inspect each schedule and its recorded earned amounts. Future scheduled amounts remain distinct from posted earned revenue.",
    "financial-ratios":
      "Review financial ratios together with their formulas. Adjust report-only current-account groups and compare periods. Zero denominators are undefined and turnover days use labelled revenue or COGS proxies.",
    "vendor-withholding": "Review posted vendor payments for a calendar month, grouped by vendor and payment currency. Saved withheld amounts and certificate references are used without recomputing tax rates. Refresh complete workspace payment history before exporting; changed or unreadable payment data keeps CSV unavailable. Vendor paid is shown in the payment currency, and the related-record drawer edits shared vendor metadata without leaving the report.",
    "discount-mismatch":
      "Compare issued invoice unit prices in the selected period with current customer price lists or item catalogue prices. Refresh complete invoice/item reads before CSV. Current prices do not prove historical discount entitlement; foreign currencies, document-wide discounts and unknown item references are excluded.",
    "vendor-scorecard":
      "Review each vendor's on-time delivery (first goods receipt against the expected date), unit-cost changes per item in the bill's own currency, and returns sent back in the period. Read-only: nothing is posted, and a vendor with no dated orders shows no on-time rate rather than 100%. Find a vendor by name and expand Review source bills to open its loaded bills in the date range.",
    "vendor-price-history":
      "What each item actually cost from each vendor, purchase by purchase, from the bill lines the books hold: the line amount divided by its units, in that bill's own currency. Prices are compared only inside one currency, a single purchase shows no change, and draft, void or cancelled bills are not purchases and are left out. Read-only: nothing here prices, posts or changes a bill.",
    "three-way-match":
      "Every purchase order issued in the period, checked against its goods receipts and its supplier's bill: matched, short or over-delivered, not received, or still waiting for a bill. The check and its sentences are the Purchase orders screen's own 3-way match, and each amount is the order's own figure in its own currency, never added across currencies. Read-only: nothing is approved, posted or changed.",
    "customer-lifetime-value":
      "Each customer's recorded sales, credit notes, cost and gross profit up to an as-of date, with the orders, the first and last order, the average order and the orders per year. The projected lifetime value repeats the recorded average annual profit for a lifespan you choose: it is an assumption shown on the screen, not a forecast, and a customer with one order carries a very thin history. Read-only: nothing is posted or changed.",
    "subscription-plans":
      "The customers' recurring invoices seen as plans: the money each brings a month (MRR) and a year (ARR), and what started and what stopped in each month of the window. A stopped plan's month is when it last ran, because the rules record the last occurrence and not a cancellation date, and currencies are never added together. Read-only analytics: nothing here sends a draft or changes a plan.",
    "expense-policy-check":
      "Check expense claims dated in the period against the workspace's own expense policy rows: a maximum per line and the amount from which a receipt is needed. The maximum is inclusive; the receipt count is not read on this screen, so a needed receipt is listed as not checked here, never as missing. Read-only: nothing is approved, changed or posted, and claims in another currency keep their own currency.",
    "expense-receipt-checklist":
      "List expense claims by the employee named on the bill, with any linked files and the recorded receipt URL. Claims with no file are grouped for review by employee, but linked files are not inspected and may not be receipts. Incomplete claim or attachment history is marked not checked; this report never approves or deletes a claim.",
    "duplicate-contact-review":
      "Compare customer and vendor records for exact tax-ID, email or phone matches and normalized-name suggestions. Name-only matches are weak; review both records before using the existing merge flow because this report never merges or edits contacts. Matched identifier values are not shown in the table or export.",
    "duplicate-bill-review":
      "Purchase bills from one vendor, in one currency, for exactly the same amount, dated within three days of each other, with a shared document number or order reference shown as stronger evidence. Two real deliveries can look like this, so every row is a question to check, not a finding. Read-only: no bill is edited, merged or deleted, and another currency is never converted.",
    "document-number-gaps":
      "Issued invoices, bills, credit notes and estimates read by their number: everything before the trailing digits is the series and the digits are the counter. A missing number can come from a skipped import, a numbering restart or a lost document, so the report shows the numbers rather than judging them, and a repeated number is shown separately. Draft, void, cancelled and rejected documents are excluded and counted, and nothing is changed.",
    "cash-forecast-13-week":
      "Open invoices on their due dates, open bills on theirs and the recorded recurring rules, added week by week for thirteen weeks. It is arithmetic on what is recorded, not a prediction: no payment history, seasonality or new business is modelled, money in another currency is counted rather than converted, and a rule whose accounts do not say which way the money moves is listed instead of guessed. Read-only; nothing is posted.",
    "vendor-1099-readiness":
      "Posted outgoing payments in the workspace currency for the chosen year, compared per vendor with the existing 1099 threshold table, and what the vendor record is missing. The tax ID appears as a mask only, no country is assumed when none is recorded, and this workspace has no W-9 field, so no form is claimed to be on file. Read-only: nothing files, edits a vendor or posts.",
    "golden-tax-fixtures":
      "Fifty golden invoices and thirty golden bills for Israel and the United States with the tax expected on each, checked on screen against the dated tables they name. A failure is shown by case number instead of passing silently. Read-only test fixtures: US amounts are the state base rate only, nothing posts or files.",
    "us-quarter-journey":
      "One read-only path for a US quarter: the sales-tax permits, each state's return figures with the planning due date, use tax on untaxed purchases, the exemption certificates behind zero-tax sales, the 1099 preview for the tax year, and closing the quarter's months. Every figure is the one the screen it names shows, and each step opens that screen. The state assigns the filing frequency, the sourcing rules and the deadline, so the due date moves off a weekend only and no holiday, marketplace facilitator, local return or transaction-count nexus test is known here. Nothing files, posts, pays or closes.",
    "il-month-journey":
      "One read-only path for an Israeli VAT month: the registration in force, the allocation numbers the month's business invoices need, the periodic VAT report figures (taxable, zero-rated and exempt sales, input VAT on equipment and on everything else, and what is to pay or reclaim), the historical PCN874 draft and closing the month. Every money figure is the one the screen it names shows, and each step opens that screen. The Tax Authority assigns the frequency and the deadline, the PCN874 layout dates to 2010 and is not filing-ready, and nothing files, posts, pays or closes. A return shown as recorded is only what the caller recorded.",
    "purchase-price-variance":
      "Compare each vendor's quantity-weighted average unit cost with the median of other vendors for the same item and currency. Costs reuse the bill-line unit-cost rule, and currencies are never converted or combined; no baseline is shown when there is no comparable vendor. Read-only: bills and catalogue prices are not changed.",
    "sales-by-territory":
      "Group issued invoice item amounts by their Location dimension, including an explicit Unassigned bucket. Each line uses its invoice's stored exchange rate to the workspace base currency; opening balances and non-issued invoices are excluded, and document-wide tax is not allocated. Check the period and invoice-history completeness before relying on the totals.",
    "record-retention-review":
      "Use the owner-specified IL seven-year, US seven-year and UK six-year periods to identify documents whose date plus the specified calendar years has passed. Country comes from the books or World/Entity Tax profile; missing dates or countries and unsupported countries remain unclassified. This is not legal advice or deletion authorization, and Workspace.retention is a separate server log and recovery setting.",
    "milestone-billing":
      "Every sales order that keeps a milestone schedule, with what is invoiced, what is left and the next milestone to bill. The amounts are cumulative shares of the order total so cents never drift, and the percentage of the order no milestone covers shows as unscheduled. An order records its customer and not a project, so orders are listed by customer. Read-only: invoicing a milestone stays on the order screen and nothing is posted.",
    "reorder-suggestions":
      "Stock items below their reorder point, grouped by the vendor they were last bought from, with a suggested quantity rounded up to whole packages. Creating draft purchase orders writes one draft per vendor with the next order numbers and a note to check them: nothing is approved, received or posted. Unit costs come from home-currency bills or orders, so a purchase in another currency is not used because no rate is guessed. Items never bought sit in a no-vendor group that cannot be drafted.",
    "dunning-letters":
      "Open invoices past their due date, what is still owed and which reminder step the invoice's age calls for on the 7/21/45 day schedule, with the letter ready to read in English or Hebrew. Nothing is sent from this screen: sending goes through the existing email path, each step is then sent once per invoice, and the log of what went out shows here once that path lands. The schedule typed here is for this viewing and is not saved to the workspace.",
    "record-notes":
      "Every note kept on a customer, vendor, item, invoice, bill, estimate, entry or project, with who wrote it and when. Search finds a note by any word in it, its author name or its record; opening a record shows its notes, and a writer adds one there or changes their own. Notes are kept on each record and never change an amount, and a change to a document in a locked period is refused by the period lock like any other change.",
    "serial-lot-lookup":
      "Search where a serial number has been: the document, the line and the lot it moved with, read from the numbers the documents carry. Below, one item's lots with their dates and units, and the same serial recorded twice for one item, which is a typing mistake to look at. Read-only: nothing is changed here, and recording a serial on a receipt or invoice line happens in that document's own form.",
    "cycle-count":
      "Count one place at a time: the sheet lists the items the stock-moves ledger puts there with the expected quantity and each item's own cost, you enter what you counted, and the sheet shows the variance in units and its value. A blank row is never read as zero and a row whose stock history does not explain its quantity is flagged, so the count is not blamed. Marking a sheet ready only records who checked it: posting the adjustment is the Inventory stock count (the server writes the entry and the history), and the count sheet is not saved to the workspace. The Warehouse operations workflow tab adds bins, pick/pack/ship tracking, two-person return authorizations and serial-based warranty dates; those are annotations only, and actual deliveries, stock returns, invoices and credits still use their existing workflows.",
    "registration-threshold-watch":
      "Compare posted revenue lines tagged with supported activity values against dated Israel, UK, Canada and EU-wide thresholds, grouped by a chosen entity dimension and country from Tax profiles. Sales are compared only when the workspace base currency matches the threshold currency; missing labels, incomplete history and statutory scope outside ledger data prevent a registration decision. This read-only report keeps its period windows and official sources visible and never posts or converts sales.",
    "purchases-from-abroad":
      "Review recorded bills of the period whose vendor's recorded country is not Israel: an Israeli business accounts for the Israeli VAT itself — on services by self-assessment in the periodic return (VAT Law Section 20), on goods at the import, where customs collects — and this screen lists the bills with the rate in force on each date and a reference amount. It never decides which a bill was, posts, accrues or files anything; vendors with no recorded country are counted for review, and bills in another currency are counted, never converted.",
    "customer-credit-limits":
      "What each customer owes now against the credit limit recorded on their own record, in the workspace base currency: the unpaid part of issued invoices, how much of it is already past its due date, the headroom left and how much of the limit is used. A customer with no recorded limit is shown as no limit recorded and is never treated as over it, and balances in another currency are listed beside the row, never added in or converted. Click a limit to type a new one; read-only otherwise — nothing is posted, no sale is blocked and no amount is changed.",
    "rule-pack-coverage":
      "What the tax rule packs cover on a chosen date: every place — a country, or a state or province inside one — with how many rate, taxability, nexus, registration and filing rules it has, the packs behind them and the distinct authority pages they were read from. A place that is not listed is one this lane has written no rules for, never a statement that no tax applies there, and the gaps list names the covered places missing a kind so the next table to write is visible. Read-only: every row is 'calculation' content, and nothing here files, accrues or posts.",
    "use-tax-review":
      "Review recorded bills of the period that carry no sales tax for the use tax of the state where the purchases are used: each base splits by the item's own tax category in that state, and the estimate uses the state-level rate in force on the bill's date. The estimate never includes county, city or district additions, lines with no item or an open category are listed for a person to review instead of estimated, and bills in another currency are counted, never converted. Read-only: nothing accrues or posts, and use tax itself is reported and paid on the state's own return.",
    "gross-profit-by-customer":
      "Review sales, estimated cost and gross profit by customer. Compare periods and inspect cost provenance. The existing invoice-item margin rules remain unchanged.",
    "inactive-items":
      "Find items without a recorded sale for a typed number of days. Inspect the last included sale or missing-date warning. No recorded sale is different from complete sales history.",
    "account-balances-as-of":
      "Review account balances through one end date. Compare closing snapshots. Existing openings and prior posted history remain included.",
    "payment-period-by-invoice-date":
      "Review recorded settlement days for paid invoices issued in the period. Compare issue-date windows and inspect invoice labels. Later settlements remain included and partial payments are not a weighted cash model.",
    "customer-period-summary":
      "Review customer openings, invoicing, receipts, credits and closings. Search parties and compare closing balances. Loaded history must be complete before exporting this summary.",
    "supplier-period-summary":
      "Review supplier openings, bills, payments, credits and closings. Search parties and compare closing balances. Negative closings can represent overpayments.",
    "customer-balance-summary":
      "Review customer balances at the selected date. Inspect balances across customers. The existing document status, FX and credit rules determine inclusion.",
    "vendor-balance-summary":
      "Review supplier balances at the selected date. Inspect balances across suppliers. The existing bill, payment and credit rules determine inclusion.",
    "contact-balance-summary":
      "Review the combined contact balance presentation. Inspect party detail for the chosen dates. Interpret the source and timing as labelled on the report.",
    "transactions-by-customer":
      "Review customer documents and receipts for the period. Filter rows and inspect related records. Document movements are distinct from every ledger journal.",
    "transactions-by-vendor":
      "Review supplier documents and payments for the period. Filter rows and inspect related records. Existing bill and payment status rules determine inclusion.",
    "transactions-by-reference":
      "Find posted activity associated with a reference. Inspect matching source entries. A shared reference does not prove records are duplicates.",
    "sales-by-item":
      "Review issued-invoice sales and margin by item. Compare periods and inspect estimated-cost indicators. The existing report explains document-level allocation limits.",
    "inventory-valuation":
      "Review the existing inventory quantity and value presentation. Inspect items and valuation provenance. Current stock records and historical snapshots have different timing.",
    "journal-sheet":
      "Review posted journal lines for the dates. Inspect account, debit and credit detail or print the report. Drafts do not belong in the posted journal.",
    "expense-by-category":
      "Review posted expenses by account category. The read-only expense account list below maps categories to chart accounts and filters loaded bills by split lines, including archived accounts. A bill can match multiple categories, and its displayed amount remains the document total, not the selected line amount. Browser bill lists can be incomplete; the posted ledger report and bill filter are separate views.",
    "income-by-source":
      "Review posted income grouped by its reported source. Compare periods and inspect source totals. Existing account-role and posting rules determine inclusion.",
    "top-expenses-income":
      "Review the largest included expense and income lines. Compare dates and inspect their source entries. A large amount is not by itself an anomaly.",
    "monthly-averages":
      "Review the existing monthly averages. Select dates and inspect the stated month count. Partial periods require the timing interpretation shown on the report.",
    "tag-breakdown":
      "Review posted activity by tags. Inspect contributing entries and compare dates. Overlapping tags can describe the same underlying activity.",
    "ar-aging":
      "Review currently unpaid customer invoices by age. Choose the as-of date and inspect overdue documents. Current unpaid status does not reconstruct every historical open balance.",
    "ap-aging":
      "Review currently unpaid supplier bills by age. Choose the as-of date and inspect overdue documents. Current unpaid status does not reconstruct every historical open balance.",
    "general-ledger":
      "Review account openings, posted lines and running balances. Choose an account or period and inspect source journals. Openings include activity before the selected start date.",
    statement:
      "Review a party statement and included documents. Choose a customer or supplier and inspect movements and balance. Sending a statement retains the existing delivery workflow.",
    "tax-liability":
      "Review the existing sales-tax liability report. Select dates and inspect taxable amounts and tax totals. Review the report scope before using it for a tax filing.",
    "landed-cost-preview":
      "Preview how freight, duty and handling spread across a purchase order receipt's lines (or a scanned receipt draft) by line value or by quantity. The allocated extra cents sum to the exact extra cost. Preview only: nothing here posts to inventory or bills (posting stays on the receipt/bill path).",
    "delivery-notes":
      "Print or export a delivery note from a sales order, recorded delivery or invoice in English (LTR) or Hebrew (RTL), numbered in its own DN-YYYY-NNN series. Prices are hidden by default so the note lists goods only, with an option to show unit and line prices. Find a source by its document number or customer name, or filter to invoices or sales orders and deliveries; no match disables print and CSV.",
    "customer-quotes":
      "Review open, signed and expired customer estimates and proposals with their portal signing link (/e/<token>). Build and preview one-page proposals with cover letters, sections and optional add-on items. Inspect recurring estimate schedules and draft quotes due on or before the selected date. Filter by quote state and copy a follow-up draft for open or expired quotes; expired drafts request an update, and nothing is sent or saved.",
    "sales-tax-holidays":
      "The dated windows in which US states stop taxing qualifying items, each with its categories, its per-item price cap and the state's own source, plus a checker for whether an item at a price falls inside a cap on a date (delivery and handling count in the price). The calendar (A-109) shows when each state holds its window, how it sets the dates, and whether the window removes the tax or only cuts the rate — Illinois keeps 1.25% of the 6.25% state rate and all local tax, so a till that treats it as tax-free under-collects. A calendar row is not a taxability rule: the state's own list decides item by item what is covered. Read-only: nothing here posts or files, and a holiday missing from the table is never assumed absent.",
    "quote-versions":
      "Every recorded version of an estimate — who recorded it, when and what changed — with any two versions compared line by line. Record the current version before an edit to keep the old content or after one to keep the new; recording the same content twice writes nothing, and content that was never recorded cannot be recovered. The customer portal always shows the estimate as it is now and says which version that is.",
    "blanket-orders":
      "A blanket order is an agreement — a total and a validity period — that several goods receipts and vendor bills draw down. Only documents explicitly linked to the order count, and a delivery recorded both ways is one delivery, so used takes the higher of the received and billed totals; both totals sit beside it and a bill in another currency is never added in. Mark an order here (an owner, accountant or bookkeeper) and edit its validity or agreed total in place; nothing here posts.",
    "mileage-rates":
      "IRS business standard mileage rates by date, with the 2022 mid-year increase. Check a date to see the rate in force. This is a dated reference from the IRS page; an expense claim still records the rate the person typed. Nothing here posts, files or calculates tax — it is calculation status only and 2026 is provisional until the 2026 IRS Notice is checked.",
    "israel-self-employment-ni":
      "The self-employed National Insurance and health-insurance rates by income band and date, from the Authority's own pages, with the monthly advance and the section-345 settlement side by side because they are different figures. Type an income to see both. This is a dated reference and calculation status only: it is not the Authority's assessment (which is made on the annual figure), it does not cover a person who is also an employee, a minor or of retirement age, and nothing here posts, files or pays.",
    "israel-advance-tax":
      "Statutory Israeli advance income-tax payment (מקדמות מס הכנסה) calendar by year and frequency (monthly or bi-monthly), under Section 175 of the Income Tax Ordinance. Shows statutory due dates (15th of the month following the period) and automatic postponements when deadlines fall on Friday or Shabbat. Pulls the entity's declared advance rate from Settings → Tax profiles and calculates estimated payments on turnover. Calculation and planning status only: rates are determined by the Tax Authority, and nothing here posts, files, assesses or pays.",
    "us-nexus-watch":
      "Each US state your customers are in, from the posted invoices less credit notes: sales before sales tax and the number of sales this calendar year and last, against the state's economic-nexus threshold, with a flag at 80%. States measure differently, so this is a watch for a conversation with your accountant, never a conclusion that you must register. TX, CA, NY, WA and CO are checked and other states are shown not verified; nothing here files, posts or registers. A customer without a tax place is in no state until you add one.",
    "banking-validation":
      "Check a US routing number (9 digits, checksum) and an IBAN (country length and mod-97). This is a data-quality check only — calculation status — not a bank confirmation, and it never posts or moves money. IBAN lengths are from the SWIFT IBAN Registry (ISO 13616); the table and its CSV list 86 countries. A country not listed does not use IBAN or is not in this table.",
  },
  settings: {
    "tax-profiles": "Review declared country, place, accounting basis and registrations for the books and each label value. Grey values inherit from the nearest parent or the books. Owners and accountants edit supported profile fields here; save confirms the server response and keeps the draft on refusal. A saved declaration is not a verified registration or a completed tax filing.",
    "scheduled-reports":
      "Choose a report to be emailed by itself after each finished week or month: the profit and loss, the balance sheet or receivables aging. The figures are in the email with a spreadsheet attached, and each period is sent once. Send now emails the last finished period straight away.",
    alerts:
      "Choose what the nightly check tells owners and accountants about the books: a reminder to close last month from a chosen day, an account over its budget, and cash below a chosen amount. Each is told once, in the bell. Alerts never change the books.",
    groups:
      "Group the workspaces you can open, such as a holding and its companies or your clients by kind. Only you see your groups, and a workspace in a group stays exactly as it is: its books, people and rules do not change. Removing a group never removes a workspace.",
    currencies:
      "The workspace's own currency and every other currency its invoices and bills use: how many, how many are still open, and the last rate posted and when. Each document keeps the rate it was posted at. The month-end revaluation of what is still open is here too.",
    "price-lists":
      "Prices for some customers, such as wholesale: a discount on every item, or a price of its own for some items, and the customers on the list (one list each). On their invoices and estimates, picking an item fills the list's price, which can still be changed on the line; nothing already posted changes. Owners and accountants keep them.",
    "price-list-import":
      "Import prices per item and list from a spreadsheet (CSV): the file is read first, rows that cannot be read are named by their record number and left out, and the preview shows the change before anything is saved. Saving uses the same server path and the same rules as Price lists, and Undo restores the lists exactly as they were. Owners and accountants import; a guest workspace can read and preview but not save.",
    "custom-fields":
      "Extra fields your business needs on customers, vendors and items: text, number, date or a choice. The definitions live on this workspace, and each record's value lives on the record itself and shows in the values list and the CSV export here. A choice field keeps only its listed options, and a missing value stays missing rather than being invented. Nothing here changes an amount, a quantity or a posting; owners and accountants change the definitions and the values.",
    "sales-reps":
      "Each sales rep's commission percentage and the customers they look after, one rep per customer. Their commission on what those customers pay, before tax, is in the Sales commission report. Nothing is posted. Owners and accountants keep them.",
    stages:
      "Your own steps for invoices and bills, one per line in order, such as bills: Received, Checked, Ready to pay. Each invoice and bill then shows its stage on its row, where owners, accountants and bookkeepers change it. A stage changes nothing in the books or in what is paid. Owners and accountants keep the stages.",
    "split-rules":
      "Saved ways to split a cost between accounts or labels, e.g. rent 60/40 between two properties. A rule is suggested on a bill whose vendor or description contains its text, says why, and only changes the lines on screen when applied; nothing is posted by a rule. Owners and accountants keep them.",
    modules:
      "Choose which sets of screens this workspace uses: quotes, purchase orders, payroll, fixed assets, loans, petty cash, intercompany, forecasting and the query builder. A module turned off leaves the menu and the page search; nothing in it is deleted, and turning it back on shows everything again. Owners and accountants change them.",
    tags:
      "Review every tag used in the workspace and how many customers, vendors, projects, documents and entries carry it. Rename a tag everywhere at once, merge two by giving one the other's name, or remove a tag from every record. Only the tags change; amounts and entries stay as they are.",
    "incoming-events":
      "Review what Stripe and the email provider reported for this workspace and what came of it. Check whether an online card payment was recorded, is waiting for the bank or was refused, and whether an email was delivered or bounced. Nothing here changes any record.",
    rules:
      "Manage classification and automation rules. Inspect conditions, test matches and use the existing save or apply workflow. Review proposed matches before applying changes.",
    dimensions:
      "Manage workspace axes and labels. Edit supported names or add label nodes. Stable IDs remain unchanged and previous names can remain aliases.",
    appearance:
      "Choose display preferences. Adjust the available theme and density controls. These preferences change presentation rather than posted records.",
    team: "Manage workspace members and invitations. Owners can use the existing invite, role and removal workflow. Only an owner can change workspace membership.",
    billing:
      "Review the workspace plan and billing controls. Use the existing subscription workflow to request changes. A displayed plan does not prove a payment provider accepted a change.",
    templates:
      "Review workspace templates. Inspect a template before applying its chart of accounts. Applying a template changes the workspace.",
    security:
      "Review account and workspace security controls. Use available sign-in, second-factor and session workflows. Confirm sensitive changes before applying them.",
    rule: "Review AI and copilot preferences. Change available controls and inspect their descriptions. Generated advice remains separate from authorized financial writes.",
    developer:
      "Manage API keys and webhook controls. Review scopes and endpoints before making changes. Only authorized members can manage credentials and integrations.",
    import:
      "Import contacts, items or accounts from CSV or Excel. Map columns, preview problems and submit valid rows. This workflow accepts supported fields and creates identities rather than restoring a complete backup.",
    emails:
      "Configure document emails, reminders and invoice approval. Review delivery preferences and the existing send workflow. Sending rules do not change invoice posting.",
    branding:
      "Configure branding and document appearance. Review workspace details and PDF previews. Branding changes do not alter invoice amounts.",
    numbering:
      "Configure document numbering series. Inspect prefixes and sequence controls. New documents receive the next number when they are saved.",
    defaults:
      "Review the accounts used by supported posting workflows. Choose an account or retain automatic role resolution. Posting validation still checks the selected account.",
    schedule:
      "Inspect the daily job schedule and recorded runs. Review status, timing and reported failures. A displayed schedule does not prove a provider action succeeded.",
    export:
      "Download a verified backup or choose a data export. Select posted ledger lines, complete record fields or a base-currency bank account and period. CSV import retains field and identity limits while full restoration uses the verified JSON workflow.",
    shortcuts:
      "Review documented keyboard shortcuts. Find navigation and screen-specific commands. Typing fields and dialogs retain their own keyboard behavior.",
  },
  intelligence: {
    intelligence:
      "Explore the registered intelligence screen. Choose an available tool and inspect its inputs and explanation. An analytical score is not a confirmed accounting fact.",
  },
  lenses: {
    forensics_1:
      "Explore anomaly tools in the shared catalog. Choose an algorithm and inspect source data and assumptions. A high score is a review signal rather than proof of fraud.",
    forensics_2:
      "Explore categorization checks in the shared catalog. Review algorithm suggestions against source records. A suggested category does not authorize a posting change.",
  },
  extra: {
    architecture:
      "Explore the application architecture map. Inspect data, algorithm and view layers. The map describes software structure rather than financial results.",
    audit:
      "Inspect the forensic audit presentation. Review source activity and signal explanations. A finding is a reason to investigate rather than proof of fraud.",
    "time-machine":
      "Explore the historical ledger presentation. Choose available dates and inspect included activity. Missing loaded records can leave the view incomplete.",
    ask: "Explore the question-driven ledger workflow. Review interpreted requests and source records. Financial changes require their normal authorized action.",
    magic:
      "Use assisted transaction entry. Review the interpreted amount, accounts and description before saving. A suggestion is not already a posted entry.",
    taxes:
      "Manage tax definitions and inspect tax workflows. Review rates and component rules before changing them. Review resulting tax totals on the affected documents.",
    consolidation:
      "Inspect consolidation across entities. Review selected entities and source account activity. A displayed elimination does not itself post a journal.",
    "accept-invite":
      "Review a workspace invitation. Sign in and accept a valid invitation using its existing workflow. Only a valid invitation can grant workspace access.",
  },
};
export function withScreenHelp<T extends { id: string }>(
  entries: T[],
  group: string,
): (T & { help: string })[] {
  return entries.map((entry) => ({
    ...entry,
    help: SCREEN_HELP[group]?.[entry.id] || "",
  }));
}
