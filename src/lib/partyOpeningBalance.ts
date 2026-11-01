/**
 * A customer's or vendor's opening balance (BA-02): what they owed you (or you owed them) on the
 * day the books start, entered as one open invoice (bill) booked against Opening Balance Equity.
 * It then shows in aging, statements and the contact's balance, and is paid like any other.
 */
import type { Bill, Invoice } from '../types';

export const OPENING_DOCUMENT_TYPE = 'opening-balance';

export function isOpeningBalanceDocument(doc: { metadata?: Record<string, unknown> | null }): boolean {
  return doc.metadata?.type === OPENING_DOCUMENT_TYPE;
}

interface Party { id: string; name: string }
interface Equity { id: string; name: string }

/** `detail` (CA-08): one open invoice or bill of the old system, with its own number and due date. */
interface OpeningDetail { number?: string; dueDate?: string }

/** The opening-balance invoice (customer) or bill (vendor); amounts in whole cents above zero. */
export function openingBalanceDocument(side: 'customer', party: Party, equity: Equity, amountCents: number, date: string, currency?: string, detail?: OpeningDetail): Partial<Invoice>;
export function openingBalanceDocument(side: 'vendor', party: Party, equity: Equity, amountCents: number, date: string, currency?: string, detail?: OpeningDetail): Partial<Bill>;
export function openingBalanceDocument(side: 'customer' | 'vendor', party: Party, equity: Equity, amountCents: number, date: string, currency?: string, detail?: OpeningDetail): Partial<Invoice> | Partial<Bill> {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('Enter an amount above 0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Enter the date the books start');
  const common = {
    number: detail?.number || `OB-${party.id.slice(0, 6).toUpperCase()}`,
    amountCents,
    date,
    dueDate: detail?.dueDate || date,
    ...(currency ? { currency } : {}),
    exchangeRate: 1,
    metadata: { type: OPENING_DOCUMENT_TYPE },
  };
  if (side === 'customer') {
    return {
      ...common, customerId: party.id, customerName: party.name, status: 'sent',
      items: [{ id: 'opening', description: 'Opening balance', quantity: 1, rateCents: amountCents, amountCents, accountId: equity.id }],
    };
  }
  return {
    ...common, vendorId: party.id, vendorName: party.name, status: 'pending',
    splits: [{ accountId: equity.id, amountCents, description: 'Opening balance' }],
  };
}

/**
 * Opening invoices and bills (CA-08): the unpaid invoices (or bills) of the old system, pasted from a
 * spreadsheet, one per line — contact, number, date, due date (optional), amount still owed — so
 * aging starts right on day one. Columns are split by tabs (a spreadsheet paste) or commas; a first
 * line of headings is skipped; dates are YYYY-MM-DD. Each line says what is wrong with it, if anything.
 */
export interface OpeningRow { line: number; partyName: string; number: string; date: string; dueDate: string; amountCents: number; problem: string | null }

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function cells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map(c => c.trim());
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const amountCents = (text: string): number => {
  const clean = text.replace(/[^0-9.-]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(clean)) return Number.NaN;
  return Math.round(Number(clean) * 100);
};

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * EG-14: the pasted lines (contact · number · date · due date (optional) · amount still owed) as the CSV the
 * server's open-item import reads (POST /api/v1/open-items/preview and /confirm). The amount still owed is both
 * the amount and the amount still open; the currency is left empty, so the workspace's is used. `lines[i]` is the
 * pasted line of the CSV's row i + 2 (the heading is row 1), so the server's per-row results map back to the paste.
 */
export function openingRowsCsv(text: string): { csv: string; lines: number[] } {
  const pasted = text.split(/\r?\n/).map((l, i) => ({ l, i: i + 1 })).filter(({ l }) => l.trim());
  if (pasted.length && /amount|customer|vendor|number|date/i.test(pasted[0].l) && !/\d{4}-\d{2}-\d{2}/.test(pasted[0].l)) pasted.shift();
  const out = ['contact,number,date,due date,currency,amount,amount still open'];
  for (const { l } of pasted) {
    const [contact = '', number = '', date = '', fourth = '', fifth = ''] = cells(l);
    const hasDue = fifth !== '';
    const owed = hasDue ? fifth : fourth;
    out.push([contact, number, date, hasDue ? fourth : '', '', owed, owed].map(csvCell).join(','));
  }
  return { csv: pasted.length ? out.join('\n') : '', lines: pasted.map(p => p.i) };
}

export function parseOpeningRows(text: string, startDate?: string): OpeningRow[] {
  const lines = text.split(/\r?\n/).map((l, i) => ({ l, i: i + 1 })).filter(({ l }) => l.trim());
  if (lines.length && /amount|customer|vendor|number|date/i.test(lines[0].l) && !/\d{4}-\d{2}-\d{2}/.test(lines[0].l)) lines.shift();
  const seen = new Set<string>();
  return lines.map(({ l, i }) => {
    const [partyName = '', number = '', date = '', fourth = '', fifth = ''] = cells(l);
    // the due date is optional: four columns are contact, number, date, amount
    const hasDue = fifth !== '';
    const dueDate = hasDue ? fourth : date;
    const cents = amountCents(hasDue ? fifth : fourth);
    let problem: string | null = null;
    if (!partyName) problem = 'Who owes it? The first column is the contact';
    else if (!number) problem = 'The invoice or bill number is missing';
    else if (!ISO.test(date)) problem = 'The date must be written YYYY-MM-DD';
    else if (!ISO.test(dueDate)) problem = 'The due date must be written YYYY-MM-DD';
    else if (dueDate < date) problem = 'Due before its own date';
    else if (startDate && date > startDate) problem = `Dated after the day the books start (${startDate}): enter it as a normal invoice or bill`;
    else if (!Number.isFinite(cents) || cents <= 0) problem = 'The amount still owed must be above 0';
    else if (seen.has(`${partyName.toLowerCase()}|${number.toLowerCase()}`)) problem = 'The same number appears twice for this contact';
    seen.add(`${partyName.toLowerCase()}|${number.toLowerCase()}`);
    return { line: i, partyName, number, date, dueDate, amountCents: Number.isFinite(cents) ? cents : 0, problem };
  });
}
