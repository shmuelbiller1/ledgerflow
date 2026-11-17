import { doc, getDoc, type Firestore } from '../db/firestore';
import { DimensionNode } from '../../types';
import { runNamedCommand } from '../commandByName';
import { localSet, localUpdate } from '../db/localStore';
import { guestSession } from '../db/guestDatabase';

export interface MigrationResult {
  migratedCount: number;
  workspaceId: string;
  success: boolean;
  error?: string;
}

/**
 * One-off move of a legacy `workspace.dimensionNodes` tree into the `dimensionNodes` collection.
 *
 * The move itself is `workspace.dimensionnodesmigrate`: it writes the values and clears the legacy field in the
 * same transaction, so a tab that goes away halfway cannot leave a workspace where half the tree is in the
 * collection and the rest is still on the row (which is what the browser's `writeBatch` + `updateDoc` pair could
 * do, and what made the next load migrate the same values again). This module is now only the caller: it reads the
 * legacy array, sends it in the screen's own 450-row chunks, and reports what happened.
 *
 * The sample company has no workspace on the server, so it keeps the move in its own copy: the values go into its
 * `dimensionNodes` table and the field is cleared on its workspace row, exactly as a signed-in tab's server does.
 */
const CHUNK = 450;

export async function migrateWorkspaceDimensionNodesToCollection(
  db: Firestore,
  workspaceId: string
): Promise<MigrationResult> {
  if (!db || !workspaceId) {
    return { migratedCount: 0, workspaceId, success: false, error: 'Invalid db or workspaceId' };
  }

  try {
    const wsRef = doc(db, 'workspaces', workspaceId);
    const wsSnap = await getDoc(wsRef);
    if (!wsSnap.exists()) {
      return { migratedCount: 0, workspaceId, success: false, error: 'Workspace does not exist' };
    }

    const data = wsSnap.data() as Record<string, unknown>;
    const legacyNodes: DimensionNode[] = Array.isArray(data.dimensionNodes) ? (data.dimensionNodes as DimensionNode[]) : [];

    if (legacyNodes.length === 0) {
      // the field can still be present as an empty list; clearing it is the whole point of the move
      if ('dimensionNodes' in data) {
        if (guestSession()) await localUpdate('workspaces', workspaceId, { dimensionNodes: null });
        else await runNamedCommand('workspace.dimensionnodesmigrate', { nodes: [] }, { workspaceId });
      }
      return { migratedCount: 0, workspaceId, success: true };
    }

    const incomplete = legacyNodes.filter(node => !node?.dimensionId || !node?.id);
    if (incomplete.length > 0) {
      // the row id is derived from the axis and the code: a value without one has nowhere to land, and a command
      // that guessed would put it where no screen reads it
      return {
        migratedCount: 0,
        workspaceId,
        success: false,
        error: `${incomplete.length} legacy label(s) have no axis or no code and were left on the workspace`,
      };
    }

    let migratedCount = 0;
    for (let i = 0; i < legacyNodes.length; i += CHUNK) {
      const nodes = legacyNodes.slice(i, i + CHUNK);
      if (guestSession()) {
        for (const node of nodes) {
          await localSet('dimensionNodes', `${workspaceId}_${node.dimensionId}_${node.id}`, { ...node, workspaceId });
        }
        migratedCount += nodes.length;
        continue;
      }
      const result = await runNamedCommand<{ migrated: number }>('workspace.dimensionnodesmigrate', { nodes }, { workspaceId });
      migratedCount += result.migrated;
    }

    // the last chunk cleared the legacy field inside the same transaction; an empty tree is cleared here
    if (legacyNodes.length === 0 && guestSession()) await localUpdate('workspaces', workspaceId, { dimensionNodes: null });

    return { migratedCount, workspaceId, success: true };
  } catch (err) {
    console.error(`[DimensionNodesMigration] Failed for workspace ${workspaceId}:`, err);
    return {
      migratedCount: 0,
      workspaceId,
      success: false,
      error: (err as Error)?.message || String(err)
    };
  }
}
