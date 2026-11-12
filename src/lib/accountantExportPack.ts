/**
 * E-58: the accountant export pack — trial balance, general ledger, A/R, A/P and tax liability by
 * period, built from the same figures the screens show and written as spreadsheet-safe CSV files
 * (UTF-8 byte-order mark) in one ZIP.
 *
 * Read-only presentation: the arithmetic is the existing pure report code (`computeTrialBalance`,
 * `computeGeneralLedger`, `computePartyAging`, `buildTaxReturn`), so the pack can never disagree
 * with the screens by using a second formula. Nothing here posts, files, or changes a record.
 *
 * Limits, stated on the screen and in the pack's README:
 * - the browser holds a capped copy of each list (src/lib/ledgerCollections.ts); a list that hit
 *   its limit blocks the download instead of shipping an incomplete pack;
 * - A/R and A/P show what is still open on the export day, not the balance at the period end
 *   (open documents are current state, not a dated snapshot);
 * - tax liability is grouped by calendar month inside the chosen period, using the Tax return
 *   screen's rules (draft and voided documents left out, home currency).
 */
import { computeGeneralLedger, computeTrialBalance } from '../server/reports/computeReports';
import { computePartyAging } from './aging';
import type { PartyAgingRow } from './aging';
import { csvMoney, toCsv } from './csvExport';
import type { CsvValue } from './csvExport';
import { buildTaxReturn } from './taxReturnDocs';
import type { TaxableDocument } from './taxReturnDocs';
import { makeStoredZip } from './workspaceArchive';
import type { Bill, ChartAccount, CreditNote, Customer, Invoice, Transaction, Vendor, VendorCredit } from '../types';
import { trimChar } from './textShape';

export const ACCOUNTANT_PACK_FORMAT = 'ledgerflow-accountant-pack-v1';
/** More general-ledger lines than this in one pack is refused: narrow the period instead. */
export const ACCOUNTANT_PACK_MAX_LEDGER_ROWS = 100000;

export type AccountantSectionKey = 'trial-balance' | 'general-ledger' | 'receivables' | 'payables' | 'tax-by-period';

export interface AccountantPackSection {
  key: AccountantSectionKey;
  title: string;
  /** file inside the ZIP (no folder) */
  fileName: string;
  headers: string[];
  rows: CsvValue[][];
  /** what the section does not show */
  notes: string[];
}

export interface AccountantPackTotals {
  debitCents: number;
  creditCents: number;
  /** what is still open on the aging day */
  receivableCents: number;
  payableCents: number;
  /** collected minus reclaimable over the whole period (negative: to reclaim) */
  taxDueCents: number;
}

export interface AccountantPack {
  format: typeof ACCOUNTANT_PACK_FORMAT;
  workspaceName: string;
  currency: string;
  startDate: string;
  endDate: string;
  /** day the A/R and A/P open balances were read (YYYY-MM-DD) */
  asOfDate: string;
  generatedAt: string;
  sections: AccountantPackSection[];
  warnings: string[];
  totals: AccountantPackTotals;
}

