/**
 * A-152 (P2-3): the Israeli month journey — one read-only path from an invoice that needs an
 * allocation number, through the periodic VAT report (form 836 figures) and the historical PCN874
 * draft, to closing the month.
 *
 * Every money figure is computed by the library the target screen already uses, so the journey
 * cannot disagree with it:
 * - the VAT return: `israelVatReturn` (`src/lib/tax/ilVatReturn.ts`), which itself reads
 *   `buildTaxReturn` (the same `computeTaxReturn` as the Tax return screen);
 * - the allocation number: `needsAllocationNumber` / `allocationNumberProblem`
 *   (`src/lib/tax/ilAllocation.ts`), with the threshold in force on the invoice date;
 * - the PCN874 rows: `buildPcn874FixtureDraft` (`src/lib/tax/pcn874Draft.ts`), the historical
 *   Appendix A layout. It is explicitly **not filing-ready**: the layout dates to 2010, and current
 *   validation, document classification, allocation-number rules and Tax Authority acceptance must
 *   be verified independently. This file says so on every draft it builds.
 * - the month's close state: `monthCloseState` from the workspace's own locks.
 *
 * What this is: a checklist of what the recorded data shows for one month, and which screen does
 * the work. What it is not: a filing, a payment, a posting, a close, or a conclusion that a return
 * is owed. The recorded filing frequency on the registration is the workspace's own statement; the
 * Tax Authority assigns the frequency. Read-only; money is whole cents of the workspace currency.
 */
import { calculateDocumentNet, calculateDocumentTax } from './documentMath';
import { monthEnd, type MonthCloseState } from './periodLock';
import { COUNTED_PURCHASES, COUNTED_SALES } from './taxCodes';
import { allocationNumberProblem, allocationThresholdCents, needsAllocationNumber } from './tax/ilAllocation';
import { belongsTo, israelVatReturn, type IlVatDocument } from './tax/ilVatReturn';
import {
  buildPcn874FixtureDraft, type Pcn874DraftOutput, type Pcn874FixtureDocument,
} from './tax/pcn874Draft';
import { registrationKey, registrationsOn, type TaxProfiles } from './tax/profile';
import { ilVatReportPeriod, type IlVatReportPeriod } from './tax/ilVatFilingFrequency';

/** A document as the screens hold it: the VAT fields, its own number, currency and party. */
export interface IlJourneyDocument extends IlVatDocument {
  number?: string;
  currency?: string;
  customerId?: string;
  vendorId?: string;
  metadata?: { ilAllocationNumber?: string; fixedAsset?: boolean; [key: string]: unknown } | null;
  /** a bill whose lines are fixed assets: its input VAT is reported apart */
  fixedAsset?: boolean;
}

export interface IlJourneyParty {
  id: string;
  name?: string;
  metadata?: unknown;
}

export type IlMonthStepId = 'registration' | 'allocation' | 'vat-report' | 'pcn874' | 'close';
export type IlMonthStepStatus = 'done' | 'attention' | 'not-applicable';

/** A figure on the journey: money in whole cents, or a count of things. */
export interface IlMonthFigure {
  label: string;
  cents?: number;
  count?: number;
  note?: string;
}

/** One VAT registration's return for the month, as the return screen computes it. */
export interface IlMonthReturn extends ReturnType<typeof israelVatReturn> {
  /** the registration this return belongs to (a permit in force on the month's last day) */
  from: string;
  /** the frequency the registration itself records, when it states one */
  filing?: string;
  /** the planning due date (the 15th of the month after the report period) when the registration states its frequency */
  dueDate?: string;
  /** CON-4: the report period's first and last months (two months for a bimonthly registration) */
  startMonth: string;
  endMonth: string;
  /** the caller recorded a return for exactly this period */
  filed: boolean;
  /** CON-4: the period runs past this month (the first month of a bimonthly pair): not yet due, not owed to close the month */
  pending: boolean;
}

/** An invoice that needs an allocation number, and what is wrong with the one recorded. */
export interface IlAllocationCase {
  invoiceId: string;
  number?: string;
  customerName?: string;
  date: string;
  netCents: number;
  thresholdCents: number;
  recorded?: string;
  problem: string | null;
}

export interface IlMonthStep {
  id: IlMonthStepId;
  title: string;
  what: string;
  screen: string;
  tab: string;
  screenLabel: string;
  status: IlMonthStepStatus;
  detail: string;
  figures: IlMonthFigure[];
  returns: IlMonthReturn[];
  allocation: IlAllocationCase[];
}

