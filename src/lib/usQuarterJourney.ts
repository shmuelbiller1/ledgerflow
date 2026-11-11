/**
 * A-153 (P2-4): the US quarter journey — one read-only path from sales tax by state, through the
 * return screens and the 1099 preview, to closing the quarter's months.
 *
 * Every figure is computed by the existing pure library the screen already uses, so the journey
 * shows the same numbers that screen shows and no second rule is invented here:
 * - permits and the state returns: `usSalesTaxReturn` (the seller's permit on the invoice date, the
 *   buyer's state, the invoice's own saved tax breakdown; credit notes reduce the period they fall in)
 * - when a return is usually due: `filingDueDate` (the A-28 planning calendar; a weekend moves, a holiday does not)
 * - use tax on purchases: `reviewUseTax` (A-29)
 * - exemption certificates: `exemptionOn` (T-05)
 * - 1099: `vendor1099Readiness` (A-188), which reads the same threshold table as the 1099 preview (E-10)
 *
 * What this is: a checklist of what the recorded data shows for one quarter, and which screen does
 * the work. What it is not: a filing, a payment, a posting, a close, or a conclusion that a return
 * is owed. It never says "you must file" — the state assigns the frequency, the sourcing rules and
 * the deadline, and nothing here knows a holiday, a marketplace facilitator, a local return or a
 * transaction-count nexus test. Read-only; money is whole cents in the workspace currency.
 */
import { COUNTED_SALES } from './taxCodes';
import { exemptionOn } from './taxExemption';
import {
  registrationsOn, registrationKey, resolveSellerProfile,
  type FilingFrequency, type TaxProfiles,
} from './tax/profile';
import { filingCalendarRow, filingDueDate } from './tax/usFilingCalendar';
import { nexusThreshold } from './tax/usNexus';
import { usSalesTaxReturn, usSaleDestination, type UsSalesDocument } from './tax/usSalesTaxReturn';
import { documentEntityLabels } from './tax/ilVatReturn';
import { NO_STATE_SALES_TAX, US_STATE_SALES_TAX } from './tax/usStateSalesTax';
import { reviewUseTax, type UseTaxBill, type UseTaxItem, type UseTaxReview } from './tax/usUseTax';
import { productTaxabilityRows } from './tax/usProductTaxability';
import { effectiveTaxCategory } from './tax/taxCategories';
import {
  vendor1099Readiness,
  type ReadinessPayment, type ReadinessVendor, type VendorReadinessReport,
} from './vendor1099Readiness';

export type UsQuarterStepId = 'permits' | 'state-returns' | 'use-tax' | 'certificates' | 'form-1099' | 'close';
export type UsQuarterStepStatus = 'done' | 'attention' | 'not-applicable';
export type UsPeriodCloseState = 'open' | 'soft' | 'hard' | 'partly-open';

/** A figure on the journey: money in whole cents, or a count of things. */
export interface UsQuarterFigure {
  label: string;
  /** whole cents of the workspace currency */
  cents?: number;
  /** a count of documents, permits or months — shown as a number, never as money */
  count?: number;
  note?: string;
}

/** One state's return for the quarter, as the return screen computes it. */
export interface UsQuarterStateReturn {
  registration: string;
  permitNumber: string;
  state: string;
  stateName: string;
  startDate: string;
  endDate: string;
  grossSalesCents: number;
  exemptSalesCents: number;
  taxableSalesCents: number;
  taxCollectedCents: number;
  documentCount: number;
  /** the tax by part, as the invoices saved it ("Texas state sales tax", "Austin") */
  byJurisdiction: Array<{ name: string; taxCents: number }>;
  /** the planning-calendar due date, moved off a weekend; undefined for a state with no state return */
  dueDate?: string;
  /** what the calendar row says about the frequency and the deadline */
  dueNote?: string;
  /** the caller recorded this return (or the whole quarter) as filed */
  filed: boolean;
  /** the state's economic-nexus sales threshold in force at the quarter end, when it has one */
  nexusThresholdCents: number | null;
  /** the quarter's gross sales into the state reach that threshold (the sales test only) */
  nexusSalesReached: boolean;
}

