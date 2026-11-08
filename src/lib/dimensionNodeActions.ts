import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { doc, getDoc, setDoc, updateDoc } from './db/firestore';
import { db } from '../firebase';
import {
  DEFAULT_WORKSPACE_DIMENSIONS,
  suggestNextDimensionNodeId,
  updateDimensionNodeDescription,
} from './dimensionUtils';
import type { DimensionDefinition, DimensionNode } from '../types';

const norm = (value: string) => value.normalize('NFC').toLowerCase().trim();

/**
 * Matches a typed or stored dimension value against registered DimensionNodes
 * by exact node ID, exact description, or alias (preserving Hebrew/mixed-script Unicode).
 */
export function matchDimensionNode(
  nodes: readonly DimensionNode[] | undefined,
  dimensionId: string,
  rawValue: string | undefined,
): DimensionNode | undefined {
  if (!rawValue || !nodes || nodes.length === 0) return undefined;
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed === 'Unassigned') return undefined;
  const targetDim = norm(dimensionId);
  const targetVal = norm(trimmed);

  const exactId = nodes.find(n => norm(n.dimensionId) === targetDim && norm(n.id) === targetVal);
  if (exactId) return exactId;

  const exactDesc = nodes.find(n => norm(n.dimensionId) === targetDim && norm(n.description) === targetVal);
  if (exactDesc) return exactDesc;

  return nodes.find(
    n => norm(n.dimensionId) === targetDim && n.aliases?.some(alias => norm(alias) === targetVal),
  );
}

/**
 * Resolves a user-entered value to a registered stable node ID when it matches a known node
 * (including hierarchical paths like "5 Ocean Ave/Unit B" -> "P5/Unit B"), keeping unknown text intact.
 */
export function normalizeDimensionInputToNodeId(
  nodes: readonly DimensionNode[] | undefined,
  dimensionId: string,
  rawValue: string,
): string {
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed === 'Unassigned' || !nodes || nodes.length === 0) return trimmed;

  const matched = matchDimensionNode(nodes, dimensionId, trimmed);
  if (matched) return matched.id;

  if (trimmed.includes('/')) {
    const [head, ...tail] = trimmed.split('/');
    const headNode = matchDimensionNode(nodes, dimensionId, head);
    if (headNode) return [headNode.id, ...tail.map(part => part.trim())].join('/');
  }

  return trimmed;
}

/**
 * Derives a clean, unique immutable axis ID from a display name (supporting non-ASCII / Hebrew names).
 */
export function deriveDimensionAxisId(
  displayName: string,
  existingDimensions: readonly DimensionDefinition[],
  explicitKey?: string,
): string {
  const existingIds = new Set(existingDimensions.map(d => d.id.toLowerCase()));
  if (explicitKey !== undefined && explicitKey.trim() !== '') {
    const cleaned = explicitKey.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
    if (!cleaned) throw new Error('Dimension key must contain letters or numbers.');
    if (existingIds.has(cleaned)) throw new Error(`Dimension axis "${cleaned}" already exists.`);
    return cleaned;
  }

  const slug = displayName
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^_+|_+$/g, '');

  const base = slug || 'dim';
  if (slug && !existingIds.has(base)) return base;

  let index = 1;
  while (existingIds.has(`${base}_${index}`)) index++;
  return `${base}_${index}`;
}

export interface DimensionActionSession {
  uid: string;
  workspaceId: string;
  canWriteNodes: boolean;
  canManageAxes: boolean;
}

export interface DimensionNodeActionAdapter {
  session(): DimensionActionSession | null;
  getNodes(): DimensionNode[];
  setNodes(nodes: DimensionNode[]): void;
  getWorkspaceDimensions(): DimensionDefinition[];
  setWorkspaceDimensions(workspaceId: string, dimensions: DimensionDefinition[]): void;
  writeNode(workspaceId: string, node: DimensionNode): Promise<void>;
  readNode(workspaceId: string, dimensionId: string, nodeId: string): Promise<Record<string, unknown> | undefined>;
  updateNode(workspaceId: string, dimensionId: string, nodeId: string, fields: Record<string, unknown>): Promise<void>;
  readWorkspace(workspaceId: string): Promise<{ dimensions?: DimensionDefinition[] } | undefined>;
  updateWorkspace(workspaceId: string, dimensions: DimensionDefinition[]): Promise<void>;
}

