import { assertGuestSession, guestRows, guestSession, SAMPLE_WORKSPACE_ID, writeGuestBatch } from './db/guestDatabase';
import { previewNumber } from './documentNumbers';
import type { NumberedDocument } from '../services/documentNumbers';

const tables: Record<NumberedDocument, string> = { invoice: 'invoices', bill: 'bills', estimate: 'estimates', creditNote: 'creditNotes', vendorCredit: 'vendorCredits', payment: 'payments' };
export interface GuestSeries { type: NumberedDocument; prefix: string; nextNumber: number; padding: number; next: string; highestUsed: number }
function scope(workspaceId: string) {
  const session = guestSession();
  assertGuestSession(session);
  if (workspaceId !== SAMPLE_WORKSPACE_ID) throw new Error('Only the sample company can allocate demo numbers.');
  return session!;
}
function highest(type: NumberedDocument, prefix: string) {
  let used = 0;
  for (const row of guestRows(tables[type])) {
    const number = row.data.number;
    if (typeof number === 'string' && number.startsWith(prefix) && /^\d+$/.test(number.slice(prefix.length))) used = Math.max(used, Number(number.slice(prefix.length)));
  }
  return used;
}
export function readGuestSeries(workspaceId: string, type: NumberedDocument): GuestSeries {
  scope(workspaceId);
  const counter = guestRows('sampleCounters').find(row => row.id === type)?.data;
  const prefix = String(counter?.prefix ?? `SAMPLE-${type.toUpperCase()}-`);
  const nextNumber = Number(counter?.next ?? 1);
  const padding = Number(counter?.padding ?? 4);
  return { type, prefix, nextNumber, padding, next: previewNumber(prefix, nextNumber, padding), highestUsed: highest(type, prefix) };
}
export function readGuestNumbering(workspaceId: string) {
  return (Object.keys(tables) as NumberedDocument[]).map(type => readGuestSeries(workspaceId, type));
}
export function saveGuestNumbering(workspaceId: string, type: NumberedDocument, input: { prefix: string; nextNumber: number; padding: number }) {
  const session = scope(workspaceId);
  if (!Object.hasOwn(tables, type)) throw new Error('Choose a document type');
  if (typeof input.prefix !== 'string' || input.prefix.length > 20 || Array.from(input.prefix).some(character => character.charCodeAt(0) < 32)) throw new Error('Enter a prefix up to 20 characters');
  if (!Number.isSafeInteger(input.nextNumber) || input.nextNumber < 1 || !Number.isInteger(input.padding) || input.padding < 1 || input.padding > 10) throw new Error('Enter a positive next number and 1–10 digits');
  const used = highest(type, input.prefix);
  if (input.nextNumber <= used) throw new Error(`That number is already used: start at ${used + 1} or higher`);
  writeGuestBatch([{ op: 'set', table: 'sampleCounters', id: type, data: { workspaceId, prefix: input.prefix, next: input.nextNumber, padding: input.padding } }], session);
  return readGuestSeries(workspaceId, type);
}
export function allocateGuestNumber(workspaceId: string, type: NumberedDocument) {
  const session = scope(workspaceId);
  const series = readGuestSeries(workspaceId, type);
  const next = Math.max(series.nextNumber, series.highestUsed + 1);
  writeGuestBatch([{ op: 'set', table: 'sampleCounters', id: type, data: { workspaceId, prefix: series.prefix, padding: series.padding, next: next + 1 } }], session);
  return previewNumber(series.prefix, next, series.padding);
}