export interface IsraelMonth {
  month: string;
  startDate: string;
  endDate: string;
  year: number;
  steps: IlMonthStep[];
  done: number;
  attention: number;
  /** no step needs attention: the month's recorded work is complete here */
  readyToClose: boolean;
  nextStep?: IlMonthStepId;
  problems: string[];
  /** CON-4: the period the PCN874 step covers (the first registration's report period, else the month) */
  pcn874Period: { startMonth: string; endMonth: string };
}

export interface IsraelMonthInput {
  /** '2026-09' */
  month: string;
  /** today, YYYY-MM-DD: used only to say whether a due date has passed */
  today: string;
  /** the workspace currency label; every figure is whole cents of it */
  currency?: string;
  profiles?: TaxProfiles | null;
  /** label order for the seller profile, the World/Entity dimension first (as on the invoice screens) */
  order?: string[];
  invoices?: IlJourneyDocument[];
  bills?: IlJourneyDocument[];
  creditNotes?: IlJourneyDocument[];
  vendorCredits?: IlJourneyDocument[];
  customers?: IlJourneyParty[];
  vendors?: IlJourneyParty[];
  /** the close state of the month; a month not listed is open */
  periods?: Array<{ month: string; state: MonthCloseState }>;
  /** returns the server keeps for this workspace: a return for exactly this period counts as filed */
  filedPeriods?: Array<{ startDate: string; endDate: string }>;
}

const MONTH_TEXT = /^(\d{4})-(0[1-9]|1[0-2])$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** '2026-09' → its first and last dates, or undefined when the text is not a month. */
export function israelMonthOf(text: string): { month: string; startDate: string; endDate: string; year: number } | undefined {
  const found = MONTH_TEXT.exec(String(text || '').trim());
  if (!found) return undefined;
  const year = Number(found[1]);
  if (year < 2000 || year > 2099) return undefined;
  const month = `${found[1]}-${found[2]}`;
  return { month, startDate: `${month}-01`, endDate: monthEnd(month), year };
}

/** What is wrong with a month or a date written by hand, or null. */
export function israelMonthProblem(month: string, today = ''): string | null {
  if (!israelMonthOf(month)) return 'A month is written as 2026-09.';
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) return 'Today is a YYYY-MM-DD date.';
  return null;
}

/** The planning due date of a monthly report: the 15th of the month after the month. */
export function ilMonthlyDueDate(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-15` : `${y}-${pad(m + 1)}-15`;
}

const inMonth = (date: string | undefined, month: string) => String(date || '').slice(0, 7) === month;
/** CON-4: a date in the report period from `month` through `endMonth` (one month when it is omitted) */
const inPeriod = (date: string | undefined, month: string, endMonth?: string) => {
  const of = String(date || '').slice(0, 7);
  return of >= month && of <= (endMonth || month) && /^\d{4}-\d{2}$/.test(of);
};
const money = (cents: number, currency: string) =>
  `${currency} ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface IlVatRegistrationSummary {
  registration: string;
  number: string;
  from: string;
  filing?: string;
}

/** The Israeli VAT registrations in force on the month's last day, one per registration. */
export function ilVatRegistrations(profiles: TaxProfiles | null | undefined, endDate: string): IlVatRegistrationSummary[] {
  const out: IlVatRegistrationSummary[] = [];
  const seen = new Set<string>();
  const all: Array<[string, NonNullable<TaxProfiles['books']>]> = [
    ...(profiles?.books ? [['books', profiles.books] as [string, NonNullable<TaxProfiles['books']>]] : []),
    ...Object.entries(profiles?.labels || {}).map(([key, profile]) => [key, profile] as [string, NonNullable<TaxProfiles['books']>]),
  ];
  for (const [from, profile] of all) {
    for (const registration of registrationsOn(profile, 'vat', endDate)) {
      if (registration.place?.country !== 'IL') continue;
      const key = registrationKey(registration);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        registration: key, number: registration.number, from,
        ...(registration.filing ? { filing: registration.filing } : {}),
      });
    }
  }
  return out.sort((a, b) => a.number.localeCompare(b.number));
}

