import { guestSession, guestRows, writeGuestBatch, SAMPLE_WORKSPACE_ID } from '../lib/db/guestDatabase';
import { priceListsProblem, type PriceList } from '../lib/priceLists';
import { runCommand } from '../lib/runCommand';

/** Same list validation in the local sample; real workspaces retain their existing server route. */
export async function saveWorkspacePriceLists(workspaceId: string, input: unknown[]): Promise<PriceList[]> {
  const sampleSession = guestSession();
  if (sampleSession) {
    if (workspaceId !== SAMPLE_WORKSPACE_ID) throw new Error('Only the sample company can be changed in the demo.');
    const workspace = guestRows('workspaces').find(row => row.id === workspaceId)?.data;
    const problem = priceListsProblem(input, String(workspace?.currency || 'USD'));
    if (problem) throw new Error(problem);
    const lists = input.map(raw => {
      const list = raw as PriceList;
      return { ...list, id: list.id || `pl_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}` };
    });
    writeGuestBatch([{ op: 'set', table: 'workspaces', id: workspaceId, merge: true, data: { priceLists: lists } }], sampleSession);
    return lists;
  }
  if (workspaceId === SAMPLE_WORKSPACE_ID) throw new Error('The sample company is closed.');
  const data = await runCommand<{ lists?: PriceList[] }>({
    path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/price-lists`,
    method: 'PUT',
    body: { lists: input },
  }) ?? {};
  // an answer without the saved lists means the save was not confirmed; saying so beats returning nothing
  if (!Array.isArray(data.lists)) throw new Error('The price lists were not saved');
  return data.lists;
}
