/**
 * A-33 (tracker Q-03): serial and lot numbers on tracked items. A receipt's line or an invoice's
 * line can carry the serial numbers it moved and/or the lot (batch) its units came from; a lookup
 * finds where a serial has been, and lots are summarised per item.
 *
 * Display and record only: no cost, quantity or posting changes here. Documents are read, never
 * written, by this module. Pure.
 *
 * A-112/A-113: the same rules validate serials, lots and expiry dates typed on a goods receipt
 * (PurchaseOrdersView's receive-goods dialog writes them onto the receipt's lines).
 */
import { isIsoDate } from './warehouseRecordUtils';

/** The part of a document line this module reads and writes. */
export interface SerializedLine {
  description?: string;
  itemId?: string;
  quantity?: number;
  serialNumbers?: string[];
  lotNumber?: string;
}

/** A line's serial numbers, always as a fresh list (empty when the line has none). */
export function lineSerials(line: SerializedLine | null | undefined): string[] {
  return Array.isArray(line?.serialNumbers) ? line.serialNumbers.filter(s => typeof s === 'string' && s.trim()) : [];
}

/** Trim and squeeze the serial as typed; the display keeps the person's own letters. */
export function normalizeSerial(serial: string): string {
  return String(serial ?? '').trim().replace(/\s+/g, ' ');
}

const folded = (serial: string) => normalizeSerial(serial).toLocaleLowerCase();

/** Is this serial already on the same item? Serials are unique per item, ignoring case. */
export function serialAlreadyUsed(serial: string, existing: string[]): boolean {
  const candidate = folded(serial);
  return existing.some(s => folded(s) === candidate);
}

/** Why this serial cannot be added to this line, in plain words, or null when it can. */
export function serialProblem(serial: string, existing: string[]): string | null {
  const clean = normalizeSerial(serial);
  if (!clean) return 'Type the serial number.';
  if (clean.length > 80) return 'A serial number can be up to 80 characters.';
  if (serialAlreadyUsed(clean, existing)) return 'That serial number is already on this line.';
  return null;
}

/** The line with the serial added (a new list), or the refusal in words. */
export function withSerial(line: SerializedLine, serial: string): { ok: true; line: SerializedLine } | { ok: false; reason: string } {
  const existing = lineSerials(line);
  const problem = serialProblem(serial, existing);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, line: { ...line, serialNumbers: [...existing, normalizeSerial(serial)] } };
}

/** The line without the serial (a new list). */
export function withoutSerial(line: SerializedLine, serial: string): SerializedLine {
  const candidate = folded(serial);
  return { ...line, serialNumbers: lineSerials(line).filter(s => folded(s) !== candidate) };
}

export interface SerialPlacement {
  serial: string;
  documentId: string;
  documentType: string;
  date: string;
  line: number;
  description: string;
  lotNumber?: string;
}

/** Where every serial of this item sits, oldest document first (the lookup's rows). */
export function serialsForItem(
  documents: Array<{ id: string; type?: string; date?: string; lines?: SerializedLine[] }>,
  itemId: string,
): SerialPlacement[] {
  const rows: SerialPlacement[] = [];
  for (const document of documents) {
    (document.lines || []).forEach((line, index) => {
      if (line.itemId !== itemId) return;
      for (const serial of lineSerials(line)) {
        rows.push({
          serial, documentId: document.id, documentType: document.type || '', date: String(document.date || '').slice(0, 10),
          line: index + 1, description: line.description || '',
          ...(line.lotNumber ? { lotNumber: line.lotNumber } : {}),
        });
      }
    });
  }
  return rows.sort((a, b) => (a.date === b.date ? a.documentId.localeCompare(b.documentId) : a.date.localeCompare(b.date)));
}

/** The placements whose serial contains the query (case-insensitive); an empty query finds nothing. */
export function findSerial(placements: SerialPlacement[], query: string): SerialPlacement[] {
  const q = folded(query);
  if (!q) return [];
  return placements.filter(p => folded(p.serial).includes(q));
}

