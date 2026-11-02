import { normalizeSearchText } from './textNormalization';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from './accountDefaults';

/**
 * CC-09: the workspace's own payment types (for example "PayPal" or "Bit"). Each belongs to one of
 * the five payment methods, which stays what postings, reports and the default deposit account
 * (CA-28) use; the type's name is kept on the payment so it can be told apart and reported.
 */
export interface PaymentType {
  id: string;
  name: string;
  method: PaymentMethod;
}

export const MAX_PAYMENT_TYPES = 50;
export const MAX_PAYMENT_TYPE_NAME = 60;
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** How two names are compared (case and runs of spaces ignored); the name itself is kept as typed. */
export const paymentTypeNameKey = (name: string): string => normalizeSearchText(name.trim().replace(/\s+/g, ' '));

export const isPaymentMethod = (value: unknown): value is PaymentMethod =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PAYMENT_METHOD_LABELS, value);

/** Keeps well-formed types only: a valid id, a name (1–60 characters) and a known method; ids and names once each. */
export function normalizePaymentTypes(input: unknown): PaymentType[] {
  if (!Array.isArray(input)) return [];
  const out: PaymentType[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, name, method } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || !ID.test(id) || !isPaymentMethod(method) || typeof name !== 'string') continue;
    const clean = name.trim();
    const key = paymentTypeNameKey(clean);
    if (!clean || clean.length > MAX_PAYMENT_TYPE_NAME || ids.has(id) || names.has(key)) continue;
    ids.add(id);
    names.add(key);
    out.push({ id, name: clean, method });
    if (out.length >= MAX_PAYMENT_TYPES) break;
  }
  return out;
}

export function findPaymentType(types: unknown, id: unknown): PaymentType | undefined {
  return typeof id === 'string' ? normalizePaymentTypes(types).find(t => t.id === id) : undefined;
}

/**
 * A new id for a payment type: random and unrelated to the name, so a type that is removed and a
 * different one added later never share an id (an open form holding the old id is then refused).
 */
export function newPaymentTypeId(existing: ReadonlyArray<{ id: string }>): string {
  const taken = new Set(existing.map(t => t.id));
  for (;;) {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    const candidate = `pt_${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The list with one type renamed (its id and method kept); unchanged if the name is empty, too long or taken. */
export function renamePaymentType(types: PaymentType[], id: string, name: string): PaymentType[] {
  const clean = name.trim();
  if (!clean || clean.length > MAX_PAYMENT_TYPE_NAME) return types;
  if (types.some(t => t.id !== id && paymentTypeNameKey(t.name) === paymentTypeNameKey(clean))) return types;
  return types.map(t => (t.id === id ? { ...t, name: clean } : t));
}
