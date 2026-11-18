import crypto from 'node:crypto';

/**
 * Values for the Postgres Firestore layer: errors, Timestamp, FieldPath, FieldValue, and how
 * documents are encoded for storage (see ../pgFirestore.ts).
 */
// Documents are free-form JSON whose fields the routes read directly, so field values are
// deliberately untyped, as in firebase-admin's own DocumentData.
export type FieldValueAny = any;
export type DocumentData = { [field: string]: FieldValueAny };
export type WhereFilterOp =
  | '<' | '<=' | '==' | '!=' | '>=' | '>'
  | 'array-contains' | 'in' | 'not-in' | 'array-contains-any';
export type OrderByDirection = 'asc' | 'desc';
export interface SetOptions { merge?: boolean }
export interface Precondition { exists?: boolean }
export interface WriteResult { writeTime: Timestamp }

// ---------------------------------------------------------------------------
// Errors (numeric gRPC codes and "5 NOT_FOUND: ..." messages, like firebase-admin)
// ---------------------------------------------------------------------------

const STATUS_NAMES: Record<number, string> = {
  3: 'INVALID_ARGUMENT',
  5: 'NOT_FOUND',
  6: 'ALREADY_EXISTS',
  7: 'PERMISSION_DENIED',
  9: 'FAILED_PRECONDITION',
  10: 'ABORTED',
  13: 'INTERNAL',
  14: 'UNAVAILABLE',
};

export class FirestoreError extends Error {
  readonly details: string;
  constructor(readonly code: number, details: string, options?: { cause?: unknown }) {
    super(`${code} ${STATUS_NAMES[code] || 'UNKNOWN'}: ${details}`, options);
    this.name = 'FirestoreError';
    this.details = details;
  }
}

export const invalid = (details: string) => new FirestoreError(3, details);

// ---------------------------------------------------------------------------
// Timestamp, FieldPath, FieldValue
// ---------------------------------------------------------------------------