export interface LotRow {
  lotNumber: string;
  lines: number;
  quantity: number;
  firstDate: string;
  lastDate: string;
}

/** The lots of one item across the documents, by lot number: how many lines and units, and when. */
export function lotRows(documents: Array<{ date?: string; lines?: SerializedLine[] }>, itemId: string): LotRow[] {
  const lots = new Map<string, LotRow>();
  for (const document of documents) {
    const date = String(document.date || '').slice(0, 10);
    for (const line of document.lines || []) {
      if (line.itemId !== itemId || !line.lotNumber || !String(line.lotNumber).trim()) continue;
      const lot = String(line.lotNumber).trim();
      const row = lots.get(lot) || { lotNumber: lot, lines: 0, quantity: 0, firstDate: date, lastDate: date };
      row.lines += 1;
      row.quantity += Number(line.quantity) || 0;
      if (date && (!row.firstDate || date < row.firstDate)) row.firstDate = date;
      if (date && date > row.lastDate) row.lastDate = date;
      lots.set(lot, row);
    }
  }
  return [...lots.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.lotNumber.localeCompare(b.lotNumber));
}

/** The same serial recorded twice for one item — a typo to look at, found across all documents. */
export function duplicateSerials(documents: Array<{ id: string; lines?: SerializedLine[] }>): Array<{ itemId: string; serial: string; documents: string[] }> {
  const seen = new Map<string, { itemId: string; serial: string; documents: string[] }>();
  for (const document of documents) {
    for (const line of document.lines || []) {
      if (!line.itemId) continue;
      for (const serial of lineSerials(line)) {
        const key = `${line.itemId}::${folded(serial)}`;
        const row = seen.get(key) || { itemId: line.itemId, serial: normalizeSerial(serial), documents: [] };
        row.documents.push(document.id);
        seen.set(key, row);
      }
    }
  }
  return [...seen.values()].filter(r => new Set(r.documents).size > 1).sort((a, b) => a.serial.localeCompare(b.serial));
}

/** Trim the lot as typed; the display keeps the person's own letters. */
export function normalizeLot(lot: string): string {
  return String(lot ?? '').trim().replace(/\s+/g, ' ');
}

/** Why this lot cannot be recorded, in plain words, or null when it can (empty = no lot). */
export function lotProblem(lot: string): string | null {
  const clean = normalizeLot(lot);
  if (!clean) return null;
  if (clean.length > 40) return 'A lot number can be up to 40 characters.';
  return null;
}

/** Why this expiry day cannot be recorded, in plain words, or null (empty = no date). */
export function lotExpiryProblem(expiry: string): string | null {
  const clean = String(expiry ?? '').trim();
  if (!clean) return null;
  if (!isIsoDate(clean)) return 'Use a real date (YYYY-MM-DD) for the expiry.';
  return null;
}

/** Split typed serials (commas or new lines) into clean numbers, dropping blanks. */
export function parseSerialList(text: string): string[] {
  return String(text ?? '').split(/[,\n]/).map(normalizeSerial).filter(s => s.length > 0);
}

/** Why this typed serial list cannot be recorded, in plain words, or null (empty = no serials). */
export function serialListProblem(text: string): string | null {
  const serials = parseSerialList(text);
  const seen = new Set<string>();
  for (const serial of serials) {
    if (serial.length > 80) return 'A serial number can be up to 80 characters.';
    const key = serial.toLocaleLowerCase();
    if (seen.has(key)) return `"${serial}" is typed twice.`;
    seen.add(key);
  }
  return null;
}

export const SERIAL_LOOKUP_CSV_HEADERS = ['Serial', 'Document', 'Type', 'Date', 'Line', 'Description', 'Lot'];

export function serialLookupCsvRows(placements: SerialPlacement[]): Array<Array<string | number>> {
  return placements.map(p => [p.serial, p.documentId, p.documentType, p.date, p.line, p.description, p.lotNumber || '']);
}
