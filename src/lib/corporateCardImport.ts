/**
 * A-134: Corporate card statement import to expense claims (CSV).
 *
 * Reads a corporate credit/charge card CSV statement by column name, converts valid card charges
 * into plain expense claim draft lines (whole minor units + decimal text for the existing claim
 * editor), skips card payments/refunds cleanly with an explicit count, refuses rows with malformed
 * dates or amounts rather than half-importing them, refuses statements whose explicit currency
 * column disagrees with the open claim's currency (no exchange rate is guessed), and flags rows
 * that match an existing expense claim line in the books so a card charge is not claimed twice by
 * accident.
 *
 * Pure module: never reads files directly, never writes to the database, and never alters expense
 * claim submission or posting.
 */
import type { Bill } from '../types';
import { parseAmountToCents } from './utils';

export interface CorporateCardCharge {
  rowNumber: number;
  date: string;
  description: string;
  amountCents: number;
  /** Formatted two-decimal major units matching ExpenseClaims DraftLine.amount */
  amountText: string;
  currency?: string;
  cardholder?: string;
  reference?: string;
  duplicateOf?: string;
}

export interface CorporateCardImportResult {
  charges: CorporateCardCharge[];
  skippedCreditsCount: number;
  duplicateCount: number;
  statementDate: string;
}

function splitCsvRecords(text: string): string[][] {
  const cleaned = String(text ?? '').replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (quoted) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && cleaned[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some(v => v.trim() !== '')) records.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some(v => v.trim() !== '')) records.push(row);
  if (quoted) throw new Error('Corporate card CSV has an unclosed quote.');
  return records;
}

const normHeader = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function pickColumn(headers: string[], candidates: string[]): number {
  const normed = headers.map(normHeader);
  for (const c of candidates) {
    const exact = normed.indexOf(c);
    if (exact >= 0) return exact;
  }
  for (const c of candidates) {
    const partial = normed.findIndex(h => h.includes(c));
    if (partial >= 0) return partial;
  }
  return -1;
}

/** Strict calendar date normalization to YYYY-MM-DD (ISO YYYY-MM-DD or unambiguous US MM/DD/YYYY when day > 12 or YYYY last). */
export function parseCardStatementDate(raw: string): string | null {
  const trimmed = String(raw ?? '').trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    const yn = Number(y), mn = Number(m), dn = Number(d);
    if (yn >= 1990 && yn <= 2100 && mn >= 1 && mn <= 12 && dn >= 1 && dn <= 31) return `${y}-${m}-${d}`;
    return null;
  }
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, mm, dd, yyyy] = slash;
    const yn = Number(yyyy), mn = Number(mm), dn = Number(dd);
    if (yn >= 1990 && yn <= 2100 && mn >= 1 && mn <= 12 && dn >= 1 && dn <= 31) {
      return `${yyyy}-${String(mn).padStart(2, '0')}-${String(dn).padStart(2, '0')}`;
    }
  }
  return null;
}

function parseSignedAmountCents(raw: string): number | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  const parenNeg = /^\(.*\)$/.test(trimmed);
  const stripped = trimmed.replace(/[()]/g, '').replace(/[$€£₪,\s]/g, '');
  if (!/^[+-]?\d+(\.\d{1,4})?$/.test(stripped)) return null;
  const neg = parenNeg || stripped.startsWith('-');
  const absCents = parseAmountToCents(stripped.replace(/^[+-]/, ''));
  return neg ? -absCents : absCents;
}

function existingClaimSignatures(existingBills: Bill[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const bill of existingBills || []) {
    if (!bill.metadata?.expenseClaim || bill.status === 'void' || bill.status === 'cancelled') continue;
    const billDay = String(bill.date || bill.issueDate || '').slice(0, 10);
    const label = bill.number || bill.id;
    for (const split of bill.splits || []) {
      const desc = String(split.description || '').trim().toLowerCase();
      const cents = Math.abs(Math.round(Number(split.amountCents) || 0));
      if (cents > 0) {
        map.set(`${billDay}|${cents}|${desc}`, label);
        map.set(`*|${cents}|${desc}`, label);
      }
    }
  }
  return map;
}

/**
 * Parse a corporate card CSV statement for an open expense claim.
 * All-or-nothing validation: any malformed row refuses the whole import listing every problem.
 */
