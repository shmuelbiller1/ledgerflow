import { TransactionLine, Transaction, DimensionDefinition, SplitAllocation, DimensionNode } from '../types';

export const DEFAULT_WORKSPACE_DIMENSIONS: DimensionDefinition[] = [
  { id: 'category', name: 'Category', systemDefault: true, sortOrder: 0 },
  { id: 'world', name: 'World / Entity', isWorld: true, sortOrder: 1 },
  { id: 'class', name: 'Class', sortOrder: 2 },
  { id: 'location', name: 'Location', sortOrder: 3 },
  { id: 'project', name: 'Project', sortOrder: 4 }
];

/**
 * Suggests the next short code for a dimension (e.g. 'P6' for 'property') based on existing nodes.
 */
export function suggestNextDimensionNodeId(dimensionId: string, nodes: DimensionNode[] | undefined): string {
  const prefix = dimensionId.substring(0, 1).toUpperCase();
  if (!nodes || nodes.length === 0) return `${prefix}1`;

  const existingIds = nodes
    .filter(n => n.dimensionId === dimensionId && n.id.startsWith(prefix))
    .map(n => Number.parseInt(n.id.substring(1), 10))
    .filter(n => !Number.isNaN(n));

  if (existingIds.length === 0) return `${prefix}1`;
  const max = Math.max(...existingIds);
  return `${prefix}${max + 1}`;
}

/**
 * Resolves a stored dimension value (which may be a node ID like "P1", a path "P1/Dairy", or a free-text string)
 * to its current human-readable display label based on the node registry.
 */
export function resolveDimensionLabel(
  nodes: DimensionNode[] | undefined,
  dimensionId: string,
  storedValue: string | undefined
): string {
  if (!storedValue || storedValue === 'Unassigned') return 'Unassigned';
  if (!nodes || nodes.length === 0) return storedValue;

  const normDim = (dimensionId || '').normalize('NFC').toLowerCase().trim();
  const target = storedValue.trim();
  const cleanTarget = target.normalize('NFC').toLowerCase();

  // 1. Exact ID match
  const matchById = nodes.find(n => n.dimensionId.normalize('NFC').toLowerCase() === normDim && n.id.normalize('NFC').toLowerCase() === cleanTarget);
  if (matchById) return matchById.description;

  // 2. Exact Description match (already stored as description or legacy)
  const matchByDesc = nodes.find(n => n.dimensionId.normalize('NFC').toLowerCase() === normDim && n.description.normalize('NFC').toLowerCase() === cleanTarget);
  if (matchByDesc) return matchByDesc.description;

  // 3. Alias match
  const matchByAlias = nodes.find(n => n.dimensionId.normalize('NFC').toLowerCase() === normDim && n.aliases?.some(a => a.normalize('NFC').toLowerCase() === cleanTarget));
  if (matchByAlias) return matchByAlias.description;

  // 4. Hierarchical path check (e.g. "P1/sub1" where "P1" is node.id or description)
  if (target.includes('/')) {
    const parts = target.split('/');
    const rootPart = parts[0].trim().normalize('NFC').toLowerCase();
    const rootNode = nodes.find(n =>
      n.dimensionId.normalize('NFC').toLowerCase() === normDim &&
      (n.id.normalize('NFC').toLowerCase() === rootPart ||
       n.description.normalize('NFC').toLowerCase() === rootPart ||
       n.aliases?.some(a => a.normalize('NFC').toLowerCase() === rootPart))
    );
    if (rootNode) {
      return [rootNode.description, ...parts.slice(1)].join('/');
    }
  }

  return storedValue;
}

/**
 * Gets the string value of a specified dimension for a transaction line.
 * Optionally resolves node IDs to human display descriptions if `nodes` is provided.
 */
