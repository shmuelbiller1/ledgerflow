import { normalizeSearchText } from './textNormalization';
import { isFixedTerm, type FixedTerm } from './paymentTerms';

/**
 * CC-11: the workspace's customer groups (for example "Wholesale" or "Retail"). A group carries
 * defaults for its customers: today the payment terms a new invoice starts with when the customer
 * has none of its own. Only the server writes the list (`customerGroups` on the workspace); a
 * customer names its group by id (`groupId`).
 */
export interface CustomerGroup {
  id: string;
  name: string;
  /** default payment terms for the group's customers (due on receipt or Net N) */
  paymentTerms?: FixedTerm;
}

export const MAX_CUSTOMER_GROUPS = 100;
export const MAX_CUSTOMER_GROUP_NAME = 60;
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** How two group names are compared (case and runs of spaces ignored); the name is kept as typed. */
export const customerGroupNameKey = (name: string): string => normalizeSearchText(name.trim().replace(/\s+/g, ' '));

/** Keeps well-formed groups only: a valid id, a name (1–60 characters), and valid terms if any; ids and names once each. */
export function normalizeCustomerGroups(input: unknown): CustomerGroup[] {
  if (!Array.isArray(input)) return [];
  const out: CustomerGroup[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, name, paymentTerms } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || !ID.test(id) || typeof name !== 'string') continue;
    const clean = name.trim();
    const key = customerGroupNameKey(clean);
    if (!clean || clean.length > MAX_CUSTOMER_GROUP_NAME || ids.has(id) || names.has(key)) continue;
    ids.add(id);
    names.add(key);
    out.push({ id, name: clean, ...(isFixedTerm(paymentTerms) ? { paymentTerms } : {}) });
    if (out.length >= MAX_CUSTOMER_GROUPS) break;
  }
  return out;
}

export function findCustomerGroup(groups: unknown, id: unknown): CustomerGroup | undefined {
  return typeof id === 'string' && id ? normalizeCustomerGroups(groups).find(g => g.id === id) : undefined;
}