export interface AccountantPackInput {
  workspaceName: string;
  currency: string;
  startDate: string;
  endDate: string;
  asOfDate: string;
  generatedAt: string;
  accounts: ChartAccount[];
  transactions: Transaction[];
  invoices: Invoice[];
  bills: Bill[];
  customers: Customer[];
  vendors: Vendor[];
  creditNotes?: CreditNote[];
  vendorCredits?: VendorCredit[];
  /** show chart-of-accounts rows with no opening balance and no movement (default: leave them out) */
  includeEmptyAccounts?: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/** `2026-01-31` → `2026-01`. */
function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Last day of a `YYYY-MM` month, without a Date object (no time zone can move it). */
export function monthEndISO(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const lengths = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return `${month}-${String(lengths[monthNumber - 1] ?? 30).padStart(2, '0')}`;
}

/** The calendar months that overlap [startDate, endDate], clipped to it. */
export function packMonths(startDate: string, endDate: string): Array<{ month: string; from: string; to: string }> {
  if (!DAY.test(startDate) || !DAY.test(endDate) || startDate > endDate) throw new Error('Choose a valid period: the start date must not be after the end date.');
  const months: Array<{ month: string; from: string; to: string }> = [];
  let month = monthOf(startDate);
  while (month <= monthOf(endDate)) {
    if (!MONTH.test(month)) throw new Error('Choose a valid period.');
    const from = `${month}-01`;
    const to = monthEndISO(month);
    months.push({
      month,
      from: from < startDate ? startDate : from,
      to: to > endDate ? endDate : to,
    });
    const year = Number(month.slice(0, 4));
    const next = Number(month.slice(5, 7)) + 1;
    month = next > 12 ? `${year + 1}-01` : `${month.slice(0, 4)}-${String(next).padStart(2, '0')}`;
    if (months.length > 600) throw new Error('The period is longer than 50 years.');
  }
  return months;
}

/** A file-name-safe workspace name: `Galil Design` → `galil-design`. */
export function packSlug(name: string): string {
  const slug = trimChar((name || '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-'), '-').toLowerCase().slice(0, 40);
  return slug || 'workspace';
}

export function accountantPackFileName(pack: Pick<AccountantPack, 'workspaceName' | 'startDate' | 'endDate'>): string {
  return `accountant-pack-${packSlug(pack.workspaceName)}-${pack.startDate}-to-${pack.endDate}.zip`;
}

function moneyHeader(currency: string): string {
  return currency || 'base currency';
}

function trialBalanceSection(input: AccountantPackInput): { section: AccountantPackSection; totalDebit: number; totalCredit: number; isBalanced: boolean } {
  const currency = moneyHeader(input.currency);
  const balance = computeTrialBalance(input.accounts, input.transactions, input.endDate);
  const keep = (row: { debit: number; credit: number; netSigned: number }) =>
    input.includeEmptyAccounts || row.debit !== 0 || row.credit !== 0 || row.netSigned !== 0;
  const rows = balance.accounts
    .filter(keep)
    .sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name) || a.name.localeCompare(b.name));
  const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);
  return {
    totalDebit,
    totalCredit,
    isBalanced: balance.isBalanced,
    section: {
      key: 'trial-balance',
      title: 'Trial balance',
      fileName: 'trial-balance.csv',
      headers: ['Account code', 'Account name', 'Type', `Debit (${currency})`, `Credit (${currency})`, `Balance in account direction (${currency})`],
      rows: [
        ...rows.map(row => [row.code || '', row.name, row.type, csvMoney(row.debit), csvMoney(row.credit), csvMoney(row.netSigned)]),
        ['', 'Total', '', csvMoney(totalDebit), csvMoney(totalCredit), ''],
      ],
      notes: [
        `As of ${input.endDate}; posted entries only (draft, void and parked entries are left out).`,
        input.includeEmptyAccounts ? 'Every account in the chart is listed.' : 'Accounts with no opening balance and no movement in the books are left out.',
        'Opening balances use the account\'s own direction, as the Trial Balance screen does: a positive balance is a debit for assets, expenses and cost of goods, and a credit for liabilities, equity and revenue.',
      ],
    },
  };
}