const partyOf = (list: IlJourneyParty[] | undefined, id: string | undefined) => (list || []).find(p => p.id === id);
/** The buyer's VAT number, recorded on the customer's own metadata (AllocationNumberField). */
const vatNumberOf = (party: IlJourneyParty | undefined): string | undefined => {
  const meta = (party?.metadata || {}) as { vatNumber?: unknown; taxId?: unknown };
  const value = typeof meta.vatNumber === 'string' ? meta.vatNumber : typeof meta.taxId === 'string' ? meta.taxId : '';
  return value.trim() || undefined;
};

/** Every invoice in the month that needs an allocation number, with what is recorded on it. */
export function ilAllocationCases(input: {
  invoices?: IlJourneyDocument[];
  customers?: IlJourneyParty[];
  month: string;
  currency?: string;
}): IlAllocationCase[] {
  const currency = input.currency || 'ILS';
  const cases: IlAllocationCase[] = [];
  for (const invoice of input.invoices || []) {
    if (!COUNTED_SALES.has(String(invoice.status)) || !inMonth(invoice.date || invoice.issueDate, input.month)) continue;
    const date = String(invoice.date || invoice.issueDate || '').slice(0, 10);
    const netCents = calculateDocumentNet(invoice);
    const taxCents = calculateDocumentTax(invoice);
    const customer = partyOf(input.customers, invoice.customerId);
    const buyerVatNumber = vatNumberOf(customer);
    const needs = needsAllocationNumber({
      date, netCents, taxCents, currency: invoice.currency || currency,
      exchangeRate: invoice.exchangeRate, buyerVatNumber,
    });
    if (!needs) continue;
    const recorded = typeof invoice.metadata?.ilAllocationNumber === 'string' ? invoice.metadata.ilAllocationNumber.trim() : '';
    cases.push({
      invoiceId: invoice.id,
      ...(invoice.number ? { number: invoice.number } : {}),
      ...(customer?.name ? { customerName: customer.name } : {}),
      date,
      netCents,
      thresholdCents: allocationThresholdCents(date) || 0,
      ...(recorded ? { recorded } : {}),
      problem: recorded ? allocationNumberProblem(recorded) : 'No allocation number is recorded. Without it the buyer cannot deduct the VAT.',
    });
  }
  return cases.sort((a, b) => a.date.localeCompare(b.date) || a.invoiceId.localeCompare(b.invoiceId));
}

// ---------------------------------------------------------------------------------------------
// PCN874 (historical Appendix A draft)
// ---------------------------------------------------------------------------------------------

export interface IlPcn874Unmapped {
  documentId: string;
  kind: 'invoice' | 'credit-note' | 'bill' | 'vendor-credit';
  number?: string;
  reason: string;
}

export interface IlPcn874Totals {
  taxableSalesNis: number;
  outputVatNis: number;
  zeroRatedSalesNis: number;
  inputOtherNis: number;
  inputEquipmentNis: number;
}

export interface IlPcn874Mapping {
  rows: Pcn874FixtureDocument[];
  unmapped: IlPcn874Unmapped[];
  totals: IlPcn874Totals;
  /** exempt, reverse-charge and out-of-scope documents: named so they are never silently dropped */
  notRepresented: number;
}

export interface IlPcn874Comparison {
  label: string;
  /** the draft's own whole-shekel figure */
  draftNis: number;
  /** the VAT report's figure, rounded to whole shekels for the comparison */
  returnNis: number;
  differenceNis: number;
}

export interface IlPcn874Preview extends IlPcn874Mapping {
  dealerId?: string;
  /** the fixed-width text, only when the dealer number is 9 digits and every document maps */
  draft?: Pcn874DraftOutput;
  /** why no draft text was built */
  problem?: string;
  /** the draft's totals beside the VAT report's, to show a difference rather than hide it */
  comparison: IlPcn874Comparison[];
  /** CON-4: the report period the draft covers (the same month twice for a monthly report) */
  startMonth: string;
  endMonth: string;
}

const asFixedAsset = (doc: IlJourneyDocument) => doc.fixedAsset === true || doc.metadata?.fixedAsset === true;

export interface IlPcn874Input {
  month: string;
  /** CON-4: the last month of a bimonthly report period that starts at `month` */
  endMonth?: string;
  /** CON-4: only the documents of this VAT registration (the same ownership the VAT report uses) */
  registration?: string;
  profiles?: TaxProfiles | null;
  order?: string[];
  invoices?: IlJourneyDocument[];
  creditNotes?: IlJourneyDocument[];
  bills?: IlJourneyDocument[];
  vendorCredits?: IlJourneyDocument[];
  customers?: IlJourneyParty[];
  vendors?: IlJourneyParty[];
  /** the workspace currency, used when a document does not state one */
  currency?: string;
}

