# What would let LedgerFlow charge twice as much

Research note, 11 Nov 2026. Market figures come from a web search on that date and are mostly from
third-party comparison sites, not vendor price lists, so treat them as rough. Code facts come from
this repository at `main`. Sources are listed at the end.

## The finding in one paragraph

Adding features to a general small-business bookkeeping product does not double its price; that
market is anchored by QuickBooks at $38 to $340 a month and by Israeli invoicing tools at about
29 to 54 ₪ a month. Prices jump when one of three things changes: **who the buyer is** (an accounting
firm, a group of companies, a landlord), **what unit is billed** (per client, per entity, per rental
unit, per payment), or **what result is proven** (how much work was removed, that the books can be
trusted). LedgerFlow already holds most of the code for three of these moves. The work is to finish
one of them and price by its unit.

## What the market pays today

| Buyer | Product | Reported price | Billed by |
|---|---|---|---|
| Small business | QuickBooks Online | $38 / $85 / $140 / $340 a month | plan |
| Small business, Israel | Green Invoice, iCount | about 29 to 54 ₪ a month | plan |
| Group of companies | Intuit Enterprise Suite | est. $7,800 a year for one entity, $12,000 to $15,000+ for several | entity |
| Mid-market finance team | Sage Intacct | starts near $10,000 to $15,000 a year; $50,000 to $200,000 for multi-entity | user, entity, module |
| Landlord | Buildium | $62 to about $400 a month | plan |
| Landlord | AppFolio | $1.40 to $5 per unit a month, about $298 minimum | rental unit |
| Non-profit | Aplos | $79 to $229+ a month | plan |
| Accounting firm | Double (formerly Keeper) | $10 / $25 / $50 per client a month | client |
| Accounting firm | Digits | earlier listed $35 to $250 per client a month; now charges firms only when 95% or more of transactions need no human touch | client, outcome |
| Anyone paying bills | Bill | reported take of about 0.31% of payment volume | payment |

Three things stand out.

1. **The step from one company to several is the largest price step in the market.** QuickBooks
   Online Advanced handles one company. The next rung costs roughly 25 to 40 times more a year.
2. **Accounting firms pay per client**, and one firm brings tens or hundreds of clients.
3. **The newest pricing is tied to a measured result.** Digits bills firms only above a 95%
   no-touch rate. Investors have put over $100 million each into Rillet, Basis and Campfire on the
   same idea: fewer hours of accounting work.

## Seven strategies

Each says why it supports a higher price, what the code already has, and what to build.

### 1. Sell to accounting firms, per client, with a measured automation rate

**Why it pays.** Per-client pricing of $10 to $50 a month is established, with up to $250 reported
for a full ledger. Fifty clients at $25 is $1,250 a month from one sale.

**What you have.** A multi-client practice view (`src/components/dashboard/PracticeView.tsx`), a
month-end close with editable steps and sign-offs, workpapers per account, questions to clients,
roles, and an audit evidence pack.

**What to build.**
- **A no-touch rate per client.** Nothing in the code measures it today. Count the bank lines posted
  from a rule or from history that no person then changed, divided by all bank lines. Show it per
  client and for the firm. This number is what the price is attached to.
- **Calibrated automatic posting.** Post without review only where the past record supports it: for
  each payee, track how often the suggestion was accepted unchanged, and auto-post only above a set
  rate (for example 99% over at least ten cases). Everything else goes to review with its reason.
- **Decide once, apply to many.** Group unreviewed lines that look alike so one decision settles
  forty lines. The text similarity code for this exists (`src/lib/algorithms/tf-idf.ts`,
  `src/lib/algorithmInternals/similarity.ts`).
- **Connect the algorithms that are written and unused:** rule induction, recurrence detection,
  subset-sum matching, find-my-error and continuous close (all in `src/lib/algorithms/`).
- **A close-readiness score** per client: unreconciled lines, open questions, data problems, drafts.

### 2. Become the step between QuickBooks and Sage Intacct