export class Timestamp {
  constructor(readonly seconds: number, readonly nanoseconds: number) {}
  static now(): Timestamp { return Timestamp.fromMillis(Date.now()); }
  static fromDate(date: Date): Timestamp { return Timestamp.fromMillis(date.getTime()); }
  static fromMillis(ms: number): Timestamp {
    const seconds = Math.floor(ms / 1000);
    return new Timestamp(seconds, Math.round((ms - seconds * 1000) * 1e6));
  }
  toMillis(): number { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate(): Date { return new Date(this.toMillis()); }
  toISOString(): string { return this.toDate().toISOString(); }
  toJSON(): string { return this.toISOString(); }
  isEqual(other: Timestamp): boolean {
    return other instanceof Timestamp && other.seconds === this.seconds && other.nanoseconds === this.nanoseconds;
  }
}

export class FieldPath {
  readonly segments: string[];
  constructor(...segments: string[]) {
    if (segments.length === 0 || segments.some(s => !s)) throw invalid('A field path needs non-empty segments');
    this.segments = segments;
  }
  static documentId(): FieldPath { return new FieldPath(DOCUMENT_ID); }
  toString(): string { return this.segments.join('.'); }
}

export const DOCUMENT_ID = '__name__';

type SentinelKind = 'serverTimestamp' | 'delete' | 'increment' | 'arrayUnion' | 'arrayRemove';

export class FieldValue {
  private constructor(readonly kind: SentinelKind, readonly operand?: unknown) {}
  static serverTimestamp(): FieldValue { return new FieldValue('serverTimestamp'); }
  static delete(): FieldValue { return new FieldValue('delete'); }
  static increment(n: number): FieldValue {
    if (typeof n !== 'number' || !Number.isFinite(n)) throw invalid('FieldValue.increment() needs a finite number');
    return new FieldValue('increment', n);
  }
  static arrayUnion(...elements: unknown[]): FieldValue { return new FieldValue('arrayUnion', elements); }
  static arrayRemove(...elements: unknown[]): FieldValue { return new FieldValue('arrayRemove', elements); }
  isEqual(other: FieldValue): boolean {
    return other instanceof FieldValue && other.kind === this.kind
      && JSON.stringify(other.operand) === JSON.stringify(this.operand);
  }
}

export function toSegments(field: string | FieldPath): string[] {
  if (field instanceof FieldPath) return field.segments;
  if (typeof field !== 'string' || !field) throw invalid('A field path must be a non-empty string');
  const segments = field.split('.');
  if (segments.some(s => !s)) throw invalid(`Invalid field path "${field}"`);
  return segments;
}

export function readPath(data: unknown, segments: string[]): unknown {
  let cur: unknown = data;
  for (const s of segments) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Encoding values for storage
// ---------------------------------------------------------------------------

/** What writes and filters need from a document reference (any document type). */
export interface RefLike { readonly collectionId: string; readonly id: string; readonly path: string }

export function isRefLike(value: unknown): value is RefLike {
  if (typeof value !== 'object' || value === null || !('firestore' in value)) return false;
  const ref = value as Partial<Record<keyof RefLike, unknown>>;
  return typeof ref.collectionId === 'string' && typeof ref.id === 'string' && typeof ref.path === 'string';
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Converts a value to what is stored in jsonb. Sentinels are handled by splitWrite. */
export function encodeValue(value: unknown, now: string): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof FieldValue) {
    if (value.kind === 'serverTimestamp') return now;
    throw invalid(`FieldValue.${value.kind}() must be a field value, not inside an array`);
  }
  if (value instanceof Timestamp || value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value.toISOString();
  }
  if (isRefLike(value)) return value.path;
  if (Array.isArray(value)) return value.map(v => encodeValue(v, now));
  if (typeof value === 'string') return stripNul(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'function' || typeof value === 'symbol') return null;
  if (typeof value === 'object') {
    if (!isPlainObject(value)) {
      const withJson = value as { toJSON?: () => unknown };
      if (typeof withJson.toJSON === 'function') return encodeValue(withJson.toJSON(), now);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[stripNul(k)] = encodeValue(v, now);
    }
    return out;
  }
  return value;
}

/** Postgres text and jsonb can't hold the NUL character (Firestore could); it is dropped. */
export function stripNul(text: string): string {
  return text.includes('\u0000') ? text.split('\u0000').join('') : text;
}

/** A write split into plain data plus the Firestore transforms, keyed by dotted field path. */
export interface Patch {
  data: Record<string, unknown>;
  unset: string[];
  inc: Record<string, number>;
  union: Record<string, unknown[]>;
  remove: Record<string, unknown[]>;
}

export function hasTransforms(p: Patch): boolean {
  return p.unset.length > 0 || Object.keys(p.inc).length > 0
    || Object.keys(p.union).length > 0 || Object.keys(p.remove).length > 0;
}

export function splitWrite(input: Record<string, unknown>, now: string): Patch {
  const patch: Patch = { data: {}, unset: [], inc: {}, union: {}, remove: {} };
  const walk = (obj: Record<string, unknown>, prefix: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(obj)) {
      if (raw === undefined) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (raw instanceof FieldValue) {
        switch (raw.kind) {
          case 'serverTimestamp': out[key] = now; break;
          case 'delete': patch.unset.push(path); break;
          case 'increment': patch.inc[path] = raw.operand as number; break;
          case 'arrayUnion': patch.union[path] = (raw.operand as unknown[]).map(v => encodeValue(v, now)); break;
          case 'arrayRemove': patch.remove[path] = (raw.operand as unknown[]).map(v => encodeValue(v, now)); break;
        }
        continue;
      }
      out[stripNul(key)] = isPlainObject(raw) ? walk(raw, path) : encodeValue(raw, now);
    }
    return out;
  };
  patch.data = walk(input, '');
  return patch;
}


const AUTO_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 20-character random id, like Firestore's auto ids. */
export function autoId(): string {
  let id = '';
  while (id.length < 20) {
    for (const byte of crypto.randomBytes(40)) {
      // 62 * 4 = 248: reject the top bytes so every character is equally likely
      if (byte < 248 && id.length < 20) id += AUTO_ID_CHARS[byte % 62];
    }
  }
  return id;
}
