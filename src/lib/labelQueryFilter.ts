/**
 * EU-E9: `?label.<name>=<value>` on the transactions API. The name is a workspace label (by id or by its name, any
 * case); the value is a label value id. An entry matches when the entry or any of its lines carries that value.
 * An unknown label name is refused with a message, never ignored.
 */
export interface LabelDef { id: string; name?: string }

export class LabelFilterError extends Error {}

/** The `label.*` query keys as { labelId: valueId }; throws for a name the workspace does not have. */
export function parseLabelFilters(query: Record<string, unknown>, labels: readonly LabelDef[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(query)) {
    if (!key.startsWith('label.')) continue;
    const name = key.slice('label.'.length).trim().toLowerCase();
    const label = labels.find(l => l.id.toLowerCase() === name || (l.name || '').trim().toLowerCase() === name);
    if (!label) throw new LabelFilterError(`Unknown label "${key.slice('label.'.length)}". Labels in this workspace: ${labels.map(l => l.name || l.id).join(', ') || 'none'}`);
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || !value.trim()) throw new LabelFilterError(`Give a value for ${key}`);
    out[label.id] = value.trim();
  }
  return out;
}

interface Taggable { dimensions?: Record<string, string> | null; lines?: Array<{ dimensions?: Record<string, string> | null }> | null }

/** Every filter matched by the entry itself or by one of its lines. */
export function matchesLabelFilters(tx: Taggable, filters: Record<string, string>): boolean {
  return Object.entries(filters).every(([id, value]) =>
    tx.dimensions?.[id] === value || (tx.lines || []).some(l => l.dimensions?.[id] === value));
}

/**
 * EU-E9: label columns for an export — one per workspace label (category is its own column), each cell the value's
 * description (the entry's own value, else the first line that carries one; several different line values are
 * joined with " | ").
 */
export function labelExportColumns(labels: readonly LabelDef[], nodes: readonly { id: string; dimensionId: string; description: string }[]) {
  const own = labels.filter(l => l.id !== 'category');
  const describe = (labelId: string, valueId: string) => nodes.find(n => n.dimensionId === labelId && n.id === valueId)?.description || valueId;
  return {
    headers: own.map(l => l.name || l.id),
    cells: (tx: Taggable): string[] => own.map(l => {
      if (tx.dimensions?.[l.id]) return describe(l.id, tx.dimensions[l.id]);
      const values = [...new Set((tx.lines || []).map(line => line.dimensions?.[l.id]).filter((v): v is string => Boolean(v)))];
      return values.map(v => describe(l.id, v)).join(' | ');
    }),
  };
}
