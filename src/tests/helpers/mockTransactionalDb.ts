/**
 * The in-memory transactional database the server tests run against: documents are kept in a map,
 * a `runTransaction` copies them, hands the copy to the callback and keeps it only when the callback
 * returns (so a refusal leaves the first copy untouched, as Firestore does). With `serialize` the
 * transactions run one after another, which is how a concurrency test proves numbering has no gaps.
 */
import type { TestDocument, TestDocumentReference, TestSnapshot, TestTransaction } from './mockTypes';

export interface MockTransactionalDbOptions {
  /** Run one transaction at a time, in call order (the numbering series test needs this). */
  serialize?: boolean;
}

export class MockTransactionalDb {
  public data: Map<string, TestDocument> = new Map();
  private transactionQueue: Promise<unknown> = Promise.resolve();
  private readonly serialize: boolean;

  constructor(options: MockTransactionalDbOptions = {}) {
    this.serialize = options.serialize === true;
  }

  collection(collName: string) {
    return {
      doc: (docId?: string) => {
        const id = docId || `id_${Math.random().toString(36).substring(2, 9)}`;
        const key = `${collName}/${id}`;
        return {
          id,
          key,
          get: async (): Promise<TestSnapshot> => {
            const val = this.data.get(key);
            return { exists: val !== undefined, id, data: () => val ? JSON.parse(JSON.stringify(val)) : undefined };
          }
        };
      }
    };
  }

  async runTransaction<T>(updateFunction: (tx: TestTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const snapshotMap = new Map<string, TestDocument>();
      for (const [k, v] of this.data.entries()) {
        snapshotMap.set(k, JSON.parse(JSON.stringify(v)));
      }

      const tx = {
        get: async (docRef: TestDocumentReference): Promise<TestSnapshot> => {
          const val = snapshotMap.get(docRef.key);
          return { exists: val !== undefined, id: docRef.id, data: () => val ? JSON.parse(JSON.stringify(val)) : undefined };
        },
        update: (docRef: TestDocumentReference, updates: TestDocument) => {
          const current = snapshotMap.get(docRef.key) || {};
          snapshotMap.set(docRef.key, { ...current, ...updates });
        },
        set: (docRef: TestDocumentReference, newData: TestDocument) => {
          snapshotMap.set(docRef.key, newData);
        },
        create: (docRef: TestDocumentReference, newData: TestDocument) => {
          snapshotMap.set(docRef.key, newData);
        },
        delete: (docRef: TestDocumentReference) => {
          snapshotMap.delete(docRef.key);
        },
        getAll: async (...docRefs: TestDocumentReference[]): Promise<TestSnapshot[]> =>
          docRefs.map(ref => {
            const val = snapshotMap.get(ref.key);
            return { exists: val !== undefined, id: ref.id, data: () => val ? JSON.parse(JSON.stringify(val)) : undefined };
          })
      };

      const res = await updateFunction(tx);
      this.data = snapshotMap;
      return res;
    };

    if (!this.serialize) return run();
    const resultPromise = this.transactionQueue.then(run);
    this.transactionQueue = resultPromise.catch(() => {});
    return resultPromise;
  }

  getDocData(collName: string, docId: string) {
    const val = this.data.get(`${collName}/${docId}`);
    return val ? JSON.parse(JSON.stringify(val)) : undefined;
  }

  getCollectionDocs(collName: string) {
    const docs: TestDocument[] = [];
    const prefix = `${collName}/`;
    for (const [k, v] of this.data.entries()) {
      if (k.startsWith(prefix)) docs.push(JSON.parse(JSON.stringify(v)));
    }
    return docs;
  }
}