**Why it pays.** This is the largest gap in the table, and it is exactly what LedgerFlow's design is
about: several companies, and any number of dimensions on every line.

**What you have.** Labels with accounting roles including self-balancing ones
(`src/lib/labelRoles.ts`), a balance sheet per label, intercompany screens, a group report with
eliminations and currency translation, and a verified group workflow (W12 in `RELEASE_GATE.md`).

**What to build.**
- **Automatic balancing between label values.** When one entry moves money between two properties
  or two companies, add the "due to" and "due from" lines automatically so each side balances alone.
  QuickBooks has no equivalent; this is the feature that makes a balance sheet per property real.
- **Mirror entries between related books.** Post an intercompany charge in one company and the
  matching entry appears in the other, linked by one shared id. The pairing logic exists and is
  unused (`src/lib/algorithms/shared-transaction-identity.ts`).
- **Eliminations that prove themselves:** a report showing every eliminated pair and any that do not
  match.
- **Ownership percentages** in consolidation, and a board showing which company has closed which month.

**Price by entity:** a base price that includes one company, and a fee for each further one.

### 3. Pick one trade and price by its unit

**Why it pays.** A landlord with 200 units pays AppFolio about $300 to $1,000 a month, and
understands "per unit" immediately.

**Property is the closest fit.** You have Property and Unit as labels, profit per property, and a
balance sheet per label. Missing, as far as I could find: a rent roll, a ledger per tenant, owner
statements (no file mentions them), and separate handling of security deposits held in trust.

**Non-profits are second.** A self-balancing Fund label is fund accounting, and a grant spend-down
calculation exists in the algorithm list. Missing: a statement of functional expenses and release
of restrictions.

**A third option that is yours alone:** a business that files in both the United States and Israel.
The repository carries both tax engines and a verified workflow for each (W7 and W8). I did not
find evidence either way on whether competitors serve both in one product; it is worth five phone
calls to cross-border accountants to find out.

### 4. Take a share of the money that moves

**Why it pays.** It raises income per customer without raising the subscription. Reported shares
run from about 0.3% of volume for bill payment to 0.5% to 1% for platforms that embed payments, and
Xero paid $2.5 to $3 billion for a bill-payment company.

**What you have.** Card payment on the emailed invoice through Stripe, payment runs to vendors, and
Israeli bank code validation.

**What to build.** A platform fee on each card payment through Stripe's own mechanism for platforms,
pay-by-bank on the invoice link, and paying vendors from inside a payment run. Use a licensed
processor for all of it; moving money yourself brings licensing obligations.

### 5. Sell proof

**Why it pays.** Lenders, auditors and investors pay for books they do not have to re-check, and a
business with a loan covenant or an audit will pay to hand them over ready.

**What you have.** "Explain this number" down to the entries, an audit evidence pack, period locks,
reconciliation reports, and tests with hand-worked figures.

**What to build.**
- **A tamper-evident audit chain.** Each audit entry carries a hash of the one before, so any
  removal or change is detectable. Agent #6's audit notes this is absent, and a nightly hash anchor
  exists only as an unused algorithm (`src/lib/algorithms/continuous-close.ts`).
- **A lender-ready package:** statements, the reconciliation for each bank account, ageing, and a
  page stating what was checked and when.

**This one has a precondition.** The audit in `audit/claude-2026-11-11/` found that a writer can
change ledger tables directly. Proof cannot be sold until that is closed.

### 6. Answer the owner's real questions

"Can I afford to hire?", "When will I run out?", "Who will pay late?" A 13-week cash forecast and a
tax set-aside card exist. Add learned days-to-pay per customer and what-if scenarios, and sell it as
a higher plan. This is a smaller step than the others: an add-on, not a new buyer.

### 7. Change what the plans count

The plans in the code limit the number of entries and people (`src/server/middleware/planCapacity.ts`). The entry limit
charges people for using the product more and penalises the automation you want to sell. Count
companies, clients, units or payment volume instead: things that grow with the customer's own income.