export function getLineDimension(
  line: TransactionLine,
  tx: Transaction | undefined,
  dimensionId: string,
  nodes?: DimensionNode[]
): string {
  const normDim = (dimensionId || '').normalize('NFC').toLowerCase().trim();
  let rawVal = 'Unassigned';

  // 1. Check line.dimensions map
  if (line.dimensions && line.dimensions[normDim]) {
    rawVal = line.dimensions[normDim];
  } else if (normDim === 'class' && line.class) {
    rawVal = line.class;
  } else if (normDim === 'location' && line.location) {
    rawVal = line.location;
  } else if (normDim === 'project' && line.project) {
    rawVal = line.project;
  } else if (normDim === 'department' && line.department) {
    rawVal = line.department;
  } else if (normDim === 'category') {
    if (line.category) rawVal = line.category;
    else if (line.accountName) rawVal = line.accountName;
  } else {
    // 3. Check line tags or tx tags for `dimension:value` format
    const allTags = [...(line.tags || []), ...(tx?.tags || [])];
    for (const tag of allTags) {
      if (!tag) continue;
      if (tag.includes(':')) {
        const [key, ...valParts] = tag.split(':');
        if (key.trim().normalize('NFC').toLowerCase() === normDim) {
          rawVal = valParts.join(':').trim();
          break;
        }
      }
    }

    if (rawVal === 'Unassigned') {
      // 4. Transaction-level dimensions & legacy aliases
      if (tx?.dimensions && tx.dimensions[normDim]) {
        rawVal = tx.dimensions[normDim];
      } else if (tx) {
        if (normDim === 'project' && tx.projectId) rawVal = tx.projectId;
        if (normDim === 'class' && tx.classId) rawVal = tx.classId;
        if (normDim === 'location' && tx.locationId) rawVal = tx.locationId;
      }
    }
  }

  if (nodes && rawVal && rawVal !== 'Unassigned') {
    return resolveDimensionLabel(nodes, dimensionId, rawVal);
  }

  return rawVal;
}

/**
 * Updates a transaction line with a dynamic dimension coordinate while keeping legacy aliases in sync.
 * If `nodes` is provided and the value matches a known node description or alias, stores node.id for stable identity.
 */
export function setLineDimension(
  line: TransactionLine,
  dimensionId: string,
  value: string,
  nodes?: DimensionNode[]
): TransactionLine {
  const normDim = dimensionId.normalize('NFC').toLowerCase().trim();
  let targetValue = value;

  if (nodes && value && value.trim() !== '' && value !== 'Unassigned') {
    const cleanVal = value.trim().normalize('NFC').toLowerCase();
    // 1. Check if value matches an existing node ID exactly
    const exactNodeId = nodes.find(n => n.dimensionId.normalize('NFC').toLowerCase() === normDim && n.id.normalize('NFC').toLowerCase() === cleanVal);
    if (exactNodeId) {
      targetValue = exactNodeId.id;
    } else {
      // 2. Check if value matches node description or alias
      const matchingNode = nodes.find(n =>
        n.dimensionId.normalize('NFC').toLowerCase() === normDim &&
        (n.description.normalize('NFC').toLowerCase() === cleanVal ||
         n.aliases?.some(a => a.normalize('NFC').toLowerCase() === cleanVal))
      );
      if (matchingNode) {
        targetValue = matchingNode.id;
      } else if (cleanVal.includes('/')) {
        // Check if prefix matches description or alias of a node
        const parts = value.split('/');
        const rootPart = parts[0].trim().normalize('NFC').toLowerCase();
        const rootNode = nodes.find(n =>
          n.dimensionId.normalize('NFC').toLowerCase() === normDim &&
          (n.id.normalize('NFC').toLowerCase() === rootPart ||
           n.description.normalize('NFC').toLowerCase() === rootPart ||
           n.aliases?.some(a => a.normalize('NFC').toLowerCase() === rootPart))
        );
        if (rootNode) {
          targetValue = [rootNode.id, ...parts.slice(1)].join('/');
        }
      }
    }
  }

  const updatedDimensions = { ...(line.dimensions || {}), [normDim]: targetValue };
  const updatedLine: TransactionLine = {
    ...line,
    dimensions: updatedDimensions
  };

  // Keep backward-compatible legacy fields in sync with human display label
  const displayLabel = nodes ? resolveDimensionLabel(nodes, normDim, targetValue) : targetValue;
  if (normDim === 'class') updatedLine.class = displayLabel;
  if (normDim === 'location') updatedLine.location = displayLabel;
  if (normDim === 'project') updatedLine.project = displayLabel;
  if (normDim === 'department') updatedLine.department = displayLabel;
  if (normDim === 'category') updatedLine.category = displayLabel;

  return updatedLine;
}

