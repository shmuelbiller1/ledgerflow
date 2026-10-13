/** E-17: guarded human-review worksheet for recorded Israeli withholding; not filing-ready. */
export { form856ReviewExport, FORM_856_REVIEW_HEADERS } from './tax/form856ReviewExport';

/**
 * PLAN §10: the filings each entity owes for a year. Reachable here until AI #2's C-58 filings calendar uses it.
 */
export { entityFilings } from './tax/entityFilings';
/**
 * PLAN US-3: a US state sales tax return per permit. Reachable here until AI #2's C-59 return screen uses it.
 */
export { usSalesTaxReturn } from './tax/usSalesTaxReturn';
/**
 * E-15: EU/UK VAT number pattern previews and masked nonblocking warnings.
 * They do not check VIES/HMRC registration or change live tax calculation.
 */
export { checkVatNumber, vatFormatWarning, maskVatNumber, VAT_COUNTRIES, VAT_COUNTRY_FORMATS } from './tax/vatNumberFormat';
/**
 * E-16: read-only USPS region and ZIP+4 recognition; never proof of tax
 * jurisdiction or deliverable address. Needs authoritative geocoding/lookup.
 */
export { parseUsStateAndZip, US_POSTAL_REGIONS } from './usAddressStateZip';

/**
 * E-14: US tax-ID formatting, masked display and warning helpers.
 * Read-only staging. Explicit EIN/SSN choice; never infers registration,
 * persists sensitive identifiers or enables 1099/W-9 filing.
 */
export {
  checkUsTaxId,
  formatUsTaxIdForInput,
  maskUsTaxId,
  usTaxIdWarning,
} from './tax/usTaxIdFormat';

/**
 * E-13: local Israeli identity/company-number format warnings only.
 * Read-only; does not query a registry, collect a taxpayer ID or block saving.
 * Claude owns the customer/vendor PartyModal wiring.
 */
export { checkIsraeliIdentifier, israeliIdentifierWarning } from './tax/israeliIdentifiers';
/**
 * E-12: pure Israeli document-title classification for explicitly issued,
 * reviewed documents only. Not wired to issuance, numbering, VAT posting,
 * allocations or tax returns until Claude supplies the issuance evidence.
 */
export { classifyIsraeliDocument, israeliDocumentTitle } from './tax/israeliDocumentTypes';

/**
 * PLAN §10: the rule graph (facts from every dimension, dated rules that accumulate, override or exclude, evidence).
 * Reachable here until the tax resolution and the Facts screen use it.
 */
export { composeFacts } from './rules/facts';
export { evaluateRules } from './rules/rules';
export { factSources } from './rules/fromTaxProfiles';
/**
 * A-38: the tax tables written as rule packs (one file per pack). Reachable here until the line
 * resolution reads them; `taxRulePackProblems` is the guard a screen or a test runs over them.
 */
export { taxRulePacks, allTaxRules, unmappedTaxRows, taxRulePackProblems } from './rules/packs/index';
/**
 * A-22 / PLAN US-1: the US state sales-tax table (base rate, shipping treatment, sourcing) and the
 * `RateTables['US-XX']` entry `resolveLineTax` uses. Rate tables only: nothing here posts or files.
 */
export { US_STATE_SALES_TAX, stateSalesTaxRate, stateSalesTaxRows, shippingTreatment, usStateSalesTaxRateTable, usShippingIsTaxable, NO_STATE_SALES_TAX, US_SALES_TAX_STATES } from './tax/usStateSalesTax';
/**
 * A-24…A-26 / PLAN step 4: Canada's GST/HST/PST, the EU's 27 VAT rates and the UK's VAT rates as
 * dated rows with sources; each plugs into `resolveLineTax` as its own RateTable.
 */
export { CA_SALES_TAX, canadaSalesTaxRateTable, canadaVatComponents, canadaCombinedRate } from './tax/caSalesTax';
export { EU_VAT_RATES, euVatStandardRate, euVatReducedRows, euVatRateTable } from './tax/euVat';
export { UK_VAT_RATES, ukVatStandardRate, ukVatZeroRow, ukVatRateTable } from './tax/ukVat';
/**
 * A-29 / PLAN IL-1: Israel's special VAT areas (Eilat's free-trade zone, the export areas,
 * duty-free) as dated rows, and the IL rate table that answers 0 there.
 */
export { IL_VAT_SPECIAL_AREAS, ilVatAreaRow, isIlZeroArea, ilVatRateTable } from './tax/ilVat';
/**
 * PLAN §6: tax code suggestions that learn from history, and unusual-code flags. Reachable here until AI #2's C-46 panel uses them.
 */
