/**
 * A-182: read address-book exports (vCard `.vcf` from phones/Outlook/Apple Contacts and the
 * Google Contacts CSV) into the same checked table the existing list import uses
 * (Settings → Import data). This file only reshapes text: validation, the all-or-nothing
 * server save, and the server's own duplicate skip stay with `recordImport` /
 * `recordImportService`, untouched.
 *
 * Honesty rules: a card with no usable name is reported, never invented; extra email/phone
 * values are kept in Notes, never silently dropped; an unreadable encoding is reported.
 */
import { findDuplicateContactCandidates, type DuplicateMatchSignal, type ReviewContact, type ReviewContactKind } from './contactDuplicateReview';

/** Column names match the importer's customer/vendor field labels exactly. */
export const CONTACT_IMPORT_HEADERS = ['Name', 'Email', 'Phone', 'Tax ID', 'Address', 'Website', 'Notes'] as const;

export interface ContactFileRead {
  /** First row is CONTACT_IMPORT_HEADERS; the rest are contacts in file order. */
  table: string[][];
  problems: string[];
}

const joinPresent = (parts: (string | undefined)[], separator: string) =>
  parts.map(p => (p ?? '').trim()).filter(Boolean).join(separator);

/** vCard text un-escaping: `\,` `\;` `\\` and `\n`/`\N` per RFC 6350 §3.4. */
const unescapeValue = (value: string) => value
  .replace(/\\n/gi, '\n')
  .replace(/\\,/g, ',')
  .replace(/\\;/g, ';')
  .replace(/\\\\/g, '\\')
  .trim();

