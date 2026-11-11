import { bankStatementDate } from './bankStatementDate';
import type { ParsedBankLine } from './mt940Parser';

export interface Camt053ParsedLine extends ParsedBankLine {
  currency?: string;
}

const MAX_SAFE_MAJOR = Math.floor((Number.MAX_SAFE_INTEGER - 100) / 100);
const isTagWord = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9_-]/.test(ch);

/** ASCII-only lowercasing preserves exact character indices against the original string. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, ch => ch.toLowerCase());
}

/** Finds `<tag…>` or `<ns:tag…>` starting at or after `from` in linear time. */
function findOpenTag(
  xml: string, lower: string, localName: string, from: number,
): { start: number; bodyStart: number; prefix: string; attributes: string } | null {
  const needle = localName.toLowerCase();
  let pos = from;
  while (pos < lower.length) {
    const lt = lower.indexOf('<', pos);
    if (lt === -1) return null;
    let p = lt + 1;
    let prefix = '';
    while (isTagWord(lower[p])) p++;
    if (lower[p] === ':') {
      prefix = lower.slice(lt + 1, p + 1);
      p++;
      const nameStart = p;
      while (isTagWord(lower[p])) p++;
      if (lower.slice(nameStart, p) !== needle) { pos = lt + 1; continue; }
    } else if (lower.slice(lt + 1, p) !== needle) {
      pos = lt + 1;
      continue;
    }
    if (xml[p] !== undefined && xml[p] !== '>' && xml[p] !== '/' && !/\s/.test(xml[p])) {
      pos = lt + 1;
      continue;
    }
    const gt = xml.indexOf('>', p);
    if (gt === -1) return null;
    if (xml[gt - 1] === '/') { pos = gt + 1; continue; } // self-closing element has no inner text
    return { start: lt, bodyStart: gt + 1, prefix, attributes: xml.slice(p, gt) };
  }
  return null;
}

/** Finds `</tag>` or `</ns:tag>` starting at or after `from`. */
function findCloseTag(xml: string, lower: string, prefix: string, localName: string, from: number): { bodyEnd: number; afterEnd: number } | null {
  const target = `</${prefix}${localName.toLowerCase()}`;
  let pos = from;
  while (pos < lower.length) {
    const idx = lower.indexOf(target, pos);
    if (idx === -1) return null;
    let p = idx + target.length;
    while (p < xml.length && /\s/.test(xml[p])) p++;
    if (xml[p] === '>') return { bodyEnd: idx, afterEnd: p + 1 };
    pos = idx + 2;
  }
  return null;
}

/** Extracts all top-level `<localName>…</localName>` blocks in one linear pass. */
function extractBlocks(xml: string, localName: string): string[] {
  const lower = asciiLower(xml);
  const blocks: string[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const open = findOpenTag(xml, lower, localName, cursor);
    if (!open) break;
    const close = findCloseTag(xml, lower, open.prefix, localName, open.bodyStart);
    if (!close) break;
    blocks.push(xml.slice(open.bodyStart, close.bodyEnd));
    cursor = close.afterEnd;
  }
  return blocks;
}

/** Extracts the inner text of the first `<localName>text</localName>` leaf element, or null. */
function firstLeafText(xml: string, localName: string): string | null {
  const lower = asciiLower(xml);
  let cursor = 0;
  while (cursor < xml.length) {
    const open = findOpenTag(xml, lower, localName, cursor);
    if (!open) return null;
    const close = findCloseTag(xml, lower, open.prefix, localName, open.bodyStart);
    if (!close) return null;
    const inner = xml.slice(open.bodyStart, close.bodyEnd);
    if (!inner.includes('<')) return inner;
    cursor = open.bodyStart;
  }
  return null;
}