const nodeDocId = (workspaceId: string, dimensionId: string, nodeId: string) =>
  `${workspaceId}_${dimensionId}_${nodeId}`;

export const defaultDimensionNodeAdapter: DimensionNodeActionAdapter = {
  session: () => {
    const auth = useAuthStore.getState();
    const workspace = auth.getCurrentWorkspace();
    if (!auth.user || !workspace || workspace.id !== auth.currentWorkspaceId) return null;
    const role = workspace.uid === auth.user.uid ? 'owner' : workspace.roles?.[auth.user.uid];
    return {
      uid: auth.user.uid,
      workspaceId: workspace.id,
      canWriteNodes: role === 'owner' || role === 'accountant' || role === 'bookkeeper',
      canManageAxes: role === 'owner' || role === 'accountant',
    };
  },
  getNodes: () => useLedgerStore.getState().dimensionNodes || [],
  setNodes: nodes => useLedgerStore.getState().setDimensionNodes(nodes),
  getWorkspaceDimensions: () =>
    useAuthStore.getState().getCurrentWorkspace()?.dimensions || DEFAULT_WORKSPACE_DIMENSIONS,
  setWorkspaceDimensions: (workspaceId, dimensions) => {
    useAuthStore.setState(state => ({
      workspaces: state.workspaces.map(w => (w.id === workspaceId ? { ...w, dimensions } : w)),
    }));
  },
  writeNode: async (workspaceId, node) => {
    if (!db) return;
    await setDoc(doc(db, 'dimensionNodes', nodeDocId(workspaceId, node.dimensionId, node.id)), {
      ...node,
      workspaceId,
    });
  },
  readNode: async (workspaceId, dimensionId, nodeId) => {
    if (!db) return undefined;
    const snap = await getDoc(doc(db, 'dimensionNodes', nodeDocId(workspaceId, dimensionId, nodeId)));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : undefined;
  },
  updateNode: async (workspaceId, dimensionId, nodeId, fields) => {
    if (!db) return;
    await updateDoc(doc(db, 'dimensionNodes', nodeDocId(workspaceId, dimensionId, nodeId)), fields);
  },
  readWorkspace: async workspaceId => {
    if (!db) return undefined;
    const snap = await getDoc(doc(db, 'workspaces', workspaceId));
    return snap.exists() ? (snap.data() as { dimensions?: DimensionDefinition[] }) : undefined;
  },
  updateWorkspace: async (workspaceId, dimensions) => {
    if (!db) return;
    await updateDoc(doc(db, 'workspaces', workspaceId), { dimensions });
  },
};

function assertSameSession(adapter: DimensionNodeActionAdapter, initial: DimensionActionSession) {
  const current = adapter.session();
  if (!current || current.uid !== initial.uid || current.workspaceId !== initial.workspaceId) {
    throw new Error('Workspace or signed-in user changed before the label finished saving.');
  }
  return current;
}

/**
 * Registers a new DimensionNode (or unarchives a matching archived node) immediately
 * from inside a transaction form or Settings, returning the persisted node.
 */
