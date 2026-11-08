import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { doc, getDoc, setDoc, updateDoc } from './db/firestore';
import { db } from '../firebase';
import {
  DEFAULT_WORKSPACE_DIMENSIONS,
  resolveDimensionLabel,
  setLineDimension,
  suggestNextDimensionNodeId,
  updateDimensionNodeDescription,
} from './dimensionUtils';
import { normalizeSearchText } from './textNormalization';
import type { DimensionDefinition, DimensionNode, Project, TransactionLine } from '../types';

/** Normalizes text for case-insensitive Unicode comparisons. */
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
 * (including hierarchical paths like "5 Ocean Ave/Unit B" -> "P5/Unit B"), keeping unknown text
 * and slash suffixes intact.
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
    if (headNode) return [headNode.id, ...tail].join('/');
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
  /**
   * Inserts a new node only when no row with its primary key exists yet, returning `'conflict'`
   * instead of overwriting an existing label when another client or stale cache already took the ID.
   */
  createOnlyNode?(workspaceId: string, node: DimensionNode): Promise<'created' | 'conflict'>;
  readNode(workspaceId: string, dimensionId: string, nodeId: string): Promise<Record<string, unknown> | undefined>;
  updateNode(workspaceId: string, dimensionId: string, nodeId: string, fields: Record<string, unknown>): Promise<void>;
  readWorkspace(workspaceId: string): Promise<{ dimensions?: DimensionDefinition[] } | undefined>;
  updateWorkspace(workspaceId: string, dimensions: DimensionDefinition[]): Promise<void>;
}

/** Builds the deterministic `dimensionNodes` primary key for a workspace, axis, and node ID. */
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
  createOnlyNode: async (workspaceId, node) => {
    if (!db) return 'created';
    const rowId = nodeDocId(workspaceId, node.dimensionId, node.id);
    const { error } = await db.client().from('dimensionNodes').insert({
      id: rowId,
      data: { ...node, workspaceId },
    });
    if (!error) return 'created';
    if (error.code === '23505' || /duplicate key|already exists/i.test(error.message || '')) {
      return 'conflict';
    }
    throw new Error(`${error.message || 'Database error'} (dimensionNodes/${rowId})`);
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

/** Verifies the signed-in user and active workspace have not changed while an async write was in flight. */
function assertSameSession(adapter: DimensionNodeActionAdapter, initial: DimensionActionSession) {
  const current = adapter.session();
  if (!current || current.uid !== initial.uid || current.workspaceId !== initial.workspaceId) {
    throw new Error('Workspace or signed-in user changed before the label finished saving.');
  }
  return current;
}

/** Merges newly discovered remote nodes and a freshly created node into the adapter's node list without overwriting unrelated nodes. */
function mergeNodesIntoStore(
  adapter: DimensionNodeActionAdapter,
  discovered: readonly DimensionNode[],
  created?: DimensionNode,
): void {
  const merged = [...adapter.getNodes()];
  const upsertLocal = (item: DimensionNode) => {
    const idx = merged.findIndex(
      n => norm(n.id) === norm(item.id) && norm(n.dimensionId) === norm(item.dimensionId),
    );
    if (idx === -1) merged.push(item);
    else merged[idx] = item;
  };
  for (const remote of discovered) upsertLocal(remote);
  if (created) upsertLocal(created);
  adapter.setNodes(merged);
}

/** Converts a raw remote document into a typed DimensionNode when valid. */
function toRemoteDimensionNode(
  raw: Record<string, unknown> | undefined,
  fallbackDimensionId: string,
  fallbackId: string,
): DimensionNode | undefined {
  if (!raw || typeof raw.description !== 'string') return undefined;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : fallbackId,
    dimensionId: typeof raw.dimensionId === 'string' && raw.dimensionId ? raw.dimensionId : fallbackDimensionId,
    description: raw.description,
    ...(Array.isArray(raw.aliases) ? { aliases: raw.aliases.filter((a): a is string => typeof a === 'string') } : {}),
    status: raw.status === 'archived' ? 'archived' : 'active',
    ...(typeof raw.createdAt === 'string' ? { createdAt: raw.createdAt } : {}),
  };
}

