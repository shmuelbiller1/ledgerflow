/**
 * EU-E8: saved layouts for Compare (the pivot). A layout is the view, rows, columns, grouping and period a person
 * named; kept in this browser per workspace. Storage that refuses keeps nothing — Compare works as before.
 */
export interface CompareLayout { name: string; pivotMode: 'flat' | 'matrix'; rowDim: string; colDim: string; groupBy: string; period: string }

export const layoutsKey = (workspaceId: string) => `lf_compare_layouts:${workspaceId}`;
export const MAX_LAYOUTS = 20;

export function readLayouts(workspaceId: string): CompareLayout[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(layoutsKey(workspaceId)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(l => l && typeof l.name === 'string').slice(0, MAX_LAYOUTS) : [];
  } catch {
    return [];
  }
}

/** Saves (or replaces, by name, any case) a layout; returns the list now kept, or null when storage refused. */
export function saveLayout(workspaceId: string, layout: CompareLayout): CompareLayout[] | null {
  const name = layout.name.trim();
  if (!name) return null;
  const rest = readLayouts(workspaceId).filter(l => l.name.toLowerCase() !== name.toLowerCase());
  const next = [{ ...layout, name }, ...rest].slice(0, MAX_LAYOUTS);
  try { localStorage.setItem(layoutsKey(workspaceId), JSON.stringify(next)); return next; } catch { return null; }
}

export function deleteLayout(workspaceId: string, name: string): CompareLayout[] | null {
  const next = readLayouts(workspaceId).filter(l => l.name !== name);
  try { localStorage.setItem(layoutsKey(workspaceId), JSON.stringify(next)); return next; } catch { return null; }
}