export async function registerDimensionNodeInline(
  dimensionId: string,
  rawDescription: string,
  initialAliases: string[] = [],
  adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter,
): Promise<DimensionNode> {
  const description = rawDescription.trim();
  if (!description) throw new Error('Enter a label name.');
  if (description.length > 200) throw new Error('Label name must be 200 characters or fewer.');
  const dimId = dimensionId.trim();
  if (!dimId) throw new Error('Choose a dimension.');

  const session = adapter.session();
  if (!session?.canWriteNodes) throw new Error('Your workspace role cannot create dimension labels.');

  const currentNodes = adapter.getNodes();
  const existing = matchDimensionNode(currentNodes, dimId, description);
  const cleanAliases = initialAliases.map(a => a.trim()).filter(Boolean);

  if (existing) {
    if (existing.status === 'archived') {
      const reactivated: DimensionNode = { ...existing, status: 'active' };
      await adapter.updateNode(session.workspaceId, existing.dimensionId, existing.id, {
        status: 'active',
        updatedAt: new Date().toISOString(),
      });
      assertSameSession(adapter, session);
      adapter.setNodes(
        adapter.getNodes().map(n =>
          n.id === existing.id && norm(n.dimensionId) === norm(existing.dimensionId) ? reactivated : n,
        ),
      );
      return reactivated;
    }
    return existing;
  }

  const nextId = suggestNextDimensionNodeId(dimId, currentNodes);
  const newNode: DimensionNode = {
    id: nextId,
    dimensionId: dimId,
    description,
    ...(cleanAliases.length > 0 ? { aliases: cleanAliases } : {}),
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  await adapter.writeNode(session.workspaceId, newNode);
  assertSameSession(adapter, session);

  const latestNodes = adapter.getNodes();
  const alreadyPresent = latestNodes.some(
    n => n.id === newNode.id && norm(n.dimensionId) === norm(newNode.dimensionId),
  );
  adapter.setNodes(
    alreadyPresent
      ? latestNodes.map(n =>
          n.id === newNode.id && norm(n.dimensionId) === norm(newNode.dimensionId) ? newNode : n,
        )
      : [...latestNodes, newNode],
  );

  return newNode;
}

/**
 * Renames an existing DimensionNode from inside a transaction form or Settings,
 * checking for concurrent edits and preserving the old description in `aliases`.
 */
export async function renameDimensionNodeInline(
  dimensionId: string,
  nodeId: string,
  previousDescription: string,
  nextDescription: string,
  adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter,
): Promise<DimensionNode> {
  const description = nextDescription.trim();
  if (!description) throw new Error('Label name is required.');
  if (description.length > 200) throw new Error('Label name must be 200 characters or fewer.');

  const session = adapter.session();
  if (!session?.canWriteNodes) throw new Error('Your workspace role cannot edit dimension labels.');

  const stored = await adapter.readNode(session.workspaceId, dimensionId, nodeId);
  const checked = assertSameSession(adapter, session);
  if (!checked.canWriteNodes) throw new Error('Your workspace role cannot edit dimension labels.');

  if (stored) {
    if (stored.workspaceId && stored.workspaceId !== session.workspaceId) {
      throw new Error('This label belongs to another workspace.');
    }
    const actualDesc = String(stored.description ?? '');
    if (actualDesc !== previousDescription) {
      throw new Error('Someone changed this label. Reopen the line to load its current name.');
    }
  }

  const baseAliases = stored && Array.isArray(stored.aliases)
    ? stored.aliases.filter((a): a is string => typeof a === 'string')
    : (adapter.getNodes().find(n => n.id === nodeId && norm(n.dimensionId) === norm(dimensionId))?.aliases || []);
  const oldTrimmed = previousDescription.trim();
  const aliases = oldTrimmed && norm(oldTrimmed) !== norm(description) && !baseAliases.some(a => norm(a) === norm(oldTrimmed))
    ? [...baseAliases, oldTrimmed]
    : baseAliases;

  await adapter.updateNode(session.workspaceId, dimensionId, nodeId, {
    description,
    aliases,
    updatedAt: new Date().toISOString(),
  });
  assertSameSession(adapter, session);

  const updatedList = updateDimensionNodeDescription(adapter.getNodes(), nodeId, dimensionId, description);
  const syncedList = updatedList.map(n =>
    n.id === nodeId && norm(n.dimensionId) === norm(dimensionId) ? { ...n, description, aliases } : n,
  );
  adapter.setNodes(syncedList);

  return (
    syncedList.find(n => n.id === nodeId && norm(n.dimensionId) === norm(dimensionId)) || {
      id: nodeId,
      dimensionId,
      description,
      aliases,
      status: 'active',
    }
  );
}

/**
 * Updates a node's active/archived status immediately and syncs the store.
 */
export async function setDimensionNodeStatusInline(
  dimensionId: string,
  nodeId: string,
  status: 'active' | 'archived',
  adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter,
): Promise<void> {
  const session = adapter.session();
  if (!session?.canWriteNodes) throw new Error('Your workspace role cannot change dimension labels.');

  await adapter.updateNode(session.workspaceId, dimensionId, nodeId, {
    status,
    updatedAt: new Date().toISOString(),
  });
  assertSameSession(adapter, session);

  adapter.setNodes(
    adapter.getNodes().map(n =>
      n.id === nodeId && norm(n.dimensionId) === norm(dimensionId) ? { ...n, status } : n,
    ),
  );
}

/**
 * Updates a node's aliases immediately and syncs the store.
 */
export async function setDimensionNodeAliasesInline(
  dimensionId: string,
  nodeId: string,
  aliases: string[],
  adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter,
): Promise<void> {
  const session = adapter.session();
  if (!session?.canWriteNodes) throw new Error('Your workspace role cannot edit dimension labels.');
  const clean = aliases.map(a => a.trim()).filter(Boolean);

  await adapter.updateNode(session.workspaceId, dimensionId, nodeId, {
    aliases: clean,
    updatedAt: new Date().toISOString(),
  });
  assertSameSession(adapter, session);

  adapter.setNodes(
    adapter.getNodes().map(n =>
      n.id === nodeId && norm(n.dimensionId) === norm(dimensionId) ? { ...n, aliases: clean } : n,
    ),
  );
}

/**
 * Adds a new DimensionDefinition axis to the current workspace immediately (owners and accountants).
 */
export async function addDimensionAxisInline(
  rawDisplayName: string,
  explicitKey?: string,
  adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter,
): Promise<DimensionDefinition> {
  const name = rawDisplayName.trim();
  if (!name) throw new Error('Enter a name for the new dimension.');
  if (name.length > 80) throw new Error('Dimension name must be 80 characters or fewer.');

  const session = adapter.session();
  if (!session?.canManageAxes) {
    throw new Error('Only workspace owners and accountants can add new dimension categories.');
  }

  const remoteWs = await adapter.readWorkspace(session.workspaceId);
  const checked = assertSameSession(adapter, session);
  if (!checked.canManageAxes) {
    throw new Error('Only workspace owners and accountants can add new dimension categories.');
  }

  const baseDimensions = remoteWs?.dimensions && Array.isArray(remoteWs.dimensions) && remoteWs.dimensions.length > 0
    ? remoteWs.dimensions
    : adapter.getWorkspaceDimensions();

  if (baseDimensions.some(d => norm(d.name) === norm(name))) {
    throw new Error(`A dimension named "${name}" already exists.`);
  }

  const id = deriveDimensionAxisId(name, baseDimensions, explicitKey);
  const newAxis: DimensionDefinition = {
    id,
    name,
    sortOrder: baseDimensions.length,
  };
  const nextDimensions = [...baseDimensions, newAxis];

  await adapter.updateWorkspace(session.workspaceId, nextDimensions);
  assertSameSession(adapter, session);
  adapter.setWorkspaceDimensions(session.workspaceId, nextDimensions);

  return newAxis;
}

/**
 * Pure synchronous normalization of a `dimensions` map: converts any typed description or alias
 * of an existing `DimensionNode` into its canonical `node.id` while leaving `undefined` as `undefined`.
 */
export function normalizeDimensionsMap(
  rawDimensions: Record<string, string> | undefined,
  nodes: DimensionNode[],
): Record<string, string> | undefined {
  if (!rawDimensions) return undefined;
  let changed = false;
  const next: Record<string, string> = {};
  for (const [axisId, rawValue] of Object.entries(rawDimensions)) {
    if (!rawValue) {
      next[axisId] = rawValue;
      continue;
    }
    const resolved = normalizeDimensionInputToNodeId(nodes, axisId, rawValue);
    next[axisId] = resolved;
    if (resolved !== rawValue) changed = true;
  }
  return changed ? next : rawDimensions;
}

/**
 * Ensures every non-empty, non-`category` label in a `dimensions` map is backed by a `DimensionNode`
 * in the workspace (creating new nodes via `findOrCreateDimensionNode` when the user has `bookkeeper+`
 * permissions) and rewrites the map to store canonical `node.id` values.
 *
 * Makes zero network calls when `rawDimensions` is empty or all values already match existing nodes.
 */
export async function ensureDimensionNodesInMap(
  rawDimensions: Record<string, string> | undefined,
  adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter,
): Promise<Record<string, string> | undefined> {
  if (!rawDimensions) return undefined;
  const entries = Object.entries(rawDimensions);
  if (entries.length === 0) return rawDimensions;

  const session = adapter.session();
  let changed = false;
  const next: Record<string, string> = {};

  for (const [axisId, rawValue] of entries) {
    const trimmed = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!trimmed || trimmed === 'Unassigned') {
      next[axisId] = rawValue;
      continue;
    }
    if (norm(axisId) === 'category') {
      const resolved = normalizeDimensionInputToNodeId(adapter.getNodes(), axisId, trimmed);
      next[axisId] = resolved;
      if (resolved !== rawValue) changed = true;
      continue;
    }

    const segments = trimmed.split('/').map(s => s.trim()).filter(Boolean);
    const resolvedSegments: string[] = [];
    for (const seg of segments) {
      const existing = matchDimensionNode(adapter.getNodes(), axisId, seg);
      if (existing && existing.status !== 'archived') {
        resolvedSegments.push(existing.id);
      } else if (session?.canWriteNodes) {
        const created = await registerDimensionNodeInline(axisId, seg, [], adapter);
        resolvedSegments.push(created.id);
      } else {
        resolvedSegments.push(seg);
      }
    }
    const joined = resolvedSegments.join('/');
    next[axisId] = joined;
    if (joined !== rawValue) changed = true;
  }

  return changed ? next : rawDimensions;
}

