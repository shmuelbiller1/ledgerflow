import { FieldValue, type Firestore, type Transaction } from "../db/firestore";

type Metric = 'totalQueriesThisMonth' | 'computeCreditBalance';

function shardIncrement(db: Firestore, workspaceId: string, metric: Metric, value: number) {
  const shardId = Math.floor(Math.random() * 10);
  return { ref: db.collection('workspaceShards').doc(`shard_${workspaceId}_${metric}_${shardId}`),
    data: { workspaceId, metric, shardId, value: FieldValue.increment(value) } };
}

export function stageShardedCounterIncrement(db: Firestore, tx: Transaction, workspaceId: string, metric: Metric, value: number): void {
  const { ref, data } = shardIncrement(db, workspaceId, metric, value);
  tx.set(ref, data, { merge: true });
}

export async function incrementShardedCounter(db: Firestore, workspaceId: string, metric: Metric, value: number): Promise<void> {
  try {
    const { ref, data } = shardIncrement(db, workspaceId, metric, value);
    await ref.set(data, { merge: true });
  } catch (err) {
    console.error("Failed to increment sharded counter:", err);
  }
}

export async function getShardedCounterValue(
  db: Firestore, 
  workspaceId: string, 
  metric: Metric,
  baseline: number,
  tx?: Transaction,
): Promise<number> {
  try {
    const query = db.collection('workspaceShards').where('workspaceId', '==', workspaceId).where('metric', '==', metric);
    const snapshot = await (tx ? tx.get(query) : query.get());
    let sum = 0;
    snapshot.forEach(doc => { sum += doc.data()?.value || 0; });
    return baseline + sum;
  } catch (err) {
    // A command's counter reads and writes are part of its commit, not best-effort usage telemetry.
    if (tx) throw err;
    console.error("Failed to get sharded counter value:", err);
    return baseline;
  }
}
