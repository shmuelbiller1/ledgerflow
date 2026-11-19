/**
 * EG-14: opening open items. The unpaid customer invoices (or vendor bills) of the old system as of the cut-over
 * date — the workspace's opening-balance date (openingBalanceService.ts) — read from a CSV with the columns
 * number, contact, date, due date, currency, amount and amount still open. Columns are found by name (the
 * E-28 Xero reader's findColumn, so a Xero "Aged receivables" export with these headings reads too); dates are
 * YYYY-MM-DD; amounts in the workspace currency's minor units (currencyMinorUnits.ts).
 *
 * Each good row becomes one open invoice (bill) dated on its own date, for its open amount, booked against
 * Opening Balance Equity (partyOpeningBalance.ts), so receivables (payables) equal the open total and no sale or
 * expense is made. The full amount is kept on the document's metadata, for reference only.
 *
 * Each row says what is wrong with it, if anything: a number missing or seen twice for the same contact (in the file
 * or already in the books), a date after the cut-over, an open amount above the amount, a currency other than the
 * workspace's (nothing is converted), an unknown contact. Shared by the server (which reads the file again and posts)
 * and the screen's preview.
 */
import { parseCsvChecked } from './csv';
import { bankStatementDate } from './bankStatementDate';
import { findColumn } from './xeroDocumentsImport';
import { currencyDigits } from './currencyMinorUnits';

export type OpenItemSide = 'customer' | 'vendor';

export interface OpenItemRow {
  /** 1-based line in the file */
  line: number;
  number: string;
  contactName: string;
  /** the contact's id, when it is known */
  contactId?: string;
  date: string;
  dueDate: string;
  currency: string;
  amountCents: number;
  openCents: number;
  problem: string | null;
}

export interface OpenItemReadOptions {
  /** the opening-balance date: no row may be dated after it */
  cutOverDate: string;
  /** the workspace's currency; a row in another currency is refused */
  currency: string;
  /** the workspace's customers (or vendors) */
  contacts: ReadonlyArray<{ id: string; name: string }>;
  /** the invoices (bills) already in the books, to refuse a second copy */
  existing?: ReadonlyArray<{ number?: string; contactId?: string; contactName?: string }>;
}

export interface OpenItemRead {
  rows: OpenItemRow[];
  /** the open total of the rows without a problem */
  openTotalCents: number;
  /** a problem with the file as a whole (no rows read) */
  fileProblem: string | null;
}

const COLUMNS = {
  number: ['number', 'invoice number', 'bill number', 'invoicenumber', 'billnumber', 'document number', 'invoice no'],
  contact: ['contact', 'contact name', 'contactname', 'customer', 'vendor', 'supplier', 'customer name', 'vendor name'],
  date: ['date', 'invoice date', 'bill date', 'issue date'],
  dueDate: ['due date', 'duedate', 'due'],
  currency: ['currency', 'currency code', 'currencycode'],
  amount: ['amount', 'total', 'invoice total', 'bill total', 'original amount'],
  open: ['amount still open', 'open amount', 'amount open', 'open', 'amount due', 'amountdue', 'balance', 'outstanding', 'amount still owed', 'still due'],
} as const;

const keyOf = (number: string, contact: string) => `${contact.trim().toLowerCase()}|${number.trim().toLowerCase()}`;

function isoDay(value: string): string | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? bankStatementDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** `1,234.567` → minor units of `currency` (0 decimals for JPY, 3 for KWD, currencyMinorUnits.ts); no floating point. */
export function openItemMinorUnits(value: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  const input = String(value ?? '').replace(/[₪$€£¥]/g, '').replace(/\u00A0/g, '').trim();
  const fraction = digits ? `(?:\\.(\\d{1,${digits}}))?` : '';
  const m = input.match(new RegExp(`^(\\d{1,3}(?:,\\d{3})+|\\d+)${fraction}$`));
  if (!m) return null;
  const whole = m[1].replace(/,/g, '');
  if (whole.length > 14) return null;
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt((m[2] || '').padEnd(digits, '0') || '0');
  return minor > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(minor);
}

