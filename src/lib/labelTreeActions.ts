/** EU-E3: writes for label parents (kept apart from dimensionNodeActions.ts, which is near its size limit). */
import type { DimensionNode } from '../types';
import { assertSameSession, defaultDimensionNodeAdapter, type DimensionNodeActionAdapter } from './dimensionNodeActions';
import { parentProblem } from './labelTree';

const norm = (value: string) => value.normalize('NFC').toLowerCase().trim();

/**
 * EU-E3: sets (or clears, with null) the parent of a label value. Refuses a loop, a parent from
 * another label and an archived parent before anything is written. `rename` optionally gives the
 * value its new own name in the same write (the "/" conversion), never on its own.
 */
export async function setDimensionNodeParentInline(
  dimensionId: string,
  nodeId: string,
  parentId: string | null,
  rename?: string,
  adapter: DimensionNodeActionAdapter = defaultDimensionNodeAdapter,
): Promise<void> {
  const session = adapter.session();
  if (!session?.canWriteNodes) throw new Error('Your workspace role cannot edit dimension labels.');
  const problem = parentProblem(adapter.getNodes(), dimensionId, nodeId, parentId);
  if (problem) throw new Error(problem);
  const description = rename?.trim();
  if (rename !== undefined && !description) throw new Error('Enter a label name.');
  await adapter.updateNode(session.workspaceId, dimensionId, nodeId, {
    parentId,
    ...(description ? { description } : {}),
    updatedAt: new Date().toISOString(),
  });
  assertSameSession(adapter, session);
  adapter.setNodes(
    adapter.getNodes().map((n: DimensionNode) => {
      if (n.id !== nodeId || norm(n.dimensionId) !== norm(dimensionId)) return n;
      const { parentId: _old, ...rest } = n;
      return { ...rest, ...(parentId ? { parentId } : {}), ...(description ? { description } : {}) };
    }),
  );
}