/** Quoted-printable UTF-8 decode (old Outlook exports). Soft breaks (`=\n`) join lines. */
const decodeQuotedPrintableUtf8 = (value: string): string | null => {
  try {
    const joined = value.replace(/=\r?\n/g, '');
    const bytes: number[] = [];
    for (let i = 0; i < joined.length; i++) {
      if (joined[i] === '=') {
        const hex = joined.slice(i + 1, i + 3);
        if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null;
        bytes.push(Number.parseInt(hex, 16));
        i += 2;
      } else if (joined[i] === '_') bytes.push(32);
      else bytes.push(joined.charCodeAt(i) & 0xff);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
};

interface VCardProp { name: string; params: Record<string, string>; value: string }

const parsePropLine = (line: string): VCardProp | null => {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segments = head.split(';');
  const rawName = segments[0] || '';
  // Group prefix like "item1.EMAIL" (Apple) — keep the property name after the dot.
  const name = rawName.includes('.') ? rawName.slice(rawName.lastIndexOf('.') + 1).toUpperCase() : rawName.toUpperCase();
  const params: Record<string, string> = {};
  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf('=');
    if (eq > 0) params[segment.slice(0, eq).trim().toUpperCase()] = segment.slice(eq + 1).trim().toUpperCase();
    else params.TYPE = segment.trim().toUpperCase();
  }
  return { name, params, value };
};

const decodedValue = (prop: VCardProp, problems: string[], cardIndex: number): string => {
  if (prop.params.ENCODING === 'QUOTED-PRINTABLE') {
    if (prop.params.CHARSET && prop.params.CHARSET !== 'UTF-8') {
      problems.push(`Card ${cardIndex}: ${prop.name} uses character set ${prop.params.CHARSET}, which was read as plain text and may look wrong.`);
      return unescapeValue(prop.value);
    }
    const decoded = decodeQuotedPrintableUtf8(prop.value);
    if (decoded === null) {
      problems.push(`Card ${cardIndex}: ${prop.name} could not be decoded (quoted-printable), so it was read as plain text.`);
      return unescapeValue(prop.value);
    }
    return unescapeValue(decoded);
  }
  return unescapeValue(prop.value);
};

export function vCardToContactTable(text: string): ContactFileRead {
  const problems: string[] = [];
  const rows: string[][] = [];
  // Unfold continuation lines (a leading space or tab continues the previous line).
  const lines = text.replace(/\r\n?/g, '\n').split('\n').reduce<string[]>((acc, line) => {
    if ((line.startsWith(' ') || line.startsWith('\t')) && acc.length) acc[acc.length - 1] += line.slice(1);
    else acc.push(line);
    return acc;
  }, []);

  let card: VCardProp[] | null = null;
  let cardIndex = 0;
  const finishCard = () => {
    if (!card) return;
    cardIndex += 1;
    const props = card;
    card = null;
    const all = (name: string) => props.filter(p => p.name === name).map(p => decodedValue(p, problems, cardIndex)).filter(Boolean);
    const fn = all('FN')[0] ?? '';
    const n = all('N')[0] ?? '';
    // N is Family;Given;Additional;Prefix;Suffix — display as "Given Family".
    const nParts = n.split(';');
    const fromN = joinPresent([nParts[1], nParts[0]], ' ');
    const org = all('ORG')[0]?.split(';')[0]?.trim() ?? '';
    const name = fn || fromN || org;
    if (!name) {
      problems.push(`Card ${cardIndex}: no name (FN, N or ORG), so it was skipped.`);
      return;
    }
    const emails = all('EMAIL');
    const phones = all('TEL').map(t => t.replace(/^tel:/i, ''));
    const adr = all('ADR')[0] ?? '';
    // ADR is PO box;extended;street;city;region;postal code;country.
    const a = adr.split(';');
    const address = joinPresent([a[2], a[3], joinPresent([a[4], a[5]], ' '), a[6], a[1]], ', ').replace(/\n/g, ', ');
    const notesParts: string[] = [];
    const note = all('NOTE')[0];
    if (note) notesParts.push(note);
    if (org && name !== org) notesParts.push(`Organisation: ${org}`);
    if (emails.length > 1) notesParts.push(`Also: ${emails.slice(1).map(e => `email ${e}`).join(', ')}`);
    if (phones.length > 1) notesParts.push(`Also: ${phones.slice(1).map(p => `phone ${p}`).join(', ')}`);
    rows.push([name, emails[0] ?? '', phones[0] ?? '', '', address, all('URL')[0] ?? '', notesParts.join('\n')]);
  };

  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === 'BEGIN:VCARD') { if (card) finishCard(); card = []; continue; }
    if (upper === 'END:VCARD') { finishCard(); continue; }
    if (!card || !line.trim()) continue;
    const prop = parsePropLine(line);
    if (prop) card.push(prop);
  }
  finishCard();
  if (cardIndex === 0) problems.push('No vCard contacts (BEGIN:VCARD … END:VCARD) were found in this file.');
  return { table: [[...CONTACT_IMPORT_HEADERS], ...rows], problems };
}

/** Strict Google Contacts CSV detection: a numbered "E-mail N - Value" column plus a name column. */
export function isGoogleContactsHeader(header: readonly string[]): boolean {
  const hasEmail = header.some(h => /^e-mail \d+ - value$/i.test(h.trim()));
  const hasName = header.some(h => /^(name|first name|last name|organization 1 - name)$/i.test(h.trim()));
  return hasEmail && hasName;
}