/** A step on the journey: what to do, which screen does it, and what the data says now. */
export interface UsQuarterStep {
  id: UsQuarterStepId;
  title: string;
  /** plain words: the work itself */
  what: string;
  /** the registry screen (tab id) that does this step */
  screen: string;
  /** which tab the screen lives on: 'reports', 'settings' or a main tab */
  tab: string;
  screenLabel: string;
  status: UsQuarterStepStatus;
  /** what the recorded data shows, in words */
  detail: string;
  figures: UsQuarterFigure[];
  /** this quarter's state returns, one per permit (the state-returns step) */
  returns: UsQuarterStateReturn[];
}

/** The quarter itself: its dates, months and tax year. */
export interface UsQuarterPeriod {
  quarter: string;
  year: number;
  /** 1–4 */
  q: number;
  startDate: string;
  endDate: string;
  /** the calendar months of the quarter, '2026-07' */
  months: string[];
  /** the tax year the quarter falls in (the 1099 preview is a year-end view) */
  taxYear: number;
}

export interface UsQuarter extends UsQuarterPeriod {
  steps: UsQuarterStep[];
  done: number;
  attention: number;
  /** no step needs attention: the quarter's recorded work is complete */
  readyToClose: boolean;
  /** the first step that still needs attention, in journey order */
  nextStep?: UsQuarterStepId;
  problems: string[];
}

export interface UsQuarterPermit {
  registration: string;
  permitNumber: string;
  state: string;
  stateName: string;
  /** the profile it came from: 'books' or a label key */
  from: string;
  filing?: FilingFrequency;
}

export interface UsQuarterInput {
  /** '2026-Q3' */
  quarter: string;
  /** today, YYYY-MM-DD: used only to say whether a due date has passed */
  today: string;
  /** the workspace currency label; every figure is whole cents of it */
  currency?: string;
  profiles?: TaxProfiles | null;
  /** label order for the seller profile, the World/Entity dimension first (as on the invoice screens) */
  order?: string[];
  customers?: Array<{ id: string; metadata?: unknown }>;
  invoices?: UsSalesDocument[];
  creditNotes?: UsSalesDocument[];
  bills?: UseTaxBill[];
  items?: UseTaxItem[];
  vendors?: ReadinessVendor[];
  payments?: ReadinessPayment[];
  /** the close state of each month of the quarter; a month not listed is open */
  periods?: Array<{ month: string; state: UsPeriodCloseState }>;
  /** registration keys, or the whole quarter, the caller has recorded as filed */
  filedReturns?: string[];
  /**
   * Filed returns the server keeps for this workspace (the same record the return screen lists):
   * a return recorded for exactly this period counts as filed, whichever permit it was for.
   */
  filedPeriods?: Array<{ startDate: string; endDate: string }>;
  /** the state the use-tax review is run for; defaults to the first permit state of the quarter */
  useTaxState?: string;
}

const QUARTER_TEXT = /^(\d{4})-Q([1-4])$/;
const MONTH_LENGTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const pad = (n: number) => String(n).padStart(2, '0');

/** '2026-Q3' → its dates and months, or undefined when the text is not a quarter. */
export function usQuarterOf(text: string): UsQuarterPeriod | undefined {
  const found = QUARTER_TEXT.exec(String(text || '').trim());
  if (!found) return undefined;
  const year = Number(found[1]);
  const q = Number(found[2]);
  if (year < 2000 || year > 2099) return undefined;
  const first = (q - 1) * 3 + 1;
  const lastMonth = first + 2;
  const length = MONTH_LENGTH[lastMonth - 1] + (lastMonth === 2 && isLeap(year) ? 1 : 0);
  return {
    quarter: `${year}-Q${q}`, year, q,
    startDate: `${year}-${pad(first)}-01`,
    endDate: `${year}-${pad(lastMonth)}-${pad(length)}`,
    months: [0, 1, 2].map(i => `${year}-${pad(first + i)}`),
    taxYear: year,
  };
}

/** What is wrong with a quarter or a date written by hand, or null. */
export function usQuarterProblem(quarter: string, today = ''): string | null {
  if (!usQuarterOf(quarter)) return 'A quarter is written as 2026-Q3.';
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) return 'Today is a YYYY-MM-DD date.';
  return null;
}

const stateNameOf = (state: string) =>
  filingCalendarRow(state)?.stateName || US_STATE_SALES_TAX.find(r => r.state === state)?.stateName || state;