/**
 * Ensures header and line-level dimension labels on an invoice draft are registered as `DimensionNode`s.
 */
export async function ensureInvoiceDimensionNodes<
  T extends { dimensions?: Record<string, string>; items?: Array<{ dimensions?: Record<string, string> }> },
>(invoice: T, adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter): Promise<T> {
  const dimensions = await ensureDimensionNodesInMap(invoice.dimensions, adapter);
  let itemsChanged = false;
  const items = invoice.items
    ? await Promise.all(
        invoice.items.map(async item => {
          const nextDims = await ensureDimensionNodesInMap(item.dimensions, adapter);
          if (nextDims !== item.dimensions) {
            itemsChanged = true;
            return { ...item, dimensions: nextDims };
          }
          return item;
        }),
      )
    : invoice.items;
  if (dimensions === invoice.dimensions && !itemsChanged) return invoice;
  return {
    ...invoice,
    ...(dimensions !== invoice.dimensions ? { dimensions } : {}),
    ...(itemsChanged ? { items } : {}),
  };
}

/**
 * Ensures header and split-level dimension labels on a bill draft are registered as `DimensionNode`s.
 */
export async function ensureBillDimensionNodes<
  T extends { dimensions?: Record<string, string>; splits?: Array<{ dimensions?: Record<string, string> }> },