function generalLedgerSection(input: AccountantPackInput): { section: AccountantPackSection; rows: number } {
  const currency = moneyHeader(input.currency);
  const ledger = computeGeneralLedger(input.accounts, input.transactions, input.startDate, input.endDate);
  const rows: CsvValue[][] = [];
  for (const account of ledger.accounts) {
    const code = account.accountCode || '';
    const name = account.accountName;
    const moved = account.openingBalanceCents !== 0 || account.entries.length > 0 || account.periodDebitsCents !== 0 || account.periodCreditsCents !== 0;
    if (!moved) continue;
    rows.push([code, name, '', 'Opening balance', '', '', '', '', '', csvMoney(account.openingBalanceCents)]);
    for (const entry of account.entries) {
      rows.push([
        code, name, entry.date, 'Entry', entry.transactionId || '', entry.description || '', entry.reference || '',
        entry.debitCents ? csvMoney(entry.debitCents) : '', entry.creditCents ? csvMoney(entry.creditCents) : '',
        csvMoney(entry.runningBalanceCents),
      ]);
    }
    rows.push([
      code, name, '', `Account total ${input.startDate} to ${input.endDate}`, '', '', '', '', '',
      csvMoney(account.endingBalanceCents),
    ]);
    if (rows.length > ACCOUNTANT_PACK_MAX_LEDGER_ROWS) {
      throw new Error(`This period has more than ${ACCOUNTANT_PACK_MAX_LEDGER_ROWS.toLocaleString('en-US')} ledger lines. Narrow the period and prepare the pack again.`);
    }
  }
  return {
    rows: rows.length,
    section: {
      key: 'general-ledger',
      title: 'General ledger',
      fileName: 'general-ledger.csv',
      headers: ['Account code', 'Account name', 'Date', 'Row type', 'Transaction', 'Description', 'Reference', `Debit (${currency})`, `Credit (${currency})`, `Running balance (${currency})`],
      rows,
      notes: [
        `Posted entries from ${input.startDate} to ${input.endDate}, one block per account with its opening balance.`,
        'The account total row carries the closing balance in the Running balance column.',
        'Rows follow the General Ledger screen (posted only, home currency).',
      ],
    },
  };
}

function agingRows(rows: PartyAgingRow[]): CsvValue[][] {
  return rows.map(row => [
    row.partyName,
    csvMoney(row.buckets.current), csvMoney(row.buckets.d1_30), csvMoney(row.buckets.d31_60),
    csvMoney(row.buckets.d61_90), csvMoney(row.buckets.d90plus), csvMoney(row.total),
  ]);
}

function agingSection(
  key: 'receivables' | 'payables',
  input: AccountantPackInput,
): { section: AccountantPackSection; total: number } {
  const currency = moneyHeader(input.currency);
  const side = key === 'receivables' ? 'customer' : 'vendor';
  const parties = side === 'customer' ? input.customers : input.vendors;
  const documents = side === 'customer' ? input.invoices : input.bills;
  const rows = computePartyAging(
    parties.map(party => ({ id: party.id, name: party.name })),
    documents as Array<Invoice | Bill>,
    side,
    input.asOfDate,
    input.currency,
  );
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const buckets = rows.reduce(
    (sum, row) => sum + row.buckets.current + row.buckets.d1_30 + row.buckets.d31_60 + row.buckets.d61_90 + row.buckets.d90plus,
    0,
  );
  return {
    total,
    section: {
      key,
      title: key === 'receivables' ? 'Accounts receivable' : 'Accounts payable',
      fileName: key === 'receivables' ? 'accounts-receivable.csv' : 'accounts-payable.csv',
      headers: [
        side === 'customer' ? 'Customer' : 'Vendor',
        `Not yet due (${currency})`, `1–30 days (${currency})`, `31–60 days (${currency})`,
        `61–90 days (${currency})`, `Over 90 days (${currency})`, `Total (${currency})`,
      ],
      rows: [...agingRows(rows), [
        'Total',
        csvMoney(rows.reduce((sum, row) => sum + row.buckets.current, 0)),
        csvMoney(rows.reduce((sum, row) => sum + row.buckets.d1_30, 0)),
        csvMoney(rows.reduce((sum, row) => sum + row.buckets.d31_60, 0)),
        csvMoney(rows.reduce((sum, row) => sum + row.buckets.d61_90, 0)),
        csvMoney(rows.reduce((sum, row) => sum + row.buckets.d90plus, 0)),
        csvMoney(buckets),
      ]],
      notes: [
        `What is still open on ${input.asOfDate}, in the home currency: this is the current position, not the balance at ${input.endDate}.`,
        'Open documents only, after deposits, payments and applied credits; the buckets follow days past the due date (the document date when there is none), as the aging screens do.',
        key === 'receivables' ? 'Customers with nothing open are left out.' : 'Vendors with nothing open are left out.',
      ],
    },
  };
}