/** The US sales-tax permits in force on the quarter's last day, one per registration. */
export function usQuarterPermits(profiles: TaxProfiles | null | undefined, endDate: string): UsQuarterPermit[] {
  const out: UsQuarterPermit[] = [];
  const seen = new Set<string>();
  const all: Array<[string, NonNullable<TaxProfiles['books']>]> = [
    ...(profiles?.books ? [['books', profiles.books] as [string, NonNullable<TaxProfiles['books']>]] : []),
    ...Object.entries(profiles?.labels || {}).map(([key, profile]) => [key, profile] as [string, NonNullable<TaxProfiles['books']>]),
  ];
  for (const [from, profile] of all) {
    for (const registration of registrationsOn(profile, 'sales_tax', endDate)) {
      if (registration.place?.country !== 'US') continue;
      const key = registrationKey(registration);
      if (seen.has(key)) continue;
      seen.add(key);
      const state = String(registration.place.state || '').toUpperCase();
      out.push({
        registration: key, permitNumber: registration.number, state, stateName: stateNameOf(state), from,
        ...(registration.filing ? { filing: registration.filing as FilingFrequency } : {}),
      });
    }
  }
  return out.sort((a, b) => a.state.localeCompare(b.state) || a.permitNumber.localeCompare(b.permitNumber));
}