export { suggestTaxCode, unusualTaxCode } from './tax/taxSuggestions';
/**
 * PLAN IL-3: Israel's VAT report figures per registration. Reachable here until AI #2's C-40 screen uses them.
 */
export { israelVatReturn } from './tax/ilVatReturn';
/**
 * E-9: opt-in historical fixture formatter, deliberately NOT a filing workflow.
 * Re-export from an application-reachable, read-only exports module so the
 * repository's import/reachability guards can verify the draft stays connected.
 * No production download or tax submission action uses this formatter.
 */
export { buildPcn874FixtureDraft as buildHistoricalPcn874Draft } from './tax/pcn874Draft';
/**
 * E-10: historical/year-specific US 1099 review helpers, intentionally not IRIS,
 * printable IRS form output, or an automatic tax filing workflow.
 * The existing workspace export path reaches this pure preview utility, while
 * users must still obtain complete verified payment / W-9 data before filing.
 */
export { build1099Preview, threshold1099Cents, us1099ReviewCsvRows } from './tax/us1099Preview';
/**
 * E-11: read-only state/local rate table staging helpers, not a tax calculator.
 * Exposed from an application-reachable export module for preview/integration
 * review only. Each result explicitly carries readyForTaxCalculation: false.
 * No live tax lookup, posting, or database update uses these functions.
 */
export {
  parseStateLocalRateRows,
  parseTexasLocalRates,
  parseCaliforniaLocalRates,
  parseNewYorkLocalRates,
  parseWashingtonLocalRates,
  parseColoradoLocalRates,
} from './tax/stateLocalRateImporters';

import type {ChartAccount,Transaction} from '../types';
import {isPostable,lineAmount,isCashAccount} from './txFilters';
import {csvMoney,type CsvValue} from './csvExport';
import {parseCsv} from './csv';
import {validCustomReportPeriod,type CustomReportPeriod} from './reportCustomPeriod';
import {balancesAsOf} from './closingSnapshot';
export type ExportKind='ledger'|'accounts'|'customers'|'vendors'|'bank'|'trial-balance';
export type TrialBalanceLayout='debit-credit'|'balance';
export interface ExportTable {headers:string[];rows:CsvValue[][]}
/** Read-only view of the existing posting/FX helper: one row per posted line, including unknown accounts. */
export function ledgerExportTable(transactions:Transaction[],accounts:ChartAccount[],period:CustomReportPeriod,currency:string):ExportTable{
 if(!validCustomReportPeriod(period))throw new Error('Choose a valid period.');
 const names=new Map(accounts.map(account=>[account.id,account]));
 return {headers:['Date','Transaction ID','Line','Description','Reference','Account ID','Account Code','Account Name','Debit','Credit','Base Currency','Status','Line Description'],rows:transactions.filter(tx=>isPostable(tx)&&tx.date>=period.startDate&&tx.date.slice(0,10)<=period.endDate).flatMap(tx=>tx.lines.map((line,index)=>{
  const amount=lineAmount(line,tx),account=names.get(line.accountId);
  return [tx.date,tx.id,index+1,tx.description,tx.reference||'',line.accountId,account?.code||'',account?.name||line.accountName||'Unknown account',csvMoney(amount>0?amount:0),csvMoney(amount<0?-amount:0),currency,tx.status,line.description||''];
 }))};
}
/**
 * BD-05: the trial balance on a date, in the shape tax software imports (account number, name,
 * type, the tax line the account is mapped to, then debit/credit columns or one balance column with
 * debits positive). One row per account that is not at zero, by account number; no totals row
 * (importers read it as an account). Balances follow the closing-snapshot rule: opening balance
 * plus every counted line up to the date. Lines on a removed account are kept, named as such.
 */