function taxSection(input: AccountantPackInput): { section: AccountantPackSection; total: number } {
  const currency = moneyHeader(input.currency);
  const months = packMonths(input.startDate, input.endDate);
  const rows: CsvValue[][] = [];
  const totals = { documents: 0, output: 0, reverse: 0, due: 0, reclaimable: 0, net: 0, sales: 0, purchases: 0 };
  for (const month of months) {
    const taxReturn = buildTaxReturn({
      invoices: input.invoices as unknown as TaxableDocument[],
      bills: input.bills as unknown as TaxableDocument[],
      creditNotes: (input.creditNotes || []) as unknown as TaxableDocument[],
      vendorCredits: (input.vendorCredits || []) as unknown as TaxableDocument[],
      startDate: month.from,
      endDate: month.to,
    });
    const box = (key: string) => taxReturn.boxes.find(b => b.key === key)?.cents ?? 0;
    const values = {
      documents: taxReturn.documentCount,
      output: box('1'), reverse: box('2'), due: box('3'), reclaimable: box('4'), net: box('5'), sales: box('6'), purchases: box('7'),
    };
    totals.documents += values.documents;
    totals.output += values.output;
    totals.reverse += values.reverse;
    totals.due += values.due;
    totals.reclaimable += values.reclaimable;
    totals.net += values.net;
    totals.sales += values.sales;
    totals.purchases += values.purchases;
    rows.push([
      month.month, month.from, month.to, String(values.documents),
      csvMoney(values.output), csvMoney(values.reverse), csvMoney(values.due), csvMoney(values.reclaimable), csvMoney(values.net),
      csvMoney(values.sales), csvMoney(values.purchases),
    ]);
  }
  rows.push([
    'Total', input.startDate, input.endDate, String(totals.documents),
    csvMoney(totals.output), csvMoney(totals.reverse), csvMoney(totals.due), csvMoney(totals.reclaimable), csvMoney(totals.net),
    csvMoney(totals.sales), csvMoney(totals.purchases),
  ]);
  return {
    total: totals.net,
    section: {
      key: 'tax-by-period',
      title: 'Tax liability by period',
      fileName: 'tax-liability-by-period.csv',
      headers: [
        'Period', 'From', 'To', 'Documents',
        `Tax on sales (${currency})`, `Reverse-charge tax (${currency})`, `Total tax due (${currency})`,
        `Tax reclaimable (${currency})`, `Net tax, negative to reclaim (${currency})`,
        `Sales excluding tax (${currency})`, `Purchases excluding tax (${currency})`,
      ],
      rows,
      notes: [
        'Calendar months inside the chosen period, from the same figures as the Tax return screen: invoices, bills, credit notes and vendor credits, home currency.',
        'Draft and voided documents are left out; nothing here files a return or claims a rate is verified.',
        'A document is counted in the month of its date (or issue date when it has none).',
      ],
    },
  };
}

