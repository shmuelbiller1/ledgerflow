/** EU-E3: writes for label parents (kept apart from dimensionNodeActions.ts, which is near its size limit). */
import type { DimensionNode } from '../types';
import { assertSameSession, defaultDimensionNodeAdapter, type DimensionNodeActionAdapter } from './dimensionNodeActions';
import { updateDimensionNodeDescription } from './dimensionUtils';
import { parentProblem } from './labelTree';

const norm = (value: string) => value.normalize('NFC').toLowerCase().trim();

/**
 * EU-E3: sets (or clears, with null) the parent of a label value. Refuses a loop, a parent from
 * another label and an archived parent before anything is written. `rename` optionally gives the
 * value its new own name in the same write (the "/" conversion), never on its own.
 */
/** One parent change per label at a time, so each loop check sees the writes before it. */
const queues = new Map<string, Promise<unknown>>();

export function setDimensionNodeParentInline(
  dimensionId: string,
  nodeId: string,
  parentId: string | null,
  rename?: string,
  adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter,
): Promise<void> {
  // the session is taken when the change is asked for: a change still queued when the workspace
  // or user changes is refused, never written into the new workspace
  const session = adapter.session();
  const key = norm(dimensionId);
  const run = (queues.get(key) || Promise.resolve())
    .catch(() => undefined) // ignore: an earlier change's failure was already reported to its caller (best-effort ordering)
    .then(() => writeParent(dimensionId, nodeId, parentId, rename, adapter, session));
  queues.set(key, run);
  return run;
}

async function writeParent(
  dimensionId: string, nodeId: string, parentId: string | null, rename: string | undefined, adapter: DimensionNodeActionAdapter,
  session: ReturnType<DimensionNodeActionAdapter['session']>,
): Promise<void> {
  if (!session?.canWriteNodes) throw new Error('Your workspace role cannot edit dimension labels.');
  assertSameSession(adapter, session);
  const nodes = adapter.getNodes();
  const problem = parentProblem(nodes, dimensionId, nodeId, parentId);
  if (problem) throw new Error(problem);
  const description = rename?.trim();
  if (rename !== undefined && !description) throw new Error('Enter a label name.');
  const sameLabel = (n: DimensionNode) => norm(n.dimensionId) === norm(dimensionId);
  const current = nodes.find(n => n.id === nodeId && sameLabel(n));
  if (description && nodes.some(n => sameLabel(n) && n.id !== nodeId && n.status !== 'archived' && norm(n.description) === norm(description))) {
    throw new Error(`Another value already uses "${description}".`);
  }
  // the old name stays an alias, so entries and rules that stored it by name still find this value
  const renamed = description && current ? updateDimensionNodeDescription([current], nodeId, dimensionId, description)[0] : undefined;
  await adapter.updateNode(session.workspaceId, dimensionId, nodeId, {
    parentId,
    ...(renamed ? { description: renamed.description, aliases: renamed.aliases || [] } : {}),
    updatedAt: new Date().toISOString(),
  });
  assertSameSession(adapter, session);
  adapter.setNodes(
    adapter.getNodes().map((n: DimensionNode) => {
      if (n.id !== nodeId || !sameLabel(n)) return n;
      const { parentId: _old, ...rest } = n;
      return { ...rest, ...(parentId ? { parentId } : {}), ...(renamed ? { description: renamed.description, aliases: renamed.aliases || [] } : {}) };
    }),
  );
}
