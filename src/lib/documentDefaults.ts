import type { Bill, ChartAccount, DimensionDefinition, DimensionNode } from '../types';

/** Drafting hints only, inside the existing record metadata; never posting instructions. */
export interface DocumentDefaults {
  accountId?: string;
  taxCodeId?: string;
  dimensions?: Record<string, string>;
}
const text = (v: unknown) => typeof v === 'string' ? v.trim().slice(0, 500) : '';
export function cleanDocumentDefaults(value: unknown): DocumentDefaults {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const dimensions = source.dimensions && typeof source.dimensions === 'object' && !Array.isArray(source.dimensions)
    ? Object.fromEntries(Object.entries(source.dimensions).filter(([key, value]) => key && key.length <= 100 && !['__proto__', 'constructor', 'prototype', 'category'].includes(key.toLowerCase()) && text(value)).map(([key, value]) => [key.toLowerCase(), text(value)])) : {};
  return {
    ...(text(source.accountId) ? { accountId: text(source.accountId) } : {}),
    ...(text(source.taxCodeId) ? { taxCodeId: text(source.taxCodeId) } : {}),
    ...(Object.keys(dimensions).length ? { dimensions } : {}),
  };
}
export function documentDefaultsOf(record?: { metadata?: Record<string, unknown>; defaultTaxCodeId?: string } | null): DocumentDefaults {
  const defaults = cleanDocumentDefaults(record?.metadata?.documentDefaults);
  return { ...defaults, ...(record?.defaultTaxCodeId ? { taxCodeId: record.defaultTaxCodeId } : {}) };
}
export function defaultsMetadata(metadata: Record<string, unknown> | undefined, defaults: DocumentDefaults): Record<string, unknown> {
  const { documentDefaults: _old, ...rest } = metadata || {};
  const clean = cleanDocumentDefaults(defaults);
  return { ...rest, ...(Object.keys(clean).length ? { documentDefaults: clean } : {}) };
}

/** Unknown axes/archived value IDs never fill; free text remains supported, as in LineLabels. */
export function availableDocumentDefaults(defaults: DocumentDefaults, axes: DimensionDefinition[], nodes: DimensionNode[]): DocumentDefaults {
  return { ...defaults, dimensions: Object.fromEntries(Object.entries(defaults.dimensions || {}).filter(([key, value]) =>
    axes.some(axis => axis.id.toLowerCase() === key && axis.id !== 'category') &&
    !nodes.some(node => node.dimensionId.toLowerCase() === key && node.id === value && node.status === 'archived'))) };
}

/** Existing values and explicitly edited empty fields win; account choices come from the caller's side. */
export function fillLineDefaults<L extends { accountId: string; dimensions?: Record<string, string> }>(line: L, defaults: DocumentDefaults, accounts: Pick<ChartAccount, 'id' | 'isArchived'>[], edited: ReadonlySet<string> = new Set()): L {
  const dimensions = { ...line.dimensions };
  for (const [key, value] of Object.entries(defaults.dimensions || {})) {
    if (!Object.hasOwn(dimensions, key) && !edited.has(`label:${key}`)) dimensions[key] = value;
  }
  return {
    ...line,
    ...(!line.accountId && !edited.has('account') && defaults.accountId && accounts.some(a => a.id === defaults.accountId && !a.isArchived) ? { accountId: defaults.accountId } : {}),
    ...(Object.keys(dimensions).length ? { dimensions } : {}),
  };
}

/** Three newest loaded, non-cancelled bills must agree, across ALL their lines. Not complete history. */
export function vendorHistoryDefaults(bills: Bill[], vendorId: string): DocumentDefaults | null {
  const recent = bills.filter(b => b.vendorId === vendorId && !['void', 'draft', 'cancelled', 'rejected'].includes(b.status))
    .sort((a, b) => (b.date || b.issueDate || '').localeCompare(a.date || a.issueDate || '') || b.id.localeCompare(a.id)).slice(0, 3);
  if (recent.length < 3 || recent.some(b => !b.splits?.length)) return null;
  const lines = recent.flatMap(b => b.splits!);
  const accountId = lines[0].accountId && lines.every(line => line.accountId === lines[0].accountId) ? lines[0].accountId : '';
  const dimensions = Object.fromEntries(Object.entries(lines[0].dimensions || {}).filter(([key, value]) => value && lines.every(line => line.dimensions?.[key] === value)));
  const defaults = cleanDocumentDefaults({ accountId, dimensions });
  return Object.keys(defaults).length ? defaults : null;
}