export function parseCorporateCardCsv(
  csvText: string,
  options: { claimCurrency?: string; existingBills?: Bill[] } = {},
): CorporateCardImportResult {
  const rows = splitCsvRecords(csvText);
  if (rows.length < 2) {
    throw new Error('The corporate card CSV has no charge rows to import.');
  }
  const headers = rows[0];
  const dateCol = pickColumn(headers, ['transaction date', 'post date', 'date', 'posted date', 'charge date']);
  const descCol = pickColumn(headers, ['description', 'merchant', 'merchant name', 'payee', 'vendor', 'narrative', 'details']);
  const amountCol = pickColumn(headers, ['amount', 'charge amount', 'billing amount', 'total']);
  const debitCol = pickColumn(headers, ['debit', 'charge']);
  const creditCol = pickColumn(headers, ['credit', 'payment']);
  const currencyCol = pickColumn(headers, ['currency', 'billing currency', 'ccy']);
  const holderCol = pickColumn(headers, ['cardholder', 'employee', 'member name', 'card member', 'name on card']);
  const refCol = pickColumn(headers, ['reference', 'transaction id', 'ref', 'card last 4', 'card']);

  const missing: string[] = [];
  if (dateCol < 0) missing.push('Date');
  if (descCol < 0) missing.push('Description / Merchant');
  if (amountCol < 0 && debitCol < 0) missing.push('Amount (or Debit)');
  if (missing.length > 0) {
    throw new Error(`Corporate card CSV is missing required column(s): ${missing.join(', ')}.`);
  }

  const expectedCurrency = options.claimCurrency?.trim().toUpperCase();
  const seenClaims = existingClaimSignatures(options.existingBills);
  const problems: string[] = [];
  const charges: CorporateCardCharge[] = [];
  let skippedCreditsCount = 0;

  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const lineNo = r + 1;
    const rawDate = cols[dateCol] ?? '';
    const date = parseCardStatementDate(rawDate);
    if (!date) {
      problems.push(`Row ${lineNo}: invalid date "${rawDate.trim() || '(empty)'}" (use YYYY-MM-DD or MM/DD/YYYY)`);
      continue;
    }
    const rawDesc = String(cols[descCol] ?? '').trim();
    if (!rawDesc) {
      problems.push(`Row ${lineNo}: missing merchant / description`);
      continue;
    }

    let signedCents: number;
    if (debitCol >= 0 && ((cols[debitCol] ?? '').trim() !== '' || (creditCol >= 0 && (cols[creditCol] ?? '').trim() !== ''))) {
      const dRaw = (cols[debitCol] ?? '').trim();
      const cRaw = creditCol >= 0 ? (cols[creditCol] ?? '').trim() : '';
      const dVal = dRaw ? parseSignedAmountCents(dRaw) : 0;
      const cVal = cRaw ? parseSignedAmountCents(cRaw) : 0;
      if (dVal === null || cVal === null) {
        problems.push(`Row ${lineNo}: unreadable debit/credit amount`);
        continue;
      }
      signedCents = Math.abs(dVal) - Math.abs(cVal);
    } else {
      const parsed = parseSignedAmountCents(cols[amountCol] ?? '');
      if (parsed === null) {
        problems.push(`Row ${lineNo}: invalid amount "${String(cols[amountCol] ?? '').trim() || '(empty)'}"`);
        continue;
      }
      signedCents = parsed;
    }

    const rowCurrency = currencyCol >= 0 ? String(cols[currencyCol] ?? '').trim().toUpperCase() : '';
    if (rowCurrency && expectedCurrency && rowCurrency !== expectedCurrency) {
      problems.push(`Row ${lineNo}: card currency ${rowCurrency} differs from claim currency ${expectedCurrency} (no exchange rate is guessed)`);
      continue;
    }

    if (signedCents <= 0) {
      skippedCreditsCount += 1;
      continue;
    }

    const reference = refCol >= 0 ? String(cols[refCol] ?? '').trim() || undefined : undefined;
    const cardholder = holderCol >= 0 ? String(cols[holderCol] ?? '').trim() || undefined : undefined;
    const description = `${date} · ${rawDesc}${reference ? ` (${reference})` : ''}`;
    const dup =
      seenClaims.get(`${date}|${signedCents}|${description.toLowerCase()}`) ||
      seenClaims.get(`${date}|${signedCents}|${rawDesc.toLowerCase()}`) ||
      seenClaims.get(`*|${signedCents}|${description.toLowerCase()}`);

    charges.push({
      rowNumber: lineNo,
      date,
      description,
      amountCents: signedCents,
      amountText: (signedCents / 100).toFixed(2),
      ...(rowCurrency ? { currency: rowCurrency } : {}),
      ...(cardholder ? { cardholder } : {}),
      ...(reference ? { reference } : {}),
      ...(dup ? { duplicateOf: dup } : {}),
    });
  }

  if (problems.length > 0) {
    throw new Error(`Could not import corporate card CSV: ${problems.join('; ')}`);
  }
  if (charges.length === 0) {
    throw new Error('The corporate card CSV had no positive charge rows to import.');
  }

  const latestDate = charges.reduce((acc, c) => (c.date > acc ? c.date : acc), charges[0].date);
  return {
    charges,
    skippedCreditsCount,
    duplicateCount: charges.filter(c => Boolean(c.duplicateOf)).length,
    statementDate: latestDate,
  };
}