export function trialBalanceExportTable(transactions:Transaction[],accounts:ChartAccount[],asOfDate:string,layout:TrialBalanceLayout):ExportTable&{debitCents:number;creditCents:number}{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate))throw new Error('Choose the date of the trial balance.');
 const {balances}=balancesAsOf(accounts,transactions,asOfDate);
 const byId=new Map(accounts.map(account=>[account.id,account]));
 const lines=Object.entries(balances).map(([id,cents])=>{
  const account=byId.get(id);
  return {code:account?.code||'',name:account?.name||`Unknown account (${id})`,type:account?.type||'',taxLine:account?.taxCategory||'',cents};
 }).sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true})||a.name.localeCompare(b.name));
 const debitCents=lines.reduce((sum,line)=>sum+(line.cents>0?line.cents:0),0);
 const creditCents=lines.reduce((sum,line)=>sum+(line.cents<0?-line.cents:0),0);
 const head=['Account Number','Account Name','Account Type','Tax Line'];
 return layout==='balance'
  ?{headers:[...head,'Balance'],rows:lines.map(line=>[line.code,line.name,line.type,line.taxLine,csvMoney(line.cents)]),debitCents,creditCents}
  :{headers:[...head,'Debit','Credit'],rows:lines.map(line=>[line.code,line.name,line.type,line.taxLine,csvMoney(line.cents>0?line.cents:0),csvMoney(line.cents<0?-line.cents:0)]),debitCents,creditCents};
}
/** Display columns remain spreadsheet-safe; Record JSON preserves types, whitespace and nested fields exactly. */
export function recordExportTable(records:object[]):ExportTable{
 const keys=[...new Set(records.flatMap(record=>Object.keys(record)))].sort();
 return {headers:[...keys,'Record JSON'],rows:records.map(record=>{
  const data=record as Record<string,unknown>;
  return [...keys.map(key=>{const value=data[key];return value===undefined?null:typeof value==='object'?JSON.stringify(value):String(value);}),JSON.stringify(record)];
 })};
}
/** File-level round trip only: does not bypass Settings Import Data's field allowlist or write records. */
export function readExportedRecords(csv:string):Record<string,unknown>[] {
 const [headers,...rows]=parseCsv(csv,','),column=headers?.indexOf('Record JSON')??-1;
 if(column<0)throw new Error('Missing Record JSON column.');
 return rows.map(row=>{const value:unknown=JSON.parse(row[column]);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid exported record.');return value as Record<string,unknown>;});
}
/** One bank-account line per exported entry, retaining repeated lines and stable source identity. */
export function bankExportLines(transactions:Transaction[],account:ChartAccount,period:CustomReportPeriod,baseCurrency:string):Transaction[]{
 if(!validCustomReportPeriod(period))throw new Error('Choose a valid period.');
 if(account.type!=='asset'||!isCashAccount(account))throw new Error('Choose a cash or bank asset account.');
 if((account.currency||baseCurrency).toUpperCase()!==baseCurrency.toUpperCase())throw new Error('Bank exports currently require an account in the workspace base currency.');
 return transactions.filter(tx=>isPostable(tx)&&tx.date>=period.startDate&&tx.date.slice(0,10)<=period.endDate).flatMap(tx=>tx.lines.flatMap((line,index)=>line.accountId===account.id?[{...tx,id:JSON.stringify([tx.id,index]),date:tx.date.slice(0,10),lines:[line]}]:[]));
}
export function generateQIF(transactions:Transaction[]):string{
 const text=(value:string)=>Array.from(value,char=>char.charCodeAt(0)<32?' ':char).join('');
 return '!Type:Bank\n'+transactions.map(tx=>{
  const [year,month,day]=tx.date.split('-');
  return `D${month}/${day}/${year}\nT${csvMoney(lineAmount(tx.lines[0],tx))}\nP${text(tx.payee||tx.description||'Transaction')}\nM${text(tx.description||'')}\nN${text(tx.id)}\n^`;
 }).join('\n')+'\n';
}

/**
 * A-18 (CC-04): recurring estimates — the schedule saved on a repeating estimate and the drafts it
 * owes. Reachable here until the estimates screen and the daily job use it; nothing is sent or posted.
 */
export { ESTIMATE_FREQUENCIES, estimateValidityDays, estimateDraftsDue, nextEstimateDraft, recurringEstimateProblem, recurringEstimateSchedule } from './recurringEstimates';
/** A-21 (CF-07): comment threads on a record — who, when, ten-minute own-edit, @mentions. */
export { COMMENT_EDIT_WINDOW_MS, COMMENT_MAX_LENGTH, commentProblem, commentEditProblem, newThreadComment, editedThreadComment, threadComments, threadParticipants, commentWhen } from './commentThreads';
/** A-23 (PLAN IL-5): the yearly withholding report (Form 856) over recorded vendor payments. */
export { FORM_856_CSV_HEADERS, form856Year, isForm856Payment, form856Rows, form856Summary, form856Notes, form856CsvRows } from './tax/form856';
/** A-33 (Q-03): serial and lot numbers on document lines and the serial lookup. */
export { SERIAL_LOOKUP_CSV_HEADERS, normalizeSerial, lineSerials, serialAlreadyUsed, serialProblem, withSerial, withoutSerial, serialsForItem, findSerial, lotRows, duplicateSerials, serialLookupCsvRows } from './serialNumbers';
/** A-35 (CC-03): a proposal's sections, optional items and one-page text. */
export { proposalProblem, proposalTotals, proposalText, proposalFromEstimate } from './proposals';
/** A-36 (CD-06/CF-08): notes on any record, newest first and searchable. */
export { NOTE_MAX_LENGTH, noteProblem, addRecordNote, editRecordNote, notesForEntity, searchRecordNotes, notePreview, noteCountsByType } from './recordNotes';
/** A-37 (CG-01): owner-defined extra fields on customers, vendors and items, with their list columns. */
export { CUSTOM_FIELD_CSV_HEADERS, customFieldProblem, fieldValueProblem, coerceCustomField, customFieldValues, customFieldColumns, customFieldCsvRow, customFieldRequiredProblem } from './customFields';

/**
 * A-28 / PLAN US-1: when each state's sales-tax return is usually due (a planning table with the
 * state's department as source) and the following-month due date, weekends moved to Monday.
 */
export { US_FILING_CALENDAR, US_FILING_CALENDAR_STATES, NO_STATE_FILING, filingCalendarRow, hasNoStateFiling, filingDueDate, filingCalendarProblems } from './tax/usFilingCalendar';

/**
 * AI #3 (Arena) A-46 to A-80 libraries, kept reachable from the app. Each is a pure function over
 * the documents it is given; none posts, moves stock or changes a calculation.
 * A-46 delivery note document (EN/HE, DN series); A-47 vendor scorecard; A-49 customer quote list;
 * A-50 reorder suggestions and draft purchase orders; A-63 landed cost preview; A-70 dunning letters;
 * A-73 milestone billing view; A-79 barcode reading; A-80 price-list CSV import.
 */
export { DELIVERY_NOTE_LABELS, buildDeliveryNote, nextDeliveryNoteNumber, deliveryNoteColumns } from './deliveryNoteDocument';
export { VENDOR_SCORECARD_CSV_HEADERS, vendorScorecard, vendorScorecardCsvRows } from './vendorScorecard';
export { customerOpenQuotes, acceptQuoteProblem } from './customerQuotes';
export { reorderSuggestions, reorderDraftOrders } from './reorderSuggestions';
export { landedCostPreview, landedCostProblem, spreadCents } from './landedCostPreview';
export { DEFAULT_DUNNING_SCHEDULE, dunningLetter, dunningStepDue, nextDunningStep, dunningLogFor, dunningAmountText } from './dunningLetters';
export { MILESTONE_BILLING_CSV_HEADERS, milestoneBilling, milestoneBillingCsvRows } from './milestoneBilling';
export { readScan, findItemByBarcode, isScannerBurst } from './barcodeScan';
export { readPriceListCsv, planPriceListImport, parseMoneyCents } from './priceListImport';

/**
 * AI #3 (Arena) A-51 to A-55 (13 Oct): the Canada filing calendar, the UK VAT schemes, the US use
 * tax review and the US exemption certificate types. Tables carry dated rows with official sources;
 * the review is a pure function over the documents it is given. Nothing files, accrues or posts.
 * The matching rule packs (caFilingPack, euReverseChargePack, ukSchemesPack, usUseTaxPack) are
 * registered in `taxRulePacks()` and exported from `./rules/packs/index` above.
 */
export { CA_FILING_CALENDAR, CA_FILING_TAXES, CA_GST_HST_BANDS, caFilingRows, caFilingBandFor, caFilingCalendarProblems } from './tax/caFilingCalendar';
export { UK_FRS_CATEGORIES, UK_VAT_SCHEME_THRESHOLDS, UK_FRS_FIRST_YEAR_DISCOUNT_POINTS, ukFrsCategory, ukFrsPercent, ukSchemeProblems } from './tax/ukVatSchemes';
export { USE_TAX_STATES, USE_TAX_CSV_HEADERS, reviewUseTax, reviewUseTaxCsvRows } from './tax/usUseTax';
export { US_EXEMPTION_CERTIFICATE_TYPES, SST_MEMBER_STATES, SST_MEMBER_ROW, CERTIFICATE_TYPE_IDS, certificateAcceptance, exemptionCertificateType, certificateTypeName, exemptionCertificateProblems } from './tax/usExemptionCertificates';
export { ilImportServicesPack, importBillsReview, importBillsCsvRows, vendorCountryOf, IMPORT_BILLS_CSV_HEADERS } from './tax/ilImportServices';
export { IL_VAT_REPORT_FREQUENCY, IL_BIMONTHLY_TURNOVER_CEILING_CENTS, assignedFrequency, frequencyCheck, ilVatFrequencyPack, ilVatFrequencyProblems } from './tax/ilVatFilingFrequency';