/**
 * Finds or mints a DimensionNode for a given description or value.
 */
export function findOrCreateDimensionNode(
  nodes: DimensionNode[],
  dimensionId: string,
  descriptionOrValue: string
): { node: DimensionNode; isNew: boolean; updatedNodes: DimensionNode[] } {
  const normDim = dimensionId.normalize('NFC').toLowerCase().trim();
  const clean = descriptionOrValue.trim();
  const cleanLower = clean.normalize('NFC').toLowerCase();

  const existing = nodes.find(n =>
    n.dimensionId.normalize('NFC').toLowerCase() === normDim &&
    (n.id.normalize('NFC').toLowerCase() === cleanLower ||
     n.description.normalize('NFC').toLowerCase() === cleanLower ||
     n.aliases?.some(a => a.normalize('NFC').toLowerCase() === cleanLower))
  );

  if (existing) {
    return { node: existing, isNew: false, updatedNodes: nodes };
  }

  const newId = suggestNextDimensionNodeId(dimensionId, nodes);
  const newNode: DimensionNode = {
    id: newId,
    dimensionId,
    description: clean,
    status: 'active',
    createdAt: new Date().toISOString()
  };

  return { node: newNode, isNew: true, updatedNodes: [...nodes, newNode] };
}

/**
 * Updates a dimension node's description while preserving the previous description as an alias
 * so historical free-text lines continue resolving to the renamed node without splitting report buckets.
 */
export function updateDimensionNodeDescription(
  nodes: DimensionNode[],
  nodeId: string,
  dimensionId: string,
  newDescription: string
): DimensionNode[] {
  const normDim = (dimensionId || '').normalize('NFC').toLowerCase().trim();
  const cleanNew = newDescription.trim();

  return nodes.map(n => {
    if (n.id === nodeId && n.dimensionId.normalize('NFC').toLowerCase() === normDim) {
      const prevDesc = n.description?.trim();
      const aliases = [...(n.aliases || [])];
      if (prevDesc && prevDesc !== cleanNew && !aliases.some(a => a.normalize('NFC').toLowerCase() === prevDesc.normalize('NFC').toLowerCase())) {
        aliases.push(prevDesc);
      }
      return { ...n, description: newDescription, aliases };
    }
    return n;
  });
}

/**
 * One-time backfill: extracts distinct free-text dimension values from transaction lines
 * across all axes using extractUniqueDimensionPaths and mints DimensionNode entries
 * for any value not yet backed by a node.
 */
export function backfillDimensionNodesFromTransactions(
  transactions: Transaction[],
  existingNodes: DimensionNode[] = [],
  dimensionDefs: DimensionDefinition[] = DEFAULT_WORKSPACE_DIMENSIONS
): { newNodes: DimensionNode[]; allNodes: DimensionNode[]; createdCount: number } {
  let currentNodes = [...existingNodes];
  const newNodesCreated: DimensionNode[] = [];

  for (const dim of dimensionDefs) {
    const paths = extractUniqueDimensionPaths(transactions, dim.id);
    for (const p of paths) {
      if (!p || p === 'Unassigned') continue;
      const { node, isNew, updatedNodes } = findOrCreateDimensionNode(currentNodes, dim.id, p);
      if (isNew) {
        newNodesCreated.push(node);
        currentNodes = updatedNodes;
      }
    }
  }

  return {
    newNodes: newNodesCreated,
    allNodes: currentNodes,
    createdCount: newNodesCreated.length
  };
}

/**
 * Migrates a set of transactions so that free-text dimension values are converted into stable DimensionNode records
 * and lines are updated to store node IDs.
 */
