/**
 * EU-E3: real parents and children for label values (Region → Property → Unit).
 * A value may name one parent (`DimensionNode.parentId`) in the same label. Pure helpers: the tree
 * order for screens, the loop check, roll-ups for reports, and the one-click plan that turns
 * existing "Region / Property" names into parents — shown first, never applied silently.
 */
import type { DimensionNode } from '../types';

const inLabel = (nodes: readonly DimensionNode[], dimensionId: string) => nodes.filter(n => n.dimensionId === dimensionId);

/** The value's chain of parents, nearest first. Stops at a loop or a missing parent. */
export function ancestors(nodes: readonly DimensionNode[], dimensionId: string, nodeId: string): DimensionNode[] {
  const byId = new Map(inLabel(nodes, dimensionId).map(n => [n.id, n]));
  const out: DimensionNode[] = [];
  const seen = new Set([nodeId]);
  for (let p = byId.get(nodeId)?.parentId; p && byId.has(p) && !seen.has(p); p = byId.get(p)?.parentId) {
    seen.add(p);
    out.push(byId.get(p)!);
  }
  return out;
}

/** Every value below this one, at any depth. */
export function descendants(nodes: readonly DimensionNode[], dimensionId: string, nodeId: string): DimensionNode[] {
  return walkBelow(childIndex(nodes, dimensionId), nodeId);
}

/** Each parent id → its children in the label, built once (a lookup instead of a scan per value). */
function childIndex(nodes: readonly DimensionNode[], dimensionId: string): Map<string, DimensionNode[]> {
  const byParent = new Map<string, DimensionNode[]>();
  for (const n of inLabel(nodes, dimensionId)) {
    if (!n.parentId) continue;
    const list = byParent.get(n.parentId);
    if (list) list.push(n); else byParent.set(n.parentId, [n]);
  }
  return byParent;
}

function walkBelow(byParent: Map<string, DimensionNode[]>, nodeId: string): DimensionNode[] {
  const out: DimensionNode[] = [];
  const stack = [nodeId];
  const seen = new Set(stack);
  while (stack.length) {
    for (const child of byParent.get(stack.pop()!) || []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      stack.push(child.id);
    }
  }
  return out;
}

/** Why `parentId` cannot be this value's parent, or null when it can (null parent = top level). */
export function parentProblem(nodes: readonly DimensionNode[], dimensionId: string, nodeId: string, parentId: string | null): string | null {
  if (!parentId) return null;
  if (parentId === nodeId) return 'A value cannot be its own parent.';
  const parent = inLabel(nodes, dimensionId).find(n => n.id === parentId);
  if (!parent) return 'Choose a value of the same label as the parent.';
  if (parent.status === 'archived') return 'An archived value cannot be a parent.';
  if (descendants(nodes, dimensionId, nodeId).some(d => d.id === parentId)) return 'That value is already under this one; choosing it would make a loop.';
  return null;
}

/** The label's values in tree order (each parent followed by its children), with their depth. */
export function treeOrder(nodes: readonly DimensionNode[], dimensionId: string): Array<{ node: DimensionNode; depth: number }> {
  const own = inLabel(nodes, dimensionId);
  const ids = new Set(own.map(n => n.id));
  const out: Array<{ node: DimensionNode; depth: number }> = [];
  const placed = new Set<string>();
  const byParent = childIndex(nodes, dimensionId);
  const visit = (node: DimensionNode, depth: number) => {
    if (placed.has(node.id)) return;
    placed.add(node.id);
    out.push({ node, depth });
    for (const child of byParent.get(node.id) || []) visit(child, depth + 1);
  };
  // a value whose parent is missing (or part of a loop) is shown at the top level, never dropped
  for (const n of own) if (!n.parentId || !ids.has(n.parentId)) visit(n, 0);
  for (const n of own) visit(n, 0);
  return out;
}

export interface RollUpRow { id: string; name: string; own: number; children: number; total: number }

/**
 * Totals with children: for every value that has children, its own amount, its descendants' and
 * the sum. `amountOf` returns the amount booked to a value id (0 when none). Each descendant is
 * counted once even when reached by two paths.
 */
export function rollUp(nodes: readonly DimensionNode[], dimensionId: string, amountOf: (valueId: string) => number): RollUpRow[] {
  const byParent = childIndex(nodes, dimensionId);
  return treeOrder(nodes, dimensionId)
    .filter(({ node }) => byParent.has(node.id))
    .map(({ node }) => ({ node, below: walkBelow(byParent, node.id) }))
    .filter(({ below }) => below.length > 0)
    .map(({ node, below }) => {
      const own = amountOf(node.id);
      const children = below.reduce((s, d) => s + amountOf(d.id), 0);
      return { id: node.id, name: node.description, own, children, total: own + children };
    });
}

export interface SlashConversion {
  nodeId: string;
  /** The name as it is now, e.g. "North / Maui house" */
  from: string;
  /** The value's own name afterwards, e.g. "Maui house" */
  newName: string;
  /** The parent's name, e.g. "North"; an existing value of that name is used, otherwise it is created */
  parentName: string;
  parentId: string | null;
}

/**
 * The plan for turning "Parent / Child" names into a real parent. Only values without a parent are
 * offered; the parent is matched by name (case-insensitive) or listed as one to create. Deeper
 * names ("A / B / C") take their last segment as the name and the rest as the parent's name.
 */
export function slashConversionPlan(nodes: readonly DimensionNode[], dimensionId: string): SlashConversion[] {
  const own = inLabel(nodes, dimensionId).filter(n => n.status !== 'archived');
  const key = (s: string) => s.trim().toLowerCase();
  const out: SlashConversion[] = [];
  for (const n of own) {
    if (n.parentId || !n.description.includes('/')) continue;
    const parts = n.description.split('/').map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const newName = parts[parts.length - 1];
    const parentName = parts.slice(0, -1).join(' / ');
    const parent = own.find(p => p.id !== n.id && key(p.description) === key(parentName));
    out.push({ nodeId: n.id, from: n.description, newName, parentName, parentId: parent?.id ?? null });
  }
  return out;
}
