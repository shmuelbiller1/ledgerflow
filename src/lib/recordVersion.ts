/**
 * Optimistic concurrency control for entries: has a record moved on since the caller read it?
 *
 * The version a caller sends is the `updatedAt` it saw — an ISO string, a Firestore-style timestamp
 * with `seconds`/`nanoseconds`, or an object with `toMillis`/`toDate`. Two versions are the same when
 * they are within 100 ms of each other, so a database that rounds to seconds, or re-serialises a
 * timestamp with a few microseconds of drift, does not make every save look like a conflict.
 *
 * This lived in `routes/transactions/helpers.ts`. The batch-update service needs it inside its own
 * transaction, and a service may not import from `routes/` (the routers import the services), so the
 * pure comparison lives here and the routes re-export it.
 */
type TimestampLike = { toMillis?: () => number; toDate?: () => Date; seconds?: number; nanoseconds?: number };

function millisOf(raw: unknown): number | null {
  const value = (raw && typeof raw === 'object' ? raw : {}) as TimestampLike;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  const ms = new Date(raw as string | number | Date).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** True when the record's current version is not the one the caller expected. */
export function isUpdatedAtMismatch(expected: unknown, current: unknown): boolean {
  if (!expected || !current) return false;
  const expectedMs = millisOf(expected);
  const currentMs = millisOf(current);
  if (expectedMs === null || currentMs === null) return String(expected) !== String(current);
  return Math.abs(expectedMs - currentMs) > 100;
}