/**
 * The month's documents as the historical PCN874 transaction rows, and every document that cannot
 * be written as one (with the reason) instead of a guessed row. Whole shekels are the document's
 * own amounts rounded; only documents in shekels are written, because the layout takes whole NIS
 * from the source of record and no rate is invented here.
 */
export function ilPcn874Rows(input: IlPcn874Input): IlPcn874Mapping {
  const currency = input.currency || 'ILS';
  const rows: Pcn874FixtureDocument[] = [];
  const unmapped: IlPcn874Unmapped[] = [];
  let notRepresented = 0;

  const add = (
    kind: IlPcn874Unmapped['kind'],
    doc: IlJourneyDocument,
    side: 'sale' | 'purchase',
    sign: '+' | '-',
  ) => {
    const party = partyOf(side === 'sale' ? input.customers : input.vendors, side === 'sale' ? doc.customerId : doc.vendorId);
    const fail = (reason: string) => unmapped.push({
      documentId: doc.id, kind, ...(doc.number ? { number: doc.number } : {}), reason,
    });
    const treatment = String(doc.taxTreatment || 'standard');
    const allowed = side === 'sale' ? ['standard', 'zero_rated'] : ['standard'];
    if (!allowed.includes(treatment)) {
      if (['exempt', 'reverse_charge', 'out_of_scope', 'zero_rated'].includes(treatment)) notRepresented++;
      fail(`Tax treatment “${treatment}” has no row in this historical layout.`);
      return;
    }
    if (!party) { fail(side === 'sale' ? 'The customer record is not loaded, so its tax ID is unknown.' : 'The vendor record is not loaded, so its tax ID is unknown.'); return; }
    const rawId = vatNumberOf(party)?.replace(/\D/g, '') || '';
    if (!rawId) { fail(`${party.name || 'The contact'} has no VAT/dealer number recorded.`); return; }
    if (rawId.length > 9) { fail(`The contact's tax ID has ${rawId.length} digits; the layout takes at most 9.`); return; }
    const number = String(doc.number || '').trim();
    if (!/^\d{1,9}$/.test(number)) { fail('The document number is not 1–9 digits, and the layout has only a numeric reference.'); return; }
    const docCurrency = doc.currency || currency;
    if (docCurrency !== 'ILS') { fail(`The document is in ${docCurrency}; the draft takes whole shekels from the ILS record.`); return; }
    const baseNis = Math.round(calculateDocumentNet(doc) / 100);
    const vatNis = Math.round(calculateDocumentTax(doc) / 100);
    const category = side === 'sale'
      ? (treatment === 'zero_rated' ? 'zero-sale' as const : 'taxable-sale' as const)
      : (asFixedAsset(doc) ? 'input-equipment' as const : 'input-other' as const);
    const allocation = typeof doc.metadata?.ilAllocationNumber === 'string' ? doc.metadata.ilAllocationNumber.trim() : '';
    if (allocation && allocationNumberProblem(allocation)) {
      fail('The allocation number recorded is not 9 digits, so the row would not be valid.');
      return;
    }
    rows.push({
      entryType: side === 'sale' ? (category === 'zero-sale' ? 'L' : 'S') : (category === 'input-equipment' ? 'R' : 'T'),
      category,
      counterpartyId: rawId,
      invoiceDate: String(doc.date || doc.issueDate || '').slice(0, 10),
      referenceGroup: '',
      referenceNumber: number,
      vatNis,
      baseNis,
      sign,
      ...(allocation ? { allocationNumber: allocation } : {}),
    });
  };

  // CON-4: a dealer's draft holds only its own registration's documents
  const mine = (docs: IlJourneyDocument[] | undefined) => (docs || []).filter(doc =>
    !input.registration || belongsTo(doc, input.profiles, input.order || [], input.registration));
  for (const doc of mine(input.invoices)) {
    if (COUNTED_SALES.has(String(doc.status)) && inPeriod(doc.date || doc.issueDate, input.month, input.endMonth)) add('invoice', doc, 'sale', '+');
  }
  for (const doc of mine(input.creditNotes)) {
    if (COUNTED_SALES.has(String(doc.status)) && inPeriod(doc.date || doc.issueDate, input.month, input.endMonth)) add('credit-note', doc, 'sale', '-');
  }
  for (const doc of mine(input.bills)) {
    if (COUNTED_PURCHASES.has(String(doc.status)) && inPeriod(doc.date || doc.issueDate, input.month, input.endMonth)) add('bill', doc, 'purchase', '+');
  }
  for (const doc of mine(input.vendorCredits)) {
    if (COUNTED_PURCHASES.has(String(doc.status)) && inPeriod(doc.date || doc.issueDate, input.month, input.endMonth)) add('vendor-credit', doc, 'purchase', '-');
  }

  const totals = rows.reduce((sum, row) => {
    const base = row.sign === '-' ? -row.baseNis : row.baseNis;
    const vat = row.sign === '-' ? -row.vatNis : row.vatNis;
    if (row.category === 'taxable-sale') { sum.taxableSalesNis += base; sum.outputVatNis += vat; }
    else if (row.category === 'zero-sale') { sum.zeroRatedSalesNis += base; }
    else if (row.category === 'input-equipment') { sum.inputEquipmentNis += vat; }
    else { sum.inputOtherNis += vat; }
    return sum;
  }, { taxableSalesNis: 0, outputVatNis: 0, zeroRatedSalesNis: 0, inputOtherNis: 0, inputEquipmentNis: 0 } as IlPcn874Totals);

  return { rows, unmapped, totals, notRepresented };
}