/** Attempts a create-only write, falling back to a read-before-write check for custom test adapters. */
async function tryCreateNode(
  adapter: DimensionNodeActionAdapter,
  workspaceId: string,
  node: DimensionNode,
): Promise<'created' | 'conflict'> {
  if (adapter.createOnlyNode) {
    return adapter.createOnlyNode(workspaceId, node);
  }
  const existing = await adapter.readNode(workspaceId, node.dimensionId, node.id);
  if (existing) return 'conflict';
  await adapter.writeNode(workspaceId, node);
  return 'created';
}

const MAX_ID_COLLISION_RETRIES = 16;

/**
 * Registers a new DimensionNode (or unarchives a matching archived node) immediately
 * from inside a transaction form or Settings, returning the persisted node.
 *
 * Uses create-only inserts with conflict-safe ID retry so stale caches or concurrent writers
 * never overwrite an existing label.
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

  const workingNodes = [...adapter.getNodes()];
  const discoveredRemote: DimensionNode[] = [];
  const existing = matchDimensionNode(workingNodes, dimId, description);
  const cleanAliases = initialAliases.map(a => a.trim()).filter(Boolean);

  if (existing) {
    if (existing.status === 'archived') {
      const mergedAliases = cleanAliases.length > 0
        ? Array.from(new Set([...(existing.aliases || []), ...cleanAliases]))
        : existing.aliases;
      const reactivated: DimensionNode = {
        ...existing,
        ...(mergedAliases ? { aliases: mergedAliases } : {}),
        status: 'active',
      };
      await adapter.updateNode(session.workspaceId, existing.dimensionId, existing.id, {
        status: 'active',
        ...(mergedAliases ? { aliases: mergedAliases } : {}),
        updatedAt: new Date().toISOString(),
      });
      assertSameSession(adapter, session);
      mergeNodesIntoStore(adapter, [], reactivated);
      return reactivated;
    }
    return existing;
  }

  for (let attemptIdx = 0; attemptIdx <= MAX_ID_COLLISION_RETRIES; attemptIdx++) {
    const candidateId =
      attemptIdx < MAX_ID_COLLISION_RETRIES
        ? suggestNextDimensionNodeId(dimId, workingNodes)
        : `${(dimId.replace(/[^a-z0-9]/gi, '').slice(0, 4) || 'N').toUpperCase()}-${crypto.randomUUID().slice(0, 8)}`;

    const newNode: DimensionNode = {
      id: candidateId,
      dimensionId: dimId,
      description,
      ...(cleanAliases.length > 0 ? { aliases: cleanAliases } : {}),
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    const outcome = await tryCreateNode(adapter, session.workspaceId, newNode);
    assertSameSession(adapter, session);

    if (outcome === 'created') {
      mergeNodesIntoStore(adapter, discoveredRemote, newNode);
      return newNode;
    }

    const remoteRaw = await adapter.readNode(session.workspaceId, dimId, candidateId);
    assertSameSession(adapter, session);
    const remoteNode = toRemoteDimensionNode(remoteRaw, dimId, candidateId);
    if (remoteNode) {
      discoveredRemote.push(remoteNode);
      workingNodes.push(remoteNode);
      if (remoteNode.status !== 'archived' && norm(remoteNode.description) === norm(description)) {
        mergeNodesIntoStore(adapter, discoveredRemote);
        return remoteNode;
      }
    } else {
      workingNodes.push({ id: candidateId, dimensionId: dimId, description: `__reserved_${candidateId}__`, status: 'active' });
    }
  }

  throw new Error('Could not allocate a unique label ID. Please try saving again.');
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
  if (!session?.canWriteNodes) throw new Error('Your workspace role cannot rename dimension labels.');

  const currentNodes = adapter.getNodes();
  const duplicate = currentNodes.find(
    n =>
      norm(n.dimensionId) === norm(dimensionId) &&
      n.id !== nodeId &&
      n.status !== 'archived' &&
      norm(n.description) === norm(description),
  );
  if (duplicate) {
    throw new Error(`Another label ("${duplicate.id}") already uses "${description}".`);
  }

  const remote = await adapter.readNode(session.workspaceId, dimensionId, nodeId);
  const checked = assertSameSession(adapter, session);
  if (!checked.canWriteNodes) throw new Error('Your workspace role cannot rename dimension labels.');

  if (
    remote &&
    typeof remote.description === 'string' &&
    remote.description.trim() !== previousDescription.trim()
  ) {
    throw new Error('This label was changed in another tab or by another team member. Refresh and try again.');
  }

  const latestNodes = adapter.getNodes();
  const concurrentDuplicate = latestNodes.find(
    n =>
      norm(n.dimensionId) === norm(dimensionId) &&
      n.id !== nodeId &&
      n.status !== 'archived' &&
      norm(n.description) === norm(description),
  );
  if (concurrentDuplicate) {
    throw new Error(`Another label ("${concurrentDuplicate.id}") already uses "${description}".`);
  }

  const baseNodes = latestNodes.some(
    n => n.id === nodeId && norm(n.dimensionId) === norm(dimensionId),
  )
    ? latestNodes
    : [
        ...latestNodes,
        {
          id: nodeId,
          dimensionId,
          description: previousDescription.trim(),
          aliases: Array.isArray(remote?.aliases) ? (remote.aliases as string[]) : [],
          status: 'active' as const,
        },
      ];

  if (norm(previousDescription) === norm(description) && previousDescription.trim() === description) {
    const unchanged = baseNodes.find(n => n.id === nodeId && norm(n.dimensionId) === norm(dimensionId))!;
    return unchanged;
  }

  const updatedList = updateDimensionNodeDescription(baseNodes, nodeId, dimensionId, description);
  const updatedNode = updatedList.find(n => n.id === nodeId && norm(n.dimensionId) === norm(dimensionId));
  if (!updatedNode) throw new Error('Label could not be found.');

  await adapter.updateNode(session.workspaceId, dimensionId, nodeId, {
    description: updatedNode.description,
    aliases: updatedNode.aliases || [],
    updatedAt: new Date().toISOString(),
  });
  assertSameSession(adapter, session);
  mergeNodesIntoStore(adapter, [], updatedNode);
  return updatedNode;
}

/**
 * Archives or reactivates a DimensionNode immediately and syncs the store.
 */
