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
      "Review customer receipts grouped by stored payment method. Compare periods and inspect undated receipt counts. Unapplied receipts are not automatically sales revenue.",
    "exchange-rates-used":
      "Review exchange rates stored on workspace documents and entries. Choose dates and inspect the rates actually used. Historical rates on records are distinct from current market quotes.",
    "open-advances":
      "Review customer deposits and vendor prepayments not yet applied to an invoice or bill, oldest first. See how long each has waited and which contacts hold the most. Apply them from the customer's or vendor's page.",
    "deferred-revenue-waterfall":
      "Review scheduled revenue earned by month and still deferred at the period end. Inspect each schedule and its recorded earned amounts. Future scheduled amounts remain distinct from posted earned revenue.",
    "financial-ratios":
      "Review financial ratios together with their formulas. Adjust report-only current-account groups and compare periods. Zero denominators are undefined and turnover days use labelled revenue or COGS proxies.",
    "discount-mismatch":
      "Compare issued invoice unit prices in the selected period with current customer price lists or item catalogue prices. Refresh complete invoice/item reads before CSV. Current prices do not prove historical discount entitlement; foreign currencies, document-wide discounts and unknown item references are excluded.",
    "vendor-scorecard":
      "Review each vendor's on-time delivery (first goods receipt against the expected date), unit-cost changes per item in the bill's own currency, and returns sent back in the period. Read-only: nothing is posted, and a vendor with no dated orders shows no on-time rate rather than 100%.",
    "expense-policy-check":
      "Check expense claims dated in the period against the workspace's own expense policy rows: a maximum per line and the amount from which a receipt is needed. The maximum is inclusive; the receipt count is not read on this screen, so a needed receipt is listed as not checked here, never as missing. Read-only: nothing is approved, changed or posted, and claims in another currency keep their own currency.",
    "cycle-count":
      "Count one place at a time: the sheet lists the items the stock-moves ledger puts there with the expected quantity and each item's own cost, you enter what you counted, and the sheet shows the variance in units and its value. A blank row is never read as zero and a row whose stock history does not explain its quantity is flagged, so the count is not blamed. Marking a sheet ready only records who checked it: posting the adjustment is the Inventory stock count (the server writes the entry and the history), and sheets are not saved to the workspace yet.",
    "registration-threshold-watch":
      "Compare posted revenue lines tagged with supported activity values against dated Israel, UK, Canada and EU-wide thresholds, grouped by a chosen entity dimension and country from Tax profiles. Sales are compared only when the workspace base currency matches the threshold currency; missing labels, incomplete history and statutory scope outside ledger data prevent a registration decision. This read-only report keeps its period windows and official sources visible and never posts or converts sales.",
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
      "Review posted expenses by account category. Compare periods and inspect contributing accounts. Categories come from the workspace chart of accounts.",
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