export function migrateWorkspaceDimensionNodes(
  transactions: Transaction[],
  existingNodes: DimensionNode[] = [],
  dimensionDefs: DimensionDefinition[] = DEFAULT_WORKSPACE_DIMENSIONS
): { updatedTransactions: Transaction[]; updatedNodes: DimensionNode[]; migrationCount: number } {
  let currentNodes = [...existingNodes];
  let migrationCount = 0;

  const activeAxes = dimensionDefs.map(d => d.id);

  const updatedTransactions = transactions.map(tx => {
    let txModified = false;
    const newLines = tx.lines?.map(line => {
      let lineModified = false;
      let updatedLine = { ...line };

      for (const axisId of activeAxes) {
        const rawVal = getLineDimension(updatedLine, tx, axisId);
        if (!rawVal || rawVal === 'Unassigned') continue;

        // Check if rawVal is already a node ID
        const normDim = axisId.normalize('NFC').toLowerCase().trim();
        const isAlreadyNodeId = currentNodes.some(n =>
          n.dimensionId.normalize('NFC').toLowerCase() === normDim && n.id === rawVal
        );

        if (!isAlreadyNodeId) {
          // Find or create node for rawVal
          const { node, isNew: _isNew, updatedNodes } = findOrCreateDimensionNode(currentNodes, axisId, rawVal);
          currentNodes = updatedNodes;

          // Rewrite line dimension to store node.id
          updatedLine = setLineDimension(updatedLine, axisId, node.id, currentNodes);
          lineModified = true;
          migrationCount++;
        }
      }

      if (lineModified) txModified = true;
      return updatedLine;
    });

    if (txModified) {
      return { ...tx, lines: newLines || [] };
    }
    return tx;
  });

  return { updatedTransactions, updatedNodes: currentNodes, migrationCount };
}

/**
 * Checks if a coordinate path matches or sits under a target parent path (hierarchical subtree match).
 * e.g., 'homes/maui/unit1' matches under 'homes' or 'homes/maui'.
 */
export function isPathSubtreeMatch(path: string, parentPath: string): boolean {
  if (!path || !parentPath) return false;
  const p = path.normalize('NFC').toLowerCase().trim();
  const target = parentPath.normalize('NFC').toLowerCase().trim();
  if (p === target) return true;
  return p.startsWith(target + '/');
}

/**
 * Validates split weight allocations for a line.
 * Weights across split allocations must sum to 1.0 (100%).
 */
export function validateSplitAllocations(splits?: SplitAllocation[]): { valid: boolean; sum: number; error?: string } {
  if (!splits || splits.length === 0) {
    return { valid: true, sum: 1.0 };
  }

  const hasInvalidWeight = splits.some(s => typeof s.weight !== 'number' || s.weight < 0 || s.weight > 1.0);
  if (hasInvalidWeight) {
    return {
      valid: false,
      sum: splits.reduce((acc, s) => acc + (s.weight || 0), 0),
      error: 'Individual split weight allocations must be between 0% (0.0) and 100% (1.0).'
    };
  }

  const sum = splits.reduce((acc, s) => acc + (s.weight || 0), 0);
  const roundedSum = Math.round(sum * 1000) / 1000; // allow small JS float precision

  if (Math.abs(roundedSum - 1.0) > 0.001) {
    return {
      valid: false,
      sum: roundedSum,
      error: `Split weights sum to ${(roundedSum * 100).toFixed(1)}%, but must total exactly 100%.`
    };
  }

  return { valid: true, sum: roundedSum };
}

/**
 * Extracts all unique hierarchical paths present in a dataset for autocomplete trie/dropdowns.
 */
export function extractUniqueDimensionPaths(
  transactions: Transaction[],
  dimensionId: string
): string[] {
  const pathSet = new Set<string>();

  transactions.forEach(tx => {
    tx.lines?.forEach(line => {
      const val = getLineDimension(line, tx, dimensionId);
      if (val && val !== 'Unassigned') {
        pathSet.add(val);
        // Also add parent path steps (e.g. homes/maui -> add homes)
        const parts = val.split('/');
        let current = '';
        for (let i = 0; i < parts.length - 1; i++) {
          current = current ? `${current}/${parts[i]}` : parts[i];
          if (current) pathSet.add(current);
        }
      }
    });
  });

  return Array.from(pathSet).sort();
}