export async function setDimensionNodeStatusInline(
  dimensionId: string,
  nodeId: string,
  status: 'active' | 'archived',
  adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter,
): Promise<void> {
  const session = adapter.session();
  if (!session?.canWriteNodes) throw new Error('Your workspace role cannot update dimension labels.');

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
 * Resolves one or more project input candidates (project ID, project name, or `DimensionNode` ID)
 * back to a real workspace `Project.id` when a matching project exists, preserving legacy
 * `line.project === project.id` linkage for the Projects and ProjectPipeline screens.
 */
export function resolveWorkspaceProjectId(
  candidates: readonly (string | undefined)[],
  projects: readonly Pick<Project, 'id' | 'name'>[] | undefined,
  nodes?: readonly DimensionNode[],
): string | undefined {
  if (!projects || projects.length === 0) return undefined;
  for (const raw of candidates) {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed || trimmed === 'Unassigned') continue;
    const byId = projects.find(p => p.id === trimmed);
    if (byId) return byId.id;
    const key = normalizeSearchText(trimmed).trim();
    if (key) {
      const byName = projects.find(p => normalizeSearchText(p.name).trim() === key);
      if (byName) return byName.id;
    }
    if (nodes && nodes.length > 0) {
      const label = resolveDimensionLabel([...nodes], 'project', trimmed);
      const labelKey = normalizeSearchText(label).trim();
      if (label && label !== trimmed) {
        const byNodeLabel = projects.find(
          p => p.id === label || (labelKey !== '' && normalizeSearchText(p.name).trim() === labelKey),
        );
        if (byNodeLabel) return byNodeLabel.id;
      }
    }
  }
  return undefined;
}

