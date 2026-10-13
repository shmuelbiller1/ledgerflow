/**
 * A-45: reading the stock-moves ledger for a count sheet. One read of the workspace's moves, the same
 * client-side read the Stock history window does (`stockMoves` is written by the server with each
 * change, W-02). Nothing is written or posted here: posting a count is the server's stock-count path.
 */
import { db } from '../firebase';
import { collection, getDocs, query, where } from './db/firestore';
import { orderedMoves, type StockMove } from './stockMoves';

/** The workspace's stock moves, oldest first, so per-location quantities can be computed. */
export async function loadWorkspaceStockMoves(workspaceId: string): Promise<StockMove[]> {
  const snap = await getDocs(query(collection(db, 'stockMoves'), where('workspaceId', '==', workspaceId)));
  return orderedMoves(snap.docs.map(d => ({ ...(d.data() as StockMove), id: d.id })));
}
