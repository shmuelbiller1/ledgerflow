/**
 * The sample company's own store — the one place a demo-mode write lives.
 *
 * Two kinds of write exist in the browser, and only two:
 *
 *  - a **command** (`useCommand` → a registered route), which is how a signed-in screen changes the
 *    workspace's records. The server decides, the browser asks.
 *  - a **local store** write, which is how the sample company changes its own records. The sample
 *    company has no workspace on the server, so there is nothing to ask: `firestore.ts` routes these
 *    calls to the in-memory guest database, and nothing leaves the tab.
 *
 * Before this module they were the same six function names (`setDoc`, `updateDoc`, `deleteDoc`,
 * `addDoc`, `writeBatch`, `runTransaction`) in both worlds, so a screen could not tell the two apart
 * by reading it — and a hook that meant "the demo's local copy" looked exactly like a hook that
 * wrote to Postgres from the browser. Every demo write goes through here now, which is also what
 * makes it checkable: `assertGuestSession` refuses a signed-in session, so a call site that forgot
 * its guest branch fails loudly instead of writing to a workspace that never asked for it.
 *
 * What this module is *not*: a second way to write real records. It does not queue, retry, or
 * reconcile — the sample company is the whole database, and it is in this tab.
 */
import { db } from '../../firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
  type SetOptions,
} from './firestore';
import { assertGuestSession, guestSession } from './guestDatabase';

/**
 * Every entry point starts here: no guest session, no write. The message is the one the demo already
 * shows when its tab was closed under a screen — "reopen the demo" is the only useful next step.
 */
function requireLocalStore(): void {
  assertGuestSession(guestSession());
}

/** Create a record in the sample company and return its id. */
export async function localAdd(table: string, data: DocumentData): Promise<string> {
  requireLocalStore();
  const ref = await addDoc(collection(db, table), data);
  return ref.id;
}

/** Write a record in the sample company, replacing it (`merge` keeps the fields it does not name). */
export async function localSet(table: string, id: string, data: DocumentData, options?: SetOptions): Promise<void> {
  requireLocalStore();
  await setDoc(doc(db, table, id), data, options);
}

/** Read one record of the sample company, for a check the write depends on (a conflict, an allowance). */
export async function localGet(table: string, id: string): Promise<DocumentData | undefined> {
  requireLocalStore();
  const snapshot = await getDoc(doc(db, table, id));
  return snapshot.exists() ? snapshot.data() : undefined;
}

/** Change some fields of a record in the sample company. */
export async function localUpdate(table: string, id: string, data: DocumentData): Promise<void> {
  requireLocalStore();
  await updateDoc(doc(db, table, id), data);
}

/** Remove a record from the sample company. */
export async function localDelete(table: string, id: string): Promise<void> {
  requireLocalStore();
  await deleteDoc(doc(db, table, id));
}

/**
 * Change several records of one table together — the demo's version of a single command that touches
 * every rule in a group. One entry per record, so a caller cannot forget which records it changed.
 */
export async function localUpdateMany(table: string, entries: ReadonlyArray<{ id: string; data: DocumentData }>): Promise<void> {
  requireLocalStore();
  if (entries.length === 0) return;
  const batch = writeBatch(db);
  entries.forEach(entry => batch.update(doc(db, table, entry.id), entry.data));
  await batch.commit();
}