/**
 * The month's PCN874 preview: the historical draft text when a 9-digit dealer number is given and
 * every document maps, plus the draft's totals beside the VAT report's, so a rounding difference
 * is shown instead of hidden. It is never filing-ready (see the module comment).
 */
export function ilPcn874Preview(input: IlPcn874Input & {
  dealerId?: string;
  generatedOn: string;
  /** the month's VAT returns, to compare the draft with the report the screen shows */
  returns?: Array<{ taxableSalesCents: number; outputVatCents: number; zeroRatedSalesCents: number; fixedAssetInputVatCents: number; otherInputVatCents: number }>;
}): IlPcn874Preview {
  const mapping = ilPcn874Rows(input);
  const dealerId = String(input.dealerId || '').replace(/\D/g, '');
  const problems: string[] = [];
  if (dealerId.length !== 9) problems.push('A 9-digit dealer number is needed for the historical PCN874 draft.');
  if (mapping.unmapped.length) problems.push(`${mapping.unmapped.length} document(s) cannot be written in this layout; they are listed with the reason.`);
  let draft: Pcn874DraftOutput | undefined;
  if (!problems.length) {
    try {
      draft = buildPcn874FixtureDraft({ dealerId, month: input.month, ...(input.endMonth && input.endMonth !== input.month ? { endMonth: input.endMonth } : {}), generatedOn: input.generatedOn, documents: mapping.rows });
    } catch (err) {
      problems.push(err instanceof Error ? err.message : 'The draft could not be built.');
    }
  }
  const returnTotals = (input.returns || []).reduce((sum, r) => ({
    taxableSalesNis: sum.taxableSalesNis + Math.round(r.taxableSalesCents / 100),
    outputVatNis: sum.outputVatNis + Math.round(r.outputVatCents / 100),
    zeroRatedSalesNis: sum.zeroRatedSalesNis + Math.round(r.zeroRatedSalesCents / 100),
    inputOtherNis: sum.inputOtherNis + Math.round(r.otherInputVatCents / 100),
    inputEquipmentNis: sum.inputEquipmentNis + Math.round(r.fixedAssetInputVatCents / 100),
  }), { taxableSalesNis: 0, outputVatNis: 0, zeroRatedSalesNis: 0, inputOtherNis: 0, inputEquipmentNis: 0 } as IlPcn874Totals);
  const labelled: Array<[string, keyof IlPcn874Totals]> = [
    ['Taxable sales', 'taxableSalesNis'],
    ['VAT on sales', 'outputVatNis'],
    ['Zero-rated sales', 'zeroRatedSalesNis'],
    ['Input VAT, other', 'inputOtherNis'],
    ['Input VAT, equipment', 'inputEquipmentNis'],
  ];
  const comparison = (input.returns || []).length
    ? labelled.map(([label, key]) => ({
      label,
      draftNis: mapping.totals[key],
      returnNis: returnTotals[key],
      differenceNis: mapping.totals[key] - returnTotals[key],
    }))
    : [];
  return {
    ...mapping,
    ...(dealerId.length === 9 ? { dealerId } : {}),
    ...(draft ? { draft } : {}),
    ...(problems.length ? { problem: problems.join(' ') } : {}),
    comparison,
    startMonth: input.month,
    endMonth: input.endMonth || input.month,
  };
}