/**
 * Deep Labeling & Multi-Dimensional Hierarchical Decomposition
 */
export interface DecomposedLabel {
  root: string;
  segments: string[];
  depth: number;
  parentPath: string | null;
  fullPath: string;
}

/**
 * Decomposes a multi-dimensional / nested label into its constituent hierarchy.
 * Supports delimiters: '/', ' > ', or ':'.
 * e.g. "Marketing / Digital / PPC" -> segments: ["Marketing", "Digital", "PPC"]
 */
export function decomposeHierarchicalLabel(label: string): DecomposedLabel {
  if (!label || typeof label !== 'string') {
    return { root: '', segments: [], depth: 0, parentPath: null, fullPath: '' };
  }

  const trimmed = label.trim();
  let segments: string[];

  if (trimmed.includes('>')) {
    segments = trimmed.split('>').map(s => s.trim()).filter(Boolean);
  } else if (trimmed.includes('/')) {
    segments = trimmed.split('/').map(s => s.trim()).filter(Boolean);
  } else if (trimmed.includes(':')) {
    segments = trimmed.split(':').map(s => s.trim()).filter(Boolean);
  } else {
    segments = [trimmed];
  }

  const root = segments[0] || '';
  const depth = segments.length;
  const parentPath = depth > 1 ? segments.slice(0, depth - 1).join('/') : null;
  const fullPath = segments.join('/');

  return { root, segments, depth, parentPath, fullPath };
}

/**
 * Matches a deep label against a target query pattern.
 * If matchAncestors is true, 'Dept/Engineering/Backend' matches a query for 'Dept/Engineering' or 'Dept'.
 */
export function matchDeepLabel(assigned: string, target: string, matchAncestors = true): boolean {
  if (!assigned || !target) return false;
  const a = assigned.normalize('NFC').toLowerCase().trim();
  const t = target.normalize('NFC').toLowerCase().trim();
  if (a === t) return true;

  const aDec = decomposeHierarchicalLabel(a);
  const tDec = decomposeHierarchicalLabel(t);

  // Exact normalized path match
  if (aDec.fullPath.normalize('NFC').toLowerCase() === tDec.fullPath.normalize('NFC').toLowerCase()) return true;

  if (matchAncestors) {
    // Child matches ancestor (e.g. 'engineering/backend' matches 'engineering')
    if (aDec.fullPath.normalize('NFC').toLowerCase().startsWith(tDec.fullPath.normalize('NFC').toLowerCase() + '/')) return true;
    // Ancestor matches child if desired
    if (tDec.fullPath.normalize('NFC').toLowerCase().startsWith(aDec.fullPath.normalize('NFC').toLowerCase() + '/')) return true;
  }

  return false;
}

/**
 * Expands hierarchical deep tags so that querying on any parent tier works seamlessly.
 * e.g. ["marketing/digital/ppc", "dept:ops:warehouse"]
 * -> ["marketing", "marketing/digital", "marketing/digital/ppc", "dept:ops", "dept:ops:warehouse"]
 */
export function expandDeepLabels(labels: string[]): string[] {
  if (!labels || labels.length === 0) return [];
  const resultSet = new Set<string>();

  for (const raw of labels) {
    if (!raw || typeof raw !== 'string') continue;
    const clean = raw.trim();
    resultSet.add(clean);

    // If label uses ':', expand colon prefixes (e.g. dept:ops:warehouse -> dept:ops, dept)
    if (clean.includes(':')) {
      const parts = clean.split(':').map(p => p.trim()).filter(Boolean);
      let cumulative = '';
      for (let i = 0; i < parts.length; i++) {
        cumulative = cumulative ? `${cumulative}:${parts[i]}` : parts[i];
        resultSet.add(cumulative);
      }
    }

    // If label uses '/' or '>', expand slash paths
    const dec = decomposeHierarchicalLabel(clean);
    if (dec.depth > 1) {
      let cumulativePath = '';
      for (let i = 0; i < dec.segments.length; i++) {
        cumulativePath = cumulativePath ? `${cumulativePath}/${dec.segments[i]}` : dec.segments[i];
        resultSet.add(cumulativePath);
      }
    }
  }

  return Array.from(resultSet);
}