>(bill: T, adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter): Promise<T> {
  const dimensions = await ensureDimensionNodesInMap(bill.dimensions, adapter);
  let splitsChanged = false;
  const splits = bill.splits
    ? await Promise.all(
        bill.splits.map(async split => {
          const nextDims = await ensureDimensionNodesInMap(split.dimensions, adapter);
          if (nextDims !== split.dimensions) {
            splitsChanged = true;
            return { ...split, dimensions: nextDims };
          }
          return split;
        }),
      )
    : bill.splits;
  if (dimensions === bill.dimensions && !splitsChanged) return bill;
  return {
    ...bill,
    ...(dimensions !== bill.dimensions ? { dimensions } : {}),
    ...(splitsChanged ? { splits } : {}),
  };
}

/**
 * Ensures header, line-level, and split-allocation dimension labels on transaction updates are registered.
 */
export async function ensureTransactionDimensionNodes<
  L extends { dimensions?: Record<string, string>; splitAllocations?: Array<{ dimensions: Record<string, string>; weight: number }> },
  T extends { dimensions?: Record<string, string>; lines?: L[] },
>(tx: T, adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter): Promise<T> {
  const dimensions = await ensureDimensionNodesInMap(tx.dimensions, adapter);
  let linesChanged = false;
  const lines = tx.lines
    ? await Promise.all(
        tx.lines.map(async line => {
          const nextDims = await ensureDimensionNodesInMap(line.dimensions, adapter);
          let allocsChanged = false;
          const nextAllocs = line.splitAllocations
            ? await Promise.all(
                line.splitAllocations.map(async alloc => {
                  const ad = (await ensureDimensionNodesInMap(alloc.dimensions, adapter)) || alloc.dimensions;
                  if (ad !== alloc.dimensions) {
                    allocsChanged = true;
                    return { ...alloc, dimensions: ad };
                  }
                  return alloc;
                }),
              )
            : line.splitAllocations;
          if (nextDims !== line.dimensions || allocsChanged) {
            linesChanged = true;
            return {
              ...line,
              ...(nextDims !== line.dimensions ? { dimensions: nextDims } : {}),
              ...(allocsChanged ? { splitAllocations: nextAllocs } : {}),
            };
          }
          return line;
        }),
      )
    : tx.lines;
  if (dimensions === tx.dimensions && !linesChanged) return tx;
  return {
    ...tx,
    ...(dimensions !== tx.dimensions ? { dimensions } : {}),
    ...(linesChanged ? { lines } : {}),
  };
}