// ---------------------------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------------------------

export function israelMonthJourney(input: IsraelMonthInput): IsraelMonth {
  const currency = input.currency || 'ILS';
  const period = israelMonthOf(input.month);
  const problems: string[] = [];
  const monthProblem = israelMonthProblem(input.month, input.today);
  if (monthProblem) problems.push(monthProblem);
  const month = period?.month || String(input.month || '');
  const startDate = period?.startDate || '';
  const endDate = period?.endDate || '';
  const today = /^\d{4}-\d{2}-\d{2}$/.test(input.today) ? input.today : '';

  const registrations = period ? ilVatRegistrations(input.profiles, endDate) : [];
  // CON-4: each registration reports over its own period — the month, or the two months a bimonthly file reports together
  const reportPeriodOf = (filing?: string): IlVatReportPeriod | undefined =>
    filing === 'bimonthly' || filing === 'monthly' ? ilVatReportPeriod(month, filing) : undefined;
  const returns: IlMonthReturn[] = period
    ? registrations.map(registration => {
      let own = reportPeriodOf(registration.filing);
      // a two-month report needs the registration in force for both months; otherwise the month is shown alone
      if (own && own.startMonth !== own.endMonth) {
        const whole = [own.startDate, own.endDate].every(day => ilVatRegistrations(input.profiles, day).some(r => r.registration === registration.registration && r.filing === registration.filing));
        if (!whole) {
          problems.push(`Registration ${registration.number} is not recorded as ${registration.filing} for the whole ${own.startMonth} to ${own.endMonth} period (it starts, ends or changes frequency inside it), so ${month} is shown alone. Check the registration dates in Settings → Tax profiles.`);
          own = ilVatReportPeriod(month, 'monthly');
        }
      }
      const from = own?.startDate || startDate;
      const to = own?.endDate || endDate;
      return {
        ...israelVatReturn({
          registration: registration.registration,
          profiles: input.profiles,
          order: input.order || [],
          invoices: input.invoices || [],
          bills: input.bills || [],
          creditNotes: input.creditNotes || [],
          vendorCredits: input.vendorCredits || [],
          startDate: from, endDate: to,
        }),
        from: registration.from,
        ...(registration.filing ? { filing: registration.filing } : {}),
        ...(own ? { dueDate: own.dueDate } : {}),
        startMonth: own?.startMonth || month,
        endMonth: own?.endMonth || month,
        filed: (input.filedPeriods || []).some(r => r.startDate === from && r.endDate === to),
        pending: (own?.endMonth || month) > month,
      };
    })
    : [];
  const pcn874Period = { startMonth: returns[0]?.startMonth || month, endMonth: returns[0]?.endMonth || month };

  const allocation = period
    ? ilAllocationCases({ invoices: input.invoices, customers: input.customers, month, currency })
    : [];
  const allocationMissing = allocation.filter(c => c.problem);
  const mapping = period
    ? ilPcn874Rows({
      month: pcn874Period.startMonth,
      endMonth: pcn874Period.endMonth,
      ...(returns[0] ? { registration: returns[0].registration, profiles: input.profiles, order: input.order || [] } : {}),
      invoices: input.invoices, creditNotes: input.creditNotes, bills: input.bills, vendorCredits: input.vendorCredits,
      customers: input.customers, vendors: input.vendors, currency,
    })
    : ilPcn874Rows({ month });
  const closeState = new Map((input.periods || []).map(p => [p.month, p.state]));
  const state: MonthCloseState = month ? (closeState.get(month) || 'open') : 'open';
  const closed = state === 'soft' || state === 'hard';
  const due = returns.filter(r => !r.pending);
  const unfiled = due.filter(r => !r.filed).length;

  const steps: IlMonthStep[] = [
    {
      id: 'registration',
      title: 'Israeli VAT registration for the month',
      what: 'Check that the entity that sold in Israel holds a VAT registration that covers the whole month, with the filing frequency the Tax Authority gave it.',
      screen: 'tax-profiles',
      tab: 'settings',
      screenLabel: 'Settings → Tax profiles',
      status: registrations.length ? 'done' : 'attention',
      detail: registrations.length
        ? `${registrations.length} Israeli VAT registration(s) in force on ${endDate}: ${registrations.map(r => r.number + (r.filing ? ` (${r.filing})` : '')).join(', ')}. The authority assigns the frequency; the registration records what this workspace was told.`
        : `No Israeli VAT registration is recorded for ${endDate}, so no periodic VAT report can be prepared from this data. Record the registration in Settings → Tax profiles before relying on the steps below.`,
      figures: [{ label: 'Registrations in force', count: registrations.length }],
      returns: [],
      allocation: [],
    },
    {
      id: 'allocation',
      title: 'Allocation numbers on business invoices',
      what: 'For every tax invoice to a business buyer above the threshold before VAT, record the allocation number the Tax Authority issued; without it the buyer cannot deduct the VAT.',
      screen: 'sales',
      tab: 'sales',
      screenLabel: 'Sales → Invoices',
      status: !allocation.length ? 'not-applicable' : allocationMissing.length ? 'attention' : 'done',
      detail: !allocation.length
        ? `No invoice in ${month} is above the allocation threshold in force on its date, or none is to a business buyer with a VAT number.`
        : `${allocation.length} invoice(s) need an allocation number: ${allocationMissing.length} without a usable one${allocationMissing.length ? ` (${allocationMissing.map(c => `#${c.number || c.invoiceId}`).join(', ')})` : ''}. The threshold is ${money(allocationThresholdCents(endDate) || 0, currency)} before VAT on ${endDate}; it steps down by date.`,
      figures: [
        { label: 'Invoices needing a number', count: allocation.length },
        { label: 'Missing or unusable', count: allocationMissing.length },
      ],
      returns: [],
      allocation,
    },
    {
      id: 'vat-report',
      title: 'Periodic VAT report (form 836 figures)',
      what: 'Compare the return screen’s boxes with the figures here, then file the periodic report on the Tax Authority’s own system and record it on the return screen.',
      screen: 'tax-liability',
      tab: 'reports',
      screenLabel: 'Reports → Tax return',
      status: !registrations.length
        ? 'not-applicable'
        : !due.length ? 'not-applicable' : due.every(r => r.filed) ? 'done' : 'attention',
      detail: !registrations.length
        ? 'No registration is recorded, so there is no VAT report to prepare from this data.'
        : returns.map(r => `${r.registration.replace(/^vat:/, '')}${r.startMonth !== r.endMonth ? ` (bimonthly report ${r.startMonth} to ${r.endMonth})` : ''}: taxable sales ${money(r.taxableSalesCents, currency)}, output VAT ${money(r.outputVatCents, currency)}, zero-rated ${money(r.zeroRatedSalesCents, currency)}, input VAT ${money(r.fixedAssetInputVatCents + r.otherInputVatCents, currency)} (equipment ${money(r.fixedAssetInputVatCents, currency)}), ${r.toPayCents >= 0 ? 'to pay' : 'to reclaim'} ${money(Math.abs(r.toPayCents), currency)}${r.filed ? ' — recorded as filed' : r.pending ? ` — the two-month report is prepared after ${r.endMonth} ends (planning due date ${r.dueDate}); nothing is owed to close ${month}` : r.dueDate ? ` — planning due date ${r.dueDate}${today && r.dueDate < today ? ', already past' : ''}` : ' — the registration records no monthly or bimonthly frequency, so the month is shown and no due date'}.`).join(' '),
      figures: returns.flatMap(r => [
        { label: `${r.registration.replace(/^vat:/, '')} taxable sales`, cents: r.taxableSalesCents, note: `${r.documentCount} document(s) counted` },
        { label: `${r.registration.replace(/^vat:/, '')} output VAT`, cents: r.outputVatCents },
        { label: `${r.registration.replace(/^vat:/, '')} zero-rated sales`, cents: r.zeroRatedSalesCents },
        { label: `${r.registration.replace(/^vat:/, '')} input VAT`, cents: r.fixedAssetInputVatCents + r.otherInputVatCents },
        { label: `${r.registration.replace(/^vat:/, '')} ${r.toPayCents >= 0 ? 'to pay' : 'to reclaim'}`, cents: Math.abs(r.toPayCents) },
      ]),
      returns,
      allocation: [],
    },
    {
      id: 'pcn874',
      title: 'PCN874 draft for the month',
      what: 'Build the historical Appendix A draft from the month’s documents and compare its whole-shekel totals with the VAT report. It is not a filing: current validation and Tax Authority acceptance are not verified here.',
      screen: 'il-month-journey',
      tab: 'reports',
      screenLabel: 'Reports → Israel Month Journey',
      status: !registrations.length
        ? 'not-applicable'
        : mapping.unmapped.length ? 'attention' : 'done',
      detail: !registrations.length
        ? 'No registration is recorded, so there is no dealer number and no draft to prepare.'
        : !mapping.rows.length && !mapping.unmapped.length
          ? `No document dated in ${pcn874Period.startMonth === pcn874Period.endMonth ? month : `${pcn874Period.startMonth} to ${pcn874Period.endMonth}`} can be written as a PCN874 row, so there is nothing to draft.`
          : `${mapping.rows.length} row(s) can be written; ${mapping.unmapped.length} document(s) cannot${mapping.unmapped.length ? ` (${mapping.unmapped.slice(0, 3).map(u => u.number || u.documentId).join(', ')}${mapping.unmapped.length > 3 ? ', …' : ''})` : ''}.${mapping.notRepresented ? ` ${mapping.notRepresented} exempt or reverse-charge document(s) have no row in this historical layout.` : ''} The draft is never filing-ready: the layout dates to 2010.`,
      figures: [
        { label: 'Rows that can be written', count: mapping.rows.length },
        { label: 'Documents that cannot', count: mapping.unmapped.length },
        { label: 'Not represented by the layout', count: mapping.notRepresented },
      ],
      returns: [],
      allocation: [],
    },
    {
      id: 'close',
      title: 'Close the month',
      what: 'Close the month after the VAT report is recorded, so no new entry can be posted into it.',
      screen: 'month-end-close',
      tab: 'month-end-close',
      screenLabel: 'Month-end close',
      status: !period ? 'not-applicable' : closed && !unfiled ? 'done' : 'attention',
      detail: !period
        ? 'The month is not readable, so its close state cannot be shown.'
        : [
          closed ? `${month} is ${state === 'hard' ? 'closed' : 'soft-closed'}.` : `${month} is still open.`,
          unfiled
            ? 'Record the VAT report on the return screen before closing the month.'
            : 'The VAT report for the month is recorded as filed.',
        ].join(' '),
      figures: [
        { label: 'Months still open', count: closed ? 0 : 1 },
        { label: 'Returns not recorded as filed', count: unfiled },
      ],
      returns: [],
      allocation: [],
    },
  ];

  const attention = steps.filter(s => s.status === 'attention').length;
  const next = steps.find(s => s.status === 'attention');
  return {
    month,
    startDate,
    endDate,
    year: period?.year || 0,
    steps,
    done: steps.filter(s => s.status === 'done').length,
    attention,
    readyToClose: attention === 0 && problems.length === 0,
    ...(next ? { nextStep: next.id } : {}),
    problems,
    pcn874Period,
  };
}