export function googleContactsToContactTable(cells: string[][]): ContactFileRead {
  const problems: string[] = [];
  const header = (cells[0] ?? []).map(h => h.trim().toLowerCase());
  const col = (label: string) => header.indexOf(label.toLowerCase());
  const get = (row: string[], index: number) => (index >= 0 ? (row[index] ?? '').trim() : '');
  const numbered = (row: string[], base: string) => {
    const values: string[] = [];
    for (let n = 1; n <= 8; n++) {
      const v = get(row, col(`${base} ${n} - value`));
      if (v) values.push(v);
    }
    return values;
  };

  const rows: string[][] = [];
  cells.slice(1).forEach((row, i) => {
    if (!row.some(c => (c ?? '').trim())) return;
    const name = get(row, col('Name'))
      || joinPresent([get(row, col('First Name')), get(row, col('Middle Name')), get(row, col('Last Name'))], ' ')
      || get(row, col('Organization 1 - Name'));
    if (!name) {
      problems.push(`Row ${i + 2}: no name (Name, First/Last Name, or Organization 1 - Name), so it was skipped.`);
      return;
    }
    const emails = numbered(row, 'E-mail');
    const phones = numbered(row, 'Phone');
    const granular = joinPresent([
      get(row, col('Address 1 - Street')),
      get(row, col('Address 1 - City')),
      joinPresent([get(row, col('Address 1 - Region')), get(row, col('Address 1 - Postal Code'))], ' '),
      get(row, col('Address 1 - Country')),
    ], ', ');
    const address = granular || get(row, col('Address 1 - Formatted')).replace(/\n+/g, ', ');
    const org = get(row, col('Organization 1 - Name'));
    const notesParts: string[] = [];
    const note = get(row, col('Notes'));
    if (note) notesParts.push(note);
    if (org && name !== org) notesParts.push(`Organisation: ${org}`);
    if (emails.length > 1) notesParts.push(`Also: ${emails.slice(1).map(e => `email ${e}`).join(', ')}`);
    if (phones.length > 1) notesParts.push(`Also: ${phones.slice(1).map(p => `phone ${p}`).join(', ')}`);
    rows.push([name, emails[0] ?? '', phones[0] ?? '', '', address, get(row, col('Website 1 - Value')), notesParts.join('\n')]);
  });
  return { table: [[...CONTACT_IMPORT_HEADERS], ...rows], problems };
}

export interface IncomingContactRow {
  row: number;
  name: string;
  email?: string;
  phone?: string;
  taxId?: string;
}

export interface ContactImportDuplicateCheck {
  /** Exact-name matches: the server skips these rows (its identity is the normalised name). */
  willSkip: { row: number; name: string; existingName: string }[];
  willSkipTotal: number;
  /** Same email/phone/tax ID but a different name: these still create a second record. */
  possible: { row: number; name: string; existingName: string; signals: DuplicateMatchSignal[] }[];
  possibleTotal: number;
}

const LIMIT = 20;
/** Same normalisation the importer's identity uses (trim, lower-case, collapsed spaces). */
const identityName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function contactImportDuplicates(
  kind: 'customers' | 'vendors',
  incoming: readonly IncomingContactRow[],
  existing: readonly ReviewContact[],
): ContactImportDuplicateCheck {
  const reviewKind: ReviewContactKind = kind === 'customers' ? 'customer' : 'vendor';
  const byName = new Map<string, ReviewContact>();
  for (const c of existing) {
    const key = identityName(c.name ?? '');
    if (key && !byName.has(key)) byName.set(key, c);
  }
  const willSkip: ContactImportDuplicateCheck['willSkip'] = [];
  const skippedRows = new Set<number>();
  for (const row of incoming) {
    const hit = byName.get(identityName(row.name ?? ''));
    if (hit) {
      skippedRows.add(row.row);
      if (willSkip.length < LIMIT) willSkip.push({ row: row.row, name: row.name, existingName: hit.name });
    }
  }
  const merged: ReviewContact[] = [
    ...existing,
    ...incoming
      .filter(r => !skippedRows.has(r.row))
      .map(r => ({ id: `incoming:${r.row}`, kind: reviewKind, name: r.name, email: r.email, phone: r.phone, taxId: r.taxId })),
  ];
  const review = findDuplicateContactCandidates(merged);
  const possible: ContactImportDuplicateCheck['possible'] = [];
  let possibleTotal = 0;
  for (const pair of review.pairs) {
    const incomingSide = pair.left.id.startsWith('incoming:') ? pair.left : pair.right.id.startsWith('incoming:') ? pair.right : null;
    const existingSide = incomingSide === pair.left ? pair.right : pair.left;
    if (!incomingSide || existingSide.id.startsWith('incoming:')) continue;
    possibleTotal += 1;
    if (possible.length < LIMIT) {
      possible.push({
        row: Number(incomingSide.id.slice('incoming:'.length)),
        name: incomingSide.name,
        existingName: existingSide.name,
        signals: pair.signals.filter(s => s !== 'name'),
      });
    }
  }
  return { willSkip, willSkipTotal: skippedRows.size, possible, possibleTotal };
}
