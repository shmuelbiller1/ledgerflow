/**
 * E-31: conservative CAMT.053 entry importer. It does not replace the older
 * exploratory CAMT parser; this variant is only for the bank import staging UI.
 * No posting, guessed exchange rates, or silent omission of incomplete entries.
 *
 * Supported XML subset: one ISO 20022 camt.053 statement with one account,
 * entry-level signed direction, one unaggregated TxDtls at most per Ntry.
 * This is not an XML schema validator or a complete ISO 20022 implementation.
 */
import { bankStatementDate } from './bankStatementDate';
import type { ParsedBankLine } from './mt940Parser';
import { firstAmtElement } from './textShape';

const SIZE_LIMIT = 5_000_000;
const MAX_ENTRIES = 50_000;

function fail(message: string): never { throw new Error('CAMT.053: ' + message); }

/** Reject XML features that cannot be represented by the conservative subset. */
function cleanXml(raw: string): string {
  if (!raw || raw.length > SIZE_LIMIT) fail('Empty or oversized XML file (5 MB maximum).');
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(raw)) fail('DTD and custom entities are unsupported.');
  // XML namespace prefixes on elements only. Attributes and their values stay intact.
  return raw.replace(/(<\/?)([A-Za-z_][\w.-]*):(?=[A-Za-z_][\w.-]*[\s/>])/g, '$1')
    .replace(/^\uFEFF/, '');
}

function decode(value: string): string {
  const converted = value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    const name = entity.toLowerCase();
    const fixed: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (name in fixed) return fixed[name];
    const hex = name.startsWith('#x');
    const point = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isInteger(point) || point < 1 || point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)) fail('Invalid XML character reference.');
    return String.fromCodePoint(point);
  });
  if (/&(?:#|[A-Za-z])/.test(converted)) fail('Unsupported XML entity.');
  return converted;
}

/** Whole structural blocks must close; no partial-success extraction. */
function blocks(xml: string, tag: string): string[] {
  const start = new RegExp('<' + tag + '(?:\\s[^<>]*)?>', 'gi');
  const pair = new RegExp('<' + tag + '(?:\\s[^<>]*)?>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'gi');
  const opened = [...xml.matchAll(start)].length;
  const values = [...xml.matchAll(pair)].map(match => match[1]);
  if (opened !== values.length) fail('Missing closing <' + tag + '> element.');
  return values;
}

function field(xml: string, tag: string): string | null {
  const match = new RegExp('<' + tag + '(?:\\s[^<>]*)?>\\s*([^<]*)<\\/' + tag + '\\s*>', 'i').exec(xml);
  return match ? decode(match[1].trim()) : null;
}

function amount(raw: string | null, index: number): number {
  if (raw === null || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw))
    fail('Entry ' + index + ' needs a nonnegative amount with at most two decimal places.');
  const [whole, fraction = ''] = raw!.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (cents === 0n || cents > BigInt(Number.MAX_SAFE_INTEGER))
    fail('Entry ' + index + ' has a zero or out-of-range amount.');
  return Number(cents);
}

function bookDate(entry: string, index: number): string {
  const book = blocks(entry, 'BookgDt');
  if (book.length !== 1) fail('Entry ' + index + ' needs one booking date.');
  const iso = field(book[0], 'Dt');
  const match = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) fail('Entry ' + index + ' needs an unambiguous YYYY-MM-DD booking date.');
  const date = bankStatementDate(Number(match![1]), Number(match![2]), Number(match![3]));
  if (!date) fail('Entry ' + index + ' has an invalid booking date.');
  return date;
}