/** Money text for a detail line; the screen formats with the workspace currency. */
function money(cents: number, currency: string): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}${(Math.abs(cents) / 100).toFixed(2)} ${currency}`;
}

const CLOSED: UsPeriodCloseState[] = ['soft', 'hard', 'partly-open'];

/**
 * The quarter's journey. Pure: it reads only what it is given, changes nothing and posts nothing.
 */
export function usQuarterJourney(input: UsQuarterInput): UsQuarter {
  const quarter = usQuarterOf(input.quarter);
  const problems: string[] = [];
  if (!quarter) problems.push(usQuarterProblem(input.quarter) || 'A quarter is written as 2026-Q3.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.today || ''))) problems.push('Today is a YYYY-MM-DD date.');
  const startDate = quarter?.startDate || '';
  const endDate = quarter?.endDate || '';
  const months = quarter?.months || [];
  const taxYear = quarter?.taxYear || Number(String(input.today).slice(0, 4)) || 2026;
  const profiles = input.profiles || null;
  const order = input.order || ['world'];
  const customers = input.customers || [];
  const invoices = input.invoices || [];
  const creditNotes = input.creditNotes || [];
  const currency = input.currency || 'USD';
  const filed = new Set(input.filedReturns || []);
  const quarterKey = quarter?.quarter || '';

  // 1. the permits in force: without one there is no state return to prepare
  const permits = usQuarterPermits(profiles, endDate);

  // 2. the state returns, one per permit, from the quarter's invoices and credit notes
  // AF-004 (#518): US sales with no state are in no return. A seller with two permits sees the same sale under both,
  // and two sellers have different ones, so the distinct documents are counted once each.
  const unplacedDocuments = new Map<string, number>();
  const returns: UsQuarterStateReturn[] = permits.map(permit => {
    const r = usSalesTaxReturn({
      registration: permit.registration, profiles, order, customers, startDate, endDate,
      invoices, creditNotes,
    });
    for (const d of r.unplaced.documents) unplacedDocuments.set(d.id, d.taxCents);
    const calendar = filingCalendarRow(permit.state);
    const dueDate = filingDueDate(permit.state, endDate);
    const nexus = nexusThreshold(permit.state, endDate);
    const threshold = nexus?.salesThresholdCents ?? null;
    return {
      registration: permit.registration,
      permitNumber: permit.permitNumber,
      state: permit.state,
      stateName: permit.stateName,
      startDate, endDate,
      grossSalesCents: r.grossSalesCents,
      exemptSalesCents: r.exemptSalesCents,
      taxableSalesCents: r.taxableSalesCents,
      taxCollectedCents: r.taxCollectedCents,
      documentCount: r.documentCount,
      byJurisdiction: r.byJurisdiction,
      ...(dueDate ? { dueDate } : {}),
      ...(calendar?.note ? { dueNote: calendar.note } : {}),
      filed: filed.has(permit.registration) || filed.has(quarterKey)
        || (input.filedPeriods || []).some(f => f.startDate === startDate && f.endDate === endDate),
      nexusThresholdCents: threshold,
      // the state's own wording: New York's "more than" is not reached at exactly the threshold
      nexusSalesReached: threshold !== null && (nexus?.strict ? r.grossSalesCents > threshold : r.grossSalesCents >= threshold),
    };
  });
  const unfiled = returns.filter(r => !r.filed && (r.taxCollectedCents !== 0 || r.documentCount > 0));

  const unplaced = { documentCount: unplacedDocuments.size, taxCents: [...unplacedDocuments.values()].reduce((sum, cents) => sum + cents, 0) };
  if (unplaced.documentCount > 0) {
    problems.push(`${unplaced.documentCount} US sale${unplaced.documentCount === 1 ? ' has' : 's have'} no state on the invoice or the customer, with ${(unplaced.taxCents / 100).toFixed(2)} of tax: ${unplaced.documentCount === 1 ? 'it is' : 'they are'} in no state's return. Add the state to the customer or the invoice.`);
  }

  // 3. use tax on purchases used in the permit state
  const useTaxState = (input.useTaxState || permits[0]?.state || '').toUpperCase();
  const useTax: UseTaxReview | null = useTaxState
    ? reviewUseTax({
      bills: input.bills || [], items: input.items || [], state: useTaxState,
      from: startDate, to: endDate, homeCurrency: currency,
    })
    : null;

  // 4. the exemption certificates behind this quarter's zero-tax sales. The membership rule is the
  //    state return's own (counted status, the period, the seller's permit, the buyer's state with
  //    the seller's place as the over-the-counter fallback), so the two counts agree; credit notes
  //    are a reversal of a sale, not a new one, and are not counted here.
  //    W8-GOLD: a sale whose every line is a loaded item in a category the state's own table exempts on the date
  //    (Texas groceries) needs no certificate — the exemption is the product's, not the buyer's. A line with no
  //    item, or an item not loaded, still counts, so a missing certificate is never hidden.
  const customersById = new Map(customers.map(c => [c.id, c]));
  const itemCategory = new Map((input.items || []).map(item => [item.id, effectiveTaxCategory(item.productTaxCategory)]));
  const exemptByProduct = (doc: UsSalesDocument, state: string, date: string) => {
    const lines = (doc as { items?: Array<{ itemId?: string }> }).items || [];
    return lines.length > 0 && lines.every(line => {
      const category = line.itemId ? itemCategory.get(line.itemId) : undefined;
      return category !== undefined && productTaxabilityRows(state, category)
        .some(r => r.treatment === 'exempt' && r.validFrom <= date && (!r.validTo || date <= r.validTo));
    });
  };
  const certificates = { counted: 0, missing: 0, expired: 0 };
  for (const doc of invoices) {
    const date = String(doc.date || doc.issueDate || '').slice(0, 10);
    if (!COUNTED_SALES.has(String(doc.status)) || date < startDate || date > endDate) continue;
    if (Number(doc.taxAmountCents || 0) !== 0) continue;
    if (doc.taxTreatment !== 'exempt' && doc.taxTreatment !== 'zero_rated') continue;
    // the seller and the destination are read exactly as the state return reads them (#627)
    const seller = resolveSellerProfile(profiles, documentEntityLabels(doc), order);
    if (!registrationsOn(seller, 'sales_tax', date).some(r => r.place?.country === 'US')) continue;
    const customer = doc.customerId ? customersById.get(doc.customerId) : undefined;
    const destination = usSaleDestination(doc, undefined, customer, seller.place?.state);
    const buyerState = destination.state;
    if (destination.abroad || !buyerState || exemptByProduct(doc, buyerState, date)) continue;
    certificates.counted++;
    const found = exemptionOn(customer, date);
    if (!found) certificates.missing++;
    else if (found.state === 'expired') certificates.expired++;
  }

  // 5. the 1099 preview for the quarter's tax year. The threshold table covers 2020 and later, so an
  //    earlier quarter says so instead of asking a table that has no row for it.
  const readiness: VendorReadinessReport | null = input.vendors && input.payments && taxYear >= 2020 && taxYear <= 2099
    ? vendor1099Readiness({ vendors: input.vendors, payments: input.payments, taxYear, homeCurrency: currency })
    : null;

  // 6. closing the quarter's months
  const closeState = new Map((input.periods || []).map(p => [p.month, p.state]));
  const openMonths = months.filter(month => !CLOSED.includes(closeState.get(month) || 'open'));

  const steps: UsQuarterStep[] = [
    {
      id: 'permits',
      title: 'Sales-tax permits for the quarter',
      what: 'Check that every entity that sold into a state holds that state’s permit, and that the permit covers the whole quarter.',
      screen: 'tax-profiles',
      tab: 'settings',
      screenLabel: 'Settings → Tax profiles',
      status: permits.length ? 'done' : 'attention',
      detail: permits.length
        ? `${permits.length} US sales-tax permit(s) in force on ${endDate}: ${permits.map(p => `${p.state} ${p.permitNumber}`).join(', ')}.`
        : `No US sales-tax permit is recorded for ${endDate}, so no state return can be prepared from this data. If the books sold into a state, record the permit — or record that none is held — before relying on the steps below.`,
      figures: [{ label: 'Permits in force', count: permits.length }],
      returns: [],
    },
    {
      id: 'state-returns',
      title: 'Sales tax by state',
      what: 'Open the return screen for each permit, compare its boxes with the figures here, then file or record the return on the state’s own system.',
      screen: 'tax-liability',
      tab: 'reports',
      screenLabel: 'Reports → Tax return',
      status: !permits.length ? 'not-applicable' : returns.every(r => r.filed) ? 'done' : 'attention',
      detail: !permits.length
        ? 'No permit is recorded, so there is no state return to prepare from this data.'
        : returns.map(r => `${r.state} ${r.permitNumber}: gross ${money(r.grossSalesCents, currency)}, taxable ${money(r.taxableSalesCents, currency)}, tax ${money(r.taxCollectedCents, currency)}${r.filed
          ? ' — recorded as filed'
          : r.dueDate
            ? ` — planning due date ${r.dueDate}${r.dueDate < input.today ? ', already past' : ''}`
            : ' — the planning calendar has no due date for this state'}.`).join(' '),
      figures: returns.flatMap(r => [
        { label: `${r.state} gross sales`, cents: r.grossSalesCents, note: `${r.documentCount} document(s) counted` },
        { label: `${r.state} exempt sales`, cents: r.exemptSalesCents },
        { label: `${r.state} taxable sales`, cents: r.taxableSalesCents },
        { label: `${r.state} tax collected`, cents: r.taxCollectedCents },
      ]),
      returns,
    },
    {
      id: 'use-tax',
      title: 'Use tax on out-of-state purchases',
      what: 'Review the purchases the vendor did not charge tax on, decide the use tax owed, and self-assess it on the state’s return.',
      screen: 'use-tax-review',
      tab: 'reports',
      screenLabel: 'Reports → Use tax review',
      status: !useTax || NO_STATE_SALES_TAX.includes(useTaxState)
        ? 'not-applicable'
        : useTax.problem || useTax.totals.estimatedUseTaxCents !== 0 || useTax.totals.unclearCents !== 0
          ? 'attention'
          : 'done',
      detail: !useTax
        ? 'No state is known for the use-tax review (no permit and none chosen).'
        : NO_STATE_SALES_TAX.includes(useTaxState)
          ? `${useTaxState} has no state sales tax, so the table has no state use tax for it; local rules are not concluded here.`
          : useTax.problem
            ? useTax.problem
            : `${useTaxState}: ${useTax.rows.length} bill(s) with no tax charged in the quarter; estimated use tax ${money(useTax.totals.estimatedUseTaxCents, currency)}, with ${money(useTax.totals.unclearCents, currency)} of base left for a person to review (never estimated).`,
      figures: useTax && !useTax.problem && !NO_STATE_SALES_TAX.includes(useTaxState)
        ? [
          { label: 'Estimated use tax', cents: useTax.totals.estimatedUseTaxCents },
          { label: 'Base to review', cents: useTax.totals.unclearCents },
        ]
        : [],
      returns: [],
    },
    {
      id: 'certificates',
      title: 'Exemption certificates',
      what: 'For every zero-tax sale in the quarter, keep the customer’s certificate on file and renew the ones that ran out before the sale.',
      screen: 'customer-tax-certificates',
      tab: 'reports',
      screenLabel: 'Reports → Customer tax certificates',
      status: !certificates.counted ? 'not-applicable' : certificates.missing || certificates.expired ? 'attention' : 'done',
      detail: !certificates.counted
        ? 'No zero-tax sale to a US customer is recorded in the quarter, so no certificate is needed from this data.'
        : `${certificates.counted} zero-tax sale(s) to a US customer: ${certificates.missing} without a recorded certificate, ${certificates.expired} after the certificate’s last day. An expired certificate means tax was due on that sale — check the invoice.`,
      figures: certificates.counted
        ? [
          { label: 'Zero-tax sales', count: certificates.counted },
          { label: 'Certificate missing', count: certificates.missing },
          { label: 'Certificate expired', count: certificates.expired },
        ]
        : [],
      returns: [],
    },
    {
      id: 'form-1099',
      title: '1099 preview for the tax year',
      what: 'Compare the year’s posted payments with the 1099 thresholds, collect the missing tax details, and prepare the forms in the tax workflow.',
      screen: 'vendor-1099-readiness',
      tab: 'reports',
      screenLabel: 'Reports → Vendor 1099 readiness',
      status: !readiness ? 'not-applicable' : readiness.rows.some(r => r.overThreshold) ? 'attention' : 'done',
    detail: !readiness
      ? taxYear < 2020
        ? `The 1099 threshold table covers 2020 and later, so ${taxYear} is not read here; open the 1099 readiness report for a year the table covers.`
        : 'Vendors and payments are not read on this screen; open the 1099 readiness report for the year’s figures.'
        : readiness.rows.some(r => r.overThreshold)
          ? `${readiness.rows.filter(r => r.overThreshold).length} vendor(s) are at or over the ${taxYear} threshold of ${money(readiness.thresholdCents, currency)}: collect the tax ID and address, then prepare the forms outside this screen. Nothing here files a form.`
          : `No vendor reached the ${taxYear} threshold of ${money(readiness.thresholdCents, currency)} from posted payments${readiness.rows.length ? ` (${readiness.rows.length} vendor(s) paid)` : ''}.`,
      figures: readiness
        ? [
          { label: 'Threshold', cents: readiness.thresholdCents, note: String(taxYear) },
          { label: 'Vendors over threshold', count: readiness.rows.filter(r => r.overThreshold).length },
        ]
        : [],
      returns: [],
    },
    {
      id: 'close',
      title: 'Close the quarter’s months',
      what: 'Close each month of the quarter after its returns are recorded, so no new entry can be posted into it.',
      screen: 'month-end-close',
      tab: 'month-end-close',
      screenLabel: 'Month-end close',
      status: !months.length ? 'not-applicable' : openMonths.length || unfiled.length ? 'attention' : 'done',
      detail: !months.length
        ? 'The quarter is not readable, so its months cannot be listed.'
        : [
          openMonths.length ? `Still open: ${openMonths.join(', ')}.` : `All of ${months.join(', ')} are closed.`,
          unfiled.length
            ? `Waiting to be recorded as filed: ${unfiled.map(r => `${r.state} ${r.permitNumber}`).join(', ')} — close the month after the return is recorded.`
            : 'No state return for the quarter is waiting to be recorded.',
        ].join(' '),
      figures: [
        { label: 'Months still open', count: openMonths.length },
        { label: 'Returns not recorded as filed', count: unfiled.length },
      ],
      returns: [],
    },
  ];

  const attention = steps.filter(s => s.status === 'attention').length;
  const next = steps.find(s => s.status === 'attention');
  return {
    quarter: quarter?.quarter || String(input.quarter || ''),
    year: quarter?.year || 0,
    q: quarter?.q || 0,
    startDate,
    endDate,
    months,
    taxYear,
    steps,
    done: steps.filter(s => s.status === 'done').length,
    attention,
    readyToClose: attention === 0 && problems.length === 0,
    ...(next ? { nextStep: next.id } : {}),
    problems,
  };
}

export const US_QUARTER_JOURNEY_CSV_HEADERS = [
  'Quarter', 'Step', 'Status', 'What to do', 'Screen', 'Permit', 'Gross sales', 'Exempt sales',
  'Taxable sales', 'Tax collected', 'Due date', 'Recorded as filed',
];

/** One row per step, plus one row per state return, for the export on the journey screen. */
export function usQuarterJourneyCsvRows(journey: UsQuarter): string[][] {
  const rows: string[][] = [];
  for (const step of journey.steps) {
    rows.push([journey.quarter, step.title, step.status, step.what, step.screenLabel, '', '', '', '', '', '', '']);
    for (const r of step.returns) {
      rows.push([
        journey.quarter, `${step.title} — ${r.state}`, step.status, `Permit ${r.permitNumber}`, step.screenLabel,
        `${r.state} ${r.permitNumber}`,
        (r.grossSalesCents / 100).toFixed(2),
        (r.exemptSalesCents / 100).toFixed(2),
        (r.taxableSalesCents / 100).toFixed(2),
        (r.taxCollectedCents / 100).toFixed(2),
        r.dueDate || 'not in the planning calendar',
        r.filed ? 'yes' : 'no',
      ]);
    }
  }
  return rows;
}
