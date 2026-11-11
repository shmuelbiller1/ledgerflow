import { FieldValue, type Firestore, type QueryDocumentSnapshot } from "../db/firestore";

export async function incrementShardedCounter(
  db: Firestore, 
  workspaceId: string, 
  metric: 'totalQueriesThisMonth' | 'computeCreditBalance', 
  value: number
): Promise<void> {
  try {
    const numShards = 10;
    const shardId = Math.floor(Math.random() * numShards);
    const docId = `shard_${workspaceId}_${metric}_${shardId}`;
    const shardRef = db.collection('workspaceShards').doc(docId);
    await shardRef.set({
      workspaceId,
      metric,
      shardId,
      value: FieldValue.increment(value)
    }, { merge: true });
  } catch (err) {
    console.error("Failed to increment sharded counter:", err);
  }
}

export async function getShardedCounterValue(
  db: Firestore, 
  workspaceId: string, 
  metric: 'totalQueriesThisMonth' | 'computeCreditBalance', 
  baseline: number
): Promise<number> {
  try {
    const snapshot = await db.collection('workspaceShards')
      .where('workspaceId', '==', workspaceId)
      .where('metric', '==', metric)
      .get();
    
    let shardSum = 0;
    snapshot.forEach((doc: QueryDocumentSnapshot) => {
      shardSum += (doc.data()?.value || 0);
    });
    
    return baseline + shardSum;
  } catch (err) {
    console.error("Failed to get sharded counter value:", err);
    return baseline;
  }
}