/** CON-4: the return of the dealer number typed on the screen, compared as digits (a registration may be saved as 514-000-000). */
export function ilReturnForDealer<R extends { registration: string }>(returns: R[], dealerId: string): R | undefined {
  const wanted = String(dealerId || '').replace(/\D/g, '');
  return wanted ? returns.find(r => (r.registration.split(':').pop() || '').replace(/\D/g, '') === wanted) : undefined;
}

export const IL_MONTH_JOURNEY_CSV_HEADERS = [
  'Month', 'Step', 'Status', 'What to do', 'Screen', 'Registration', 'Taxable sales', 'Output VAT',
  'Zero-rated sales', 'Input VAT, other', 'Input VAT, equipment', 'To pay', 'Due date', 'Recorded as filed',
  'Report period from', 'Report period to',
];

/** One row per step, plus one row per registration's return, for the export on the journey screen. */
export function ilMonthJourneyCsvRows(journey: IsraelMonth): string[][] {
  const rows: string[][] = [];
  const cents = (n: number) => (n / 100).toFixed(2);
  for (const step of journey.steps) {
    rows.push([journey.month, step.title, step.status, step.what, step.screenLabel, '', '', '', '', '', '', '', '', '', '', '']);
    for (const r of step.returns) {
      rows.push([
        journey.month, `${step.title} — ${r.registration}`, step.status, step.what, step.screenLabel,
        r.registration, cents(r.taxableSalesCents), cents(r.outputVatCents), cents(r.zeroRatedSalesCents),
        cents(r.otherInputVatCents), cents(r.fixedAssetInputVatCents), cents(r.toPayCents),
        r.dueDate || 'not stated', r.filed ? 'yes' : 'no', r.startMonth, r.endMonth,
      ]);
    }
  }
  return rows;
}