export function readOpenItemsCsv(csv: string, options: OpenItemReadOptions): OpenItemRead {
  let table: string[][];
  try {
    table = parseCsvChecked(csv).filter(r => r.some(c => c.trim()));
  } catch (err) {
    return { rows: [], openTotalCents: 0, fileProblem: err instanceof Error ? err.message : String(err) };
  }
  if (!table.length) return { rows: [], openTotalCents: 0, fileProblem: 'The file is empty' };
  const header = table[0];
  // the open amount first: "amount still open" also starts with "amount"
  const col = {
    number: findColumn(header, COLUMNS.number), contact: findColumn(header, COLUMNS.contact),
    date: findColumn(header, COLUMNS.date), dueDate: findColumn(header, COLUMNS.dueDate),
    currency: findColumn(header, COLUMNS.currency), open: findColumn(header, COLUMNS.open),
    amount: -1,
  };
  col.amount = header.findIndex((cell, i) => i !== col.open && findColumn([cell], COLUMNS.amount) === 0);
  const missing = (Object.keys(col) as Array<keyof typeof col>).filter(k => col[k] < 0);
  if (missing.length) {
    return { rows: [], openTotalCents: 0, fileProblem: `Columns missing: ${missing.join(', ')}. The first line must name the columns number, contact, date, due date, currency, amount, amount still open` };
  }

  const contacts = new Map<string, { id: string; name: string }>();
  const ambiguous = new Set<string>();
  for (const c of options.contacts) {
    const k = c.name.trim().toLowerCase();
    if (contacts.has(k)) ambiguous.add(k);
    else contacts.set(k, c);
  }
  const contactNames = new Map(options.contacts.map(c => [c.id, c.name]));
  const booked = new Set((options.existing || []).map(d => keyOf(d.number || '', (d.contactId && contactNames.get(d.contactId)) || d.contactName || '')));
  const seen = new Set<string>();
  const currency = options.currency.toUpperCase();

  const rows = table.slice(1).map((cells, i): OpenItemRow => {
    const cell = (k: keyof typeof col) => String(cells[col[k]] ?? '').trim();
    const number = cell('number');
    const contactName = cell('contact');
    const isAmbiguous = ambiguous.has(contactName.toLowerCase());
    const contact = isAmbiguous ? undefined : contacts.get(contactName.toLowerCase());
    const date = isoDay(cell('date'));
    const dueRaw = cell('dueDate');
    const dueDate = dueRaw ? isoDay(dueRaw) : date;
    const rowCurrency = (cell('currency') || currency).toUpperCase();
    const amount = openItemMinorUnits(cell('amount'), currency);
    const open = openItemMinorUnits(cell('open'), currency);
    const key = keyOf(number, contactName);
    let problem: string | null = null;
    if (!number) problem = 'The number is missing';
    else if (!contactName) problem = 'The contact is missing';
    else if (isAmbiguous) problem = `More than one contact is named "${contactName}": rename one so the row names a single contact`
    else if (!contact) problem = `"${contactName}" is not in your contacts: add it first`;
    else if (!date) problem = 'The date must be a real date written YYYY-MM-DD';
    else if (!dueDate) problem = 'The due date must be a real date written YYYY-MM-DD';
    else if (dueDate < date) problem = 'Due before its own date';
    else if (date > options.cutOverDate) problem = `Dated after the cut-over date (${options.cutOverDate}): enter it as a normal invoice or bill`;
    else if (rowCurrency !== currency) problem = `In ${rowCurrency}, not ${currency}: nothing is converted, so enter it by hand`;
    else if (amount === null || amount <= 0) problem = `The amount must be above 0, with at most ${currencyDigits(currency)} decimals for ${currency}`;
    else if (open === null || open <= 0) problem = `The amount still open must be above 0, with at most ${currencyDigits(currency)} decimals for ${currency}`;
    else if (open > amount) problem = 'The amount still open is more than the amount';
    else if (seen.has(key)) problem = 'The same number appears twice for this contact';
    else if (booked.has(key)) problem = 'Already in the books for this contact';
    if (number && contactName) seen.add(key);
    return {
      line: i + 2, number, contactName, ...(contact ? { contactId: contact.id, contactName: contact.name } : {}),
      date: date || cell('date'), dueDate: dueDate || dueRaw, currency: rowCurrency,
      amountCents: amount ?? 0, openCents: open ?? 0, problem,
    };
  });
  return { rows, openTotalCents: rows.filter(r => !r.problem).reduce((s, r) => s + r.openCents, 0), fileProblem: rows.length ? null : 'The file has no rows under its headings' };
}