/** Extracts the first `<Amt …>value</Amt>` or `<ns:Amt …>value</ns:Amt>` leaf element. */
function extractFirstAmt(xml: string): { attributes: string; value: string } | null {
  const lower = asciiLower(xml);
  let cursor = 0;
  while (cursor < xml.length) {
    const open = findOpenTag(xml, lower, 'Amt', cursor);
    if (!open) return null;
    const close = findCloseTag(xml, lower, open.prefix, 'Amt', open.bodyStart);
    if (!close) return null;
    const inner = xml.slice(open.bodyStart, close.bodyEnd);
    if (!inner.includes('<')) return { attributes: open.attributes, value: inner };
    cursor = open.bodyStart;
  }
  return null;
}

/** Extracts the first `<Dt>` or `<DtTm>` inside `<BookgDt>` / `<ValDt>`, falling back to any `<Dt>` / `<DtTm>` in the entry. */
function extractEntryDateText(entryXml: string): string | null {
  for (const container of ['BookgDt', 'ValDt']) {
    for (const sub of extractBlocks(entryXml, container)) {
      const dt = firstLeafText(sub, 'Dt') ?? firstLeafText(sub, 'DtTm');
      if (dt !== null) return dt;
    }
  }
  return firstLeafText(entryXml, 'Dt') ?? firstLeafText(entryXml, 'DtTm');
}

function parseAmountToCents(raw: string): number {
  const trimmed = raw.trim();
  const match = /^(\d{1,16})(?:[.,](\d{1,3}))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`CAMT.053 entry has an invalid amount ("${trimmed.slice(0, 40)}").`);
  }
  const whole = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(whole) || whole > MAX_SAFE_MAJOR) {
    throw new Error('CAMT.053 entry has an out-of-range amount.');
  }
  const fracPadded = (match[2] ?? '').padEnd(3, '0');
  const cents = whole * 100
    + Number.parseInt(fracPadded.slice(0, 2), 10)
    + (Number.parseInt(fracPadded[2], 10) >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(cents)) {
    throw new Error('CAMT.053 entry has an out-of-range amount.');
  }
  return cents;
}

export function parseCamt053Statement(content: string): Camt053ParsedLine[] {
  const lines: Camt053ParsedLine[] = [];

  for (const entryXml of extractBlocks(content, 'Ntry')) {
    const amt = extractFirstAmt(entryXml);
    const rawDateText = extractEntryDateText(entryXml);

    // Entries without any date element or amount element are skipped (preserving local-date.test.ts behavior)
    if (!amt || rawDateText === null) continue;

    const rawDate = rawDateText.trim();
    const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(rawDate);
    if (!ymdMatch) {
      throw new Error(`CAMT.053 entry has an invalid booking date ("${rawDate.slice(0, 32)}").`);
    }
    const validDate = bankStatementDate(
      Number.parseInt(ymdMatch[1], 10),
      Number.parseInt(ymdMatch[2], 10),
      Number.parseInt(ymdMatch[3], 10),
    );
    if (!validDate) {
      throw new Error(`CAMT.053 entry has an invalid calendar date ("${ymdMatch[0]}" is not a real calendar day).`);
    }

    const rawCents = parseAmountToCents(amt.value);
    const currency = /\bCcy="([A-Za-z]{3})"/i.exec(amt.attributes)?.[1]?.toUpperCase();
    const rawInd = firstLeafText(entryXml, 'CdtDbtInd');
    const ind = rawInd ? rawInd.trim().toUpperCase() : 'DBIT';
    if (ind !== 'CRDT' && ind !== 'DBIT') {
      throw new Error(`CAMT.053 entry has an unsupported CdtDbtInd ("${ind.slice(0, 16)}").`);
    }
    const rawRvsl = firstLeafText(entryXml, 'RvslInd')?.trim().toLowerCase();
    const reversed = rawRvsl === 'true' || rawRvsl === '1';
    const isCredit = reversed ? ind === 'DBIT' : ind === 'CRDT';
    const rawDesc = firstLeafText(entryXml, 'Ustrd') ?? firstLeafText(entryXml, 'AddtlNtryInf');

    lines.push({
      date: validDate,
      amountCents: isCredit ? rawCents : -rawCents,
      type: isCredit ? 'credit' : 'debit',
      description: rawDesc ? rawDesc.trim() : 'CAMT.053 Bank Entry',
      currency,
    });
  }

  return lines;
}