## What I would do

**Strategy 1 first, then strategy 2 as the upgrade.**

- The firm channel needs the least new code; the practice view, close and workpapers are built.
- One sale brings many books, and per-client pricing is already normal in that market.
- A measured no-touch rate is where the market is heading, and you can show the number.
- Firms' clients include groups of companies, which is where strategy 2 sells itself.

## What will not do it

More reports and more calculators. There are about 167 report and tool views already, and seven
finished algorithms that no screen uses. Another one changes nothing about who buys or what they pay.

## Honest limits

- Every strategy here is a hypothesis until five real buyers in that segment say they would pay. Do
  those conversations before building.
- Buyers who pay more check more. A firm or a group will ask about the audit trail, direct database
  writes and reports worked out in the browser. Those three (see `audit/claude-2026-11-11/`) are
  preconditions for any of the higher prices.
- The prices above are other vendors' reported figures on one day, mostly second-hand.

## Sources

- [QuickBooks Online pricing after the August 2026 increase (auditfriendly.co)](https://auditfriendly.co/answers/quickbooks-online-price-increase-2026)
- [QuickBooks pricing 2026 (NerdWallet)](https://www.nerdwallet.com/article/small-business/business-software/how-much-does-quickbooks-cost)
- [Sage Intacct pricing guide (BPM)](https://www.bpm.com/insights/sage-intacct-pricing/)
- [Sage Intacct pricing (G2)](https://learn.g2.com/sage-intacct-pricing)
- [Sage Intacct pricing 2026 (Octura)](https://octurasolutions.com/resources/sage-intacct-pricing-2026-what-it-really-costs-and-alternatives)
- [Intuit Enterprise Suite pricing 2026 (ERP Research)](https://erpresearch.com/en-us/intuit-enterprise-suite-pricing)
- [QuickBooks Online vs Intuit Enterprise Suite (Certum)](https://www.certumsolutions.com/library/quickbooks-online-vs-intuit-enterprise-suite)
- [Buildium vs AppFolio pricing 2026 (CostBench)](https://costbench.com/compare/buildium-vs-appfolio/)
- [AppFolio vs Buildium (TenantCloud)](https://www.tenantcloud.com/review/appfolio-vs-buildium)
- [Best accounting software for non-profits 2026 (Dupple)](https://dupple.com/learn/best-accounting-software-nonprofits)
- [Green Invoice pricing](https://www.greeninvoice.co.il/pricing)
- [Double (formerly Keeper) pricing (G2)](https://www.g2.com/products/double-double/pricing)
- [Karbon vs Double buyer's guide 2026](https://ustechautomations.com/resources/blog/karbon-vs-double-for-accounting-firms-2026)
- [Digits announces outcome-based pricing (Accounting Today)](https://www.accountingtoday.com/news/digits-announces-outcome-based-pricing)
- [Digits outcome-based pricing (CPA Practice Advisor)](https://www.cpapracticeadvisor.com/2026/04/07/digits-announces-outcome-based-pricing-for-accounting-firms/181110/)
- [Digits pricing history (usagepricing.com)](https://usagepricing.com/blueprint/digits)
- [Rillet's raise (CPA Trendlines)](https://cpatrendlines.com/2026/08/24/rillets-raise-100-million-bets-on-fewer-accountants/)
- [AI accounting startups by funding (New Market Pitch)](https://newmarketpitch.com/blogs/news/ai-accounting-top-startups-fundraising)
- [Bill Q4 FY2025 earnings call (Alpha Spread)](https://www.alphaspread.com/security/nyse/bill/investor-relations/earnings-call/q4-2025)
- [Why Xero bought Melio (Benzinga)](https://www.benzinga.com/m-a/25/07/46419726/why-xero-took-a-2-5-billion-bet-on-this-b2b-payments-startup)
- [Embedded finance for vertical SaaS (Apideck)](https://www.apideck.com/blog/embedded-finance-vertical-saas)