/** Parses a full single-account statement, not standalone <Ntry> fragments. */
export function parseCamt053Import(xmlSource: string, expectedCurrency: string): ParsedBankLine[] {
  const xml = cleanXml(xmlSource);
  if (!/<Document(?:\s[^<>]*)?>/i.test(xml) || !/<\/Document\s*>/i.test(xml) ||
      !/camt\.053/i.test(xmlSource)) fail('Expected a complete CAMT.053 Document.');
  const statements = blocks(xml, 'Stmt');
  if (statements.length !== 1) fail('Export exactly one bank statement per file.');
  const statement = statements[0];
  const accounts = blocks(statement, 'Acct');
  if (accounts.length !== 1 || !(field(accounts[0], 'IBAN') || field(accounts[0], 'Id')))
    fail('Statement needs exactly one identified account.');
  const accountCurrency = field(accounts[0], 'Ccy');
  if (accountCurrency && accountCurrency !== expectedCurrency.toUpperCase())
    fail('Account currency differs from workspace currency; no conversion will be guessed.');
  if (!/^[A-Z]{3}$/.test(expectedCurrency)) fail('Invalid workspace currency.');
  try {
    if (new Intl.NumberFormat('en', { style: 'currency', currency: expectedCurrency })
      .resolvedOptions().maximumFractionDigits !== 2) fail('Only two-decimal currencies are supported.');
  } catch { fail('Unsupported currency.'); }

  const entries = blocks(statement, 'Ntry');
  // PREV-6: an entry outside the statement would otherwise be dropped silently.
  if (blocks(xml, 'Ntry').length !== entries.length) fail('An entry is outside the statement; the file is damaged.');
  if (!entries.length || entries.length > MAX_ENTRIES)
    fail('Expected 1–50,000 complete entries.');
  const parsed: ParsedBankLine[] = [];
  for (const [index, entry] of entries.entries()) {
    const item = index + 1;
    const txDetails = blocks(entry, 'TxDtls');
    if (txDetails.length > 1 || blocks(entry, 'NtryDtls').length > 1)
      fail('Entry ' + item + ' contains multiple transaction details; review a detailed export.');
    if (/<(?:CcyXchg|XchgRate|CntrValAmt|RvslInd)\b/i.test(entry))
      fail('Entry ' + item + ' has currency conversion or reversal information that needs separate review.');
    const statuses = blocks(entry, 'Sts');
    // CAMT may express status as <Sts>BOOK</Sts> or <Sts><Cd>BOOK</Cd></Sts>.
    const status = statuses.length === 1 ? (field(statuses[0], 'Cd') ||
      (statuses[0].trim().match(/^(BOOK|BOOKED|PDNG|INFO)$/)?.[1] ?? null)) : null;
    if (statuses.length > 1 || !status || (status !== 'BOOK' && status !== 'BOOKED'))
      fail('Entry ' + item + ' is not booked or has an unknown status.');

    // Read the entry-level amount only, never a nested TxDtls amount.
    const envelope = entry.split(/<NtryDtls(?:\s[^<>]*)?>/i)[0];
    const money = firstAmtElement(envelope);
    if (!money) fail('Entry ' + item + ' has no entry-level amount.');
    const currency = /\bCcy\s*=\s*["']([A-Z]{3})["']/i.exec(money.attributes)?.[1];
    if (!currency) fail('Entry ' + item + ' has no currency.');
    if (currency !== expectedCurrency.toUpperCase())
      fail('Entry ' + item + ' currency ' + currency + ' differs from workspace currency.');
    const cents = amount(decode(money.value.trim()), item);
    const indicator = field(entry, 'CdtDbtInd');
    if (indicator !== 'CRDT' && indicator !== 'DBIT')
      fail('Entry ' + item + ' needs a CRDT or DBIT direction.');
    const signed = indicator === 'DBIT' ? -cents : cents;
    const reference = field(entry, 'NtryRef') || field(entry, 'AcctSvcrRef') ||
      field(entry, 'EndToEndId') || undefined;
    const description = field(entry, 'Ustrd') || field(entry, 'AddtlNtryInf') ||
      field(entry, 'AddtlTxInf') || (reference ? 'CAMT.053 entry ' + reference : 'CAMT.053 entry ' + item);
    parsed.push({
      date: bookDate(entry, item), amountCents: signed, description,
      ...(reference ? { reference } : {}), type: indicator === 'DBIT' ? 'debit' : 'credit',
    });
  }
  return parsed;
}