/**
 * Builds a minimal `Partial<TransactionLine>` patch for a single dimension edit without copying
 * unrelated line fields (such as `quantity` or `unitPriceCents`), while keeping `line.project`
 * bound to a real workspace `Project.id` whenever a workspace project matches.
 */
export function buildTransactionLineDimensionPatch(
  line: TransactionLine,
  dimensionId: string,
  value: string,
  nodes?: DimensionNode[],
  projects?: readonly Pick<Project, 'id' | 'name'>[],
): Partial<TransactionLine> {
  const normDim = norm(dimensionId);
  const updated = setLineDimension(line, dimensionId, value, nodes);
  const patch: Partial<TransactionLine> = {
    dimensions: updated.dimensions,
  };
  if (normDim === 'class') patch.class = updated.class;
  else if (normDim === 'location') patch.location = updated.location;
  else if (normDim === 'department') patch.department = updated.department;
  else if (normDim === 'category') patch.category = updated.category;
  else if (normDim === 'project') {
    if (!value.trim() || value === 'Unassigned') {
      patch.project = updated.project;
    } else {
      const previousValue = line.dimensions?.project
        || projects?.find(project => project.id === line.project)?.name
        || line.project;
      const previousNode = matchDimensionNode(nodes, 'project', previousValue);
      const nextNode = matchDimensionNode(nodes, 'project', value);
      // A rename keeps node identity even when legacy values store descriptions or aliases.
      const sameNode = previousNode !== undefined && previousNode.id === nextNode?.id;
      const matchedProjectId = resolveWorkspaceProjectId(
        [value, updated.project, updated.dimensions?.project, sameNode ? line.project : undefined],
        projects,
        nodes,
      );
      patch.project = matchedProjectId ?? updated.project;
    }
  }
  return patch;
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
 * in the workspace (creating new root nodes when the user has `bookkeeper+` permissions) and rewrites
 * the map to store canonical `node.id` values while preserving hierarchical slash suffixes intact.
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

    const resolveSingle = async (token: string): Promise<string> => {
      const cleanToken = token.trim();
      if (!cleanToken || cleanToken === 'Unassigned') return token;
      const existing = matchDimensionNode(adapter.getNodes(), axisId, cleanToken);
      if (existing && existing.status !== 'archived') return existing.id;
      if (session?.canWriteNodes) {
        const created = await registerDimensionNodeInline(axisId, cleanToken, [], adapter);
        return created.id;
      }
      return cleanToken;
    };

    let joined: string;
    const wholeMatch = matchDimensionNode(adapter.getNodes(), axisId, trimmed);
    if (wholeMatch && wholeMatch.status !== 'archived') {
      joined = wholeMatch.id;
    } else if (trimmed.includes('/')) {
      const [head, ...tail] = trimmed.split('/');
      const resolvedHead = head.trim() ? await resolveSingle(head) : head;
      joined = [resolvedHead, ...tail].join('/');
    } else {
      joined = await resolveSingle(trimmed);
    }

    next[axisId] = joined;
    if (joined !== rawValue) changed = true;
  }

  return changed ? next : rawDimensions;
}

/**
 * Ensures header and line-level dimension labels on an invoice draft are registered sequentially
 * so multi-line saves never allocate colliding node IDs.
 */
export async function ensureInvoiceDimensionNodes<
  T extends { dimensions?: Record<string, string>; items?: Array<{ dimensions?: Record<string, string> }> },