/**
 * Extracts deep multi-dimensional coordinates and labels from free text (memos, descriptions).
 * Looks for patterns like [Dimension:Value/SubValue] or #tag/subtag
 */
export function extractMultiDimensionalLabels(
  text: string,
  existingDimensions?: Record<string, string>,
  existingTags?: string[]
): { dimensions: Record<string, string>; tags: string[]; deepPaths: string[] } {
  const dimensions: Record<string, string> = { ...(existingDimensions || {}) };
  const tagSet = new Set<string>(existingTags || []);
  const deepPaths: string[] = [];

  if (!text) return { dimensions, tags: Array.from(tagSet), deepPaths };

  // 1. Match bracketed dimensions: [Key:Value] or [Key:Value/SubValue]
  const bracketRegex = /\[([\p{L}\p{M}\p{N}_-]+)\s*[:=]\s*([^\]]+)\]/gu;
  let bMatch;
  while ((bMatch = bracketRegex.exec(text)) !== null) {
    const dimKey = bMatch[1].normalize('NFC').toLowerCase().trim();
    const dimVal = bMatch[2].trim();
    dimensions[dimKey] = dimVal;
    deepPaths.push(`${dimKey}:${dimVal}`);
    tagSet.add(`${dimKey}:${dimVal}`);
  }

  // 2. Match hashtag deep paths: #project/apollo/subphase or #dept/eng
  const hashRegex = /#([\p{L}\p{M}\p{N}_/: -]+)/gu;
  let hMatch;
  while ((hMatch = hashRegex.exec(text)) !== null) {
    const tag = hMatch[1].trim();
    tagSet.add(tag);
    if (tag.includes('/') || tag.includes(':')) {
      deepPaths.push(tag);
    }
  }

  const expandedTags = expandDeepLabels(Array.from(tagSet));
  return { dimensions, tags: expandedTags, deepPaths };
}

/**
 * Canonical string normalizer: trims whitespace, normalizes Unicode to NFC canonical composition, and converts to lowercase.
 * Essential for multilingual text (e.g. Hebrew, accented characters) where visually identical glyphs
 * can have different binary representations (composed vs decomposed).
 */
export function normalizeLabel(label: string | null | undefined): string {
  if (!label) return '';
  return label.trim().normalize('NFC').toLowerCase();
}


/**
 * AU-2: the one label filter. A stored label value (node id, description or alias, with an optional
 * `/child` path) resolves to its stable node id; a value no node knows stays as written (trimmed).
 */
export function stableLabelValue(raw: string, dimensionId: string, nodes: readonly DimensionNode[] = []): string {
  const normalize = (value: string) => value.normalize('NFC').toLowerCase().trim();
  const dimension = normalize(dimensionId);
  const matches = (value: string) => {
    const key = normalize(value);
    return nodes.find(node => normalize(node.dimensionId) === dimension &&
      [node.id, node.description, ...(node.aliases || [])].some(label => normalize(label) === key));
  };
  const target = raw.trim();
  const exactNode = matches(target);
  if (exactNode) return exactNode.id;
  const [root, ...suffix] = target.split('/');
  if (!suffix.length) return target;
  const rootNode = matches(root);
  return rootNode ? [rootNode.id, ...suffix].join('/') : target;
}

/** AU-2: does this line carry `filter.value` for `filter.dimensionId` (by id, name or alias)? */
export function lineHasLabel(
  line: TransactionLine,
  tx: Transaction | undefined,
  filter: { dimensionId: string; value: string },
  nodes: readonly DimensionNode[] = [],
): boolean {
  const own = getLineDimension(line, tx, filter.dimensionId);
  const key = (v: string) => stableLabelValue(v, filter.dimensionId, nodes).normalize('NFC').toLowerCase();
  return key(own) === key(filter.value); // case does not matter: "tel aviv" finds "Tel Aviv"
}