/** Builds every section. Throws with a readable message when a period is invalid or the ledger is too large. */
export function buildAccountantPack(input: AccountantPackInput): AccountantPack {
  if (!DAY.test(input.startDate) || !DAY.test(input.endDate)) throw new Error('Choose a start and end date for the pack.');
  if (input.startDate > input.endDate) throw new Error('The start date must not be after the end date.');
  if (!DAY.test(input.asOfDate)) throw new Error('The aging date is not a valid date.');

  const trial = trialBalanceSection(input);
  const ledger = generalLedgerSection(input);
  const receivables = agingSection('receivables', input);
  const payables = agingSection('payables', input);
  const tax = taxSection(input);

  const warnings: string[] = [];
  if (!trial.isBalanced) {
    warnings.push(`The trial balance at ${input.endDate} does not balance: debits and credits differ. Check the books before sending this pack.`);
  }
  if (trial.totalDebit === 0 && trial.totalCredit === 0) {
    warnings.push('No posted entry falls in this period or before it: the pack has no ledger figures.');
  }
  if (input.invoices.length + input.bills.length === 0) {
    warnings.push('No invoice or bill is loaded for this workspace, so A/R, A/P and tax liability are empty.');
  }

  return {
    format: ACCOUNTANT_PACK_FORMAT,
    workspaceName: input.workspaceName,
    currency: input.currency,
    startDate: input.startDate,
    endDate: input.endDate,
    asOfDate: input.asOfDate,
    generatedAt: input.generatedAt,
    sections: [trial.section, ledger.section, receivables.section, payables.section, tax.section],
    warnings,
    totals: {
      debitCents: trial.totalDebit,
      creditCents: trial.totalCredit,
      receivableCents: receivables.total,
      payableCents: payables.total,
      taxDueCents: tax.total,
    },
  };
}

/** One section as CSV text (no byte-order mark; `packCsvFiles` adds it for files). */
export function sectionCsv(section: AccountantPackSection): string {
  return toCsv(section.headers, section.rows);
}

/** The README that travels with the CSVs: who, when, what is included and what is not. */
export function packReadme(pack: AccountantPack): string {
  const money = (cents: number) => csvMoney(cents);
  const lines = [
    `Accountant export pack — ${pack.workspaceName}`,
    '',
    `Period: ${pack.startDate} to ${pack.endDate}`,
    `A/R and A/P open balances read on: ${pack.asOfDate}`,
    `Currency: ${pack.currency}`,
    `Generated: ${pack.generatedAt}`,
    `Format: ${pack.format}`,
    '',
    'Files in this ZIP (each CSV starts with a UTF-8 byte-order mark, so Excel shows accents and Hebrew):',
    ...pack.sections.map(section => `- ${section.fileName}: ${section.title}`),
    '',
    'Cross-checks',
    `- Trial balance debits ${money(pack.totals.debitCents)} / credits ${money(pack.totals.creditCents)}${pack.totals.debitCents === pack.totals.creditCents ? ' (equal)' : ' (NOT equal — see warnings)'}.`,
    `- Accounts receivable open total ${money(pack.totals.receivableCents)}; accounts payable open total ${money(pack.totals.payableCents)}.`,
    `- Tax liability for the period ${money(pack.totals.taxDueCents)} (negative: to reclaim).`,
    '',
    'What this pack is not',
    '- It is built from the records loaded in the browser for this workspace. A list that reached its limit blocks the download on screen instead of shipping an incomplete pack.',
    '- A/R and A/P are the open balances on the day the pack was prepared, not a dated snapshot at the period end.',
    '- Tax liability is a calculation from recorded documents, not a filed return and not a claim that a rate is verified.',
    '- Nothing here is a statutory filing. Review the figures with your accountant before using them.',
    '',
  ];
  if (pack.warnings.length) {
    lines.push('Warnings', ...pack.warnings.map(warning => `- ${warning}`), '');
  }
  for (const section of pack.sections) {
    lines.push(`${section.title} (${section.fileName})`, ...section.notes.map(note => `- ${note}`), '');
  }
  return lines.join('\n');
}

export interface PackFile { path: string; content: string }

/** The ZIP entries: one CSV per section plus the README, all inside one folder. */
export function packCsvFiles(pack: AccountantPack): PackFile[] {
  const folder = `accountant-pack-${packSlug(pack.workspaceName)}-${pack.startDate}-to-${pack.endDate}`;
  return [
    { path: `${folder}/README.txt`, content: packReadme(pack) },
    ...pack.sections.map(section => ({ path: `${folder}/${section.fileName}`, content: '\uFEFF' + sectionCsv(section) })),
  ];
}

/** The whole pack as one downloadable ZIP (stored entries, no dependency). */
export function accountantPackZip(pack: AccountantPack): Blob {
  return makeStoredZip(packCsvFiles(pack));
}