>(invoice: T, adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter): Promise<T> {
  const dimensions = await ensureDimensionNodesInMap(invoice.dimensions, adapter);
  let itemsChanged = false;
  let items = invoice.items;
  if (invoice.items) {
    const out: typeof invoice.items = [];
    for (const item of invoice.items) {
      const nextDims = await ensureDimensionNodesInMap(item.dimensions, adapter);
      if (nextDims !== item.dimensions) {
        itemsChanged = true;
        out.push({ ...item, dimensions: nextDims });
      } else {
        out.push(item);
      }
    }
    items = out;
  }
  if (dimensions === invoice.dimensions && !itemsChanged) return invoice;
  return {
    ...invoice,
    ...(dimensions !== invoice.dimensions ? { dimensions } : {}),
    ...(itemsChanged ? { items } : {}),
  };
}

/**
 * Ensures header and split-level dimension labels on a bill draft are registered sequentially
 * so multi-line saves never allocate colliding node IDs.
 */
export async function ensureBillDimensionNodes<
  T extends { dimensions?: Record<string, string>; splits?: Array<{ dimensions?: Record<string, string> }> },
>(bill: T, adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter): Promise<T> {
  const dimensions = await ensureDimensionNodesInMap(bill.dimensions, adapter);
  let splitsChanged = false;
  let splits = bill.splits;
  if (bill.splits) {
    const out: typeof bill.splits = [];
    for (const split of bill.splits) {
      const nextDims = await ensureDimensionNodesInMap(split.dimensions, adapter);
      if (nextDims !== split.dimensions) {
        splitsChanged = true;
        out.push({ ...split, dimensions: nextDims });
      } else {
        out.push(split);
      }
    }
    splits = out;
  }
  if (dimensions === bill.dimensions && !splitsChanged) return bill;
  return {
    ...bill,
    ...(dimensions !== bill.dimensions ? { dimensions } : {}),
    ...(splitsChanged ? { splits } : {}),
  };
}

/**
 * Ensures header, line-level, and split-allocation dimension labels on transaction updates are
 * registered sequentially so multi-line and multi-allocation saves never collide.
 */
export async function ensureTransactionDimensionNodes<
  L extends { dimensions?: Record<string, string>; splitAllocations?: Array<{ dimensions: Record<string, string>; weight: number }> },
  T extends { dimensions?: Record<string, string>; lines?: L[] },
>(tx: T, adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter): Promise<T> {
  const dimensions = await ensureDimensionNodesInMap(tx.dimensions, adapter);
  let linesChanged = false;
  let lines = tx.lines;
  if (tx.lines) {
    const outLines: L[] = [];
    for (const line of tx.lines) {
      const nextDims = await ensureDimensionNodesInMap(line.dimensions, adapter);
      let allocsChanged = false;
      let nextAllocs = line.splitAllocations;
      if (line.splitAllocations) {
        const outAllocs: NonNullable<L['splitAllocations']> = [];
        for (const alloc of line.splitAllocations) {
          const ad = (await ensureDimensionNodesInMap(alloc.dimensions, adapter)) || alloc.dimensions;
          if (ad !== alloc.dimensions) {
            allocsChanged = true;
            outAllocs.push({ ...alloc, dimensions: ad });
          } else {
            outAllocs.push(alloc);
          }
        }
        nextAllocs = outAllocs;
      }
      if (nextDims !== line.dimensions || allocsChanged) {
        linesChanged = true;
        outLines.push({
          ...line,
          ...(nextDims !== line.dimensions ? { dimensions: nextDims } : {}),
          ...(allocsChanged ? { splitAllocations: nextAllocs } : {}),
        });
      } else {
        outLines.push(line);
      }
    }
    lines = outLines;
  }
  if (dimensions === tx.dimensions && !linesChanged) return tx;
  return {
    ...tx,
    ...(dimensions !== tx.dimensions ? { dimensions } : {}),
    ...(linesChanged ? { lines } : {}),
  };
}
